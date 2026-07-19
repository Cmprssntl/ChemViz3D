/**
 * Conformation search for ChemViz3D
 *
 * Searches for conformations with maximum and minimum coplanarity
 * by rotating all rotatable bonds and evaluating planar fragment counts.
 *
 * ¿ÉÄÜ¹²ÃæÔ­×ÓÊý = max over conformations of (max atoms in any single plane)
 * Ò»¶¨¹²ÃæÔ­×ÓÊý = min over conformations of (max atoms in any single plane)
 *
 * Ëã·¨£º
 * 1. Ã¶¾ÙËùÓÐ¿ÉÐý×ª¼üµÄÐý×ª½Ç×éºÏ£¨¡Ü3¼üÈ«Ã¶¾Ù£¬>3¼ü½üËÆËÑË÷£©
 * 2. ¶ÔÃ¿¸ö¹¹Ïó¼ÆËã×î´ó¹²ÃæÔ­×ÓÊý
 * 3. È¡×î´ó/×îÐ¡Öµ
 */
import * as THREE from "three";
import type { MoleculeData, BondData } from "../types/molecule";
import { applyBondRotation, buildRingBondSet, buildAdj } from "./rotation";
import { detectPlanarFragments, bestFitPlane, planarityDeviation } from "./coplanarity";

export interface ConformerResult {
  molecule: MoleculeData;
  coplanarAtomCount: number;
  coplanarAtomIndices: number[];
  allCoplanarIndices: number[];
}

/**
 * Count unique atoms that are part of the LARGEST merged planar fragment.
 * This represents the maximum number of atoms that can lie in a single plane.
 */
export function countMaxPlanarAtoms(mol: MoleculeData): {
  largestCount: number;
  largestIndices: number[];
  allIndices: number[];
} {
  const fragments = detectPlanarFragments(mol);
  // Tightened thresholds:
  //  - angle: 10° (was 30°). 30° was so lenient that two fragments with
  //    substantially different normals would still merge, producing
  //    "coplanar" sets whose best-fit plane missed the actual atoms.
  //  - post-merge deviation: 0.20 Å. After merging, re-fit a plane to
  //    the union and reject if any atom is more than 0.20 Å off. This
  //    ensures the final "largest coplanar set" is actually coplanar.
  const ANGLE_THRESH = THREE.MathUtils.degToRad(10);
  const POST_MERGE_DEVIATION_TOL = 0.20;

  // Merge overlapping fragments with similar normals
  const merged: Set<number>[] = [];
  const mergedNorms: THREE.Vector3[] = [];

  for (const f of fragments) {
    let added = false;
    for (let g = 0; g < merged.length; g++) {
      const overlaps = [...merged[g]].some(idx => f.atomIndices.includes(idx));
      // Guard: zero-length normals (shouldn't happen after bestFitPlane fix, but safety check)
      const nLen = f.normal.length();
      const mnLen = mergedNorms[g].length();
      if (nLen < 0.0001 || mnLen < 0.0001) {
        // If normal is degenerate, merge based on overlap alone
        if (overlaps) {
          for (const idx of f.atomIndices) merged[g].add(idx);
          added = true;
          break;
        }
      } else if (overlaps && mergedNorms[g].angleTo(f.normal) < ANGLE_THRESH) {
        for (const idx of f.atomIndices) merged[g].add(idx);
        added = true;
        break;
      }
    }
    if (!added) {
      merged.push(new Set(f.atomIndices));
      mergedNorms.push(f.normal.clone());
    }
  }

  // After merging, RE-VERIFY each merged set is actually coplanar.
  // Re-fit a plane to all merged atoms and check max deviation. If any
  // atom is too far off, split (discard) the merge. This prevents
  // drawing a plane that visibly misses some marked atoms.
  const finalMerged: Set<number>[] = [];
  for (let g = 0; g < merged.length; g++) {
    if (merged[g].size < 3) continue;
    const positions = [...merged[g]].map(idx => {
      const a = mol.atoms[idx];
      return new THREE.Vector3(a.x, a.y, a.z);
    });
    const fit = bestFitPlane(positions);
    const dev = planarityDeviation(positions, fit.normal, fit.center);
    if (dev < POST_MERGE_DEVIATION_TOL) {
      finalMerged.push(merged[g]);
    }
    // If deviation too large, this merge is invalid → drop it entirely
    // rather than drawing a misleading plane.
  }

  // Find the SINGLE largest group from the validated merges
  let bestCount = 0;
  let bestIndices: number[] = [];
  const allAtoms = new Set<number>();

  for (const set of finalMerged) {
    for (const idx of set) allAtoms.add(idx);
    if (set.size > bestCount) {
      bestCount = set.size;
      bestIndices = [...set];
    }
  }

  // Geometric floor: any 3 atoms in 3D space are always coplanar.
  // If no chemically-detected planar fragment was found but the molecule
  // has >=3 atoms, return 3 as the guaranteed minimum (using the first
  // 3 atom indices as a representative coplanar triple).
  if (bestCount < 3 && mol.atoms.length >= 3) {
    bestCount = 3;
    bestIndices = [0, 1, 2];
  }

  return {
    largestCount: bestCount,
    largestIndices: bestIndices,
    allIndices: [...allAtoms],
  };
}

/**
 * Build adjacency from bonds (includes all atoms including H)
 */
function _buildAdj(bonds: BondData[]): Map<number, number[]> {
  const adj = new Map<number, number[]>();
  for (const b of bonds) {
    if (!adj.has(b.atom1Idx)) adj.set(b.atom1Idx, []);
    if (!adj.has(b.atom2Idx)) adj.set(b.atom2Idx, []);
    adj.get(b.atom1Idx)!.push(b.atom2Idx);
    adj.get(b.atom2Idx)!.push(b.atom1Idx);
  }
  return adj;
}

/**
 * Get rotatable bonds for conformation search.
 * Excludes ring bonds and bonds to H.
 */
function getRotatableBonds(mol: MoleculeData): BondData[] {
  const adj = _buildAdj(mol.bonds);
  const ringBonds = buildRingBondSet(adj, mol.bonds);

  return mol.bonds.filter((b) => {
    if (b.order !== 1) return false;
    // Skip ring bonds
    const key = Math.min(b.atom1Idx, b.atom2Idx) + "," + Math.max(b.atom1Idx, b.atom2Idx);
    if (ringBonds.has(key)) return false;
    const a1 = mol.atoms[b.atom1Idx];
    const a2 = mol.atoms[b.atom2Idx];
    if (!a1 || !a2) return false;
    // Skip bonds involving H
    if (a1.element === "H" || a2.element === "H") return false;
    // Only C-C, C-O, O-C
    return (a1.element === "C" && a2.element === "C") ||
           (a1.element === "C" && a2.element === "O") ||
           (a1.element === "O" && a2.element === "C");
  });
}

export interface ConformerSearchResult {
  mostPlanar: ConformerResult;
  leastPlanar: ConformerResult;
  totalSearched: number;
}

// For >3 bonds: use random sampling (Monte Carlo)
const MONTE_CARLO_SAMPLES = 500;

/**
 * Clone a molecule (deep copy atoms)
 */
function cloneMol(mol: MoleculeData): MoleculeData {
  return { ...mol, atoms: mol.atoms.map(a => ({ ...a })) };
}

/**
 * Apply a set of rotation angles to a molecule.
 * Each rotation is applied sequentially.
 */
function applyRotations(
  mol: MoleculeData,
  bonds: BondData[],
  angles: number[]
): MoleculeData {
  let cur = cloneMol(mol);
  for (let i = 0; i < bonds.length; i++) {
    if (Math.abs(angles[i]) > 0.5) {
      cur = applyBondRotation(cur, bonds[i].atom1Idx, bonds[i].atom2Idx, angles[i]);
    }
  }
  return cur;
}

/**
 * Continuous coplanarity score for a molecule.
 *
 * Returns:
 * - count  : the size of the largest merged planar fragment
 *            (i.e. the discrete "coplanar atom count").
 * - dev    : the max distance of any atom in that fragment from the
 *            best-fit plane through the fragment. Lower = more truly
 *            planar. Returns 0 if the count is below the geometric floor.
 *
 * Used as a fine-grained score for the refinement phase of the
 * coarse-to-fine search: among conformations with the same `count`,
 * the one with the smaller `dev` is more coplanar.
 */
function scoreCoplanarity(mol: MoleculeData): { count: number; dev: number } {
  const { largestCount, largestIndices } = countMaxPlanarAtoms(mol);
  if (largestCount < 3) return { count: largestCount, dev: 0 };
  const positions = largestIndices.map((idx) => {
    const a = mol.atoms[idx];
    return new THREE.Vector3(a.x, a.y, a.z);
  });
  const { normal, center } = bestFitPlane(positions);
  let maxDev = 0;
  for (const p of positions) {
    const d = Math.abs(p.clone().sub(center).dot(normal));
    if (d > maxDev) maxDev = d;
  }
  return { count: largestCount, dev: maxDev };
}

/**
 * Compare two (count, dev) pairs.
 *   A is better than B if A.count > B.count, or
 *   if A.count === B.count and A.dev < B.dev.
 * For "least planar" we invert the comparison.
 */
function isBetter(aCount: number, aDev: number, bCount: number, bDev: number, mode: "most" | "least"): boolean {
  if (mode === "most") {
    if (aCount !== bCount) return aCount > bCount;
    return aDev < bDev;
  } else {
    if (aCount !== bCount) return aCount < bCount;
    return aDev > bDev;
  }
}

/**
 * Alternating 1D line search: for each bond, sweep a small range around
 * the current best angle and keep the best. Iterate until no further
 * improvement. This is the refinement phase of the coarse-to-fine search.
 *
 * Cost: O(iters * bonds * FINE_STEPS) evaluations, typically 1-2 iters.
 */
function refineAngles(
  molecule: MoleculeData,
  bonds: BondData[],
  startAngles: number[],
  mode: "most" | "least",
  FINE_RANGE: number,
  FINE_STEPS: number
): { angles: number[]; count: number; dev: number } {
  const step = (2 * FINE_RANGE) / (FINE_STEPS - 1);
  let angles = [...startAngles];
  const baseScore = scoreCoplanarity(applyRotations(molecule, bonds, angles));
  let bestCount = baseScore.count;
  let bestDev = baseScore.dev;

  for (let iter = 0; iter < 5; iter++) {
    let iterImproved = false;
    for (let b = 0; b < bonds.length; b++) {
      let localBestAngle = angles[b];
      const others = angles.slice(0, b).concat(angles.slice(b + 1));
      // Pre-build the trial: vary only bond `b`, keep the others fixed
      const trialBase = [...angles];
      for (let s = 0; s < FINE_STEPS; s++) {
        const offset = -FINE_RANGE + s * step;
        trialBase[b] = angles[b] + offset;
        const rotated = applyRotations(molecule, bonds, trialBase);
        const sc = scoreCoplanarity(rotated);
        if (isBetter(sc.count, sc.dev, bestCount, bestDev, mode)) {
          bestCount = sc.count;
          bestDev = sc.dev;
          localBestAngle = trialBase[b];
          iterImproved = true;
        }
      }
      angles[b] = localBestAngle;
      // (Best molecule is rebuilt from the final angles outside this function)
    }
    if (!iterImproved) break;
  }
  return { angles, count: bestCount, dev: bestDev };
}

/**
 * Search for the most and least planar conformations.
 *
 * Algorithm (coarse-to-fine):
 * - Phase 1 (coarse): full enumeration at 15° step (24 angles per bond).
 *   Up to 24^3 = 13,824 evaluations. Finds the best *region*.
 * - Phase 2 (refine): alternating 1D line search around the coarse
 *   optimum, with 0.5° step in a ±5° window. Typically converges in
 *   1-2 iterations, ~60 evaluations per bond. Uses a continuous score
 *   (count + max deviation of merged atoms) so the truly-most-planar
 *   conformation wins the tie.
 * - >3 rotatable bonds: Monte Carlo random sampling (500 samples).
 */
export function searchExtremeConformations(molecule: MoleculeData): ConformerSearchResult {
  const bonds = getRotatableBonds(molecule);

  // Base evaluation (no rotation)
  const baseResult = countMaxPlanarAtoms(molecule);

  if (bonds.length === 0) {
    return {
      mostPlanar: {
        molecule: cloneMol(molecule),
        coplanarAtomCount: baseResult.largestCount,
        coplanarAtomIndices: baseResult.largestIndices,
        allCoplanarIndices: baseResult.allIndices,
      },
      leastPlanar: {
        molecule: cloneMol(molecule),
        coplanarAtomCount: baseResult.largestCount,
        coplanarAtomIndices: baseResult.largestIndices,
        allCoplanarIndices: baseResult.allIndices,
      },
      totalSearched: 1,
    };
  }

  // ── Phase 1: coarse grid (15° step, 24 angles) for ≤3 bonds, ──
  //            or Monte Carlo for >3 bonds.
  const COARSE_STEPS = 24;
  const coarseStepAngle = 360 / COARSE_STEPS;

  let bestMostAngles: number[] = bonds.map(() => 0);
  let bestMostCount = baseResult.largestCount;
  let bestMostDev = 0;
  let bestLeastAngles: number[] = bonds.map(() => 0);
  let bestLeastCount = baseResult.largestCount;
  let bestLeastDev = 0;
  let totalSearched = 1;

  if (bonds.length <= 3) {
    // Full enumeration at 15° step
    const angleCache: number[][] = [];
    function generate(idx: number, current: number[]) {
      if (idx === bonds.length) {
        angleCache.push([...current]);
        return;
      }
      for (let s = 0; s < COARSE_STEPS; s++) {
        current.push(s * coarseStepAngle);
        generate(idx + 1, current);
        current.pop();
      }
    }
    if (bonds.length > 0) generate(0, []);

    for (const angles of angleCache) {
      const rotated = applyRotations(molecule, bonds, angles);
      const sc = scoreCoplanarity(rotated);
      totalSearched++;

      if (isBetter(sc.count, sc.dev, bestMostCount, bestMostDev, "most")) {
        bestMostCount = sc.count;
        bestMostDev = sc.dev;
        bestMostAngles = angles;
      }
      if (isBetter(sc.count, sc.dev, bestLeastCount, bestLeastDev, "least")) {
        bestLeastCount = sc.count;
        bestLeastDev = sc.dev;
        bestLeastAngles = angles;
      }
    }
  } else {
    // Monte Carlo random sampling for >3 bonds
    for (let i = 0; i < MONTE_CARLO_SAMPLES; i++) {
      const angles = bonds.map(() => Math.floor(Math.random() * COARSE_STEPS) * coarseStepAngle);
      const rotated = applyRotations(molecule, bonds, angles);
      const sc = scoreCoplanarity(rotated);
      totalSearched++;
      if (isBetter(sc.count, sc.dev, bestMostCount, bestMostDev, "most")) {
        bestMostCount = sc.count;
        bestMostDev = sc.dev;
        bestMostAngles = angles;
      }
      if (isBetter(sc.count, sc.dev, bestLeastCount, bestLeastDev, "least")) {
        bestLeastCount = sc.count;
        bestLeastDev = sc.dev;
        bestLeastAngles = angles;
      }
    }
  }

  // ── Phase 2: refine around the coarse optimum ──
  // 0.5° step in a ±5° window (21 evaluations per bond per iteration).
  // Only for ≤3 bonds; Monte Carlo results are not refined.
  if (bonds.length <= 3) {
    const FINE_RANGE = 5; // degrees
    const FINE_STEPS = 21;

    const mostRefined = refineAngles(
      molecule, bonds, bestMostAngles, "most", FINE_RANGE, FINE_STEPS
    );
    if (isBetter(mostRefined.count, mostRefined.dev, bestMostCount, bestMostDev, "most")) {
      bestMostCount = mostRefined.count;
      bestMostDev = mostRefined.dev;
      bestMostAngles = mostRefined.angles;
    }
    totalSearched += FINE_STEPS * bonds.length * 2; // rough estimate

    const leastRefined = refineAngles(
      molecule, bonds, bestLeastAngles, "least", FINE_RANGE, FINE_STEPS
    );
    if (isBetter(leastRefined.count, leastRefined.dev, bestLeastCount, bestLeastDev, "least")) {
      bestLeastCount = leastRefined.count;
      bestLeastDev = leastRefined.dev;
      bestLeastAngles = leastRefined.angles;
    }
  }

  // Rebuild the final molecules from the best angle vectors
  const bestMostMol = applyRotations(molecule, bonds, bestMostAngles);
  const bestLeastMol = applyRotations(molecule, bonds, bestLeastAngles);
  const mostResult = countMaxPlanarAtoms(bestMostMol);
  const leastResult = countMaxPlanarAtoms(bestLeastMol);

  return {
    mostPlanar: {
      molecule: bestMostMol,
      coplanarAtomCount: mostResult.largestCount,
      coplanarAtomIndices: mostResult.largestIndices,
      allCoplanarIndices: mostResult.allIndices,
    },
    leastPlanar: {
      molecule: bestLeastMol,
      coplanarAtomCount: leastResult.largestCount,
      coplanarAtomIndices: leastResult.largestIndices,
      allCoplanarIndices: leastResult.allIndices,
    },
    totalSearched,
  };
}
