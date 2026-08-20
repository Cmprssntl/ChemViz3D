import type { ChemVZMolecule, ChemVZHybrid } from "../types/moleculeFormat";
import { ATOMIC_DATA } from "../utils/formulaParser";
import {
  DEFAULT_SYSTEM_PROMPT,
  getAIRequestUrl,
  getChatCompletionsUrl,
  getDesktopBridgeToken,
  hasValidTextAISettings,
  requestAISettings,
  type AIConfig,
} from "./config";

const HYBRIDIZATIONS = new Set<ChemVZHybrid>(["sp", "sp2", "sp3"]);
const BOND_ORDERS = new Set([1, 1.5, 2, 3]);

export const CHEMVZ_SYSTEM_PROMPT = DEFAULT_SYSTEM_PROMPT;

export class AIParseError extends Error {
  constructor(
    message: string,
    public readonly kind: "config" | "network" | "response" | "schema",
    public readonly httpStatus?: number,
  ) {
    super(message);
    this.name = "AIParseError";
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : {};
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function validateConnected(atomCount: number, bonds: Array<[number, number]>): boolean {
  if (atomCount <= 1) return true;
  const adjacency = Array.from({ length: atomCount }, () => [] as number[]);
  for (const [a, b] of bonds) {
    adjacency[a].push(b);
    adjacency[b].push(a);
  }
  const visited = new Set<number>([0]);
  const queue = [0];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const next of adjacency[current]) {
      if (!visited.has(next)) {
        visited.add(next);
        queue.push(next);
      }
    }
  }
  return visited.size === atomCount;
}

/** Strict validation for AI output. The existing file loader remains compatible with v1/v2. */
export function validateAIChemVZ(value: unknown): ChemVZMolecule {
  const object = asRecord(value);
  if (object.chemvz !== 2 || !Array.isArray(object.atoms) || !Array.isArray(object.bonds)) {
    throw new AIParseError("AI 输出不是 chemvz: 2 格式", "schema");
  }
  if (object.atoms.length === 0 || object.atoms.length > 512) {
    throw new AIParseError("AI 输出的原子数量不合理", "schema");
  }

  const atoms = object.atoms.map((raw, index) => {
    const atom = asRecord(raw);
    const el = atom.el;
    if (typeof el !== "string" || !(el in ATOMIC_DATA)) {
      throw new AIParseError(`AI 输出包含不支持的元素（第 ${index + 1} 个原子）`, "schema");
    }
    if (atom.hybridization !== undefined && !HYBRIDIZATIONS.has(atom.hybridization as ChemVZHybrid)) {
      throw new AIParseError(`AI 输出包含无效杂化状态（第 ${index + 1} 个原子）`, "schema");
    }
    if (atom.charge !== undefined && !finiteNumber(atom.charge)) {
      throw new AIParseError(`AI 输出包含无效电荷（第 ${index + 1} 个原子）`, "schema");
    }
    return {
      el,
      ...(typeof atom.label === "string" ? { label: atom.label } : {}),
      ...(finiteNumber(atom.charge) ? { charge: atom.charge } : {}),
      ...(HYBRIDIZATIONS.has(atom.hybridization as ChemVZHybrid)
        ? { hybridization: atom.hybridization as ChemVZHybrid }
        : {}),
    };
  });

  const pairs = new Set<string>();
  const bonds = object.bonds.map((raw, index) => {
    const bond = asRecord(raw);
    const pair = bond.i;
    if (!Array.isArray(pair) || pair.length !== 2 || !pair.every(Number.isInteger)) {
      throw new AIParseError(`AI 输出包含无效键索引（第 ${index + 1} 条键）`, "schema");
    }
    const [a, b] = pair as [number, number];
    if (a < 0 || b < 0 || a >= atoms.length || b >= atoms.length || a === b) {
      throw new AIParseError(`AI 输出的键索引越界（第 ${index + 1} 条键）`, "schema");
    }
    const key = a < b ? `${a}-${b}` : `${b}-${a}`;
    if (pairs.has(key)) throw new AIParseError("AI 输出包含重复键", "schema");
    pairs.add(key);
    if (typeof bond.order !== "number" || !BOND_ORDERS.has(bond.order)) {
      throw new AIParseError(`AI 输出包含无效键级（第 ${index + 1} 条键）`, "schema");
    }
    if (bond.stereo !== undefined && !["up", "down", "any"].includes(String(bond.stereo))) {
      throw new AIParseError(`AI 输出包含无效立体化学标记（第 ${index + 1} 条键）`, "schema");
    }
    return {
      i: [a, b] as [number, number],
      order: bond.order,
      ...(bond.stereo !== undefined ? { stereo: bond.stereo as "up" | "down" | "any" } : {}),
    };
  });

  if (!validateConnected(atoms.length, bonds.map((bond) => bond.i))) {
    throw new AIParseError("AI 输出包含多个不相连的分子片段", "schema");
  }

  return {
    chemvz: 2,
    ...(typeof object.name === "string"
      ? { name: object.name.slice(0, 160) }
      : (object.name && typeof object.name === "object"
        ? { name: Object.fromEntries(Object.entries(object.name as Record<string, unknown>)
          .filter(([key, value]) => typeof key === "string" && typeof value === "string")
          .slice(0, 12)
          .map(([key, value]) => [key, String(value).slice(0, 160)])) }
        : {})),
    ...(typeof object.smiles === "string" && object.smiles.trim() ? { smiles: object.smiles.trim().slice(0, 1000) } : {}),
    ...(typeof object.comment === "string" ? { comment: object.comment.slice(0, 500) } : {}),
    atoms,
    bonds,
  };
}

function extractJson(content: unknown): unknown {
  if (Array.isArray(content)) {
    content = content.map((part) => asRecord(part).text).filter((part): part is string => typeof part === "string").join("");
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
      response = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
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

async function parseOnce(input: string, config: AIConfig): Promise<ChemVZMolecule> {
  const url = getAIRequestUrl(config.baseUrl);
  const bridgeToken = getDesktopBridgeToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (bridgeToken && url.startsWith("/__chemviz_bridge/")) {
    headers["X-ChemViz-Bridge-Token"] = bridgeToken;
  } else {
    headers.Authorization = `Bearer ${config.apiKey}`;
  }
  const displayUrl = getChatCompletionsUrl(config.baseUrl);
  const messages = [
    { role: "system", content: config.systemPrompt || DEFAULT_SYSTEM_PROMPT },
    { role: "user", content: input.trim() },
  ];
  const baseBody = { model: config.model, temperature: 0, messages };
  let payload: unknown;
  try {
    payload = await requestCompletion(url, headers, {
      ...baseBody,
      response_format: { type: "json_object" },
    }, displayUrl);
  } catch (error) {
    // Some OpenAI-compatible servers do not implement response_format.
    if (!(error instanceof AIParseError) || ![400, 422].includes(error.httpStatus || 0)) throw error;
    payload = await requestCompletion(url, headers, baseBody, displayUrl);
  }

  const root = asRecord(payload);
  const choices = root.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new AIParseError("AI API 响应缺少 choices", "response");
  }
  const message = asRecord(asRecord(choices[0]).message);
  return validateAIChemVZ(extractJson(message.content));
}

export async function parseWithAI(input: string, config: AIConfig): Promise<ChemVZMolecule> {
  const desktopBridgeConfigured = Boolean(getDesktopBridgeToken());
  if (!hasValidTextAISettings()) {
    requestAISettings();
    throw new AIParseError("AI 功能已禁用：没有有效的 API 配置。请检查 API 密钥、模型和请求地址；本地预设仍可使用。", "config");
  }
  if (!desktopBridgeConfigured && (!config.baseUrl || !config.apiKey || !config.model)) {
    throw new AIParseError("未配置文本模型，请填写 settings.int 或 settings.developer.int 的 text 配置", "config");
  }

  const maxRetries = Number.isInteger(config.maxRetries)
    ? Math.min(10, Math.max(0, config.maxRetries))
    : 2;
  let lastError: AIParseError | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await parseOnce(input, config);
    } catch (error) {
      const normalized = error instanceof AIParseError
        ? error
        : new AIParseError(error instanceof Error ? error.message : String(error), "response");
      if (normalized.kind === "config") throw normalized;
      lastError = normalized;
    }
  }

  const retryText = maxRetries > 0 ? `，已重试 ${maxRetries} 次` : "";
  throw new AIParseError(
    `AI 解析失败${retryText}：${lastError?.message || "未知错误"}`,
    lastError?.kind || "response",
    lastError?.httpStatus,
  );
}
