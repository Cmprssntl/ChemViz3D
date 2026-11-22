import type { MoleculeData } from "../types/molecule";
import { hasValidTextAISettings } from "../ai/config";
import { iupacNamer } from "../domain/naming/IupacNamer";
import { nameWithAI } from "./aiNamer";
import { getCachedName, saveCachedName } from "./cache";

export type NamingSource = "preset" | "cache" | "ai" | "local";

export interface NamingResolution {
  name?: string;
  source?: NamingSource;
  error?: string;
}

/** Injected for tests; production uses the real namer, cache and model. */
export interface NamingServiceDeps {
  resolveLocal(molecule: MoleculeData, presetName?: string): NamingResolution;
  getCached(molecule: MoleculeData): Promise<string | null>;
  saveCached(molecule: MoleculeData, name: string): Promise<void>;
  nameWithAI(molecule: MoleculeData): Promise<string>;
  hasAI(): boolean;
}

const defaultDeps: NamingServiceDeps = {
  resolveLocal(molecule, presetName) {
    if (presetName) return { name: presetName, source: "preset" };
    const result = iupacNamer.tryName(molecule);
    return "name" in result
      ? { name: result.name, source: "local" }
      : { source: "local", error: result.error.message };
  },
  getCached: getCachedName,
  saveCached: saveCachedName,
  nameWithAI,
  hasAI: hasValidTextAISettings,
};

/**
 * Two-stage naming.
 *
 * `resolve` is synchronous and always returns something the UI can render now
 * (a preset name, the local IUPAC name, or a typed error). `upgrade` then tries
 * the naming cache and the text model in the background. A monotonically
 * increasing token discards replies for molecules the user has already left.
 */
export class NamingService {
  private token = 0;

  constructor(private readonly deps: NamingServiceDeps = defaultDeps) {}

  /** Synchronous local stage: preset name first, then the built-in namer. */
  resolve(molecule: MoleculeData, presetName?: string): NamingResolution {
    return this.deps.resolveLocal(molecule, presetName);
  }

  /**
   * Try cache then AI. Failures are deliberately silent unless the caller
   * passes `onError`: the local name is already on screen.
   */
  async upgrade(
    molecule: MoleculeData,
    onResolved: (name: string, source: "cache" | "ai") => void,
    onError?: (error: unknown) => void,
  ): Promise<void> {
    const token = ++this.token;
    if (!this.deps.hasAI()) return;

    try {
      const cached = await this.deps.getCached(molecule);
      if (cached && token === this.token) {
        onResolved(cached, "cache");
        return;
      }
    } catch {
      // Cache transport problems must not prevent the AI attempt.
    }
    if (token !== this.token) return;

    try {
      const name = await this.deps.nameWithAI(molecule);
      if (token !== this.token) return;
      onResolved(name, "ai");
      try {
        await this.deps.saveCached(molecule, name);
      } catch {
        // The name is already on screen; a cache write failure is non-fatal.
      }
    } catch (error) {
      // Background upgrades stay silent; the UI may pass onError to report.
      if (token === this.token) onError?.(error);
    }
  }

  /** Invalidate in-flight work when a new molecule replaces the old one. */
  cancel(): void {
    this.token++;
  }
}

export const namingService = new NamingService();
