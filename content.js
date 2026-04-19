const STORAGE_KEYS = ["settings", "officialUsage", "approxUsage"];
const MODEL_CONTEXT_DEFAULTS = {
  haiku: 200000,
  sonnet: 200000,
  opus: 200000,
  custom: 200000
};

const LEGACY_MODEL_CONTEXT_DEFAULTS = {
  sonnet: 1000000,
  opus: 1000000
};

const DEFAULT_SETTINGS = {
  maxMessages: 45,
  windowHours: 5,
  warnAtPercent: 85,
  tokenUnitPerMessage: 2800,
  modelProfile: "sonnet",
  contextWindowTokens: MODEL_CONTEXT_DEFAULTS.sonnet,
  useEstimatorFallback: true
};

const OFFICIAL_TTL_MS = 3 * 60 * 1000;
const OFFICIAL_STUCK_AFTER_TURN_MS = 12000;
const DOM_OFFICIAL_TTL_MS = 45 * 1000;
const DOM_SCAN_DEBOUNCE_MS = 1200;
const SAVE_THROTTLE_MS = 2200;
const STREAM_REPLY_FINALIZE_DELAY_MS = 900;
const PENDING_TURN_SAMPLE_SCHEDULE_MS = [2500, 7000, 14000, 24000, 36000];
const APPROX_WINDOW_START_SKEW_MS = 1500;

const state = {
  settings: { ...DEFAULT_SETTINGS },
  officialUsage: null,
  approxUsage: defaultApproxUsage()
};

let rootEl;
let titleEl;
let sourceEl;
let statsEl;
let detailEl;
let meterFillEl;
let listenersAttached = false;
let tickerId;
let observer;
let domScanTimer;
let saveTimer;
let pendingTurn;
let lastSignal = {
  ts: 0,
  text: ""
};
let runtimeUnavailable = false;
let approxSaveSequence = 0;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function defaultApproxUsage() {
  return {
    windowStart: Date.now(),
    messageUnitsUsed: 0,
    contextTokens: 0,
    lastPromptTokens: 0,
    lastResponseTokens: 0,
    lastTurnTokens: 0,
    lastTurnAt: 0,
    lastUpdatedAt: 0
  };
}

function parseIntSafe(value) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseFloatSafe(value) {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isExtensionContextValid() {
  try {
    return (
      typeof chrome !== "undefined" &&
      !!chrome.runtime &&
      !!chrome.runtime.id &&
      !!chrome.storage &&
      !!chrome.storage.local
    );
  } catch {
    return false;
  }
}

function isContextInvalidatedError(error) {
  if (!error || typeof error !== "object") {
    return false;
  }

  const message = typeof error.message === "string" ? error.message : "";
  return /extension context invalidated/i.test(message);
}

function stopRuntimeLoops() {
  if (tickerId) {
    window.clearInterval(tickerId);
    tickerId = undefined;
  }

  if (domScanTimer) {
    window.clearTimeout(domScanTimer);
    domScanTimer = undefined;
  }

  if (saveTimer) {
    window.clearTimeout(saveTimer);
    saveTimer = undefined;
  }

  clearPendingTurnTimers();

  if (observer) {
    observer.disconnect();
    observer = undefined;
  }
}

function handleRuntimeError(error) {
  if (!isContextInvalidatedError(error)) {
    return false;
  }

  runtimeUnavailable = true;
  stopRuntimeLoops();
  if (rootEl) {
    rootEl.classList.add("cwb-hidden");
  }

  return true;
}

async function storageGetSafe(keys) {
  if (runtimeUnavailable || !isExtensionContextValid()) {
    return {};
  }

  try {
    return await chrome.storage.local.get(keys);
  } catch (error) {
    handleRuntimeError(error);
    return {};
  }
}

function storageSetSafe(value) {
  if (runtimeUnavailable || !isExtensionContextValid()) {
    return;
  }

  try {
    const promise = chrome.storage.local.set(value);
    if (promise && typeof promise.catch === "function") {
      promise.catch((error) => {
        handleRuntimeError(error);
      });
    }
  } catch (error) {
    handleRuntimeError(error);
  }
}

function mergeApproxUsageForPersistence(existingRaw, incomingRaw) {
  const existing = normalizeApproxUsage(existingRaw);
  const incoming = normalizeApproxUsage(incomingRaw);

  if (incoming.windowStart > existing.windowStart + APPROX_WINDOW_START_SKEW_MS) {
    return incoming;
  }

  if (existing.windowStart > incoming.windowStart + APPROX_WINDOW_START_SKEW_MS) {
    return existing;
  }

  const incomingIsNewer = incoming.lastUpdatedAt >= existing.lastUpdatedAt;
  const minWindowStart = Math.min(existing.windowStart, incoming.windowStart);

  return {
    windowStart: Number.isFinite(minWindowStart) ? minWindowStart : incoming.windowStart,
    messageUnitsUsed: Math.round(Math.max(existing.messageUnitsUsed, incoming.messageUnitsUsed) * 100) / 100,
    contextTokens: Math.max(existing.contextTokens, incoming.contextTokens),
    lastPromptTokens: incomingIsNewer ? incoming.lastPromptTokens : existing.lastPromptTokens,
    lastResponseTokens: incomingIsNewer ? incoming.lastResponseTokens : existing.lastResponseTokens,
    lastTurnTokens: incomingIsNewer ? incoming.lastTurnTokens : existing.lastTurnTokens,
    lastTurnAt: Math.max(existing.lastTurnAt, incoming.lastTurnAt),
    lastUpdatedAt: Math.max(existing.lastUpdatedAt, incoming.lastUpdatedAt)
  };
}

async function storageSetApproxUsageSafe(nextApproxUsage) {
  if (runtimeUnavailable || !isExtensionContextValid()) {
    return;
  }

  const opId = ++approxSaveSequence;

  try {
    const data = await chrome.storage.local.get(["approxUsage"]);
    const merged = mergeApproxUsageForPersistence(data.approxUsage, nextApproxUsage);

    if (runtimeUnavailable || !isExtensionContextValid() || opId !== approxSaveSequence) {
      return;
    }

    await chrome.storage.local.set({ approxUsage: merged });
    state.approxUsage = merged;
  } catch (error) {
    handleRuntimeError(error);
  }
}

function resolveContextWindowTokens(profile, contextInput) {
  const contextDefault = MODEL_CONTEXT_DEFAULTS[profile] || DEFAULT_SETTINGS.contextWindowTokens;
  const legacyDefault = LEGACY_MODEL_CONTEXT_DEFAULTS[profile];

  if (!Number.isFinite(contextInput)) {
    return contextDefault;
  }

  if (Number.isFinite(legacyDefault) && contextInput === legacyDefault) {
    return contextDefault;
  }

  return contextInput;
}

function settingsChanged(raw, normalized) {
  if (!raw || typeof raw !== "object") {
    return true;
  }

  return (
    raw.maxMessages !== normalized.maxMessages ||
    raw.windowHours !== normalized.windowHours ||
    raw.warnAtPercent !== normalized.warnAtPercent ||
    raw.tokenUnitPerMessage !== normalized.tokenUnitPerMessage ||
    raw.modelProfile !== normalized.modelProfile ||
    raw.contextWindowTokens !== normalized.contextWindowTokens ||
    raw.useEstimatorFallback !== normalized.useEstimatorFallback
  );
}

function normalizeSettings(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const profile =
    typeof source.modelProfile === "string" && Object.prototype.hasOwnProperty.call(MODEL_CONTEXT_DEFAULTS, source.modelProfile)
      ? source.modelProfile
      : DEFAULT_SETTINGS.modelProfile;

  const contextInput = parseIntSafe(source.contextWindowTokens);
  const resolvedContext = resolveContextWindowTokens(profile, contextInput);

  return {
    maxMessages: clamp(parseIntSafe(source.maxMessages) || DEFAULT_SETTINGS.maxMessages, 1, 1000),
    windowHours: clamp(parseIntSafe(source.windowHours) || DEFAULT_SETTINGS.windowHours, 1, 24),
    warnAtPercent: clamp(parseIntSafe(source.warnAtPercent) || DEFAULT_SETTINGS.warnAtPercent, 50, 100),
    tokenUnitPerMessage: clamp(parseIntSafe(source.tokenUnitPerMessage) || DEFAULT_SETTINGS.tokenUnitPerMessage, 400, 20000),
    modelProfile: profile,
    contextWindowTokens: clamp(resolvedContext, 8000, 1500000),
    useEstimatorFallback: source.useEstimatorFallback !== false
  };
}

function normalizeOfficialUsage(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const used = Number(source.used);
  const limit = Number(source.limit);
  const remaining = Number(source.remaining);
  const receivedAt = Number(source.receivedAt);

  return {
    source: source.source || "network",
    used: Number.isFinite(used) && used >= 0 ? Math.round(used) : null,
    limit: Number.isFinite(limit) && limit > 0 ? Math.round(limit) : null,
    remaining: Number.isFinite(remaining) && remaining >= 0 ? Math.round(remaining) : null,
    resetAt: parseResetAt(source.resetAt),
    receivedAt: Number.isFinite(receivedAt) ? receivedAt : 0
  };
}

function normalizeApproxUsage(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const base = defaultApproxUsage();

  return {
    windowStart: Number.isFinite(source.windowStart) ? source.windowStart : base.windowStart,
    messageUnitsUsed: Math.max(0, parseFloatSafe(source.messageUnitsUsed) || 0),
    contextTokens: Math.max(0, parseIntSafe(source.contextTokens) || 0),
    lastPromptTokens: Math.max(0, parseIntSafe(source.lastPromptTokens) || 0),
    lastResponseTokens: Math.max(0, parseIntSafe(source.lastResponseTokens) || 0),
    lastTurnTokens: Math.max(0, parseIntSafe(source.lastTurnTokens) || 0),
    lastTurnAt: Number.isFinite(source.lastTurnAt) ? source.lastTurnAt : 0,
    lastUpdatedAt: Number.isFinite(source.lastUpdatedAt) ? source.lastUpdatedAt : 0
  };
}

async function refreshStateFromStorage() {
  const data = await storageGetSafe(STORAGE_KEYS);
  state.settings = normalizeSettings(data.settings);
  state.officialUsage = normalizeOfficialUsage(data.officialUsage);
  state.approxUsage = normalizeApproxUsage(data.approxUsage);

  if (settingsChanged(data.settings, state.settings)) {
    storageSetSafe({ settings: state.settings });
  }
}

function parseResetAt(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value > 1e12) {
      return value;
    }

    if (value > 1e9) {
      return value * 1000;
    }
  }

  if (typeof value === "string") {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return parseResetAt(numeric);
    }

    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) {
    return "now";
  }

  const totalMinutes = Math.ceil(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  return `${minutes}m`;
}

function isOfficialUsageFresh() {
  if (!state.officialUsage || state.officialUsage.receivedAt <= 0) {
    return false;
  }

  const ttl = state.officialUsage.source === "dom" ? DOM_OFFICIAL_TTL_MS : OFFICIAL_TTL_MS;
  return Date.now() - state.officialUsage.receivedAt <= ttl;
}

function haveSameOfficialCounters(prev, next) {
  if (!prev || !next) {
    return false;
  }

  return prev.limit === next.limit && prev.used === next.used && prev.remaining === next.remaining;
}

function isOfficialLaggingTurnProgress() {
  if (!state.officialUsage || state.officialUsage.receivedAt <= 0) {
    return false;
  }

  const lastTurnAt = Number(state.approxUsage.lastTurnAt);
  if (!Number.isFinite(lastTurnAt) || lastTurnAt <= state.officialUsage.receivedAt) {
    return false;
  }

  return Date.now() - lastTurnAt >= OFFICIAL_STUCK_AFTER_TURN_MS;
}

function maybeResetApproxWindow() {
  const windowMs = state.settings.windowHours * 60 * 60 * 1000;
  const elapsed = Date.now() - state.approxUsage.windowStart;

  if (elapsed >= windowMs || elapsed < 0) {
    state.approxUsage.windowStart = Date.now();
    state.approxUsage.messageUnitsUsed = 0;
    state.approxUsage.lastPromptTokens = 0;
    state.approxUsage.lastResponseTokens = 0;
    state.approxUsage.lastTurnTokens = 0;
    state.approxUsage.lastTurnAt = 0;
    state.approxUsage.lastUpdatedAt = Date.now();
    queueApproxSave();
    return true;
  }

  return false;
}

function queueApproxSave(force = false) {
  if (saveTimer) {
    window.clearTimeout(saveTimer);
    saveTimer = undefined;
  }

  if (force) {
    storageSetApproxUsageSafe({ ...state.approxUsage });
    return;
  }

  saveTimer = window.setTimeout(() => {
    storageSetApproxUsageSafe({ ...state.approxUsage });
  }, SAVE_THROTTLE_MS);
}

function ensureBarElements() {
  if (!document.body) {
    return false;
  }

  if (rootEl && document.body.contains(rootEl)) {
    return true;
  }

  const existing = document.getElementById("cwb-root");
  if (existing) {
    rootEl = existing;
    titleEl = existing.querySelector(".cwb-title");
    sourceEl = existing.querySelector(".cwb-source");
    statsEl = existing.querySelector(".cwb-stats");
    detailEl = existing.querySelector(".cwb-detail");
    meterFillEl = existing.querySelector(".cwb-meter-fill");
    return true;
  }

  rootEl = document.createElement("div");
  rootEl.id = "cwb-root";
  rootEl.innerHTML = `
    <div class="cwb-shell">
      <div class="cwb-top">
        <span class="cwb-title">Claude Usage</span>
        <span class="cwb-source">WAITING</span>
      </div>
      <div class="cwb-stats"></div>
      <div class="cwb-detail"></div>
      <div class="cwb-meter" role="progressbar" aria-label="Claude usage progress">
        <span class="cwb-meter-fill"></span>
      </div>
    </div>
  `;

  document.body.appendChild(rootEl);

  titleEl = rootEl.querySelector(".cwb-title");
  sourceEl = rootEl.querySelector(".cwb-source");
  statsEl = rootEl.querySelector(".cwb-stats");
  detailEl = rootEl.querySelector(".cwb-detail");
  meterFillEl = rootEl.querySelector(".cwb-meter-fill");
  return true;
}

function setTone(percent) {
  if (!rootEl) {
    return;
  }

  if (percent >= 100) {
    rootEl.dataset.tone = "danger";
  } else if (percent >= state.settings.warnAtPercent) {
    rootEl.dataset.tone = "warn";
  } else {
    rootEl.dataset.tone = "ok";
  }
}

function renderOfficialBar(official) {
  const limit = official.limit;
  const used = official.used;
  const remaining = official.remaining;

  if (sourceEl) {
    sourceEl.textContent = "OFFICIAL";
  }

  if (Number.isFinite(limit) && Number.isFinite(used) && limit > 0) {
    const boundedUsed = clamp(used, 0, limit);
    const boundedRemaining =
      Number.isFinite(remaining) && remaining >= 0 ? clamp(remaining, 0, limit) : Math.max(0, limit - boundedUsed);
    const percent = clamp(Math.round((boundedUsed / limit) * 100), 0, 100);
    const resetText = official.resetAt ? ` Resets in ${formatDuration(official.resetAt - Date.now())}.` : "";

    if (statsEl) {
      statsEl.textContent = `Used ${boundedUsed}/${limit} messages. ${boundedRemaining} left.${resetText}`;
    }

    if (detailEl) {
      detailEl.textContent = `Source: Claude ${official.source} signal.`;
    }

    if (meterFillEl) {
      meterFillEl.style.width = `${percent}%`;
    }

    setTone(percent);
    return;
  }

  if (Number.isFinite(remaining) && remaining >= 0) {
    if (statsEl) {
      statsEl.textContent = `Claude reports ${remaining} messages remaining.`;
    }

    if (detailEl) {
      detailEl.textContent = `Source: Claude ${official.source} signal.`;
    }

    if (meterFillEl) {
      meterFillEl.style.width = "0%";
    }

    setTone(remaining === 0 ? 100 : 0);
    return;
  }

  if (statsEl) {
    statsEl.textContent = "Official usage signal detected, but counters are incomplete.";
  }

  if (detailEl) {
    detailEl.textContent = `Source: Claude ${official.source} signal.`;
  }

  if (meterFillEl) {
    meterFillEl.style.width = "0%";
  }

  setTone(0);
}

function renderEstimatedBar() {
  maybeResetApproxWindow();

  const limit = state.settings.maxMessages;
  const used = Math.max(0, state.approxUsage.messageUnitsUsed);
  const remaining = Math.max(0, limit - used);
  const percent = clamp(Math.round((used / limit) * 100), 0, 100);
  const resetAt = state.approxUsage.windowStart + state.settings.windowHours * 60 * 60 * 1000;
  const resetText = `Resets in ${formatDuration(resetAt - Date.now())}.`;

  const contextUsed = Math.max(0, state.approxUsage.contextTokens);
  const contextLimit = state.settings.contextWindowTokens;
  const contextPercentRaw = (contextUsed / contextLimit) * 100;
  const contextPercent = clamp(Math.round(contextPercentRaw), 0, 100);
  const contextPercentText = contextPercentRaw > 0 && contextPercent === 0 ? "<1" : String(contextPercent);

  if (sourceEl) {
    sourceEl.textContent = "ESTIMATED";
  }

  if (statsEl) {
    statsEl.textContent = `Estimated ${used.toFixed(1)}/${limit} message units. ${remaining.toFixed(1)} left. ${resetText}`;
  }

  if (detailEl) {
    detailEl.textContent = `Turn ~${state.approxUsage.lastTurnTokens} tok (prompt ${state.approxUsage.lastPromptTokens}, reply ${state.approxUsage.lastResponseTokens}). Context ${contextUsed}/${contextLimit} tok (${contextPercentText}%).`;
  }

  if (meterFillEl) {
    meterFillEl.style.width = `${percent}%`;
  }

  setTone(percent);
}

function renderWaitingBar() {
  if (sourceEl) {
    sourceEl.textContent = "WAITING";
  }

  if (statsEl) {
    statsEl.textContent = "Waiting for Claude usage counters.";
  }

  if (detailEl) {
    detailEl.textContent = "Estimator fallback is disabled in settings.";
  }

  if (meterFillEl) {
    meterFillEl.style.width = "0%";
  }

  setTone(0);
}

function isChatRoute(pathname) {
  if (typeof pathname !== "string") {
    return false;
  }

  return pathname === "/" || pathname.startsWith("/chat") || pathname.startsWith("/new");
}

function hasVisibleChatComposer() {
  const composer = document.querySelector("textarea, [contenteditable='true'][role='textbox'], [role='textbox'][contenteditable='true']");
  if (!(composer instanceof Element)) {
    return false;
  }

  const style = window.getComputedStyle(composer);
  if (style.display === "none" || style.visibility === "hidden") {
    return false;
  }

  const rect = composer.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function shouldShowUsageBar() {
  return isChatRoute(window.location.pathname) && hasVisibleChatComposer();
}

function renderBar() {
  if (runtimeUnavailable) {
    return;
  }

  if (!ensureBarElements()) {
    return;
  }

  // Only show on the chat interface where the composer is visible.
  if (!shouldShowUsageBar()) {
    rootEl.classList.add("cwb-hidden");
    return;
  }

  rootEl.classList.remove("cwb-hidden");

  const officialFresh = isOfficialUsageFresh() && !isOfficialLaggingTurnProgress();
  if (officialFresh) {
    renderOfficialBar(state.officialUsage);
    return;
  }

  if (state.settings.useEstimatorFallback) {
    renderEstimatedBar();
    return;
  }

  renderWaitingBar();
}

function normalizeOfficialPayload(raw, source) {
  const sourceObj = raw && typeof raw === "object" ? raw : {};
  const limit = Number(sourceObj.limit);
  const used = Number(sourceObj.used);
  const remaining = Number(sourceObj.remaining);

  const normalized = {
    source,
    receivedAt: Date.now(),
    limit: Number.isFinite(limit) && limit > 0 ? Math.round(limit) : null,
    used: Number.isFinite(used) && used >= 0 ? Math.round(used) : null,
    remaining: Number.isFinite(remaining) && remaining >= 0 ? Math.round(remaining) : null,
    resetAt: parseResetAt(sourceObj.resetAt)
  };

  const hasUsage = normalized.limit != null || normalized.used != null || normalized.remaining != null;
  if (!hasUsage) {
    return null;
  }

  if (normalized.used == null && normalized.limit != null && normalized.remaining != null) {
    normalized.used = Math.max(0, normalized.limit - normalized.remaining);
  }

  if (normalized.remaining == null && normalized.limit != null && normalized.used != null) {
    normalized.remaining = Math.max(0, normalized.limit - normalized.used);
  }

  if (normalized.limit == null && normalized.used != null && normalized.remaining != null) {
    normalized.limit = normalized.used + normalized.remaining;
  }

  return normalized;
}

function applyOfficialUsage(raw, source) {
  const next = normalizeOfficialPayload(raw, source);
  if (!next) {
    return;
  }

  const current = state.officialUsage;
  if (current && haveSameOfficialCounters(current, next)) {
    // Avoid refreshing receivedAt with unchanged values so stale counters can expire.
    // Accept identical network values if current came from DOM, since network is higher confidence.
    if (!(current.source !== "network" && next.source === "network")) {
      return;
    }
  }

  state.officialUsage = next;
  storageSetSafe({ officialUsage: next });
  renderBar();
}

function parseRelativeReset(text) {
  if (!text) {
    return null;
  }

  const lower = text.toLowerCase();
  const hourMatch = lower.match(/(\d+)\s*h(?:ours?)?/);
  const minMatch = lower.match(/(\d+)\s*m(?:in(?:ute)?s?)?/);

  if (!hourMatch && !minMatch) {
    return null;
  }

  const hours = hourMatch ? parseInt(hourMatch[1], 10) : 0;
  const minutes = minMatch ? parseInt(minMatch[1], 10) : 0;

  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return null;
  }

  return Date.now() + (hours * 60 + minutes) * 60 * 1000;
}

function parseOfficialUsageFromText(text) {
  if (!text || typeof text !== "string") {
    return null;
  }

  const normalized = text.replace(/\s+/g, " ");
  if (!normalized) {
    return null;
  }

  const hasUsageLanguage = /(messages?\s+(?:remaining|left)|out of messages|message limit|limit reached)/i.test(normalized);
  if (!hasUsageLanguage) {
    return null;
  }

  const limitPattern = /(you are out of messages|limit reached|message limit reached|no messages remaining)/i;
  if (limitPattern.test(normalized)) {
    return {
      remaining: 0
    };
  }

  const remainingPattern = /(?:you have\s+)?(\d+)\s+messages?\s+(?:remaining|left)(?:\s+until\s+([^\.\n]+))?/i;
  const remainingMatch = normalized.match(remainingPattern);
  if (remainingMatch) {
    const remaining = parseInt(remainingMatch[1], 10);
    if (!Number.isFinite(remaining)) {
      return null;
    }

    const resetText = remainingMatch[2] ? remainingMatch[2].trim() : "";
    let resetAt = parseResetAt(resetText);
    if (!resetAt) {
      resetAt = parseRelativeReset(resetText);
    }

    const payload = { remaining };
    if (resetAt) {
      payload.resetAt = resetAt;
    }

    return payload;
  }

  return null;
}

function collectDomUsageCandidateText() {
  const selectors = [
    "[role='status']",
    "[aria-live]",
    "[data-testid*='limit']",
    "[data-testid*='quota']",
    "[class*='limit']",
    "[class*='quota']",
    "[class*='remaining']"
  ];

  const parts = [];
  const seen = new Set();

  for (const selector of selectors) {
    const nodes = document.querySelectorAll(selector);
    for (const node of nodes) {
      const text = (node.innerText || "").replace(/\s+/g, " ").trim();
      if (!text || text.length > 2800 || seen.has(text)) {
        continue;
      }

      seen.add(text);
      parts.push(text);
    }
  }

  return parts.join(" ");
}

function gatherPageTextForUsage() {
  if (!document.body) {
    return "";
  }

  const ownText = rootEl ? rootEl.innerText || "" : "";
  let pageText = collectDomUsageCandidateText();

  if (!pageText) {
    pageText = document.body.innerText || "";
    const main = document.querySelector("main");
    const mainText = main ? main.innerText || "" : "";
    if (mainText && pageText.includes(mainText)) {
      pageText = pageText.split(mainText).join(" ");
    }
  }

  if (ownText && pageText.includes(ownText)) {
    pageText = pageText.split(ownText).join(" ");
  }

  return pageText;
}

function scanDomForOfficialUsage() {
  const pageText = gatherPageTextForUsage();
  const payload = parseOfficialUsageFromText(pageText);
  if (!payload) {
    return;
  }

  applyOfficialUsage(payload, "dom");
}

function queueDomUsageScan() {
  if (domScanTimer) {
    window.clearTimeout(domScanTimer);
  }

  domScanTimer = window.setTimeout(() => {
    scanDomForOfficialUsage();
  }, DOM_SCAN_DEBOUNCE_MS);
}

function injectPageHook() {
  if (!document.documentElement || document.getElementById("cwb-page-hook")) {
    return;
  }

  const script = document.createElement("script");
  script.id = "cwb-page-hook";
  script.src = chrome.runtime.getURL("page-hook.js");
  script.async = false;

  script.onload = () => {
    script.remove();
  };

  (document.head || document.documentElement).appendChild(script);
}

function estimateTokens(text) {
  if (!text) {
    return 0;
  }

  const value = String(text);
  const chars = value.length;
  if (chars === 0) {
    return 0;
  }

  const words = (value.trim().match(/\S+/g) || []).length;
  const cjk = (value.match(/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]/g) || []).length;
  const codeLike = (value.match(/[{}()[\];=<>`$\\/]/g) || []).length;

  const englishEstimate = chars / 4;
  const wordEstimate = words * 1.25;
  const cjkEstimate = cjk + (chars - cjk) / 4.2;
  const codeAdjust = codeLike * 0.14;

  return Math.max(1, Math.ceil(Math.max(englishEstimate, wordEstimate, cjkEstimate) + codeAdjust));
}

function getPrimaryConversationText() {
  const candidates = [
    document.querySelector("main"),
    document.querySelector("[data-testid*='conversation']"),
    document.querySelector("[class*='conversation']"),
    document.body
  ].filter(Boolean);

  let best = "";
  for (const candidate of candidates) {
    const text = (candidate.innerText || "").trim();
    if (text.length > best.length) {
      best = text;
    }
  }

  if (rootEl && rootEl.innerText && best.includes(rootEl.innerText)) {
    best = best.replace(rootEl.innerText, " ");
  }

  if (best.length > 450000) {
    return best.slice(best.length - 450000);
  }

  return best;
}

function estimateConversationTokens() {
  return estimateTokens(getPrimaryConversationText());
}

function updateContextSnapshot() {
  const contextTokens = estimateConversationTokens();
  if (Math.abs(contextTokens - state.approxUsage.contextTokens) < 25) {
    return;
  }

  state.approxUsage.contextTokens = contextTokens;
  state.approxUsage.lastUpdatedAt = Date.now();
  queueApproxSave();
}

function clearPendingTurnTimers() {
  if (!pendingTurn || !Array.isArray(pendingTurn.timers)) {
    return;
  }

  for (const id of pendingTurn.timers) {
    window.clearTimeout(id);
  }

  pendingTurn.timers = [];
}

function finalizeTurnIfReady(turnId) {
  if (!pendingTurn || pendingTurn.id !== turnId || pendingTurn.finalized) {
    return;
  }

  pendingTurn.finalized = true;

  const afterContext = Math.max(pendingTurn.contextBefore, pendingTurn.maxContextAfter);
  const contextDelta = Math.max(0, afterContext - pendingTurn.contextBefore);
  const directPromptTokens = Math.max(1, parseIntSafe(pendingTurn.directPromptTokens) || 1);
  const domEstimatedResponseTokens = Math.max(0, contextDelta - directPromptTokens);
  const streamedResponseTokens = Math.max(0, parseIntSafe(pendingTurn.streamReplyTokens) || 0);
  const responseTokens = Math.max(streamedResponseTokens, domEstimatedResponseTokens);
  const rawTurnTokens = pendingTurn.promptTokens + responseTokens;

  const contextPressure = clamp(afterContext / state.settings.contextWindowTokens, 0, 1.8);
  const weightedTurnTokens = Math.max(1, Math.round(rawTurnTokens * (1 + contextPressure * 0.55)));
  const unitCost = clamp(weightedTurnTokens / state.settings.tokenUnitPerMessage, 0.35, 5);

  state.approxUsage.messageUnitsUsed = Math.round((state.approxUsage.messageUnitsUsed + unitCost) * 100) / 100;
  state.approxUsage.contextTokens = afterContext;
  state.approxUsage.lastPromptTokens = pendingTurn.promptTokens;
  state.approxUsage.lastResponseTokens = responseTokens;
  state.approxUsage.lastTurnTokens = weightedTurnTokens;
  state.approxUsage.lastTurnAt = Date.now();
  state.approxUsage.lastUpdatedAt = Date.now();

  queueApproxSave(true);
  renderBar();

  clearPendingTurnTimers();
  pendingTurn = undefined;
}

function samplePendingTurn(turnId, finalize = false) {
  if (!pendingTurn || pendingTurn.id !== turnId || pendingTurn.finalized) {
    return;
  }

  const contextNow = estimateConversationTokens();
  pendingTurn.maxContextAfter = Math.max(pendingTurn.maxContextAfter, contextNow);
  state.approxUsage.contextTokens = Math.max(state.approxUsage.contextTokens, contextNow);

  if (finalize) {
    finalizeTurnIfReady(turnId);
  }
}

function applyStreamReplySignal(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const replyText = typeof source.replyText === "string" ? source.replyText : "";
  const replyChars = Number(source.replyChars);
  const replyTokensInput = Number(source.replyTokens);

  const tokenFromText = replyText ? estimateTokens(replyText) : null;
  const tokenFromChars = Number.isFinite(replyChars) && replyChars > 0 ? Math.round(replyChars / 4) : null;
  const tokenFromPayload = Number.isFinite(replyTokensInput) && replyTokensInput > 0 ? Math.round(replyTokensInput) : null;
  const replyTokens = tokenFromPayload || tokenFromChars || tokenFromText;

  if (!Number.isFinite(replyTokens) || replyTokens <= 0) {
    return;
  }

  state.approxUsage.lastResponseTokens = replyTokens;
  state.approxUsage.lastUpdatedAt = Date.now();
  queueApproxSave();

  if (!pendingTurn || pendingTurn.finalized) {
    renderBar();
    return;
  }

  pendingTurn.streamReplyTokens = Math.max(pendingTurn.streamReplyTokens || 0, replyTokens);

  const contextNow = estimateConversationTokens();
  pendingTurn.maxContextAfter = Math.max(pendingTurn.maxContextAfter, contextNow);
  state.approxUsage.contextTokens = Math.max(state.approxUsage.contextTokens, contextNow);

  if (!pendingTurn.streamFinalizeQueued) {
    pendingTurn.streamFinalizeQueued = true;
    const turnId = pendingTurn.id;
    const timerId = window.setTimeout(() => {
      samplePendingTurn(turnId, true);
    }, STREAM_REPLY_FINALIZE_DELAY_MS);
    pendingTurn.timers.push(timerId);
  }

  renderBar();
}

function recordEstimatedSend(promptText) {
  const cleaned = (promptText || "").replace(/\s+/g, " ").trim();
  if (!cleaned) {
    return;
  }

  const now = Date.now();
  if (now - lastSignal.ts < 2200 && cleaned === lastSignal.text) {
    return;
  }

  lastSignal = {
    ts: now,
    text: cleaned
  };

  maybeResetApproxWindow();
  state.approxUsage.lastTurnAt = now;
  state.approxUsage.lastUpdatedAt = now;
  queueApproxSave();

  const contextBefore = estimateConversationTokens();
  const directPromptTokens = estimateTokens(cleaned);
  const promptTokens = Math.max(directPromptTokens, contextBefore + directPromptTokens);
  const turnId = now;

  clearPendingTurnTimers();

  pendingTurn = {
    id: turnId,
    promptTokens,
    directPromptTokens,
    contextBefore,
    maxContextAfter: contextBefore,
    streamReplyTokens: 0,
    streamFinalizeQueued: false,
    finalized: false,
    timers: []
  };

  const schedule = PENDING_TURN_SAMPLE_SCHEDULE_MS;
  for (let i = 0; i < schedule.length; i += 1) {
    const delay = schedule[i];
    const isFinal = i === schedule.length - 1;
    const timerId = window.setTimeout(() => {
      samplePendingTurn(turnId, isFinal);
    }, delay);
    pendingTurn.timers.push(timerId);
  }
}

function isPromptInput(element) {
  if (!(element instanceof Element)) {
    return false;
  }

  if (element.matches("textarea")) {
    return true;
  }

  if (element.getAttribute("contenteditable") === "true") {
    return true;
  }

  return element.getAttribute("role") === "textbox";
}

function readPromptText(element) {
  if (!element) {
    return "";
  }

  if ("value" in element && typeof element.value === "string") {
    return element.value;
  }

  return element.textContent || "";
}

function getPromptElementFromTarget(target) {
  if (!(target instanceof Element)) {
    return null;
  }

  if (isPromptInput(target)) {
    return target;
  }

  return target.closest("textarea, [contenteditable='true'], [role='textbox']");
}

function looksLikeSendButton(button) {
  if (!(button instanceof Element)) {
    return false;
  }

  const label = [
    button.getAttribute("aria-label") || "",
    button.getAttribute("title") || "",
    button.textContent || ""
  ]
    .join(" ")
    .toLowerCase();

  return /(send|submit|message|arrow\s*up)/.test(label);
}

function findLikelyPrompt() {
  const active = document.activeElement;
  if (isPromptInput(active)) {
    return active;
  }

  return document.querySelector("textarea, [contenteditable='true'][role='textbox'], [role='textbox'][contenteditable='true']");
}

function handleKeydown(event) {
  if (event.key !== "Enter" || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) {
    return;
  }

  const promptEl = getPromptElementFromTarget(event.target);
  if (!promptEl) {
    return;
  }

  recordEstimatedSend(readPromptText(promptEl));
}

function handleClick(event) {
  const target = event.target;
  if (!(target instanceof Element)) {
    return;
  }

  const button = target.closest("button");
  if (!button || !looksLikeSendButton(button)) {
    return;
  }

  const promptEl = findLikelyPrompt();
  recordEstimatedSend(readPromptText(promptEl));
}

function attachListeners() {
  if (listenersAttached) {
    return;
  }

  listenersAttached = true;

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== window.location.origin) {
      return;
    }

    const data = event.data;
    if (!data || typeof data !== "object") {
      return;
    }

    if (data.source !== "cwb-hook") {
      return;
    }

    if (data.type === "CWB_USAGE_SIGNAL") {
      applyOfficialUsage(data.payload, "network");
      return;
    }

    if (data.type === "CWB_REPLY_STREAM") {
      applyStreamReplySignal(data.payload);
    }
  });

  document.addEventListener("keydown", handleKeydown, true);
  document.addEventListener("click", handleClick, true);

  if (!runtimeUnavailable && isExtensionContextValid()) {
    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== "local") {
          return;
        }

        if (changes.settings) {
          state.settings = normalizeSettings(changes.settings.newValue);
          maybeResetApproxWindow();
          renderBar();
        }

        if (changes.officialUsage) {
          state.officialUsage = normalizeOfficialUsage(changes.officialUsage.newValue);
          renderBar();
        }

        if (changes.approxUsage) {
          state.approxUsage = normalizeApproxUsage(changes.approxUsage.newValue);
          renderBar();
        }
      });
    } catch (error) {
      handleRuntimeError(error);
    }
  }
}

function startTicker() {
  if (runtimeUnavailable) {
    return;
  }

  if (tickerId) {
    window.clearInterval(tickerId);
  }

  tickerId = window.setInterval(() => {
    maybeResetApproxWindow();
    updateContextSnapshot();
    scanDomForOfficialUsage();
    renderBar();
  }, 20000);
}

function startDomObserver() {
  if (runtimeUnavailable || !document.documentElement || observer) {
    return;
  }

  observer = new MutationObserver(() => {
    if (!document.getElementById("cwb-root")) {
      renderBar();
    }

    queueDomUsageScan();
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true
  });
}

async function init() {
  if (!isExtensionContextValid()) {
    return;
  }

  await refreshStateFromStorage();
  maybeResetApproxWindow();
  updateContextSnapshot();

  renderBar();
  injectPageHook();
  attachListeners();
  startTicker();
  startDomObserver();
  scanDomForOfficialUsage();
}

init().catch(() => {
  // Fail silently on pages where extension APIs are unavailable.
});
