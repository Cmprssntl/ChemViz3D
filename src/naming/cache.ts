import type { MoleculeData } from "../types/molecule";
import { getDesktopBridgeToken } from "../ai/config";
import { platform } from "../platform";

/**
 * Naming cache.
 *
 * The logical key is the canonical SMILES when the structure has one; otherwise
 * a deterministic signature built from the atom and bond labels. Storage keys
 * are hashed so they stay filesystem-safe, and the original key is kept in the
 * value so a hash collision can never return another molecule's name.
 *
 * Entries live in the `naming` namespace:
 *   localStorage  chemviz3d.naming-cache.v1
 *   desktop       <config>/molecules/cache/naming-v1-*.json
 *   Android       app-private chemviz-cache/naming-v1-*.json
 */
const BRIDGE_PREFIX = "/__chemviz_bridge";
const STORAGE_KEY = "chemviz3d.naming-cache.v1";
const NAMESPACE = "naming-";
const BRIDGE_TIMEOUT_MS = 2500;

export interface NamingCacheEntry {
  /** Canonical SMILES or structure signature. */
  key: string;
  name: string;
  source: "ai";
  createdAt?: string;
}

/** Canonical key: SMILES first, structure signature otherwise. */
export function namingCacheKey(molecule: Pick<MoleculeData, "smiles" | "atoms" | "bonds">): string {
  const smiles = molecule.smiles?.trim();
  if (smiles) return smiles;
  return structureSignature(molecule);
}

/** Order-independent fallback signature (element labels + sorted bond labels). */
function structureSignature(molecule: Pick<MoleculeData, "atoms" | "bonds">): string {
  const atoms = molecule.atoms.map((atom) => {
    const charge = atom.charge ? `^${atom.charge}` : "";
    return `${atom.element}${charge}${atom.hybridization ? `:${atom.hybridization}` : ""}`;
  });
  const bonds = molecule.bonds.map((bond) => {
    const first = molecule.atoms[bond.atom1Idx]?.element ?? "?";
    const second = molecule.atoms[bond.atom2Idx]?.element ?? "?";
    const pair = [first, second].sort().join("-");
    return `${pair}:${bond.order}`;
  }).sort();
  return `sig:${atoms.join(",")}|${bonds.join(",")}`;
}

function hashKey(key: string): string {
  let hash = 2166136261;
  for (const char of key) {
    hash ^= char.codePointAt(0) || 0;
    hash = Math.imul(hash, 16777619);
  }
  return `${NAMESPACE}v1-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

async function fetchBridge(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), BRIDGE_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timeout);
  }
}

function bridgeHeaders(): Record<string, string> {
  const token = getDesktopBridgeToken();
  return token ? { "X-ChemViz-Bridge-Token": token } : {};
}

function androidBridge(): NonNullable<Window["ChemVizAndroid"]> | null {
  if (typeof window === "undefined" || !platform.isAndroid) return null;
  const bridge = window.ChemVizAndroid;
  return bridge && typeof bridge.getCache === "function" && typeof bridge.saveCache === "function"
    ? bridge
    : null;
}

function readBrowserCache(): Record<string, NamingCacheEntry> {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed as Record<string, NamingCacheEntry> : {};
  } catch {
    return {};
  }
}

function writeBrowserCache(value: Record<string, NamingCacheEntry>): void {
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value)); } catch { /* storage unavailable */ }
}

function parseEntry(raw: string, expectedKey: string): NamingCacheEntry | null {
  try {
    const value = JSON.parse(raw) as NamingCacheEntry;
    if (!value || value.key !== expectedKey || typeof value.name !== "string" || !value.name.trim()) return null;
    return value;
  } catch {
    return null;
  }
}

export async function getCachedName(molecule: Pick<MoleculeData, "smiles" | "atoms" | "bonds">): Promise<string | null> {
  const key = namingCacheKey(molecule);
  const storageKey = hashKey(key);
  const mobile = androidBridge();
  if (mobile) {
    try {
      const raw = mobile.getCache?.(storageKey) || "";
      return raw ? parseEntry(raw, key)?.name ?? null : null;
    } catch {
      return null;
    }
  }
  if (getDesktopBridgeToken()) {
    const response = await fetchBridge(`${BRIDGE_PREFIX}/cache/${encodeURIComponent(storageKey)}`, { headers: bridgeHeaders() });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`无法读取命名缓存（HTTP ${response.status}）`);
    return parseEntry(await response.text(), key)?.name ?? null;
  }
  const entry = readBrowserCache()[storageKey];
  return entry && entry.key === key && entry.name.trim() ? entry.name : null;
}

export async function saveCachedName(
  molecule: Pick<MoleculeData, "smiles" | "atoms" | "bonds">,
  name: string,
): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) return;
  const key = namingCacheKey(molecule);
  const storageKey = hashKey(key);
  const entry: NamingCacheEntry = { key, name: trimmed, source: "ai", createdAt: new Date().toISOString() };
  const mobile = androidBridge();
  if (mobile) {
    if (!mobile.saveCache?.(storageKey, JSON.stringify(entry))) throw new Error("无法保存 Android 命名缓存");
    return;
  }
  if (getDesktopBridgeToken()) {
    const response = await fetchBridge(`${BRIDGE_PREFIX}/cache/${encodeURIComponent(storageKey)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...bridgeHeaders() },
      body: JSON.stringify(entry),
    });
    if (!response.ok) throw new Error(`无法保存命名缓存（HTTP ${response.status}）`);
    return;
  }
  writeBrowserCache({ ...readBrowserCache(), [storageKey]: entry });
}

export async function clearCachedName(
  molecule: Pick<MoleculeData, "smiles" | "atoms" | "bonds">,
): Promise<void> {
  const storageKey = hashKey(namingCacheKey(molecule));
  const mobile = androidBridge();
  if (mobile) {
    mobile.deleteCache?.(storageKey);
    return;
  }
  if (getDesktopBridgeToken()) {
    const response = await fetchBridge(`${BRIDGE_PREFIX}/cache/${encodeURIComponent(storageKey)}`, {
      method: "DELETE",
      headers: bridgeHeaders(),
    });
    if (!response.ok && response.status !== 404) throw new Error(`无法清除命名缓存（HTTP ${response.status}）`);
    return;
  }
  const cache = readBrowserCache();
  delete cache[storageKey];
  writeBrowserCache(cache);
}

/** Clear only `naming-*` entries; the AI cache namespace is untouched. */
export async function clearAllNamingCache(): Promise<void> {
  const mobile = androidBridge();
  if (mobile) {
    if (typeof mobile.clearCacheByPrefix === "function") mobile.clearCacheByPrefix(NAMESPACE);
    return;
  }
  if (getDesktopBridgeToken()) {
    const response = await fetchBridge(`${BRIDGE_PREFIX}/cache?prefix=${encodeURIComponent(NAMESPACE)}`, {
      method: "DELETE",
      headers: bridgeHeaders(),
    });
    if (!response.ok) throw new Error(`无法清空命名缓存（HTTP ${response.status}）`);
    return;
  }
  writeBrowserCache({});
}
