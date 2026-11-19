/**
 * Failures of the IUPAC namer are typed and surfaced verbatim in the UI.
 * There is deliberately no fallback: showing a molecular formula or SMILES in
 * the "IUPAC name" row would look like a successful naming.
 */
export type NamingErrorCode =
  | "empty-structure"
  | "no-carbon-parent"
  | "unsupported-ring-system"
  | "unsupported-substituent"
  | "unsupported-functional-group"
  | "ambiguous-parent";

const MESSAGES: Record<NamingErrorCode, string> = {
  "empty-structure": "结构为空",
  "no-carbon-parent": "没有可命名的碳骨架（不支持无机结构）",
  "unsupported-ring-system": "暂不支持稠环或桥环体系",
  "unsupported-substituent": "暂不支持该取代基",
  "unsupported-functional-group": "暂不支持该官能团",
  "ambiguous-parent": "无法唯一确定母体",
};

export class NamingError extends Error {
  constructor(
    readonly code: NamingErrorCode,
    detail?: string,
  ) {
    super(detail ? `${MESSAGES[code]}：${detail}` : MESSAGES[code]);
    this.name = "NamingError";
  }
}
