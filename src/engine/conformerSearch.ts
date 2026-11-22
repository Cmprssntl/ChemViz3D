/**
 * Deterministic conformer search for maximum and minimum coplanarity.
 *
 * The implementation lives under `conformer/search/`:
 *   types     — public result types and fixed search budgets
 *   planarity — fragment merging, scoring and the "possible/definite" count
 *   explore   — Halton/grid sampling and multi-start local refinement
 *
 * This facade keeps the historical import path stable for UI and tests.
 */
export type {
  ConformerResult,
  ConformerSearchOptions,
  ConformerSearchQuality,
  ConformerSearchResult,
} from "./conformer/search/types";
export { countMaxPlanarAtoms } from "./conformer/search/planarity";
export { searchExtremeConformations } from "./conformer/search/explore";
