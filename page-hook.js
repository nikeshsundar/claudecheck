(() => {
  if (window.__cwbUsageHookInstalled) {
    return;
  }

  window.__cwbUsageHookInstalled = true;

  const MAX_BODY_CHARS = 500000;
  const MAX_REPLY_TEXT_CHARS = 120000;
  const POST_USAGE_TYPE = "CWB_USAGE_SIGNAL";
  const POST_REPLY_STREAM_TYPE = "CWB_REPLY_STREAM";
  const TARGET_ORIGIN = window.location.origin;
  const MESSAGE_HINT = /message|messages|prompt|chat|conversation|request/i;

  const LIMIT_KEYS = [
    "message_limit",
    "messages_limit",
    "messagelimit",
    "max_messages",
    "maxmessages",
    "messages_allowed",
    "message_cap",
    "messagecap",
    "quota_messages",
    "allowed_messages"
  ];

  const USED_KEYS = [
    "messages_used",
    "used_messages",
    "messagesused",
    "message_count_used",
    "messagecountused",
    "prompts_used",
    "requests_used"
  ];

  const REMAINING_KEYS = [
    "messages_remaining",
    "remaining_messages",
    "messagesremaining",
    "remainingmessages",
    "messages_left",
    "messagesleft",
    "remaining_message_count",
    "remainingmessagecount"
  ];

  const RESET_KEYS = [
    "reset_at",
    "resetat",
    "reset_time",
    "resettime",
    "window_end",
    "windowend",
    "period_end",
    "periodend",
    "next_reset"
  ];

  let lastUsageHash = "";
  let lastUsageEmitAt = 0;
  let lastReplyHash = "";
  let lastReplyEmitAt = 0;

  function toNumber(value) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === "string") {
      const parsed = Number(value.trim());
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }

    return null;
  }

  function parseResetAt(value) {
    const numeric = toNumber(value);
    if (numeric != null) {
      if (numeric > 1e12) {
        return Math.round(numeric);
      }

      if (numeric > 1e9) {
        return Math.round(numeric * 1000);
      }
    }

    if (typeof value === "string") {
      const parsed = Date.parse(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }

    return null;
  }

  function keyPattern(key) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`\"${escaped}\"\\s*:\\s*\"?(-?\\d+(?:\\.\\d+)?)\"?`, "i");
  }

  function extractNumberByKeys(text, keys) {
    for (const key of keys) {
      const match = text.match(keyPattern(key));
      if (!match) {
        continue;
      }

      const parsed = toNumber(match[1]);
      if (parsed != null) {
        return parsed;
      }
    }

    return null;
  }

  function extractResetByKeys(text) {
    for (const key of RESET_KEYS) {
      const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const pattern = new RegExp(`\"${escaped}\"\\s*:\\s*(\"[^\"]+\"|-?\\d+(?:\\.\\d+)?)`, "i");
      const match = text.match(pattern);
      if (!match) {
        continue;
      }

      const raw = match[1].replace(/^\"|\"$/g, "");
      const parsed = parseResetAt(raw);
      if (parsed != null) {
        return parsed;
      }
    }

    return null;
  }

  function scoreCandidate(candidate, text) {
    let score = 0;
    if (candidate.limit != null) {
      score += 2;
    }

    if (candidate.used != null) {
      score += 2;
    }

    if (candidate.remaining != null) {
      score += 2;
    }

    if (candidate.resetAt != null) {
      score += 1;
    }

    if (MESSAGE_HINT.test(text)) {
      score += 2;
    }

    return score;
  }

  function parseTextUsage(text) {
    if (!text || text.length > MAX_BODY_CHARS) {
      return null;
    }

    const lower = text.toLowerCase();

    const limit = extractNumberByKeys(lower, LIMIT_KEYS);
    const used = extractNumberByKeys(lower, USED_KEYS);
    const remaining = extractNumberByKeys(lower, REMAINING_KEYS);
    const resetAt = extractResetByKeys(lower);

    const candidate = {
      limit,
      used,
      remaining,
      resetAt
    };

    const hasCounters = candidate.limit != null || candidate.used != null || candidate.remaining != null;
    if (!hasCounters) {
      return null;
    }

    if (candidate.used == null && candidate.limit != null && candidate.remaining != null) {
      candidate.used = Math.max(0, candidate.limit - candidate.remaining);
    }

    if (candidate.remaining == null && candidate.limit != null && candidate.used != null) {
      candidate.remaining = Math.max(0, candidate.limit - candidate.used);
    }

    const score = scoreCandidate(candidate, lower);
    if (score < 6) {
      return null;
    }

    return candidate;
  }

  function postUsage(payload) {
    const normalized = {
      limit: Number.isFinite(payload.limit) && payload.limit > 0 ? Math.round(payload.limit) : undefined,
      used: Number.isFinite(payload.used) && payload.used >= 0 ? Math.round(payload.used) : undefined,
      remaining: Number.isFinite(payload.remaining) && payload.remaining >= 0 ? Math.round(payload.remaining) : undefined,
      resetAt: Number.isFinite(payload.resetAt) ? payload.resetAt : undefined
    };

    const hasUsage =
      normalized.limit !== undefined || normalized.used !== undefined || normalized.remaining !== undefined;

    if (!hasUsage) {
      return;
    }

    const hash = JSON.stringify(normalized);
    const now = Date.now();
    if (hash === lastUsageHash && now - lastUsageEmitAt < 2500) {
      return;
    }

    lastUsageHash = hash;
    lastUsageEmitAt = now;

    window.postMessage(
      {
        source: "cwb-hook",
        type: POST_USAGE_TYPE,
        payload: normalized
      },
      TARGET_ORIGIN
    );
  }

  function extractSseChunk(payload) {
    if (!payload || typeof payload !== "object") {
      return null;
    }

    const eventType = typeof payload.type === "string" ? payload.type : "";
    const blockIndex = Number.isFinite(payload.index) ? payload.index : "x";

    if (eventType === "message_stop") {
      return {
        mode: "stop",
        text: "",
        signature: ""
      };
    }

    if (eventType === "content_block_delta" && payload.delta && typeof payload.delta.text === "string") {
      const deltaType = typeof payload.delta.type === "string" ? payload.delta.type : "";
      if (deltaType === "text_delta") {
        return {
          mode: "delta",
          text: payload.delta.text,
          signature: `${eventType}:${blockIndex}:${payload.delta.text}`
        };
      }

      return null;
    }

    return null;
  }

  function overlapSuffixPrefix(base, piece) {
    if (!base || !piece) {
      return 0;
    }

    const maxOverlap = Math.min(base.length, piece.length);
    for (let size = maxOverlap; size > 0; size -= 1) {
      if (base.endsWith(piece.slice(0, size))) {
        return size;
      }
    }

    return 0;
  }

  function appendWithOverlap(base, piece) {
    if (typeof piece !== "string" || !piece) {
      return base;
    }

    if (!base) {
      return piece;
    }

    if (base.endsWith(piece)) {
      return base;
    }

    const overlap = overlapSuffixPrefix(base, piece);
    return `${base}${piece.slice(overlap)}`;
  }

  function parseSseDataLine(line) {
    if (typeof line !== "string") {
      return null;
    }

    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) {
      return null;
    }

    const raw = trimmed.slice(5).trim();
    if (!raw || raw === "[DONE]") {
      return null;
    }

    try {
      const parsed = JSON.parse(raw);
      return extractSseChunk(parsed);
    } catch {
      return null;
    }
  }

  function appendSseChunk(completion, chunk, streamState) {
    if (!chunk) {
      return completion;
    }

    if (chunk.mode === "stop") {
      streamState.sawStop = true;
      return completion;
    }

    if (typeof chunk.text !== "string" || !chunk.text) {
      return completion;
    }

    if (chunk.mode === "delta") {
      streamState.sawDelta = true;

      const signature = chunk.signature || chunk.text;
      if (signature && signature === streamState.lastDeltaSignature) {
        return completion;
      }

      if (completion.endsWith(chunk.text)) {
        return completion;
      }

      streamState.lastDeltaSignature = signature;
      return appendWithOverlap(completion, chunk.text);
    }

    return completion;
  }

  function postReplyStream(completionText) {
    const text = typeof completionText === "string" ? completionText : "";
    if (!text) {
      return;
    }

    const boundedText =
      text.length > MAX_REPLY_TEXT_CHARS ? text.slice(text.length - MAX_REPLY_TEXT_CHARS) : text;
    const replyChars = boundedText.length;
    if (!Number.isFinite(replyChars) || replyChars <= 0) {
      return;
    }

    const payload = {
      replyChars,
      replyTokens: Math.max(1, Math.round(replyChars / 4)),
      replyText: boundedText
    };

    const hash = JSON.stringify(payload);
    const now = Date.now();
    if (hash === lastReplyHash && now - lastReplyEmitAt < 2500) {
      return;
    }

    lastReplyHash = hash;
    lastReplyEmitAt = now;

    window.postMessage(
      {
        source: "cwb-hook",
        type: POST_REPLY_STREAM_TYPE,
        payload
      },
      TARGET_ORIGIN
    );
  }

  function parseSseCompletionText(text) {
    if (!text || typeof text !== "string") {
      return {
        completion: "",
        sawStop: false
      };
    }

    const bounded = text.length > MAX_BODY_CHARS ? text.slice(text.length - MAX_BODY_CHARS) : text;
    const lines = bounded.split(/\r?\n/);
    let completion = "";
    const streamState = {
      sawDelta: false,
      sawStop: false,
      lastDeltaSignature: ""
    };

    for (const line of lines) {
      const chunk = parseSseDataLine(line);
      completion = appendSseChunk(completion, chunk, streamState);
    }

    return {
      completion,
      sawStop: streamState.sawStop
    };
  }

  function isLikelyClaudeApiUrl(url) {
    if (!url || typeof url !== "string") {
      return false;
    }

    return /claude\.ai/i.test(url) && /(api|graphql|backend|chat|messages)/i.test(url);
  }

  function getRequestUrl(input) {
    if (typeof input === "string") {
      return input;
    }

    if (input && typeof input === "object" && typeof input.url === "string") {
      return input.url;
    }

    return "";
  }

  function isLikelyStreamingUrl(url) {
    if (!url || typeof url !== "string") {
      return false;
    }

    return /(append_message|messages|completion|conversation|stream)/i.test(url);
  }

  async function inspectResponseBody(url, contentType, textPromise) {
    if (!isLikelyClaudeApiUrl(url)) {
      return;
    }

    if (typeof contentType === "string" && !/json|text/i.test(contentType)) {
      return;
    }

    try {
      const text = await textPromise;
      const parsed = parseTextUsage(text);
      if (parsed) {
        postUsage(parsed);
      }
    } catch {
      // Ignore parsing errors.
    }
  }

  async function inspectResponseStream(url, contentType, bodyStream) {
    if (!isLikelyClaudeApiUrl(url)) {
      return;
    }

    const isEventStream = typeof contentType === "string" && /event-stream/i.test(contentType);
    if (!isEventStream && !isLikelyStreamingUrl(url)) {
      return;
    }

    if (!bodyStream || typeof bodyStream.getReader !== "function") {
      return;
    }

    const reader = bodyStream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let completion = "";
    const streamState = {
      sawDelta: false,
      sawStop: false,
      lastDeltaSignature: ""
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        if (!value) {
          continue;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || "";

        for (const line of lines) {
          const chunk = parseSseDataLine(line);
          completion = appendSseChunk(completion, chunk, streamState);
        }
      }

      buffer += decoder.decode();
      if (buffer) {
        const lines = buffer.split(/\r?\n/);
        for (const line of lines) {
          const chunk = parseSseDataLine(line);
          completion = appendSseChunk(completion, chunk, streamState);
        }
      }

      if (streamState.sawStop || completion) {
        postReplyStream(completion);
      }
    } catch {
      // Ignore streaming parse errors.
    }
  }

  function inspectResponseStreamText(url, contentType, text) {
    if (!isLikelyClaudeApiUrl(url)) {
      return;
    }

    if (typeof text !== "string" || !text) {
      return;
    }

    const sseLikeContentType = typeof contentType === "string" && /event-stream/i.test(contentType);
    const sseLikeBody = /(^|\n)\s*data:/i.test(text);
    if (!sseLikeContentType && !sseLikeBody) {
      return;
    }

    const parsed = parseSseCompletionText(text);
    if (parsed.sawStop || parsed.completion) {
      postReplyStream(parsed.completion);
    }
  }

  function patchFetch() {
    if (!window.fetch) {
      return;
    }

    const originalFetch = window.fetch;
    window.fetch = async function patchedFetch(...args) {
      const response = await originalFetch.apply(this, args);

      try {
        const url = getRequestUrl(args[0]) || response.url;
        const contentType = response.headers ? response.headers.get("content-type") : "";
        inspectResponseBody(url, contentType, response.clone().text());
        inspectResponseStream(url, contentType, response.clone().body);
      } catch {
        // Ignore hook errors.
      }

      return response;
    };
  }

  function patchXhr() {
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function patchedOpen(method, url, ...rest) {
      this.__cwbUrl = typeof url === "string" ? url : "";
      return originalOpen.call(this, method, url, ...rest);
    };

    XMLHttpRequest.prototype.send = function patchedSend(...args) {
      this.addEventListener(
        "loadend",
        () => {
          try {
            const contentType = this.getResponseHeader("content-type") || "";
            const responseText = typeof this.responseText === "string" ? this.responseText : "";
            const url = this.__cwbUrl || this.responseURL;
            inspectResponseBody(url, contentType, Promise.resolve(responseText));
            inspectResponseStreamText(url, contentType, responseText);
          } catch {
            // Ignore hook errors.
          }
        },
        { once: true }
      );

      return originalSend.apply(this, args);
    };
  }

  patchFetch();
  patchXhr();
})();
