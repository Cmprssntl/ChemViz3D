import type { MoleculeData } from "../../types/molecule";
import { MolecularGraph } from "../graph/MolecularGraph";

/** Typical valences used to derive implicit hydrogens. */
const VALENCE: Record<string, number> = {
  H: 1, B: 3, C: 4, N: 3, O: 2, F: 1, Si: 4, P: 3, S: 2, Cl: 1, Br: 1, I: 1,
};

export interface HeavyBond {
  a: number;
  b: number;
  order: number;
}

/**
 * Hydrogen-suppressed view of a molecule.
 *
 * Naming works on heavy atoms only: locants, parent chains and substituents are
 * all defined on the heavy skeleton, while hydrogen counts are needed for
 * aldehyde/amine detection and for validating that a lone carbon really is
 * methane and not, say, carbon dioxide.
 */
export class HeavyMolecule {
  readonly graph: MolecularGraph;
  private readonly orderByPair = new Map<string, number>();

  private constructor(
    readonly elements: readonly string[],
    readonly bonds: readonly HeavyBond[],
    readonly hydrogens: readonly number[],
    readonly charges: readonly number[],
  ) {
    this.graph = new MolecularGraph(
      elements.length,
      bonds.map((bond, index) => ({ index, a: bond.a, b: bond.b, order: bond.order })),
    );
    for (const bond of bonds) this.orderByPair.set(pairKey(bond.a, bond.b), bond.order);
  }

  static fromMolecule(molecule: MoleculeData): HeavyMolecule {
    const indexOf = new Map<number, number>();
    const elements: string[] = [];
    const charges: number[] = [];
    molecule.atoms.forEach((atom, index) => {
      if (atom.element === "H") return;
      indexOf.set(index, elements.length);
      elements.push(atom.element);
      charges.push(atom.charge ?? 0);
    });

    const bonds: HeavyBond[] = [];
    const used = new Array(elements.length).fill(0);
    for (const bond of molecule.bonds) {
      const a = indexOf.get(bond.atom1Idx);
      const b = indexOf.get(bond.atom2Idx);
      if (a === undefined || b === undefined) continue;
      const order = Math.max(1, Math.round(bond.order));
      bonds.push({ a, b, order });
      used[a] += order;
      used[b] += order;
    }

    const hydrogens = elements.map((element, index) => {
      const target = (VALENCE[element] ?? 0) + charges[index];
      return Math.max(0, Math.round(target - used[index]));
    });
    return new HeavyMolecule(elements, bonds, hydrogens, charges);
  }

  get size(): number {
    return this.elements.length;
  }

  isCarbon(atom: number): boolean {
    return this.elements[atom] === "C";
  }

  neighbors(atom: number): readonly number[] {
    return this.graph.neighborsOf(atom);
  }

  carbonNeighbors(atom: number): number[] {
    return this.neighbors(atom).filter((neighbor) => this.isCarbon(neighbor));
  }

  order(a: number, b: number): number {
    return this.orderByPair.get(pairKey(a, b)) ?? 0;
  }

  doubleBondedNeighbors(atom: number): number[] {
    return this.neighbors(atom).filter((neighbor) => this.order(atom, neighbor) === 2);
  }

  singleBondedNeighbors(atom: number): number[] {
    return this.neighbors(atom).filter((neighbor) => this.order(atom, neighbor) === 1);
  }

  isTerminal(atom: number): boolean {
    return this.neighbors(atom).length <= 1;
  }
}

function pairKey(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}
