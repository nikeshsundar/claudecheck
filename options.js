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
const DOM_OFFICIAL_TTL_MS = 45 * 1000;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function parseIntSafe(value) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseFloatSafe(value) {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
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

function getOfficialTtl(officialUsage) {
  return officialUsage.source === "dom" ? DOM_OFFICIAL_TTL_MS : OFFICIAL_TTL_MS;
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

  return {
    windowStart: Number.isFinite(source.windowStart) ? source.windowStart : Date.now(),
    messageUnitsUsed: Math.max(0, parseFloatSafe(source.messageUnitsUsed) || 0),
    contextTokens: Math.max(0, parseIntSafe(source.contextTokens) || 0),
    lastPromptTokens: Math.max(0, parseIntSafe(source.lastPromptTokens) || 0),
    lastResponseTokens: Math.max(0, parseIntSafe(source.lastResponseTokens) || 0),
    lastTurnTokens: Math.max(0, parseIntSafe(source.lastTurnTokens) || 0),
    lastTurnAt: Number.isFinite(source.lastTurnAt) ? source.lastTurnAt : 0,
    lastUpdatedAt: Number.isFinite(source.lastUpdatedAt) ? source.lastUpdatedAt : 0
  };
}

function maybeResetApproxWindow(settings, approxUsage) {
  const windowMs = settings.windowHours * 60 * 60 * 1000;
  const elapsed = Date.now() - approxUsage.windowStart;
  if (elapsed >= windowMs || elapsed < 0) {
    approxUsage.windowStart = Date.now();
    approxUsage.messageUnitsUsed = 0;
    approxUsage.lastPromptTokens = 0;
    approxUsage.lastResponseTokens = 0;
    approxUsage.lastTurnTokens = 0;
    approxUsage.lastTurnAt = 0;
    approxUsage.lastUpdatedAt = Date.now();
    return true;
  }

  return false;
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

function showStatus(text) {
  const status = document.getElementById("status");
  status.textContent = text;
  if (!text) {
    return;
  }

  window.setTimeout(() => {
    if (status.textContent === text) {
      status.textContent = "";
    }
  }, 2200);
}

function fillInputs(settings) {
  document.getElementById("maxMessages").value = String(settings.maxMessages);
  document.getElementById("windowHours").value = String(settings.windowHours);
  document.getElementById("warnAtPercent").value = String(settings.warnAtPercent);
  document.getElementById("tokenUnitPerMessage").value = String(settings.tokenUnitPerMessage);
  document.getElementById("modelProfile").value = settings.modelProfile;
  document.getElementById("contextWindowTokens").value = String(settings.contextWindowTokens);
  document.getElementById("useEstimatorFallback").checked = settings.useEstimatorFallback;
}

function readInput(id, min, max, fallback) {
  const value = parseInt(document.getElementById(id).value, 10);
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return clamp(value, min, max);
}

function renderStatus(settings, officialUsage, approxUsage) {
  const output = document.getElementById("counterInfo");
  const officialFresh = officialUsage.receivedAt > 0 && Date.now() - officialUsage.receivedAt <= getOfficialTtl(officialUsage);

  if (officialFresh) {
    if (Number.isFinite(officialUsage.limit) && Number.isFinite(officialUsage.used)) {
      const remaining = Number.isFinite(officialUsage.remaining)
        ? Math.max(0, Math.min(officialUsage.remaining, officialUsage.limit))
        : Math.max(0, officialUsage.limit - officialUsage.used);

      const resetText = officialUsage.resetAt
        ? ` Resets in ${formatDuration(officialUsage.resetAt - Date.now())}.`
        : "";

      output.textContent = `Official: ${officialUsage.used}/${officialUsage.limit} used, ${remaining} left. Source: ${officialUsage.source}.${resetText}`;
      return;
    }

    if (Number.isFinite(officialUsage.remaining)) {
      const resetText = officialUsage.resetAt
        ? ` Resets in ${formatDuration(officialUsage.resetAt - Date.now())}.`
        : "";
      output.textContent = `Official: ${officialUsage.remaining} messages remaining. Source: ${officialUsage.source}.${resetText}`;
      return;
    }

    output.textContent = `Official signal from ${officialUsage.source}, but counters were incomplete.`;
    return;
  }

  if (!settings.useEstimatorFallback) {
    output.textContent =
      "No fresh official signal and estimator fallback is disabled. Enable fallback or open Claude chat to capture official counters.";
    return;
  }

  const limit = settings.maxMessages;
  const used = approxUsage.messageUnitsUsed;
  const remaining = Math.max(0, limit - used);
  const resetAt = approxUsage.windowStart + settings.windowHours * 60 * 60 * 1000;
  const contextPercent = clamp(Math.round((approxUsage.contextTokens / settings.contextWindowTokens) * 100), 0, 100);

  output.textContent = `Estimated: ${used.toFixed(1)}/${limit} units used, ${remaining.toFixed(1)} left. Last turn ~${approxUsage.lastTurnTokens} tok. Context ${contextPercent}%. Resets in ${formatDuration(resetAt - Date.now())}.`;
}

async function loadAndRender() {
  const data = await chrome.storage.local.get(["settings", "officialUsage", "approxUsage"]);
  const settings = normalizeSettings(data.settings);
  const officialUsage = normalizeOfficialUsage(data.officialUsage);
  const approxUsage = normalizeApproxUsage(data.approxUsage);

  if (maybeResetApproxWindow(settings, approxUsage)) {
    await chrome.storage.local.set({ approxUsage });
  }

  fillInputs(settings);
  renderStatus(settings, officialUsage, approxUsage);
}

document.getElementById("modelProfile").addEventListener("change", (event) => {
  const profile = event.target.value;
  const mapped = MODEL_CONTEXT_DEFAULTS[profile];
  if (Number.isFinite(mapped)) {
    document.getElementById("contextWindowTokens").value = String(mapped);
  }
});

document.getElementById("saveBtn").addEventListener("click", async () => {
  const existingData = await chrome.storage.local.get(["settings"]);
  const existing = normalizeSettings(existingData.settings);

  const settings = {
    ...existing,
    maxMessages: readInput("maxMessages", 1, 1000, existing.maxMessages),
    windowHours: readInput("windowHours", 1, 24, existing.windowHours),
    warnAtPercent: readInput("warnAtPercent", 50, 100, existing.warnAtPercent),
    tokenUnitPerMessage: readInput("tokenUnitPerMessage", 400, 20000, existing.tokenUnitPerMessage),
    modelProfile: document.getElementById("modelProfile").value,
    contextWindowTokens: readInput("contextWindowTokens", 8000, 1500000, existing.contextWindowTokens),
    useEstimatorFallback: document.getElementById("useEstimatorFallback").checked
  };

  await chrome.storage.local.set({ settings });
  await loadAndRender();
  showStatus("Settings saved.");
});

document.getElementById("resetBtn").addEventListener("click", async () => {
  const approxUsage = {
    windowStart: Date.now(),
    messageUnitsUsed: 0,
    contextTokens: 0,
    lastPromptTokens: 0,
    lastResponseTokens: 0,
    lastTurnTokens: 0,
    lastTurnAt: 0,
    lastUpdatedAt: Date.now()
  };

  await chrome.storage.local.set({ approxUsage });
  await loadAndRender();
  showStatus("Estimated window reset.");
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") {
    return;
  }

  if (changes.settings || changes.officialUsage || changes.approxUsage) {
    loadAndRender().catch(() => {
      showStatus("Unable to refresh extension state.");
    });
  }
});

loadAndRender().catch(() => {
  showStatus("Unable to load extension state.");
});
