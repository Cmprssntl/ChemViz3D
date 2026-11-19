/**
 * Post-condition checks for any geometry produced by a conformer backend or
 * by the relaxation pipeline. Nothing reaches the renderer before passing
 * these checks: the old pipeline shipped 2800 Å bonds for a C6 chain.
 */

export interface GeometryAtom {
  element: string;
  x: number;
  y: number;
  z: number;
}

export interface GeometryBond {
  atom1Idx: number;
  atom2Idx: number;
  order: number;
}

export interface GeometryIssue {
  code: "non-finite" | "bond-length" | "atom-overlap" | "extent" | "index";
  message: string;
  atoms?: number[];
}

export interface GeometryStats {
  minBond: number;
  maxBond: number;
  minNonBonded: number;
  extent: number;
}

export interface GeometryReport {
  ok: boolean;
  issues: GeometryIssue[];
  stats: GeometryStats;
}

/** Reference lengths in Ångström, keyed by the canonical element pair. */
const REFERENCE_LENGTHS: Record<string, number> = {
  "C-C": 1.54, "C=C": 1.34, "C#C": 1.20,
  "C-O": 1.43, "C=O": 1.22,
  "C-N": 1.47, "C=N": 1.38, "C#N": 1.16,
  "C-H": 1.09, "N-H": 1.01, "O-H": 0.96,
  "C-F": 1.35, "C-Cl": 1.79, "C-Br": 1.97, "C-I": 2.14,
  "C-S": 1.82, "S-H": 1.34, "C-P": 1.87, "N-N": 1.45, "N-O": 1.40, "O-O": 1.48,
};

const MIN_NON_BONDED = 0.6;
const MAX_EXTENT = 1000;

export class GeometryValidator {
  private readonly bondTolerance: number;

  constructor(bondTolerance = 0.35) {
    this.bondTolerance = bondTolerance;
  }

  validate(atoms: readonly GeometryAtom[], bonds: readonly GeometryBond[]): GeometryReport {
    const issues: GeometryIssue[] = [];
    const stats: GeometryStats = { minBond: Infinity, maxBond: 0, minNonBonded: Infinity, extent: 0 };
    if (atoms.length === 0) return { ok: true, issues, stats };

    for (let i = 0; i < atoms.length; i++) {
      const atom = atoms[i];
      if (!Number.isFinite(atom.x) || !Number.isFinite(atom.y) || !Number.isFinite(atom.z)) {
        issues.push({ code: "non-finite", message: `Atom ${i} has non-finite coordinates`, atoms: [i] });
      }
    }
    if (issues.length > 0) return { ok: false, issues, stats };

    for (const bond of bonds) {
      if (!atoms[bond.atom1Idx] || !atoms[bond.atom2Idx]) {
        issues.push({ code: "index", message: `Bond references a missing atom (${bond.atom1Idx}, ${bond.atom2Idx})` });
        continue;
      }
      const length = distance(atoms[bond.atom1Idx], atoms[bond.atom2Idx]);
      stats.minBond = Math.min(stats.minBond, length);
      stats.maxBond = Math.max(stats.maxBond, length);
      const reference = referenceLength(atoms[bond.atom1Idx].element, atoms[bond.atom2Idx].element, bond.order);
      const deviation = Math.abs(length - reference);
      if (deviation > Math.max(this.bondTolerance, reference * 0.25)) {
        issues.push({
          code: "bond-length",
          message: `Bond ${bond.atom1Idx}-${bond.atom2Idx} is ${length.toFixed(2)} Å (expected ~${reference.toFixed(2)} Å)`,
          atoms: [bond.atom1Idx, bond.atom2Idx],
        });
      }
    }

    stats.minNonBonded = this.minNonBondedDistance(atoms);
    if (stats.minNonBonded < MIN_NON_BONDED) {
      issues.push({
        code: "atom-overlap",
        message: `Two atoms are ${stats.minNonBonded.toFixed(2)} Å apart`,
      });
    }

    stats.extent = extentOf(atoms);
    if (!Number.isFinite(stats.extent) || stats.extent > MAX_EXTENT) {
      issues.push({ code: "extent", message: `Structure extent is ${stats.extent.toFixed(1)} Å` });
    }

    if (Number.isFinite(stats.minBond) === false) stats.minBond = 0;
    if (Number.isFinite(stats.minNonBonded) === false) stats.minNonBonded = 0;
    return { ok: issues.length === 0, issues, stats };
  }

  /** Grid-hashed nearest-pair search, O(n) for practical molecule sizes. */
  private minNonBondedDistance(atoms: readonly GeometryAtom[]): number {
    const cellSize = 3;
    const cells = new Map<string, number[]>();
    const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
    let min = Infinity;
    for (let i = 0; i < atoms.length; i++) {
      const atom = atoms[i];
      const cx = Math.floor(atom.x / cellSize);
      const cy = Math.floor(atom.y / cellSize);
      const cz = Math.floor(atom.z / cellSize);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dz = -1; dz <= 1; dz++) {
            const bucket = cells.get(key(cx + dx, cy + dy, cz + dz));
            if (!bucket) continue;
            for (const other of bucket) {
              min = Math.min(min, distance(atom, atoms[other]));
            }
          }
        }
      }
      const bucketKey = key(cx, cy, cz);
      const bucket = cells.get(bucketKey);
      if (bucket) bucket.push(i);
      else cells.set(bucketKey, [i]);
    }
    return min;
  }
}

export function referenceLength(elementA: string, elementB: string, order: number): number {
  const symbol = order >= 3 ? "#" : order >= 2 ? "=" : "-";
  const candidates = [`${elementA}${symbol}${elementB}`, `${elementB}${symbol}${elementA}`];
  for (const key of candidates) {
    const value = REFERENCE_LENGTHS[key];
    if (value) return value;
  }
  const singleCandidates = [`${elementA}-${elementB}`, `${elementB}-${elementA}`];
  for (const key of singleCandidates) {
    const value = REFERENCE_LENGTHS[key];
    if (value) return value;
  }
  return 1.5;
}

export function distance(a: GeometryAtom, b: GeometryAtom): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function extentOf(atoms: readonly GeometryAtom[]): number {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const atom of atoms) {
    minX = Math.min(minX, atom.x); maxX = Math.max(maxX, atom.x);
    minY = Math.min(minY, atom.y); maxY = Math.max(maxY, atom.y);
    minZ = Math.min(minZ, atom.z); maxZ = Math.max(maxZ, atom.z);
  }
  return Math.hypot(maxX - minX, maxY - minY, maxZ - minZ);
}
