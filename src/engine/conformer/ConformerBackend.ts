import type { AtomData, BondData } from "../../types/molecule";
import type { ChemVZHybrid } from "../../types/moleculeFormat";

/** Graph-level input for every conformer backend (heavy atoms only). */
export interface ConformerInput {
  elements: string[];
  /** [atom1, atom2, order] */
  bonds: Array<[number, number, number]>;
  hybridizations?: Array<ChemVZHybrid | undefined>;
  charges?: Array<number | undefined>;
  formula?: string;
  smiles?: string;
}

export interface ConformerOutput {
  atoms: AtomData[];
  bonds: BondData[];
  backend: string;
  warnings: string[];
}

export interface ConformerOptions {
  /** Fixed seed keeps generation reproducible across reloads. */
  seed?: number;
  /** MMFF94 iteration cap; large molecules use fewer iterations. */
  maxIterations?: number;
  /** Skip the initial minimisation and return the raw conformer. */
  skipMinimise?: boolean;
  /** Background refinement should use `ConstrainedMinimizer` instead of MMFF94. */
  useConstrained?: boolean;
  /** MMFF94 iterations per cooperative chunk. */
  chunkIterations?: number;
}

/**
 * Polymorphic base class for 3D structure generation. Backends must never
 * return geometry that fails `GeometryValidator`: the service validates and
 * falls through to the next backend instead of rendering a broken structure.
 */
export abstract class ConformerBackend {
  abstract readonly id: string;

  abstract isAvailable(): boolean;

  abstract build(input: ConformerInput, options: ConformerOptions): ConformerOutput | null;

  /**
   * Optional second stage for large molecules. Returns refined geometry for
   * the same graph, or null when the backend cannot refine it.
   */
  refine?(
    input: ConformerInput,
    coarse: ConformerOutput,
    options: ConformerOptions,
  ): Promise<ConformerOutput | null> | ConformerOutput | null;
}

export class ConformerError extends Error {
  constructor(message: string, public readonly attempts: string[]) {
    super(message);
    this.name = "ConformerError";
  }
}

export function elementFromAtomicNumber(atomicNumber: number): string {
  const table = [
    "", "H", "He", "Li", "Be", "B", "C", "N", "O", "F", "Ne",
    "Na", "Mg", "Al", "Si", "P", "S", "Cl", "Ar", "K", "Ca",
    "Sc", "Ti", "V", "Cr", "Mn", "Fe", "Co", "Ni", "Cu", "Zn",
    "Ga", "Ge", "As", "Se", "Br", "Kr", "Rb", "Sr", "Y", "Zr",
    "Nb", "Mo", "Tc", "Ru", "Rh", "Pd", "Ag", "Cd", "In", "Sn",
    "Sb", "Te", "I",
  ];
  return table[atomicNumber] ?? "C";
}

export function atomicNumberFromElement(element: string): number {
  const symbols = [
    "H", "He", "Li", "Be", "B", "C", "N", "O", "F", "Ne",
    "Na", "Mg", "Al", "Si", "P", "S", "Cl", "Ar", "K", "Ca",
    "Sc", "Ti", "V", "Cr", "Mn", "Fe", "Co", "Ni", "Cu", "Zn",
    "Ga", "Ge", "As", "Se", "Br", "Kr", "Rb", "Sr", "Y", "Zr",
    "Nb", "Mo", "Tc", "Ru", "Rh", "Pd", "Ag", "Cd", "In", "Sn",
    "Sb", "Te", "I",
  ];
  const index = symbols.indexOf(element);
  return index >= 0 ? index + 1 : 6;
}
