import {
  adapterFor,
  type PlatformAdapter,
  type PlatformKind,
} from "./PlatformAdapter";

declare const __CHEMVIZ_BUILD_PLATFORM__: string | undefined;

interface PlatformGlobals {
  __CHEMVIZ_PLATFORM__?: string;
  ChemVizAndroid?: unknown;
  __CHEMVIZ_DESKTOP_BRIDGE__?: unknown;
  qt?: unknown;
}

const KNOWN: PlatformKind[] = ["web", "desktop", "android"];

function normalize(value: unknown): PlatformKind | null {
  return typeof value === "string" && (KNOWN as string[]).includes(value)
    ? value as PlatformKind
    : null;
}

/**
 * Detection order, most authoritative first:
 *
 * 1. the build flag (`VITE_PLATFORM` / `--platform`),
 * 2. a runtime injection (`__CHEMVIZ_PLATFORM__` or a known bridge global),
 * 3. the `platform.json` marker file shipped next to the bundle,
 * 4. web.
 *
 * Steps 1–2 are synchronous so the first paint already has the right layout;
 * the marker is only an async fallback for builds without a flag.
 */
export function detectPlatform(): PlatformAdapter {
  const injected = typeof globalThis !== "undefined"
    ? (globalThis as unknown as PlatformGlobals)
    : undefined;

  const fromBuild = normalize(typeof __CHEMVIZ_BUILD_PLATFORM__ === "string" ? __CHEMVIZ_BUILD_PLATFORM__ : undefined);
  if (fromBuild) return adapterFor(fromBuild);

  const fromRuntime = normalize(injected?.__CHEMVIZ_PLATFORM__);
  if (fromRuntime) return adapterFor(fromRuntime);

  if (injected?.ChemVizAndroid) return adapterFor("android");
  if (injected?.__CHEMVIZ_DESKTOP_BRIDGE__ || injected?.qt) return adapterFor("desktop");

  return adapterFor("web");
}

/**
 * Reads `platform.json` next to the bundle. Used by the packaging script to
 * prove that each artifact carries its own marker; failures fall back to the
 * detected adapter rather than breaking boot.
 */
export async function readPlatformMarker(url = "platform.json"): Promise<PlatformKind | null> {
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) return null;
    const body = await response.json() as { platform?: string };
    return normalize(body.platform);
  } catch {
    return null;
  }
}
