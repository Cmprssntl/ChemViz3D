import type { AtomData, BondData } from "../../types/molecule";
import { buildFromBondSpec, type BondSpec } from "../vseprBuilder";
import { ConstrainedMinimizer } from "../relax/ConstrainedMinimizer";
import { GeometryValidator } from "../relax/GeometryValidator";
import {
  ConformerBackend,
  type ConformerInput,
  type ConformerOptions,
  type ConformerOutput,
} from "./ConformerBackend";

/**
 * Fallback backend for graphs the knowledge-based generator cannot handle.
 *
 * It keeps the deterministic VSEPR placement (which is geometrically sane)
 * and refines it with the constrained minimizer. The legacy numeric-gradient
 * UFF is never used here: it is the component that stretched C6 chains to
 * thousands of Ångström.
 */
export class HeuristicBackend extends ConformerBackend {
  readonly id = "heuristic";

  private readonly validator = new GeometryValidator();
  private readonly minimizer = new ConstrainedMinimizer();

  isAvailable(): boolean {
    return true;
  }

  build(input: ConformerInput, options: ConformerOptions = {}): ConformerOutput | null {
    const spec: BondSpec = {
      atoms: input.elements,
      bonds: input.bonds,
      ...(input.hybridizations ? { hybridizations: input.hybridizations } : {}),
      ...(input.charges ? { charges: input.charges } : {}),
    };

    let built;
    try {
      built = buildFromBondSpec(spec, input.formula ?? "", input.smiles ?? "");
    } catch {
      return null;
    }

    const warnings: string[] = [];
    const minimized = options.skipMinimise
      ? null
      : this.minimizer.minimize(built.atoms, built.bonds, {
        maxIterations: options.maxIterations ?? 200,
      });
    const atoms: AtomData[] = minimized?.accepted ? minimized.atoms : built.atoms;
    if (minimized && !minimized.accepted) {
      warnings.push("Constrained refinement did not converge; using placement geometry");
    }

    const report = this.validator.validate(atoms, built.bonds);
    if (!report.ok) return null;
    return { atoms, bonds: built.bonds as BondData[], backend: this.id, warnings };
  }

  refine(
    _input: ConformerInput,
    coarse: ConformerOutput,
    options: ConformerOptions = {},
  ): ConformerOutput {
    const warnings: string[] = [];
    const minimized = this.minimizer.minimize(coarse.atoms, coarse.bonds, {
      maxIterations: options.maxIterations ?? 200,
    });
    if (!minimized.accepted) warnings.push("Constrained refinement did not converge; using coarse geometry");
    return {
      atoms: minimized.accepted ? minimized.atoms : coarse.atoms,
      bonds: coarse.bonds,
      backend: this.id,
      warnings,
    };
  }
}
