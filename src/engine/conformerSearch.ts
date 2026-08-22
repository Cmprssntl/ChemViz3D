/** Deterministic conformer search for maximum and minimum coplanarity. */
import * as THREE from "three";
import type { BondData, MoleculeData } from "../types/molecule";
import { applyBondRotation, buildAdj, buildRingBondSet } from "./rotation";
import {
  bestFitPlane,
  detectPlanarFragments,
  planarityDeviation,
  planarityRmsDeviation,
  type CoplanarSet,
} from "./coplanarity";

export interface ConformerResult {
  molecule: MoleculeData;
  coplanarAtomCount: number;
  coplanarAtomIndices: number[];
  allCoplanarIndices: number[];
}

export type ConformerSearchQuality = "fast" | "balanced" | "precise";

export interface ConformerSearchOptions {
  quality?: ConformerSearchQuality;
}

interface SearchBudget {
  gridSteps: number;
  sampleCount: number;
  beamWidth: number;
  refineStarts: number;
  refineRounds: number;
  refineSteps: number[];
}

const SEARCH_BUDGETS: Record<ConformerSearchQuality, SearchBudget> = {
  fast: { gridSteps: 12, sampleCount: 256, beamWidth: 8, refineStarts: 4, refineRounds: 2, refineSteps: [15, 3] },
  balanced: { gridSteps: 24, sampleCount: 1024, beamWidth: 16, refineStarts: 8, refineRounds: 3, refineSteps: [15, 5, 1] },
  precise: { gridSteps: 36, sampleCount: 4096, beamWidth: 32, refineStarts: 16, refineRounds: 4, refineSteps: [15, 5, 1, 0.5] },
};

interface PlanarScore {
  /** Chemically meaningful count; the 3-atom geometric floor is excluded. */
  count: number;
  indices: number[];
  allIndices: number[];
  maxDeviation: number;
  rmsDeviation: number;
  continuity: number;
}

interface Candidate {
  angles: number[];
  score: PlanarScore;
}

interface MergeState {
  indices: number[];
  fragmentIds: number[];
  maxDeviation: number;
  rmsDeviation: number;
  continuity: number;
  tolerance: number;
}

// A fragment's own tolerance describes the geometry of that chemical unit.
// Once separate fragments are combined, use a substantially tighter bound:
// otherwise two nearby but visibly different planes can be accepted by the
// least-squares fit and reported/highlighted as one coplanar set.
const MERGE_DEVIATION_TOL = 0.08;
const MERGE_BEAM_WIDTH = 48;
const HALTON_PRIMES = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53];

function cloneMol(mol: MoleculeData): MoleculeData {
  return { ...mol, atoms: mol.atoms.map((atom) => ({ ...atom })) };
}

function normalizeAngle(angle: number): number {
  const wrapped = ((angle + 180) % 360 + 360) % 360 - 180;
  return Math.abs(wrapped) < 1e-9 ? 0 : wrapped;
}

function angleKey(angles: number[]): string {
  return angles.map((angle) => normalizeAngle(angle).toFixed(3)).join(",");
}

function applyRotations(molecule: MoleculeData, bonds: BondData[], angles: number[]): MoleculeData {
  let current = cloneMol(molecule);
  for (let index = 0; index < bonds.length; index++) {
    const angle = normalizeAngle(angles[index] || 0);
    if (Math.abs(angle) > 0.5) {
      current = applyBondRotation(current, bonds[index].atom1Idx, bonds[index].atom2Idx, angle);
    }
  }
  return current;
}

function atomPositions(molecule: MoleculeData, indices: number[]): THREE.Vector3[] {
  return indices.map((index) => {
    const atom = molecule.atoms[index];
    return new THREE.Vector3(atom.x, atom.y, atom.z);
  });
}

function hasCarbonylNeighbor(molecule: MoleculeData, atomIndex: number): boolean {
  return molecule.bonds.some((bond) => {
    if (bond.order !== 2) return false;
    const other = bond.atom1Idx === atomIndex ? bond.atom2Idx : bond.atom2Idx === atomIndex ? bond.atom1Idx : -1;
    return other >= 0 && molecule.atoms[other]?.element === "O";
  });
}

function getRotatableBonds(molecule: MoleculeData): BondData[] {
  const adj = buildAdj(molecule.bonds);
  const ringBonds = buildRingBondSet(adj, molecule.bonds);
  return molecule.bonds.filter((bond) => {
    if (bond.order !== 1) return false;
    const first = molecule.atoms[bond.atom1Idx];
    const second = molecule.atoms[bond.atom2Idx];
    if (!first || !second || first.element === "H" || second.element === "H") return false;
    const key = `${Math.min(bond.atom1Idx, bond.atom2Idx)},${Math.max(bond.atom1Idx, bond.atom2Idx)}`;
    if (ringBonds.has(key)) return false;
    // Amide C-N bonds have appreciable partial-double-bond character and
    // should remain planar rather than being treated as free rotors.
    const amide = (first.element === "C" && second.element === "N" && hasCarbonylNeighbor(molecule, bond.atom1Idx))
      || (second.element === "C" && first.element === "N" && hasCarbonylNeighbor(molecule, bond.atom2Idx));
    return !amide;
  });
}

function fragmentContinuity(indices: number[], bonds: BondData[]): number {
  const members = new Set(indices);
  return bonds.reduce((total, bond) => total + (members.has(bond.atom1Idx) && members.has(bond.atom2Idx) ? 1 : 0), 0);
}

function mergeState(molecule: MoleculeData, fragments: CoplanarSet[], fragmentIds: number[]): MergeState | null {
  const indices = [...new Set(fragmentIds.flatMap((id) => fragments[id].atomIndices))].sort((a, b) => a - b);
  if (indices.length < 3) return null;
  const positions = atomPositions(molecule, indices);
  const fit = bestFitPlane(positions);
  const maxDeviation = planarityDeviation(positions, fit.normal, fit.center);
  const fragmentTolerances = fragmentIds.map((id) => fragments[id].tolerance ?? MERGE_DEVIATION_TOL);
  // A single fragment is already validated by detectPlanarFragments and may
  // use its chemistry-specific tolerance. For a union, the strictest member
  // controls the result; taking the loosest tolerance was the source of
  // visibly off-plane atoms being merged into a highlighted set.
  const tolerance = fragmentIds.length === 1
    ? fragmentTolerances[0]
    : Math.min(MERGE_DEVIATION_TOL, ...fragmentTolerances);
  if (maxDeviation >= tolerance) return null;
  return {
    indices,
    fragmentIds: [...fragmentIds].sort((a, b) => a - b),
    maxDeviation,
    rmsDeviation: planarityRmsDeviation(positions, fit.normal, fit.center),
    continuity: fragmentContinuity(indices, molecule.bonds),
    tolerance,
  };
}

function compareMergeState(a: MergeState, b: MergeState): number {
  return b.indices.length - a.indices.length
    || a.maxDeviation - b.maxDeviation
    || a.rmsDeviation - b.rmsDeviation
    || b.continuity - a.continuity
    || a.fragmentIds.join(",").localeCompare(b.fragmentIds.join(","));
}

function connectedFragments(a: CoplanarSet, b: CoplanarSet, bonds: BondData[]): boolean {
  const first = new Set(a.atomIndices);
  const second = new Set(b.atomIndices);
  if (a.atomIndices.some((index) => second.has(index))) return true;
  return bonds.some((bond) => (first.has(bond.atom1Idx) && second.has(bond.atom2Idx))
    || (first.has(bond.atom2Idx) && second.has(bond.atom1Idx)));
}

function selectPlanarSet(molecule: MoleculeData, fragments: CoplanarSet[]): PlanarScore {
  if (fragments.length === 0) {
    return { count: 0, indices: [], allIndices: [], maxDeviation: 0, rmsDeviation: 0, continuity: 0 };
  }

  const allIndices = [...new Set(fragments.flatMap((fragment) => fragment.atomIndices))].sort((a, b) => a - b);
  let states = fragments.map((_, id) => mergeState(molecule, fragments, [id])).filter((state): state is MergeState => Boolean(state));
  for (let pass = 0; pass < fragments.length; pass++) {
    const expanded = [...states];
    for (const state of states) {
      for (let id = 0; id < fragments.length; id++) {
        if (state.fragmentIds.includes(id)
          || !state.fragmentIds.some((existingId) => connectedFragments(fragments[existingId], fragments[id], molecule.bonds))) continue;
        const candidate = mergeState(molecule, fragments, [...state.fragmentIds, id]);
        if (candidate) expanded.push(candidate);
      }
    }
    const deduped = new Map<string, MergeState>();
    for (const state of expanded) {
      const key = state.indices.join(",");
      const previous = deduped.get(key);
      if (!previous || compareMergeState(state, previous) < 0) deduped.set(key, state);
    }
    states = [...deduped.values()].sort(compareMergeState).slice(0, MERGE_BEAM_WIDTH);
    if (states.length === 0) break;
  }

  const best = states.sort(compareMergeState)[0];
  if (!best) return { count: 0, indices: [], allIndices, maxDeviation: 0, rmsDeviation: 0, continuity: 0 };
  return {
    count: best.indices.length,
    indices: best.indices,
    allIndices,
    maxDeviation: best.maxDeviation,
    rmsDeviation: best.rmsDeviation,
    continuity: best.continuity,
  };
}

/** Count the largest chemically meaningful coplanar set. */
export function countMaxPlanarAtoms(molecule: MoleculeData): {
  largestCount: number;
  largestIndices: number[];
  allIndices: number[];
  maxDeviation?: number;
  rmsDeviation?: number;
  continuity?: number;
} {
  const score = selectPlanarSet(molecule, detectPlanarFragments(molecule));
  if (score.count >= 3) {
    return {
      largestCount: score.count,
      largestIndices: score.indices,
      allIndices: score.allIndices,
      maxDeviation: score.maxDeviation,
      rmsDeviation: score.rmsDeviation,
      continuity: score.continuity,
    };
  }
  // Three points are always geometrically coplanar, but this fallback is
  // deliberately applied after semantic scoring so it cannot win a search.
  const fallback = molecule.atoms.length >= 3 ? [0, 1, 2] : [];
  return {
    largestCount: fallback.length,
    largestIndices: fallback,
    allIndices: score.allIndices,
    maxDeviation: 0,
    rmsDeviation: 0,
    continuity: 0,
  };
}

function scoreCoplanarity(molecule: MoleculeData): PlanarScore {
  const fragments = detectPlanarFragments(molecule);
  const score = selectPlanarSet(molecule, fragments);
  return score;
}

function compareScore(a: PlanarScore, b: PlanarScore, mode: "most" | "least"): number {
  if (a.count !== b.count) return mode === "most" ? b.count - a.count : a.count - b.count;
  if (Math.abs(a.maxDeviation - b.maxDeviation) > 1e-9) {
    return mode === "most" ? a.maxDeviation - b.maxDeviation : b.maxDeviation - a.maxDeviation;
  }
  if (Math.abs(a.rmsDeviation - b.rmsDeviation) > 1e-9) {
    return mode === "most" ? a.rmsDeviation - b.rmsDeviation : b.rmsDeviation - a.rmsDeviation;
  }
  if (a.continuity !== b.continuity) return mode === "most" ? b.continuity - a.continuity : a.continuity - b.continuity;
  return a.indices.join(",").localeCompare(b.indices.join(","));
}

function radicalInverse(index: number, base: number): number {
  let value = 0;
  let factor = 1 / base;
  let current = index;
  while (current > 0) {
    value += (current % base) * factor;
    current = Math.floor(current / base);
    factor /= base;
  }
  return value;
}

function deterministicAngles(sample: number, bondCount: number, steps: number): number[] {
  return Array.from({ length: bondCount }, (_, dimension) => {
    const prime = HALTON_PRIMES[dimension] ?? 59 + dimension * 2;
    const index = Math.floor(radicalInverse(sample + 1, prime) * steps) % steps;
    return index * 360 / steps;
  });
}

function isBetterCandidate(a: Candidate, b: Candidate, mode: "most" | "least"): boolean {
  const comparison = compareScore(a.score, b.score, mode);
  return comparison < 0 || (comparison === 0 && angleKey(a.angles) < angleKey(b.angles));
}

function insertCandidate(pool: Candidate[], candidate: Candidate, mode: "most" | "least", width: number): void {
  const key = angleKey(candidate.angles);
  if (pool.some((item) => angleKey(item.angles) === key)) return;
  pool.push(candidate);
  pool.sort((a, b) => compareScore(a.score, b.score, mode) || angleKey(a.angles).localeCompare(angleKey(b.angles)));
  if (pool.length > width) pool.length = width;
}

function createResult(molecule: MoleculeData, score: PlanarScore): ConformerResult {
  const output = score.count >= 3 ? score.indices : molecule.atoms.length >= 3 ? [0, 1, 2] : [];
  return {
    molecule,
    coplanarAtomCount: output.length,
    coplanarAtomIndices: output,
    allCoplanarIndices: score.allIndices,
  };
}

export interface ConformerSearchResult {
  mostPlanar: ConformerResult;
  leastPlanar: ConformerResult;
  totalSearched: number;
}

export function searchExtremeConformations(
  molecule: MoleculeData,
  options: ConformerSearchOptions = {},
): ConformerSearchResult {
  const quality = options.quality ?? "balanced";
  const budget = SEARCH_BUDGETS[quality] ?? SEARCH_BUDGETS.balanced;
  const bonds = getRotatableBonds(molecule);
  const cache = new Map<string, Candidate>();
  const mostPool: Candidate[] = [];
  const leastPool: Candidate[] = [];
  let totalSearched = 0;

  const evaluate = (rawAngles: number[]): Candidate => {
    const angles = rawAngles.map(normalizeAngle);
    const key = angleKey(angles);
    const cached = cache.get(key);
    if (cached) return cached;
    const score = scoreCoplanarity(applyRotations(molecule, bonds, angles));
    const candidate = { angles, score };
    cache.set(key, candidate);
    totalSearched++;
    insertCandidate(mostPool, candidate, "most", budget.beamWidth);
    insertCandidate(leastPool, candidate, "least", budget.beamWidth);
    return candidate;
  };

  const evaluateGrid = (index: number, angles: number[]) => {
    if (index === bonds.length) {
      evaluate(angles);
      return;
    }
    for (let step = 0; step < budget.gridSteps; step++) {
      angles.push(step * 360 / budget.gridSteps);
      evaluateGrid(index + 1, angles);
      angles.pop();
    }
  };

  evaluate(new Array(bonds.length).fill(0));
  if (bonds.length <= 3) {
    evaluateGrid(0, []);
  } else {
    // Fixed anchors improve coverage of common staggered/eclipsed regions.
    for (const anchor of [0, 60, 120, 180, 240, 300]) {
      evaluate(new Array(bonds.length).fill(anchor));
    }
    for (let sample = 0; sample < budget.sampleCount; sample++) {
      evaluate(deterministicAngles(sample, bonds.length, budget.gridSteps));
    }
  }

  const refine = (start: Candidate, mode: "most" | "least"): Candidate => {
    let best = start;
    for (let round = 0; round < budget.refineRounds; round++) {
      const step = budget.refineSteps[Math.min(round, budget.refineSteps.length - 1)];
      let improved = false;
      for (let bondIndex = 0; bondIndex < bonds.length; bondIndex++) {
        const trials = [0, -step, step, -2 * step, 2 * step].map((offset) => {
          const angles = [...best.angles];
          angles[bondIndex] = normalizeAngle(angles[bondIndex] + offset);
          return evaluate(angles);
        });
        const local = trials.reduce((candidate, trial) => isBetterCandidate(trial, candidate, mode) ? trial : candidate, best);
        if (isBetterCandidate(local, best, mode)) {
          best = local;
          improved = true;
        }
      }
      if (!improved) break;
    }
    return best;
  };

  const mostStarts = [...mostPool].slice(0, budget.refineStarts);
  const leastStarts = [...leastPool].slice(0, budget.refineStarts);
  for (const candidate of mostStarts) refine(candidate, "most");
  for (const candidate of leastStarts) refine(candidate, "least");

  const most = mostPool[0] ?? evaluate(new Array(bonds.length).fill(0));
  const least = leastPool[0] ?? most;
  return {
    mostPlanar: createResult(applyRotations(molecule, bonds, most.angles), most.score),
    leastPlanar: createResult(applyRotations(molecule, bonds, least.angles), least.score),
    totalSearched,
  };
}
