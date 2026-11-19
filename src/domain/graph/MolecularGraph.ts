/**
 * Single graph implementation shared by every geometry feature.
 *
 * Before this module existed, adjacency, ring perception and rotatable-bond
 * rules were re-implemented in `conformer.ts`, `rotation.ts`,
 * `coplanarity.ts`, `conformerSearch.ts` and `properties.ts`. Diverging
 * definitions caused rings to be rotated, rotatable-bond counts to disagree
 * between panels, and conformer search to explore different bonds than the
 * optimizer. All of that now goes through one class.
 */

export interface GraphBond {
  index: number;
  a: number;
  b: number;
  order: number;
}

export interface RotatableBondPolicy {
  /** Amide C-N bonds are planar and must not be treated as free rotors. */
  excludeAmide: boolean;
}

const DEFAULT_POLICY: RotatableBondPolicy = { excludeAmide: true };

export class MolecularGraph {
  readonly atomCount: number;
  readonly bonds: readonly GraphBond[];
  private readonly adjacency: number[][];
  private readonly bondByAtom: GraphBond[][];
  private ringCache: number[][] | null = null;

  constructor(atomCount: number, bonds: readonly GraphBond[]) {
    this.atomCount = atomCount;
    this.bonds = [...bonds];
    this.adjacency = Array.from({ length: atomCount }, () => [] as number[]);
    this.bondByAtom = Array.from({ length: atomCount }, () => [] as GraphBond[]);
    for (const bond of this.bonds) {
      if (!this.isValidAtom(bond.a) || !this.isValidAtom(bond.b) || bond.a === bond.b) continue;
      this.adjacency[bond.a].push(bond.b);
      this.adjacency[bond.b].push(bond.a);
      this.bondByAtom[bond.a].push(bond);
      this.bondByAtom[bond.b].push(bond);
    }
    for (const neighbors of this.adjacency) neighbors.sort((x, y) => x - y);
  }

  static bondKey(a: number, b: number): string {
    return a < b ? `${a},${b}` : `${b},${a}`;
  }

  isValidAtom(index: number): boolean {
    return Number.isInteger(index) && index >= 0 && index < this.atomCount;
  }

  neighborsOf(atom: number): readonly number[] {
    return this.adjacency[atom] ?? [];
  }

  bondsOf(atom: number): readonly GraphBond[] {
    return this.bondByAtom[atom] ?? [];
  }

  degree(atom: number): number {
    return this.neighborsOf(atom).length;
  }

  /** Bounded simple-cycle perception (deterministic, sorted by size). */
  findRings(maxSize = 12): number[][] {
    const cached = this.ringCache;
    if (cached && maxSize <= 12) return cached.filter((ring) => ring.length <= maxSize);

    const rings: number[][] = [];
    const seen = new Set<string>();
    const visit = (start: number, current: number, path: number[], used: Set<number>) => {
      for (const next of this.neighborsOf(current)) {
        if (next === start) {
          if (path.length >= 3 && path.length <= maxSize) {
            const key = MolecularGraph.canonicalCycle(path);
            if (!seen.has(key)) {
              seen.add(key);
              rings.push([...path]);
            }
          }
          continue;
        }
        if (next < start || used.has(next) || path.length >= maxSize) continue;
        used.add(next);
        path.push(next);
        visit(start, next, path, used);
        path.pop();
        used.delete(next);
      }
    };
    for (let start = 0; start < this.atomCount; start++) {
      if (this.degree(start) === 0) continue;
      visit(start, start, [start], new Set([start]));
    }
    rings.sort((x, y) => x.length - y.length || MolecularGraph.canonicalCycle(x).localeCompare(MolecularGraph.canonicalCycle(y)));
    this.ringCache = rings;
    return rings.filter((ring) => ring.length <= maxSize);
  }

  static canonicalCycle(cycle: readonly number[]): string {
    const variants: string[] = [];
    for (const ordered of [cycle, [...cycle].reverse()]) {
      for (let offset = 0; offset < ordered.length; offset++) {
        variants.push([...ordered.slice(offset), ...ordered.slice(0, offset)].join(","));
      }
    }
    return variants.sort()[0];
  }

  ringBondKeys(maxSize = 12): Set<string> {
    const keys = new Set<string>();
    for (const ring of this.findRings(maxSize)) {
      for (let i = 0; i < ring.length; i++) {
        keys.add(MolecularGraph.bondKey(ring[i], ring[(i + 1) % ring.length]));
      }
    }
    return keys;
  }

  isRingAtom(atom: number, maxSize = 12): boolean {
    return this.findRings(maxSize).some((ring) => ring.includes(atom));
  }

  /**
   * Rotatable single bonds. A bond is rotatable when it is acyclic, connects
   * two heavy atoms that both keep at least two heavy neighbours, and is not
   * an amide C-N bond (unless the caller explicitly opts in).
   */
  rotatableBonds(elements: readonly string[], policy: RotatableBondPolicy = DEFAULT_POLICY): GraphBond[] {
    const ringBonds = this.ringBondKeys();
    return this.bonds.filter((bond) => {
      if (bond.order !== 1) return false;
      if (elements[bond.a] === "H" || elements[bond.b] === "H") return false;
      if (ringBonds.has(MolecularGraph.bondKey(bond.a, bond.b))) return false;
      if (policy.excludeAmide && this.isAmideBond(bond, elements)) return false;
      return this.heavyNeighborCount(bond.a, elements) >= 2
        && this.heavyNeighborCount(bond.b, elements) >= 2;
    });
  }

  heavyNeighborCount(atom: number, elements: readonly string[]): number {
    return this.neighborsOf(atom).filter((neighbor) => elements[neighbor] !== "H").length;
  }

  isAmideBond(bond: GraphBond, elements: readonly string[]): boolean {
    const pairs: Array<[number, number]> = [[bond.a, bond.b], [bond.b, bond.a]];
    return pairs.some(([carbon, nitrogen]) =>
      elements[carbon] === "C"
      && elements[nitrogen] === "N"
      && this.bondsOf(carbon).some((neighbor) =>
        neighbor.order === 2 && elements[neighbor.a === carbon ? neighbor.b : neighbor.a] === "O"));
  }

  /**
   * Splits the graph at a bond and returns the smaller side. The returned
   * `anchor` stays fixed and `rotor` is the atom whose side rotates.
   */
  sideOf(bond: GraphBond): { anchor: number; rotor: number; atoms: Set<number> } | null {
    const sideA = this.reachable(bond.a, bond.b);
    const sideB = this.reachable(bond.b, bond.a);
    if (sideA.size === 0 || sideB.size === 0) return null;
    const rotateA = sideA.size <= sideB.size;
    const atoms = rotateA ? sideA : sideB;
    atoms.delete(bond.a);
    atoms.delete(bond.b);
    if (atoms.size === 0) return null;
    return {
      anchor: rotateA ? bond.b : bond.a,
      rotor: rotateA ? bond.a : bond.b,
      atoms,
    };
  }

  reachable(start: number, blocked: number): Set<number> {
    const visited = new Set<number>([start]);
    const queue = [start];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const next of this.neighborsOf(current)) {
        if (next === blocked || visited.has(next)) continue;
        visited.add(next);
        queue.push(next);
      }
    }
    return visited;
  }

  connectedComponents(): number[][] {
    const visited = new Set<number>();
    const components: number[][] = [];
    for (let atom = 0; atom < this.atomCount; atom++) {
      if (visited.has(atom)) continue;
      const component = [...this.reachable(atom, -1)].sort((x, y) => x - y);
      component.forEach((index) => visited.add(index));
      components.push(component);
    }
    return components;
  }

  /** Atoms within `depth` bonds of `atom`, used for steric exclusion sets. */
  neighborhood(atom: number, depth: number): Set<number> {
    const result = new Set<number>([atom]);
    let frontier = [atom];
    for (let step = 0; step < depth; step++) {
      const next: number[] = [];
      for (const current of frontier) {
        for (const neighbor of this.neighborsOf(current)) {
          if (result.has(neighbor)) continue;
          result.add(neighbor);
          next.push(neighbor);
        }
      }
      frontier = next;
    }
    return result;
  }
}
