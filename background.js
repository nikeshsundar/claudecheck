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
    resetAt: source.resetAt || null,
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

function approxChanged(raw, normalized) {
  if (!raw || typeof raw !== "object") {
    return true;
  }

  return (
    raw.windowStart !== normalized.windowStart ||
    raw.messageUnitsUsed !== normalized.messageUnitsUsed ||
    raw.contextTokens !== normalized.contextTokens ||
    raw.lastPromptTokens !== normalized.lastPromptTokens ||
    raw.lastResponseTokens !== normalized.lastResponseTokens ||
    raw.lastTurnTokens !== normalized.lastTurnTokens ||
    raw.lastTurnAt !== normalized.lastTurnAt ||
    raw.lastUpdatedAt !== normalized.lastUpdatedAt
  );
}

function officialChanged(raw, normalized) {
  if (!raw || typeof raw !== "object") {
    return true;
  }

  return (
    raw.source !== normalized.source ||
    raw.used !== normalized.used ||
    raw.limit !== normalized.limit ||
    raw.remaining !== normalized.remaining ||
    raw.resetAt !== normalized.resetAt ||
    raw.receivedAt !== normalized.receivedAt
  );
}

async function ensureStateInitialized() {
  const data = await chrome.storage.local.get(["settings", "officialUsage", "approxUsage"]);
  const normalizedSettings = normalizeSettings(data.settings);
  const normalizedOfficialUsage = normalizeOfficialUsage(data.officialUsage);
  const normalizedApproxUsage = normalizeApproxUsage(data.approxUsage);

  const updates = {};

  if (settingsChanged(data.settings, normalizedSettings)) {
    updates.settings = normalizedSettings;
  }

  if (officialChanged(data.officialUsage, normalizedOfficialUsage)) {
    updates.officialUsage = normalizedOfficialUsage;
  }

  if (approxChanged(data.approxUsage, normalizedApproxUsage)) {
    updates.approxUsage = normalizedApproxUsage;
  }

  if (Object.keys(updates).length > 0) {
    await chrome.storage.local.set(updates);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  ensureStateInitialized().catch(() => {
    // Ignore storage init errors; content script will retry.
  });
});

chrome.runtime.onStartup.addListener(() => {
  ensureStateInitialized().catch(() => {
    // Ignore storage init errors; content script will retry.
  });
});
