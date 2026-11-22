import type { MoleculeData } from "../../../types/molecule";

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

export interface SearchBudget {
  gridSteps: number;
  sampleCount: number;
  beamWidth: number;
  refineStarts: number;
  refineRounds: number;
  refineSteps: number[];
}

export const SEARCH_BUDGETS: Record<ConformerSearchQuality, SearchBudget> = {
  fast: { gridSteps: 12, sampleCount: 256, beamWidth: 8, refineStarts: 4, refineRounds: 2, refineSteps: [15, 3] },
  balanced: { gridSteps: 24, sampleCount: 1024, beamWidth: 16, refineStarts: 8, refineRounds: 3, refineSteps: [15, 5, 1] },
  precise: { gridSteps: 36, sampleCount: 4096, beamWidth: 32, refineStarts: 16, refineRounds: 4, refineSteps: [15, 5, 1, 0.5] },
};

export interface PlanarScore {
  /** Chemically meaningful count; the 3-atom geometric floor is excluded. */
  count: number;
  indices: number[];
  allIndices: number[];
  maxDeviation: number;
  rmsDeviation: number;
  continuity: number;
}

export interface Candidate {
  angles: number[];
  score: PlanarScore;
}

export interface MergeState {
  indices: number[];
  fragmentIds: number[];
  maxDeviation: number;
  rmsDeviation: number;
  continuity: number;
  tolerance: number;
}

export interface ConformerSearchResult {
  mostPlanar: ConformerResult;
  leastPlanar: ConformerResult;
  totalSearched: number;
}

/** Large structures automatically use a cheaper search budget. */
export function effectiveSearchQuality(
  atomCount: number,
  requested: ConformerSearchQuality,
): ConformerSearchQuality {
  if (atomCount > 200) return "fast";
  if (atomCount > 100 && requested === "precise") return "balanced";
  return requested;
}

// A fragment's own tolerance describes the geometry of that chemical unit.
// Once separate fragments are combined, use a substantially tighter bound:
// otherwise two nearby but visibly different planes can be accepted by the
// least-squares fit and reported/highlighted as one coplanar set.
export const MERGE_DEVIATION_TOL = 0.08;
export const MERGE_BEAM_WIDTH = 48;
export const HALTON_PRIMES = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53];
