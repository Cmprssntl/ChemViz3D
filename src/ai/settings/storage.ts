import { DEFAULT_SYSTEM_PROMPT } from "./prompt";
import { MAX_RETRIES, UI_DEFAULTS, UI_VALUES } from "./defaults";
import type { AIEndpointSettings, AISettings, UISettings } from "./types";

declare const __CHEMVIZ_AI_SETTINGS__: (Partial<AISettings> & { ui?: Partial<UISettings>; systemPrompt?: string }) | undefined;

const STORAGE_KEY = "chemviz3d.ai-settings.v1";
const UI_STORAGE_KEY = "chemviz3d.ui-settings.v1";

const EMPTY_ENDPOINT: AIEndpointSettings = {
  api: "",
  model: "",
  requestUrl: "",
  maxRetries: MAX_RETRIES.default,
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
};

export const DEFAULT_SETTINGS: AISettings = {
  text: { ...EMPTY_ENDPOINT },
  image: { ...EMPTY_ENDPOINT },
};

export const DEFAULT_UI_SETTINGS: UISettings = UI_DEFAULTS as unknown as UISettings;

let runtimeSettings: AISettings | null = null;
let runtimeDeveloperConfigured = false;

export function cloneSettings(settings: AISettings): AISettings {
  return {
    text: { ...settings.text },
    image: { ...settings.image },
  };
}

export function setRuntimeAISettings(
  settings: AISettings,
  developerConfigured = runtimeDeveloperConfigured,
): AISettings {
  runtimeSettings = cloneSettings(settings);
  runtimeDeveloperConfigured = developerConfigured;
  return cloneSettings(runtimeSettings);
}

export function getRuntimeAISettings(): AISettings {
  return runtimeSettings ? cloneSettings(runtimeSettings) : getAISettings();
}

export function isRuntimeDeveloperConfigured(): boolean {
  return runtimeDeveloperConfigured;
}

export function normalizeEndpoint(value: unknown, fallback: AIEndpointSettings): AIEndpointSettings {
  if (!value || typeof value !== "object") return { ...fallback };
  const endpoint = value as Record<string, unknown>;
  return {
    api: typeof endpoint.api === "string" ? endpoint.api.trim() : fallback.api,
    model: typeof endpoint.model === "string" ? endpoint.model.trim() : fallback.model,
    requestUrl: typeof endpoint.requestUrl === "string" ? endpoint.requestUrl.trim() : fallback.requestUrl,
    maxRetries: typeof endpoint.maxRetries === "number" && Number.isInteger(endpoint.maxRetries)
      ? Math.min(MAX_RETRIES.max, Math.max(MAX_RETRIES.min, endpoint.maxRetries))
      : fallback.maxRetries,
    systemPrompt: normalizeSystemPrompt(endpoint.systemPrompt, fallback.systemPrompt),
  };
}

export function normalizeSystemPrompt(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function pickUIValue<K extends keyof UISettings>(
  raw: Record<string, unknown>,
  key: K,
  fallback: UISettings[K],
): UISettings[K] {
  const allowed = UI_VALUES[key] ?? [];
  const candidate = raw[key];
  return typeof candidate === "string" && allowed.includes(candidate)
    ? candidate as UISettings[K]
    : fallback;
}

export function normalizeUISettings(value: unknown, fallback = DEFAULT_UI_SETTINGS): UISettings {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    locale: pickUIValue(raw, "locale", fallback.locale),
    displayMode: pickUIValue(raw, "displayMode", fallback.displayMode),
    labelDisplayMode: pickUIValue(raw, "labelDisplayMode", fallback.labelDisplayMode),
    conformerSearchQuality: pickUIValue(raw, "conformerSearchQuality", fallback.conformerSearchQuality),
  };
}

export function getUISettings(): UISettings {
  if (typeof window === "undefined") return { ...DEFAULT_UI_SETTINGS };
  const configured = typeof __CHEMVIZ_AI_SETTINGS__ === "undefined" ? undefined : __CHEMVIZ_AI_SETTINGS__?.ui;
  const configuredDefaults = normalizeUISettings(configured);
  try {
    const raw = window.localStorage.getItem(UI_STORAGE_KEY);
    return raw ? normalizeUISettings(JSON.parse(raw), configuredDefaults) : configuredDefaults;
  } catch {
    return configuredDefaults;
  }
}

export function cacheUISettings(settings: UISettings): UISettings {
  const normalized = normalizeUISettings(settings);
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(UI_STORAGE_KEY, JSON.stringify(normalized));
    } catch {
      // Browser storage can be unavailable in restricted contexts.
    }
  }
  return normalized;
}

interface InjectedSettings {
  text?: Partial<AIEndpointSettings>;
  image?: Partial<AIEndpointSettings>;
  ui?: Partial<UISettings>;
  systemPrompt?: string;
}

/** Settings inlined into the page HTML by the desktop bridge. Reading them
 * needs no network request, so reads never fail even if QtWebEngine's fetch
 * is flaky ("Failed to fetch") on a given Windows build. */
function getInjectedSettings(): InjectedSettings {
  if (typeof window === "undefined") return {};
  const value = (window as Window & { __CHEMVIZ_SETTINGS__?: unknown }).__CHEMVIZ_SETTINGS__;
  return value && typeof value === "object" ? (value as InjectedSettings) : {};
}

/** Restore the runtime snapshot from the HTML-injected settings (fallback
 * used when the bridge fetch fails). Returns true if anything was restored. */
export function restoreSettingsFromInjection(): boolean {
  const injected = getInjectedSettings();
  if (!injected.text && !injected.image && !injected.ui) return false;
  setRuntimeAISettings({
    text: normalizeEndpoint(injected.text, DEFAULT_SETTINGS.text),
    image: normalizeEndpoint(injected.image, DEFAULT_SETTINGS.image),
  });
  if (injected.ui) cacheUISettings(normalizeUISettings(injected.ui));
  return true;
}

/** UI settings from the HTML injection, or null when absent. */
export function getInjectedUISettings(): UISettings | null {
  const injected = getInjectedSettings();
  return injected.ui ? normalizeUISettings(injected.ui) : null;
}

export function getAISettings(): AISettings {
  // The desktop bridge loads file-based settings into the runtime snapshot at
  // startup (loadAISettingsFromDesktopBridge). Prefer that snapshot over
  // localStorage: QtWebEngine keys localStorage by origin and the bridge port
  // changes on every restart, so localStorage cannot survive a relaunch.
  if (runtimeSettings) return cloneSettings(runtimeSettings);
  const configured = typeof __CHEMVIZ_AI_SETTINGS__ === "undefined" ? {} : __CHEMVIZ_AI_SETTINGS__;
  const legacyFilePrompt = normalizeSystemPrompt(configured.systemPrompt, "");
  const fileSettings = {
    text: normalizeEndpoint(configured.text, legacyFilePrompt
      ? { ...DEFAULT_SETTINGS.text, systemPrompt: legacyFilePrompt }
      : DEFAULT_SETTINGS.text),
    image: normalizeEndpoint(configured.image, legacyFilePrompt
      ? { ...DEFAULT_SETTINGS.image, systemPrompt: legacyFilePrompt }
      : DEFAULT_SETTINGS.image),
  };
  let stored: Partial<AISettings> & { systemPrompt?: unknown } = {};
  if (typeof window !== "undefined") {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) stored = JSON.parse(raw) as Partial<AISettings>;
    } catch {
      // Ignore unavailable or malformed browser storage and use file settings.
    }
  }
  const legacyStoredPrompt = normalizeSystemPrompt(stored.systemPrompt, "");
  return {
    text: normalizeEndpoint(stored.text, legacyStoredPrompt
      ? { ...fileSettings.text, systemPrompt: legacyStoredPrompt }
      : fileSettings.text),
    image: normalizeEndpoint(stored.image, legacyStoredPrompt
      ? { ...fileSettings.image, systemPrompt: legacyStoredPrompt }
      : fileSettings.image),
  };
}

export function saveAISettings(settings: AISettings): void {
  if (typeof window === "undefined") return;
  const normalized = {
    text: normalizeEndpoint(settings.text, DEFAULT_SETTINGS.text),
    image: normalizeEndpoint(settings.image, DEFAULT_SETTINGS.image),
  };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  setRuntimeAISettings(normalized);
}
