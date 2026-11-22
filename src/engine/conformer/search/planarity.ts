import * as THREE from "three";
import type { BondData, MoleculeData } from "../../../types/molecule";
import { graphOf } from "../../rotation";
import {
  bestFitPlane,
  detectPlanarFragments,
  planarityDeviation,
  planarityRmsDeviation,
  type CoplanarSet,
} from "../../coplanarity";
import {
  MERGE_BEAM_WIDTH,
  MERGE_DEVIATION_TOL,
  type ConformerResult,
  type MergeState,
  type PlanarScore,
} from "./types";

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

export function getRotatableBonds(molecule: MoleculeData): BondData[] {
  const graph = graphOf(molecule);
  const ringBonds = graph.ringBondKeys();
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

export function selectPlanarSet(molecule: MoleculeData, fragments: CoplanarSet[]): PlanarScore {
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

export function scoreCoplanarity(molecule: MoleculeData): PlanarScore {
  return selectPlanarSet(molecule, detectPlanarFragments(molecule));
}

export function compareScore(a: PlanarScore, b: PlanarScore, mode: "most" | "least"): number {
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

export function createResult(molecule: MoleculeData, score: PlanarScore): ConformerResult {
  const output = score.count >= 3 ? score.indices : molecule.atoms.length >= 3 ? [0, 1, 2] : [];
  return {
    molecule,
    coplanarAtomCount: output.length,
    coplanarAtomIndices: output,
    allCoplanarIndices: score.allIndices,
  };
}
