// ============================================================
// ChemViz3D i18n engine
// Simple module-level pattern (no React context needed).
// ============================================================

import type { TranslationMap } from "./types";
import { zhCN } from "./locales/zh-CN";
import { zhTW } from "./locales/zh-TW";
import { enUS } from "./locales/en-US";

export type LocaleKey = "zh-CN" | "zh-TW" | "en-US";
const FALLBACK: LocaleKey = "en-US";

const locales: Record<LocaleKey, TranslationMap> = {
  "zh-CN": zhCN,
  "zh-TW": zhTW,
  "en-US": enUS,
};

let _current: LocaleKey = "zh-CN";

export function setLocale(l: LocaleKey): void {
  _current = l;
}
export function getLocale(): LocaleKey {
  return _current;
}

type TParams = Record<string, string | number> | undefined;

export function t(key: string, params?: TParams): string {
  const map = locales[_current] ?? locales[FALLBACK];
  const raw: string = map[key] ?? locales[FALLBACK][key] ?? key;
  if (!params) return raw;
  let out = raw;
  for (const [k, v] of Object.entries(params)) {
    out = out.replace(new RegExp(`\\{\\{${k}\\}\\}`, "g"), String(v));
  }
  return out;
}
