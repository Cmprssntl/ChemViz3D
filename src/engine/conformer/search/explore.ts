import type { BondData, MoleculeData } from "../../../types/molecule";
import { applyBondRotation } from "../../rotation";
import { compareScore, createResult, getRotatableBonds, scoreCoplanarity } from "./planarity";
import {
  HALTON_PRIMES,
  SEARCH_BUDGETS,
  type Candidate,
  type ConformerSearchOptions,
  type ConformerSearchResult,
} from "./types";

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
