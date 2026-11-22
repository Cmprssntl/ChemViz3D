import type { MoleculeData } from "../types/molecule";
import {
  getAIConfig,
  hasValidTextAISettings,
  requestAISettings,
  type AIConfig,
} from "../ai/config";
import { AIParseError } from "../ai/errors";
import {
  asRecord,
  extractJsonObject,
  readMessageContent,
  requestChatCompletion,
  type ChatMessage,
} from "../ai/chat";

/**
 * Dedicated IUPAC naming prompt.
 *
 * The parser prompt returns a whole chemvz structure; naming only needs one
 * name, so a smaller schema keeps the model from inventing atoms.
 */
export const NAMING_SYSTEM_PROMPT = `You name organic molecules with standard IUPAC nomenclature in English.
Use the structure supplied by the user; never invent or modify atoms.
Return ONLY one JSON object with this exact shape:
{"name": "<IUPAC name>", "comment": "<optional one-line note>"}
Rules:
- "name" must be a single line, 1-120 characters, without a leading "IUPAC:" or "name:" label.
- Use lowercase unless a locant or a proper prefix requires otherwise.
- If the structure cannot be named confidently, return {"name": "", "comment": "<reason>"}.`;

/** Raised when the model reply cannot be used as a name. */
export class NamingAIError extends Error {
  constructor(
    message: string,
    public readonly kind: "config" | "network" | "response" | "schema",
  ) {
    super(message);
    this.name = "NamingAIError";
  }
}

const MAX_NAME_LENGTH = 120;

/** Trim and reject anything that is not a single clean IUPAC line. */
export function validateIupacName(value: unknown): string {
  if (typeof value !== "string") throw new NamingAIError("AI 命名结果缺少 name 字段", "schema");
  const name = value.trim().replace(/\s+/g, " ");
  if (!name) throw new NamingAIError("AI 命名结果为空", "schema");
  if (/[\r\n\t]/.test(value)) throw new NamingAIError("AI 命名结果不是单行文本", "schema");
  if (name.length > MAX_NAME_LENGTH) throw new NamingAIError("AI 命名结果过长", "schema");
  if (/^`+|`+$/.test(name)) throw new NamingAIError("AI 命名结果包含 Markdown 标记", "schema");
  if (/^(?:iupac(?:\s*name)?|name)\s*[:：]/i.test(name)) {
    throw new NamingAIError("AI 命名结果带有前缀标签", "schema");
  }
  return name;
}

/** Compact, deterministic structure description for the user message. */
export function describeMolecule(molecule: MoleculeData): string {
  const counts = new Map<string, number>();
  for (const atom of molecule.atoms) counts.set(atom.element, (counts.get(atom.element) ?? 0) + 1);
  const composition = [...counts.entries()].map(([element, count]) => `${element}${count > 1 ? count : ""}`).join("");
  const bonds = molecule.bonds
    .map((bond) => {
      const first = molecule.atoms[bond.atom1Idx]?.element ?? "?";
      const second = molecule.atoms[bond.atom2Idx]?.element ?? "?";
      return `${bond.atom1Idx}${first}-${bond.atom2Idx}${second}:${bond.order}`;
    })
    .join(", ");
  return [
    `Formula: ${molecule.formula || composition}`,
    `SMILES: ${molecule.smiles?.trim() || "(not provided)"}`,
    `Atoms (${molecule.atoms.length}): ${composition}`,
    `Bonds (${molecule.bonds.length}): ${bonds || "(none)"}`,
  ].join("\n");
}

async function nameOnce(molecule: MoleculeData, config: AIConfig): Promise<string> {
  const messages: ChatMessage[] = [
    { role: "system", content: NAMING_SYSTEM_PROMPT },
    { role: "user", content: describeMolecule(molecule) },
  ];
  const payload = await requestChatCompletion(config, messages);
  const result = asRecord(extractJsonObject(readMessageContent(payload)));
  return validateIupacName(result.name);
}

/**
 * Ask the configured text model for an IUPAC name.
 *
 * Retries mirror `parseWithAI`: config errors stop immediately, transient
 * failures are retried up to `maxRetries`, and the last error is reported.
 */
export async function nameWithAI(molecule: MoleculeData, config: AIConfig = getAIConfig()): Promise<string> {
  if (!hasValidTextAISettings()) {
    requestAISettings();
    throw new NamingAIError("AI 命名已禁用：没有有效的文本模型配置。", "config");
  }
  const maxRetries = Number.isInteger(config.maxRetries)
    ? Math.min(10, Math.max(0, config.maxRetries))
    : 2;
  let lastError: NamingAIError | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await nameOnce(molecule, config);
    } catch (error) {
      const normalized = error instanceof NamingAIError
        ? error
        : error instanceof AIParseError
          ? new NamingAIError(error.message, error.kind)
          : new NamingAIError(error instanceof Error ? error.message : String(error), "response");
      if (normalized.kind === "config") throw normalized;
      lastError = normalized;
    }
  }

  const retryText = maxRetries > 0 ? `，已重试 ${maxRetries} 次` : "";
  throw new NamingAIError(
    `AI 命名失败${retryText}：${lastError?.message || "未知错误"}`,
    lastError?.kind || "response",
  );
}
