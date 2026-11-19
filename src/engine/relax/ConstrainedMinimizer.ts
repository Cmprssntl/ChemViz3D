import type { AtomData, BondData } from "../../types/molecule";
import { referenceLength } from "./GeometryValidator";
import { HarmonicForceField } from "./HarmonicForceField";

export interface MinimizerOptions {
  maxIterations?: number;
  gradientTolerance?: number;
  /** Maximum displacement of a single atom per accepted step (Å). */
  trustRadius?: number;
}

export interface MinimizerResult {
  atoms: AtomData[];
  iterations: number;
  accepted: boolean;
  energy: number;
}

const DEFAULT_MAX_ITERATIONS = 200;
const DEFAULT_GRADIENT_TOLERANCE = 0.05;
const DEFAULT_TRUST_RADIUS = 0.15;
const ARMIJO = 1e-4;
const MAX_BOND_STRAIN = 0.02;

/**
 * Projected minimizer: Armijo backtracking, a per-atom trust radius, and a
 * SHAKE-style projection that keeps every bond at its reference length.
 *
 * The old optimizer accepted any energy decrease, so relieving a close
 * contact by stretching a bond was always "better". Here a step is rejected
 * unless it satisfies sufficient decrease *and* survives bond projection, so
 * the degenerate solution is unreachable.
 */
export class ConstrainedMinimizer {
  minimize(atoms: readonly AtomData[], bonds: readonly BondData[], options: MinimizerOptions = {}): MinimizerResult {
    const maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS;
    const tolerance = options.gradientTolerance ?? DEFAULT_GRADIENT_TOLERANCE;
    const trustRadius = options.trustRadius ?? DEFAULT_TRUST_RADIUS;

    let current = cloneAtoms(atoms);
    const forceField = new HarmonicForceField(current, bonds);
    let energy = forceField.energy(current);
    if (!Number.isFinite(energy)) return { atoms: cloneAtoms(atoms), iterations: 0, accepted: false, energy };

    let step = 0.002;
    let iterations = 0;
    for (; iterations < maxIterations; iterations++) {
      const gradient = forceField.gradient(current);
      const maxGradient = maxAbs(gradient);
      if (!Number.isFinite(maxGradient) || maxGradient < tolerance) break;

      const stepResult = this.tryStep(current, gradient, energy, step, trustRadius, forceField, bonds);
      if (!stepResult) break;
      current = stepResult.atoms;
      energy = stepResult.energy;
      step = stepResult.usedFullStep ? Math.min(step * 1.5, 0.01) : stepResult.alpha;
    }

    const accepted = this.bondStrain(current, bonds) <= MAX_BOND_STRAIN && Number.isFinite(energy);
    return { atoms: current, iterations, accepted, energy };
  }

  private tryStep(
    atoms: AtomData[],
    gradient: Float64Array,
    energy: number,
    initialStep: number,
    trustRadius: number,
    forceField: HarmonicForceField,
    bonds: readonly BondData[],
  ): { atoms: AtomData[]; energy: number; alpha: number; usedFullStep: boolean } | null {
    let alpha = initialStep;
    const gradientNormSquared = gradient.reduce((sum, value) => sum + value * value, 0);
    for (let attempt = 0; attempt < 16; attempt++) {
      const candidate = displaced(atoms, gradient, alpha, trustRadius);
      projectBonds(candidate, bonds);
      const candidateEnergy = forceField.energy(candidate);
      const sufficient = Number.isFinite(candidateEnergy)
        && candidateEnergy <= energy - ARMIJO * alpha * gradientNormSquared;
      if (sufficient && this.bondStrain(candidate, bonds) <= MAX_BOND_STRAIN) {
        return { atoms: candidate, energy: candidateEnergy, alpha, usedFullStep: attempt === 0 };
      }
      alpha *= 0.5;
    }
    return null;
  }

  private bondStrain(atoms: readonly AtomData[], bonds: readonly BondData[]): number {
    let worst = 0;
    for (const bond of bonds) {
      const first = atoms[bond.atom1Idx];
      const second = atoms[bond.atom2Idx];
      if (!first || !second) continue;
      const length = Math.hypot(first.x - second.x, first.y - second.y, first.z - second.z);
      const reference = referenceLength(first.element, second.element, bond.order);
      worst = Math.max(worst, Math.abs(length - reference) / reference);
    }
    return worst;
  }
}

function cloneAtoms(atoms: readonly AtomData[]): AtomData[] {
  return atoms.map((atom) => ({ ...atom }));
}

function maxAbs(values: Float64Array): number {
  let max = 0;
  for (const value of values) max = Math.max(max, Math.abs(value));
  return max;
}

function displaced(atoms: readonly AtomData[], gradient: Float64Array, alpha: number, trustRadius: number): AtomData[] {
  return atoms.map((atom, index) => {
    let dx = -alpha * gradient[index * 3];
    let dy = -alpha * gradient[index * 3 + 1];
    let dz = -alpha * gradient[index * 3 + 2];
    const length = Math.hypot(dx, dy, dz);
    if (length > trustRadius) {
      const scale = trustRadius / length;
      dx *= scale;
      dy *= scale;
      dz *= scale;
    }
    return { ...atom, x: atom.x + dx, y: atom.y + dy, z: atom.z + dz };
  });
}

/** Iterative SHAKE projection of every bond onto its reference length. */
export function projectBonds(atoms: AtomData[], bonds: readonly BondData[], iterations = 8): void {
  for (let pass = 0; pass < iterations; pass++) {
    let maxError = 0;
    for (const bond of bonds) {
      const first = atoms[bond.atom1Idx];
      const second = atoms[bond.atom2Idx];
      if (!first || !second) continue;
      const dx = first.x - second.x;
      const dy = first.y - second.y;
      const dz = first.z - second.z;
      const length = Math.hypot(dx, dy, dz);
      if (length < 1e-8) continue;
      const target = referenceLength(first.element, second.element, bond.order);
      const correction = (length - target) / (2 * length);
      first.x -= correction * dx;
      first.y -= correction * dy;
      first.z -= correction * dz;
      second.x += correction * dx;
      second.y += correction * dy;
      second.z += correction * dz;
      maxError = Math.max(maxError, Math.abs(length - target));
    }
    if (maxError < 1e-4) break;
  }
}
