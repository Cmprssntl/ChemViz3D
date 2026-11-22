import type { MoleculeData } from "../../types/molecule";
import { GeometryValidator } from "../relax/GeometryValidator";
import {
  ConformerBackend,
  ConformerError,
  type ConformerInput,
  type ConformerOptions,
  type ConformerOutput,
} from "./ConformerBackend";
import { planConformer, type ConformerPlan } from "./ConformerPlan";
import { HeuristicBackend } from "./HeuristicBackend";
import { OpenChemLibBackend } from "./OpenChemLibBackend";

export { ConformerError } from "./ConformerBackend";

export interface ConformerBuildOptions extends ConformerOptions {
  name?: string;
}

export interface ConformerBuildResult {
  molecule: MoleculeData;
  backend: string;
  warnings: string[];
  plan: ConformerPlan;
  /** Background refinement; absent when the plan does not need one. */
  refine?: () => Promise<MoleculeData | null>;
}

const ELEMENT_ORDER = ["C", "H", "O", "N", "S", "P", "F", "Cl", "Br", "I"];

/**
 * Selects a backend, validates its output and only then hands geometry to the
 * renderer. A backend that produces an invalid structure is skipped rather
 * than rendered.
 */
export class ConformerService {
  private readonly validator = new GeometryValidator();

  constructor(
    private readonly backends: ConformerBackend[] = [new OpenChemLibBackend(), new HeuristicBackend()],
  ) {}

  build(input: ConformerInput, options: ConformerBuildOptions = {}): ConformerBuildResult {
    if (input.elements.length === 0) {
      throw new ConformerError("Empty structure", []);
    }
    const plan = planConformer(input);
    const attempts: string[] = [];
    for (const backend of this.backends) {
      if (!backend.isAvailable()) {
        attempts.push(`${backend.id}: unavailable`);
        continue;
      }
      let output;
      try {
        output = backend.build(input, {
          ...options,
          skipMinimise: options.skipMinimise ?? !plan.initialMinimise,
          ...(plan.initialMinimise
            ? { maxIterations: options.maxIterations ?? plan.initialIterations }
            : {}),
        });
      } catch (error) {
        attempts.push(`${backend.id}: ${message(error)}`);
        continue;
      }
      if (!output) {
        attempts.push(`${backend.id}: produced no geometry`);
        continue;
      }
      const report = this.validator.validate(output.atoms, output.bonds);
      if (!report.ok) {
        attempts.push(`${backend.id}: ${report.issues[0]?.message ?? "invalid geometry"}`);
        continue;
      }
      const refine = plan.refine && backend.refine
        ? this.makeRefiner(backend, input, output, options, plan)
        : undefined;
      return {
        molecule: this.toMolecule(output, options, input),
        backend: output.backend,
        warnings: output.warnings,
        plan,
        refine,
      };
    }
    throw new ConformerError(
      `No conformer backend produced a valid structure (${attempts.join("; ")})`,
      attempts,
    );
  }

  private makeRefiner(
    backend: ConformerBackend,
    input: ConformerInput,
    coarse: ConformerOutput,
    options: ConformerBuildOptions,
    plan: ConformerPlan,
  ): () => Promise<MoleculeData | null> {
    return async () => {
      let refined: ConformerOutput | null;
      try {
        refined = await backend.refine!(input, coarse, {
          ...options,
          maxIterations: plan.refineIterations,
          useConstrained: plan.refineWithConstrained,
        });
      } catch {
        return null;
      }
      if (!refined) return null;
      const report = this.validator.validate(refined.atoms, refined.bonds);
      if (!report.ok) return null;
      return this.toMolecule(refined, options, input);
    };
  }

  private toMolecule(
    output: ConformerOutput,
    options: ConformerBuildOptions,
    input: ConformerInput,
  ): MoleculeData {
    return {
      atoms: output.atoms,
      bonds: output.bonds,
      name: options.name || input.formula || "molecule",
      formula: formulaOf(output.atoms.map((atom) => atom.element)) || input.formula || "",
      smiles: input.smiles ?? "",
    };
  }
}

function formulaOf(elements: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const element of elements) counts.set(element, (counts.get(element) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => indexOf(a[0]) - indexOf(b[0]))
    .map(([element, count]) => element + (count > 1 ? count : ""))
    .join("");
}

function indexOf(element: string): number {
  const index = ELEMENT_ORDER.indexOf(element);
  return index >= 0 ? index : ELEMENT_ORDER.length;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
