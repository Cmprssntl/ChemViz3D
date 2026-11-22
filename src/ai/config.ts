/**
 * Public AI settings facade.
 *
 * The implementation is split under `settings/`:
 *   types     — configuration shapes
 *   prompt    — the default chemvz system prompt
 *   defaults  — shared JSON schema (field names, enums, defaults)
 *   storage   — normalization, localStorage and the runtime snapshot
 *   bridge    — desktop QtWebChannel / HTTP bridge and Android persistence
 *
 * Feature code keeps importing from `ai/config` so the split stays invisible.
 */
import { t } from "../i18n/index";
import { getDesktopBridgeToken } from "./settings/bridge";
import { getRuntimeAISettings, isRuntimeDeveloperConfigured } from "./settings/storage";
import type { AIConfig } from "./settings/types";

declare const __CHEMVIZ_AI_PROXY_URL__: string | undefined;
declare const __CHEMVIZ_AI_PROXY_SOURCE__: string | undefined;

export type { AIConfig, AIEndpointSettings, AISettings, UISettings } from "./settings/types";
export { DEFAULT_SYSTEM_PROMPT } from "./settings/prompt";
export {
  DEFAULT_UI_SETTINGS,
  cacheUISettings,
  getAISettings,
  getInjectedUISettings,
  getRuntimeAISettings,
  getUISettings,
  normalizeUISettings,
  restoreSettingsFromInjection,
  saveAISettings,
  setRuntimeAISettings,
} from "./settings/storage";
export {
  getDesktopBridgeToken,
  getQtSettingsApi,
  hasDesktopDeveloperSettings,
  loadAISettingsFromDesktopBridge,
  saveAISettingsFile,
  saveUISettingsToDesktopBridge,
} from "./settings/bridge";

export function requestAISettings(message = t("aiDisabledMessage")) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("chemviz-ai-settings-required", {
      detail: { message, openSettings: true },
    }));
  }
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
    || isRuntimeDeveloperConfigured();
}

/** The image endpoint has its own model; a text-only setup cannot read images. */
export function hasValidImageAISettings(settings = getRuntimeAISettings()): boolean {
  const { image } = settings;
  return Boolean(image.api.trim() && image.model.trim() && isValidAIRequestUrl(image.requestUrl))
    || isRuntimeDeveloperConfigured();
}

export function getImageAIConfig(): AIConfig {
  const image = getRuntimeAISettings().image;
  return {
    baseUrl: image.requestUrl,
    apiKey: image.api,
    model: image.model,
    maxRetries: image.maxRetries,
    systemPrompt: image.systemPrompt,
  };
}

export function getAIConfig(): AIConfig {
  const text = getRuntimeAISettings().text;
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
  if (getDesktopBridgeToken()) return "/__chemviz_bridge/chat/completions";
  const proxyUrl = typeof __CHEMVIZ_AI_PROXY_URL__ === "undefined" ? "" : __CHEMVIZ_AI_PROXY_URL__;
  const proxySource = typeof __CHEMVIZ_AI_PROXY_SOURCE__ === "undefined" ? "" : __CHEMVIZ_AI_PROXY_SOURCE__;
  if (proxyUrl && proxySource && baseUrl.replace(/\/+$/, "") === proxySource.replace(/\/+$/, "")) {
    return proxyUrl;
  }
  return getChatCompletionsUrl(baseUrl);
}
