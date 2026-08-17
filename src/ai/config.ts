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

export const DEFAULT_SYSTEM_PROMPT = `You convert chemistry descriptions into ChemViz3D's molecular storage format.
Return ONLY one valid JSON object. Never use Markdown fences or explanatory text.
The exact schema is:
{
  "chemvz": 2,
  "name": "optional common or IUPAC name",
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
- Do not invent 3D coordinates, formula fields, or SMILES fields.
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

declare const __CHEMVIZ_AI_SETTINGS__: (Partial<AISettings> & { systemPrompt?: string }) | undefined;
declare const __CHEMVIZ_AI_PROXY_URL__: string | undefined;
declare const __CHEMVIZ_AI_PROXY_SOURCE__: string | undefined;
const STORAGE_KEY = "chemviz3d.ai-settings.v1";

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
}

/** Write settings.int with an explicit file picker, or download it when unavailable. */
export async function saveAISettingsFile(settings: AISettings): Promise<"picker" | "download"> {
  const normalized = {
    text: normalizeEndpoint(settings.text, DEFAULT_SETTINGS.text),
    image: normalizeEndpoint(settings.image, DEFAULT_SETTINGS.image),
  };
  const content = `${JSON.stringify(normalized, null, 2)}\n`;
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

export function hasTextAISettings(settings = getAISettings()): boolean {
  const { text } = settings;
  return Boolean(text.api && text.model && text.requestUrl);
}

/** Text settings used by the chemistry parser. Image settings are reserved for a later image workflow. */
export function getAIConfig(): AIConfig {
  const settings = getAISettings();
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
  const proxyUrl = typeof __CHEMVIZ_AI_PROXY_URL__ === "undefined" ? "" : __CHEMVIZ_AI_PROXY_URL__;
  const proxySource = typeof __CHEMVIZ_AI_PROXY_SOURCE__ === "undefined" ? "" : __CHEMVIZ_AI_PROXY_SOURCE__;
  if (proxyUrl && proxySource && baseUrl.replace(/\/+$/, "") === proxySource.replace(/\/+$/, "")) {
    return proxyUrl;
  }
  return getChatCompletionsUrl(baseUrl);
}
