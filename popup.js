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

function statusText(text) {
  const status = document.getElementById("status");
  status.textContent = text;
  if (!text) {
    return;
  }

  window.setTimeout(() => {
    if (status.textContent === text) {
      status.textContent = "";
    }
  }, 1800);
}

function readNumberInput(id, min, max, fallback) {
  const element = document.getElementById(id);
  const parsed = parseInt(element.value, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return clamp(parsed, min, max);
}

function fillSettingsInputs(settings) {
  document.getElementById("maxMessages").value = String(settings.maxMessages);
  document.getElementById("windowHours").value = String(settings.windowHours);
  document.getElementById("tokenUnitPerMessage").value = String(settings.tokenUnitPerMessage);
  document.getElementById("warnAtPercent").value = String(settings.warnAtPercent);
}

function renderOfficial(officialUsage) {
  const hasFresh = officialUsage.receivedAt > 0 && Date.now() - officialUsage.receivedAt <= getOfficialTtl(officialUsage);
  if (!hasFresh) {
    return false;
  }

  const hasLimit = Number.isFinite(officialUsage.limit) && officialUsage.limit > 0;
  const hasUsed = Number.isFinite(officialUsage.used);
  const hasRemaining = Number.isFinite(officialUsage.remaining);

  if (hasLimit && hasUsed) {
    const remaining = hasRemaining
      ? Math.max(0, Math.min(officialUsage.remaining, officialUsage.limit))
      : Math.max(0, officialUsage.limit - officialUsage.used);

    const resetText = officialUsage.resetAt
      ? ` Resets in ${formatDuration(officialUsage.resetAt - Date.now())}.`
      : "";

    document.getElementById("usageValue").textContent = `${officialUsage.used} / ${officialUsage.limit}`;
    document.getElementById("usageMeta").textContent = `Official (${officialUsage.source}). ${remaining} left.${resetText}`;
    return true;
  }

  if (hasRemaining) {
    const resetText = officialUsage.resetAt
      ? ` Resets in ${formatDuration(officialUsage.resetAt - Date.now())}.`
      : "";

    document.getElementById("usageValue").textContent = `${officialUsage.remaining} left`;
    document.getElementById("usageMeta").textContent = `Official (${officialUsage.source}).${resetText}`;
    return true;
  }

  document.getElementById("usageValue").textContent = "Official signal";
  document.getElementById("usageMeta").textContent = `Source: ${officialUsage.source}. Counters incomplete.`;
  return true;
}

function renderEstimated(settings, approxUsage) {
  const limit = settings.maxMessages;
  const used = Math.max(0, approxUsage.messageUnitsUsed);
  const remaining = Math.max(0, limit - used);
  const resetAt = approxUsage.windowStart + settings.windowHours * 60 * 60 * 1000;
  const contextPct = Math.round((Math.max(0, approxUsage.contextTokens) / settings.contextWindowTokens) * 100);

  document.getElementById("usageValue").textContent = `${used.toFixed(1)} / ${limit}`;
  document.getElementById("usageMeta").textContent = `Estimated. ${remaining.toFixed(1)} left. Context ${Math.min(100, Math.max(0, contextPct))}%. Resets in ${formatDuration(resetAt - Date.now())}.`;
}

async function loadAndRender() {
  const data = await chrome.storage.local.get(["settings", "officialUsage", "approxUsage"]);
  const settings = normalizeSettings(data.settings);
  const officialUsage = normalizeOfficialUsage(data.officialUsage);
  const approxUsage = normalizeApproxUsage(data.approxUsage);

  const didReset = maybeResetApproxWindow(settings, approxUsage);
  if (didReset) {
    await chrome.storage.local.set({ approxUsage });
  }

  fillSettingsInputs(settings);

  const officialRendered = renderOfficial(officialUsage);
  if (!officialRendered) {
    if (settings.useEstimatorFallback) {
      renderEstimated(settings, approxUsage);
    } else {
      document.getElementById("usageValue").textContent = "No active data";
      document.getElementById("usageMeta").textContent =
        "Official signal unavailable and estimator fallback is disabled.";
    }
  }
}

document.getElementById("saveBtn").addEventListener("click", async () => {
  const data = await chrome.storage.local.get(["settings"]);
  const existing = normalizeSettings(data.settings);

  const settings = {
    ...existing,
    maxMessages: readNumberInput("maxMessages", 1, 1000, existing.maxMessages),
    windowHours: readNumberInput("windowHours", 1, 24, existing.windowHours),
    tokenUnitPerMessage: readNumberInput("tokenUnitPerMessage", 400, 20000, existing.tokenUnitPerMessage),
    warnAtPercent: readNumberInput("warnAtPercent", 50, 100, existing.warnAtPercent)
  };

  await chrome.storage.local.set({ settings });
  await loadAndRender();
  statusText("Saved.");
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
  statusText("Estimate reset.");
});

document.getElementById("openOptions").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") {
    return;
  }

  if (changes.settings || changes.officialUsage || changes.approxUsage) {
    loadAndRender().catch(() => {
      statusText("Unable to refresh state.");
    });
  }
});

loadAndRender().catch(() => {
  statusText("Unable to load extension state.");
});
