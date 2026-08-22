import type { ChemVZMolecule } from "../types/moleculeFormat";
import { getDesktopBridgeToken } from "./config";
import { validateAIChemVZ } from "./aiParser";

const BRIDGE_PREFIX = "/__chemviz_bridge";
const STORAGE_KEY = "chemviz3d.ai-cache.v1";
const BRIDGE_TIMEOUT_MS = 2500;

async function fetchBridge(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), BRIDGE_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timeout);
  }
}

export interface CachedChemVZ {
  input: string;
  chemvz: ChemVZMolecule;
  createdAt?: string;
}

function normalizeInput(input: string): string {
  return input.trim().toLocaleLowerCase().replace(/[\s_-]+/g, "");
}

/** Stable, filesystem-safe key; the original input remains in the cache value. */
export function cacheKey(input: string): string {
  let hash = 2166136261;
  for (const char of normalizeInput(input)) {
    hash ^= char.codePointAt(0) || 0;
    hash = Math.imul(hash, 16777619);
  }
  return `v1-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function bridgeHeaders(): Record<string, string> {
  const token = getDesktopBridgeToken();
  return token ? { "X-ChemViz-Bridge-Token": token } : {};
}

function readBrowserCache(): Record<string, CachedChemVZ> {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed as Record<string, CachedChemVZ> : {};
  } catch {
    return {};
  }
}

function writeBrowserCache(value: Record<string, CachedChemVZ>): void {
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value)); } catch { /* storage unavailable */ }
}

function androidCacheBridge(): NonNullable<Window["ChemVizAndroid"]> | null {
  if (typeof window === "undefined") return null;
  const bridge = window.ChemVizAndroid;
  return bridge && typeof bridge.getCache === "function" && typeof bridge.saveCache === "function"
    ? bridge
    : null;
}

export async function getCachedChemVZ(input: string): Promise<CachedChemVZ | null> {
  const key = cacheKey(input);
  const mobile = androidCacheBridge();
  if (mobile) {
    try {
      const raw = mobile.getCache?.(key) || "";
      if (!raw) return null;
      const value = JSON.parse(raw) as CachedChemVZ;
      if (!value || typeof value.input !== "string") return null;
      return { ...value, chemvz: validateAIChemVZ(value.chemvz) };
    } catch {
      return null;
    }
  }
  if (getDesktopBridgeToken()) {
    const response = await fetchBridge(`${BRIDGE_PREFIX}/cache/${encodeURIComponent(key)}`, { headers: bridgeHeaders() });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`无法读取 AI 缓存（HTTP ${response.status}）`);
    const value = await response.json() as CachedChemVZ;
    if (!value || typeof value.input !== "string") return null;
    return { ...value, chemvz: validateAIChemVZ(value.chemvz) };
  }
  const value = readBrowserCache()[key];
  if (!value || !value.chemvz) return null;
  try { return { ...value, chemvz: validateAIChemVZ(value.chemvz) }; } catch { return null; }
}

export async function saveCachedChemVZ(input: string, chemvz: ChemVZMolecule): Promise<void> {
  const key = cacheKey(input);
  const value: CachedChemVZ = { input: input.trim(), chemvz, createdAt: new Date().toISOString() };
  const mobile = androidCacheBridge();
  if (mobile) {
    if (!mobile.saveCache?.(key, JSON.stringify(value))) throw new Error("无法保存 Android AI 缓存");
    return;
  }
  if (getDesktopBridgeToken()) {
    const response = await fetchBridge(`${BRIDGE_PREFIX}/cache/${encodeURIComponent(key)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...bridgeHeaders() },
      body: JSON.stringify(value),
    });
    if (!response.ok) throw new Error(`无法保存 AI 缓存（HTTP ${response.status}）`);
    return;
  }
  writeBrowserCache({ ...readBrowserCache(), [key]: value });
}

export async function clearCachedChemVZ(input: string): Promise<void> {
  const key = cacheKey(input);
  const mobile = androidCacheBridge();
  if (mobile) {
    mobile.deleteCache?.(key);
    return;
  }
  if (getDesktopBridgeToken()) {
    const response = await fetchBridge(`${BRIDGE_PREFIX}/cache/${encodeURIComponent(key)}`, { method: "DELETE", headers: bridgeHeaders() });
    if (!response.ok && response.status !== 404) throw new Error(`无法清除 AI 缓存（HTTP ${response.status}）`);
    return;
  }
  const cache = readBrowserCache();
  delete cache[key];
  writeBrowserCache(cache);
}

export async function clearAllCachedChemVZ(): Promise<void> {
  const mobile = androidCacheBridge();
  if (mobile) {
    mobile.clearCache?.();
    return;
  }
  if (getDesktopBridgeToken()) {
    const response = await fetchBridge(`${BRIDGE_PREFIX}/cache`, { method: "DELETE", headers: bridgeHeaders() });
    if (!response.ok) throw new Error(`无法清空 AI 缓存（HTTP ${response.status}）`);
    return;
  }
  writeBrowserCache({});
}
