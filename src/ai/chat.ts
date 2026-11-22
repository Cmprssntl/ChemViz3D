import {
  getAIRequestUrl,
  getChatCompletionsUrl,
  getDesktopBridgeToken,
  getQtSettingsApi,
  type AIConfig,
} from "./config";
import { AIParseError } from "./errors";

/** Chat message accepted by OpenAI-compatible endpoints. */
export interface ChatMessage {
  role: "system" | "user";
  content: unknown;
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : {};
}

/** Strip Markdown fences and parse the JSON object an AI returned. */
export function extractJsonObject(content: unknown): unknown {
  if (Array.isArray(content)) {
    content = content
      .map((part) => asRecord(part).text)
      .filter((part): part is string => typeof part === "string")
      .join("");
  }
  if (typeof content !== "string") throw new AIParseError("AI 没有返回文本内容", "response");
  const trimmed = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    throw new AIParseError("AI 返回的内容不是有效 JSON", "response");
  }
}

async function requestCompletion(
  url: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
  displayUrl = url,
): Promise<unknown> {
  let response: Response;
  try {
    const android = typeof window !== "undefined" ? window.ChemVizAndroid : undefined;
    if (android?.requestChatCompletions && url.startsWith("http")) {
      const requestId = `chat-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const result = await new Promise<{ status: number; body: string }>((resolve, reject) => {
        const timeout = window.setTimeout(() => {
          delete window.__chemvizAndroidChatResult;
          reject(new Error("Android AI 请求超时"));
        }, 120000);
        window.__chemvizAndroidChatResult = (id, status, body) => {
          if (id !== requestId) return;
          window.clearTimeout(timeout);
          delete window.__chemvizAndroidChatResult;
          resolve({ status, body });
        };
        try {
          // Keep the injected bridge object as the receiver. Android WebView
          // rejects a JavaScriptInterface method invoked as a detached function.
          android.requestChatCompletions!(requestId, url, headers.Authorization?.replace(/^Bearer\s+/i, "") || "", JSON.stringify(body));
        } catch (error) {
          window.clearTimeout(timeout);
          delete window.__chemvizAndroidChatResult;
          reject(error);
        }
      });
      response = new Response(result.body, { status: result.status, headers: { "Content-Type": "application/json" } });
    } else {
      // Packaged desktop shell: prefer the native QtWebChannel transport so
      // AI calls work even when QtWebEngine's network service cannot deliver
      // fetch() responses back to the page ("Failed to fetch").
      const qtApi = await getQtSettingsApi();
      if (qtApi) {
        const resultText = await new Promise<string>((resolve, reject) => {
          const timeout = window.setTimeout(() => reject(new Error("AI 请求超时")), 120000);
          qtApi.chatCompletions(JSON.stringify(body), (result) => {
            window.clearTimeout(timeout);
            resolve(result);
          });
        });
        const forwarded = JSON.parse(resultText) as { status: number; body: string; error?: string };
        if (forwarded.error) {
          throw new AIParseError(`AI API 网络请求失败：${forwarded.error}`, "network");
        }
        response = new Response(forwarded.body, {
          status: forwarded.status,
          headers: { "Content-Type": "application/json" },
        });
      } else {
        response = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
      }
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const hint = detail === "Failed to fetch"
      ? "（可能是 API 地址不可达或浏览器 CORS 预检被拒绝）"
      : "";
    throw new AIParseError(`AI API 网络请求失败：${detail}${hint}，请求地址：${displayUrl}`, "network");
  }
  const raw = await response.text();
  let payload: unknown = null;
  try { payload = raw ? JSON.parse(raw) : null; } catch { /* handled below */ }
  if (!response.ok) {
    const errorValue = asRecord(payload).error;
    const message = typeof errorValue === "string" ? errorValue : asRecord(errorValue).message;
    const detail = typeof message === "string" ? message : `AI API 请求失败（HTTP ${response.status}）`;
    throw new AIParseError(`${detail}（HTTP ${response.status}）`, "network", response.status);
  }
  return payload;
}

/**
 * Send one chat completion request using the configured text endpoint.
 *
 * `response_format` is retried without the field when a compatible server
 * rejects it with 400/422, which is the same fallback the parser uses.
 */
export async function requestChatCompletion(
  config: AIConfig,
  messages: ChatMessage[],
): Promise<unknown> {
  const url = getAIRequestUrl(config.baseUrl);
  const bridgeToken = getDesktopBridgeToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (bridgeToken && url.startsWith("/__chemviz_bridge/")) {
    headers["X-ChemViz-Bridge-Token"] = bridgeToken;
  } else {
    headers.Authorization = `Bearer ${config.apiKey}`;
  }
  const displayUrl = getChatCompletionsUrl(config.baseUrl);
  const baseBody = { model: config.model, temperature: 0, messages };
  try {
    return await requestCompletion(url, headers, {
      ...baseBody,
      response_format: { type: "json_object" },
    }, displayUrl);
  } catch (error) {
    if (!(error instanceof AIParseError) || ![400, 422].includes(error.httpStatus || 0)) throw error;
    return requestCompletion(url, headers, baseBody, displayUrl);
  }
}

/** Extract `choices[0].message.content`, raising a typed error when absent. */
export function readMessageContent(payload: unknown): unknown {
  const choices = asRecord(payload).choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new AIParseError("AI API 响应缺少 choices", "response");
  }
  return asRecord(asRecord(choices[0]).message).content;
}
