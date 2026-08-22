import { validateAIChemVZ } from "./aiParser";
import type { ChemVZMolecule } from "../types/moleculeFormat";

export interface LocalPresetResult {
  kind: "preset";
  formula: string;
  reason: "preset";
  presetId: string;
  chemvz: ChemVZMolecule;
}

export type LocalParseResult = LocalPresetResult;

interface PresetFile {
  id: string;
  formula: string;
  inputs: string[];
  chemvz: unknown;
}

const presetModules = import.meta.glob("/molecules/presets/*.json", { eager: true, import: "default" }) as Record<string, unknown>;

function loadPresets(): Map<string, LocalPresetResult> {
  const byInput = new Map<string, LocalPresetResult>();
  for (const [fileName, raw] of Object.entries(presetModules)) {
    try {
      const file = raw as PresetFile;
      if (!file || typeof file.id !== "string" || typeof file.formula !== "string" || !Array.isArray(file.inputs)) continue;
      const chemvz = validateAIChemVZ(file.chemvz);
      for (const input of file.inputs) {
        if (typeof input !== "string" || !input.trim()) continue;
        byInput.set(normalizeInput(input), {
          kind: "preset",
          formula: file.formula,
          reason: "preset",
          presetId: file.id,
          chemvz,
        });
      }
    } catch (error) {
      console.warn(`Ignoring invalid local chemistry preset ${fileName}:`, error);
    }
  }
  return byInput;
}

const LOCAL_PRESETS = loadPresets();

/** Merge presets supplied by the desktop bridge's writable config directory. */
export async function loadExternalPresets(): Promise<void> {
  if (typeof window === "undefined") return;
  const bridge = window.__CHEMVIZ_DESKTOP_BRIDGE__;
  if (!bridge?.token || bridge.version !== 1) return;
  try {
    const response = await fetch(bridge.presetsUrl || "/__chemviz_bridge/presets", {
      headers: { "X-ChemViz-Bridge-Token": bridge.token },
    });
    if (!response.ok) return;
    const payload = await response.json() as { presets?: unknown };
    if (!Array.isArray(payload.presets)) return;
    for (const [key, value] of loadPresetsFromValues(payload.presets)) LOCAL_PRESETS.set(key, value);
  } catch (error) {
    console.warn("Unable to load config-directory chemistry presets", error);
  }
}

function loadPresetsFromValues(values: unknown[]): Map<string, LocalPresetResult> {
  const byInput = new Map<string, LocalPresetResult>();
  for (const raw of values) {
    try {
      const file = raw as PresetFile;
      if (!file || typeof file.id !== "string" || typeof file.formula !== "string" || !Array.isArray(file.inputs)) continue;
      const chemvz = validateAIChemVZ(file.chemvz);
      for (const input of file.inputs) {
        if (typeof input !== "string" || !input.trim()) continue;
        byInput.set(normalizeInput(input), {
          kind: "preset", formula: file.formula, reason: "preset", presetId: file.id, chemvz,
        });
      }
    } catch (error) {
      console.warn("Ignoring invalid config-directory chemistry preset:", error);
    }
  }
  return byInput;
}

function normalizeInput(input: string): string {
  return input.trim().toLocaleLowerCase().replace(/[\s_-]+/g, "");
}

export function parseLocalInput(input: string): LocalParseResult | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  return LOCAL_PRESETS.get(normalizeInput(trimmed)) || null;
}
