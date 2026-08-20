export interface AIConfig {
  /** API root or a complete Chat Completions URL. */
  baseUrl: string;
  apiKey: string;
  model: string;
  maxRetries: number;
  systemPrompt: string;
}

export interface AIEndpointSettings {
  api: string;
  model: string;
  requestUrl: string;
  maxRetries: number;
  systemPrompt: string;
}

export interface AISettings {
  text: AIEndpointSettings;
  image: AIEndpointSettings;
}

export interface UISettings {
  locale: "zh-CN" | "zh-TW" | "en-US";
  displayMode: "ball-and-stick" | "space-filling";
  labelDisplayMode: "always" | "hover" | "never";
  conformerSearchQuality: "fast" | "balanced" | "precise";
}

export const DEFAULT_SYSTEM_PROMPT = `You convert chemistry descriptions into ChemViz3D's molecular storage format.
Return ONLY one valid JSON object. Never use Markdown fences or explanatory text.
The exact schema is:
{
  "chemvz": 2,
  "name": {"zh-CN":"optional Chinese name","en-US":"optional English name"},
  "smiles": "canonical SMILES",
  "comment": "optional short note",
  "atoms": [{"el":"C","hybridization":"sp3","charge":0}],
  "bonds": [{"i":[0,1],"order":1}]
}
Rules:
- Output chemvz exactly 2.
- Use only element symbols supported by the application.
- Output heavy atoms only; implicit hydrogens are added by the local VSEPR builder.
- Atom indices are zero-based and bonds must refer to existing, distinct atoms.
- Bond order must be 1, 1.5, 2, or 3. Use hybridization sp/sp2/sp3 when known.
- For benzene-style six-member aromatic carbon rings, use alternating 1, 2, 1, 2, 1, 2 bonds; never make all six ring edges order 2.
- For nitro groups, use [N+](=O)[O-] with explicit N+ and O- charges when needed.
- Describe one connected ordinary molecule. Use formal charges when standard resonance notation requires them; do not output multiple disconnected fragments.
- Always include a correct canonical SMILES string in the \'smiles\' field. Do not derive it from the formula.
- Do not invent 3D coordinates or formula fields.
- If the request is ambiguous, choose the most common textbook interpretation and explain it in comment.`;

const EMPTY_ENDPOINT: AIEndpointSettings = {
  api: "",
  model: "",
  requestUrl: "",
  maxRetries: 2,
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
};
const DEFAULT_SETTINGS: AISettings = {
  text: { ...EMPTY_ENDPOINT },
  image: { ...EMPTY_ENDPOINT },
};
export const DEFAULT_UI_SETTINGS: UISettings = {
  locale: "zh-CN",
  displayMode: "ball-and-stick",
  labelDisplayMode: "always",
  conformerSearchQuality: "balanced",
};

declare const __CHEMVIZ_AI_SETTINGS__: (Partial<AISettings> & { ui?: Partial<UISettings>; systemPrompt?: string }) | undefined;
declare const __CHEMVIZ_AI_PROXY_URL__: string | undefined;
declare const __CHEMVIZ_AI_PROXY_SOURCE__: string | undefined;
const STORAGE_KEY = "chemviz3d.ai-settings.v1";
const UI_STORAGE_KEY = "chemviz3d.ui-settings.v1";
const DESKTOP_BRIDGE_PREFIX = "/__chemviz_bridge";
const DESKTOP_BRIDGE_TOKEN_HEADER = "X-ChemViz-Bridge-Token";
let runtimeSettings: AISettings | null = null;
let runtimeDeveloperConfigured = false;

export function getDesktopBridgeToken(): string {
  if (typeof window === "undefined") return "";
  const bridge = window.__CHEMVIZ_DESKTOP_BRIDGE__;
  return bridge?.version === 1 && typeof bridge.token === "string" ? bridge.token : "";
}

export function hasDesktopDeveloperSettings(): boolean {
  if (typeof window === "undefined") return false;
  const bridge = window.__CHEMVIZ_DESKTOP_BRIDGE__;
  return bridge?.version === 1 && bridge.developerConfigured === true;
}

function cloneSettings(settings: AISettings): AISettings {
  return {
    text: { ...settings.text },
    image: { ...settings.image },
  };
}

export function setRuntimeAISettings(settings: AISettings, developerConfigured = hasDesktopDeveloperSettings()): AISettings {
  runtimeSettings = cloneSettings(settings);
  runtimeDeveloperConfigured = developerConfigured;
  return cloneSettings(runtimeSettings);
}

export function getRuntimeAISettings(): AISettings {
  return runtimeSettings ? cloneSettings(runtimeSettings) : getAISettings();
}

export function requestAISettings(message = "AI 功能已禁用：请先填写有效的 API 配置。") {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("chemviz-ai-settings-required", {
      detail: { message, openSettings: true },
    }));
  }
}

function desktopBridgeHeaders(): Record<string, string> {
  const token = getDesktopBridgeToken();
  return token ? { [DESKTOP_BRIDGE_TOKEN_HEADER]: token } : {};
}

function androidBridge(): NonNullable<Window["ChemVizAndroid"]> | null {
  if (typeof window === "undefined") return null;
  const bridge = window.ChemVizAndroid;
  return bridge && typeof bridge.getSettings === "function" && typeof bridge.saveSettings === "function"
    ? bridge
    : null;
}

function normalizeEndpoint(value: unknown, fallback: AIEndpointSettings): AIEndpointSettings {
  if (!value || typeof value !== "object") return { ...fallback };
  const endpoint = value as Record<string, unknown>;
  return {
    api: typeof endpoint.api === "string" ? endpoint.api.trim() : fallback.api,
    model: typeof endpoint.model === "string" ? endpoint.model.trim() : fallback.model,
    requestUrl: typeof endpoint.requestUrl === "string" ? endpoint.requestUrl.trim() : fallback.requestUrl,
    maxRetries: typeof endpoint.maxRetries === "number" && Number.isInteger(endpoint.maxRetries)
      ? Math.min(10, Math.max(0, endpoint.maxRetries))
      : fallback.maxRetries,
    systemPrompt: normalizeSystemPrompt(endpoint.systemPrompt, fallback.systemPrompt),
  };
}

function normalizeSystemPrompt(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

export function normalizeUISettings(value: unknown, fallback = DEFAULT_UI_SETTINGS): UISettings {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    locale: raw.locale === "zh-CN" || raw.locale === "zh-TW" || raw.locale === "en-US"
      ? raw.locale
      : fallback.locale,
    displayMode: raw.displayMode === "ball-and-stick" || raw.displayMode === "space-filling"
      ? raw.displayMode
      : fallback.displayMode,
    labelDisplayMode: raw.labelDisplayMode === "always" || raw.labelDisplayMode === "hover" || raw.labelDisplayMode === "never"
      ? raw.labelDisplayMode
      : fallback.labelDisplayMode,
    conformerSearchQuality: raw.conformerSearchQuality === "fast" || raw.conformerSearchQuality === "balanced" || raw.conformerSearchQuality === "precise"
      ? raw.conformerSearchQuality
      : fallback.conformerSearchQuality,
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

export function getAISettings(): AISettings {
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

/** Load persisted AI and UI settings from the local desktop bridge. */
export async function loadAISettingsFromDesktopBridge(): Promise<UISettings | null> {
  const mobile = androidBridge();
  if (mobile) {
    try {
      const raw = mobile.getSettings?.() || "{}";
      const value = JSON.parse(raw) as Partial<AISettings> & { ui?: unknown };
      const normalized = {
        text: normalizeEndpoint(value.text, DEFAULT_SETTINGS.text),
        image: normalizeEndpoint(value.image, DEFAULT_SETTINGS.image),
      };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
      setRuntimeAISettings(normalized, hasDesktopDeveloperSettings());
      return cacheUISettings(normalizeUISettings(value.ui));
    } catch (error) {
      console.warn("Unable to load Android settings; using local defaults", error);
      return null;
    }
  }
  const token = getDesktopBridgeToken();
  if (!token || typeof window === "undefined") return null;
  const response = await fetch(`${DESKTOP_BRIDGE_PREFIX}/settings`, {
    headers: desktopBridgeHeaders(),
  });
  if (!response.ok) throw new Error(`无法读取桌面客户端配置（HTTP ${response.status}）`);
  const value = await response.json() as Partial<AISettings> & { ui?: unknown };
  const normalized = {
    text: normalizeEndpoint(value.text, DEFAULT_SETTINGS.text),
    image: normalizeEndpoint(value.image, DEFAULT_SETTINGS.image),
  };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  setRuntimeAISettings(normalized, hasDesktopDeveloperSettings());
  return cacheUISettings(normalizeUISettings(value.ui));
}

export async function saveUISettingsToDesktopBridge(settings: UISettings): Promise<boolean> {
  const mobile = androidBridge();
  if (mobile) {
    const current = getAISettings();
    const value = {
      text: current.text,
      image: current.image,
      ui: normalizeUISettings(settings),
    };
    if (!mobile.saveSettings?.(JSON.stringify(value))) throw new Error("无法保存 Android 设置");
    return true;
  }
  const token = getDesktopBridgeToken();
  if (!token) return false;
  const response = await fetch(`${DESKTOP_BRIDGE_PREFIX}/settings`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...desktopBridgeHeaders() },
    body: JSON.stringify({ ui: normalizeUISettings(settings) }),
  });
  if (!response.ok) throw new Error(`无法保存桌面客户端界面设置（HTTP ${response.status}）`);
  return true;
}

/** Write settings.int with an explicit file picker, or download it when unavailable. */
export async function saveAISettingsFile(settings: AISettings): Promise<"bridge" | "picker" | "download"> {
  const normalized = {
    text: normalizeEndpoint(settings.text, DEFAULT_SETTINGS.text),
    image: normalizeEndpoint(settings.image, DEFAULT_SETTINGS.image),
    ui: getUISettings(),
  };
  const content = `${JSON.stringify(normalized, null, 2)}\n`;
  const mobile = androidBridge();
  if (mobile) {
    if (!mobile.saveSettings?.(content)) throw new Error("无法保存 Android 设置");
    return "bridge";
  }
  const bridgeToken = getDesktopBridgeToken();
  if (bridgeToken) {
    const response = await fetch(`${DESKTOP_BRIDGE_PREFIX}/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...desktopBridgeHeaders() },
      body: content,
    });
    if (!response.ok) {
      let detail = "";
      try {
        const payload = await response.json() as { error?: unknown };
        if (typeof payload.error === "string") detail = `：${payload.error}`;
      } catch {
        // Keep the status-only error when the bridge did not return JSON.
      }
      throw new Error(`无法保存桌面客户端配置（HTTP ${response.status}）${detail}`);
    }
    return "bridge";
  }
  const picker = (window as Window & {
    showSaveFilePicker?: (options?: unknown) => Promise<{
      createWritable: () => Promise<{ write: (value: string) => Promise<void>; close: () => Promise<void> }>;
    }>;
  }).showSaveFilePicker;

  if (picker) {
    const handle = await picker({
      suggestedName: "settings.int",
      types: [{ description: "ChemViz3D settings", accept: { "application/json": [".int", ".json"] } }],
    });
    const writable = await handle.createWritable();
    await writable.write(content);
    await writable.close();
    return "picker";
  }

  const blob = new Blob([content], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "settings.int";
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
  return "download";
}

export function hasTextAISettings(settings = getRuntimeAISettings()): boolean {
  return hasValidTextAISettings(settings);
}

export function isValidAIRequestUrl(value: string): boolean {
  if (!value.trim() || /\s/.test(value)) return false;
  try {
    const parsed = new URL(value.trim());
    return (parsed.protocol === "https:" || parsed.protocol === "http:") && Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

export function hasValidTextAISettings(settings = getRuntimeAISettings()): boolean {
  const { text } = settings;
  return Boolean(text.api.trim() && text.model.trim() && isValidAIRequestUrl(text.requestUrl))
    || runtimeDeveloperConfigured;
}

/** Text settings used by the chemistry parser. Image settings are reserved for a later image workflow. */
export function getAIConfig(): AIConfig {
  const settings = getRuntimeAISettings();
  const text = settings.text;
  return {
    baseUrl: text.requestUrl,
    apiKey: text.api,
    model: text.model,
    maxRetries: text.maxRetries,
    systemPrompt: text.systemPrompt,
  };
}

export function getChatCompletionsUrl(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/+$/, "");
  if (!normalized) return "";
  return normalized.endsWith("/chat/completions")
    ? normalized
    : `${normalized}/chat/completions`;
}

/** Use the Vite same-origin proxy only for the settings it was configured to proxy. */
export function getAIRequestUrl(baseUrl: string): string {
  if (getDesktopBridgeToken()) return `${DESKTOP_BRIDGE_PREFIX}/chat/completions`;
  const proxyUrl = typeof __CHEMVIZ_AI_PROXY_URL__ === "undefined" ? "" : __CHEMVIZ_AI_PROXY_URL__;
  const proxySource = typeof __CHEMVIZ_AI_PROXY_SOURCE__ === "undefined" ? "" : __CHEMVIZ_AI_PROXY_SOURCE__;
  if (proxyUrl && proxySource && baseUrl.replace(/\/+$/, "") === proxySource.replace(/\/+$/, "")) {
    return proxyUrl;
  }
  return getChatCompletionsUrl(baseUrl);
}
