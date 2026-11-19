import { detectPlatform } from "./detect";
import type { PlatformAdapter } from "./PlatformAdapter";

/** Detected once at module load; every feature reads this instance. */
export const platform: PlatformAdapter = detectPlatform();

platform.applyToDocument();

export type { PlatformAdapter, PlatformCapabilities, PlatformKind } from "./PlatformAdapter";
export { adapterFor } from "./PlatformAdapter";
export { readPlatformMarker } from "./detect";
