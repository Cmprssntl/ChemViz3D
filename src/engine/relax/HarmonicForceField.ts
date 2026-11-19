import type { AtomData, BondData } from "../../types/molecule";
import { referenceLength } from "./GeometryValidator";

interface BondTerm {
  a: number;
  b: number;
  r0: number;
  k: number;
}

interface AngleTerm {
  i: number;
  j: number;
  k: number;
  theta0: number;
  kTheta: number;
}

interface VdwTerm {
  a: number;
  b: number;
  epsilon: number;
  sigma: number;
}

const BOND_FORCE = 350;
const MULTI_BOND_FORCE = 525;
const VDW_CUTOFF = 8;

const VDW_PARAMETERS: Record<string, { epsilon: number; sigma: number }> = {
  H: { epsilon: 0.044, sigma: 2.89 },
  C: { epsilon: 0.105, sigma: 3.85 },
  N: { epsilon: 0.069, sigma: 3.66 },
  O: { epsilon: 0.095, sigma: 3.50 },
  F: { epsilon: 0.072, sigma: 3.36 },
  P: { epsilon: 0.305, sigma: 4.15 },
  S: { epsilon: 0.25, sigma: 4.03 },
  Cl: { epsilon: 0.265, sigma: 4.02 },
  Br: { epsilon: 0.32, sigma: 4.22 },
  I: { epsilon: 0.40, sigma: 4.50 },
};

const ANGLE_BY_HYBRID: Record<string, { theta0: number; k: number }> = {
  sp: { theta0: 180, k: 100 },
  sp2: { theta0: 120, k: 80 },
  sp3: { theta0: 109.47, k: 60 },
};

/**
 * Harmonic bond + angle + Lennard-Jones model with analytic gradients.
 *
 * The old implementation differentiated the energy numerically (3n energy
 * evaluations per step) and accepted any energy decrease, which let the
 * optimizer trade 2800 Å bonds for a lower VDW penalty. The analytic gradient
 * plus the constrained minimizer removes that failure mode.
 */
export class HarmonicForceField {
  private readonly bonds: BondTerm[] = [];
  private readonly angles: AngleTerm[] = [];
  private readonly vdw: VdwTerm[] = [];

  constructor(
    private readonly atoms: readonly AtomData[],
    bonds: readonly BondData[],
  ) {
    this.buildBondTerms(bonds);
    this.buildAngleTerms(bonds);
    this.buildVdwTerms(bonds);
  }

  private buildBondTerms(bonds: readonly BondData[]): void {
    for (const bond of bonds) {
      const first = this.atoms[bond.atom1Idx];
      const second = this.atoms[bond.atom2Idx];
      if (!first || !second) continue;
      this.bonds.push({
        a: bond.atom1Idx,
        b: bond.atom2Idx,
        r0: referenceLength(first.element, second.element, bond.order),
        k: bond.order > 1 ? MULTI_BOND_FORCE : BOND_FORCE,
      });
    }
  }

  private buildAngleTerms(bonds: readonly BondData[]): void {
    const neighbors = new Map<number, number[]>();
    for (const bond of bonds) {
      push(neighbors, bond.atom1Idx, bond.atom2Idx);
      push(neighbors, bond.atom2Idx, bond.atom1Idx);
    }
    for (const [center, list] of neighbors) {
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const hybrid = this.atoms[center]?.hybridization ?? "sp3";
          const parameters = ANGLE_BY_HYBRID[hybrid] ?? ANGLE_BY_HYBRID.sp3;
          this.angles.push({
            i: list[i],
            j: center,
            k: list[j],
            theta0: parameters.theta0,
            kTheta: parameters.k,
          });
        }
      }
    }
  }

  private buildVdwTerms(bonds: readonly BondData[]): void {
    const excluded = new Set<string>();
    const neighbors = new Map<number, number[]>();
    for (const bond of bonds) {
      excluded.add(pairKey(bond.atom1Idx, bond.atom2Idx));
      push(neighbors, bond.atom1Idx, bond.atom2Idx);
      push(neighbors, bond.atom2Idx, bond.atom1Idx);
    }
    // 1-3 pairs (both bonds of every angle) are excluded from VDW.
    for (const [center, list] of neighbors) {
      for (const first of list) {
        for (const second of list) {
          if (first < second) excluded.add(pairKey(first, second));
        }
      }
      void center;
    }
    for (let a = 0; a < this.atoms.length; a++) {
      for (let b = a + 1; b < this.atoms.length; b++) {
        if (excluded.has(pairKey(a, b))) continue;
        const first = VDW_PARAMETERS[this.atoms[a].element] ?? VDW_PARAMETERS.C;
        const second = VDW_PARAMETERS[this.atoms[b].element] ?? VDW_PARAMETERS.C;
        this.vdw.push({
          a,
          b,
          epsilon: Math.sqrt(first.epsilon * second.epsilon),
          sigma: 0.5 * (first.sigma + second.sigma),
        });
      }
    }
  }

  energy(atoms: readonly AtomData[]): number {
    let total = 0;
    for (const term of this.bonds) {
      const delta = distance(atoms, term.a, term.b) - term.r0;
      total += 0.5 * term.k * delta * delta;
    }
    for (const term of this.angles) {
      const angle = angleBetween(atoms, term.i, term.j, term.k);
      if (angle === null) continue;
      const delta = (angle - term.theta0) * Math.PI / 180;
      total += 0.5 * term.kTheta * delta * delta;
    }
    for (const term of this.vdw) {
      const r = distance(atoms, term.a, term.b);
      if (r <= 0.1 || r > VDW_CUTOFF) continue;
      const ratio = term.sigma / r;
      const ratio6 = ratio ** 6;
      total += term.epsilon * (ratio6 * ratio6 - 2 * ratio6);
    }
    return total;
  }

  gradient(atoms: readonly AtomData[]): Float64Array {
    const gradient = new Float64Array(atoms.length * 3);
    this.bondGradient(atoms, gradient);
    this.angleGradient(atoms, gradient);
    this.vdwGradient(atoms, gradient);
    return gradient;
  }

  private bondGradient(atoms: readonly AtomData[], gradient: Float64Array): void {
    for (const term of this.bonds) {
      const a = atoms[term.a];
      const b = atoms[term.b];
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const dz = a.z - b.z;
      const r = Math.hypot(dx, dy, dz);
      if (r < 1e-8) continue;
      const coefficient = term.k * (r - term.r0) / r;
      add(gradient, term.a, coefficient * dx, coefficient * dy, coefficient * dz);
      add(gradient, term.b, -coefficient * dx, -coefficient * dy, -coefficient * dz);
    }
  }

  private angleGradient(atoms: readonly AtomData[], gradient: Float64Array): void {
    for (const term of this.angles) {
      const i = atoms[term.i];
      const j = atoms[term.j];
      const k = atoms[term.k];
      const ux = i.x - j.x, uy = i.y - j.y, uz = i.z - j.z;
      const vx = k.x - j.x, vy = k.y - j.y, vz = k.z - j.z;
      const lu = Math.hypot(ux, uy, uz);
      const lv = Math.hypot(vx, vy, vz);
      if (lu < 1e-8 || lv < 1e-8) continue;
      const cos = clamp((ux * vx + uy * vy + uz * vz) / (lu * lv), -1, 1);
      const sin = Math.sqrt(Math.max(0, 1 - cos * cos));
      if (sin < 1e-6) continue;
      const angle = Math.acos(cos) * 180 / Math.PI;
      const dEdTheta = term.kTheta * (angle - term.theta0) * Math.PI / 180;
      const common = 1 / (lu * lv);
      const dux = -(vx * common - cos * ux / (lu * lu)) / sin;
      const duy = -(vy * common - cos * uy / (lu * lu)) / sin;
      const duz = -(vz * common - cos * uz / (lu * lu)) / sin;
      const dvx = -(ux * common - cos * vx / (lv * lv)) / sin;
      const dvy = -(uy * common - cos * vy / (lv * lv)) / sin;
      const dvz = -(uz * common - cos * vz / (lv * lv)) / sin;
      add(gradient, term.i, dEdTheta * dux, dEdTheta * duy, dEdTheta * duz);
      add(gradient, term.k, dEdTheta * dvx, dEdTheta * dvy, dEdTheta * dvz);
      add(gradient, term.j,
        -dEdTheta * (dux + dvx),
        -dEdTheta * (duy + dvy),
        -dEdTheta * (duz + dvz));
    }
  }

  private vdwGradient(atoms: readonly AtomData[], gradient: Float64Array): void {
    for (const term of this.vdw) {
      const a = atoms[term.a];
      const b = atoms[term.b];
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const dz = a.z - b.z;
      const r = Math.hypot(dx, dy, dz);
      if (r <= 0.1 || r > VDW_CUTOFF) continue;
      const ratio = term.sigma / r;
      const ratio6 = ratio ** 6;
      const coefficient = 12 * term.epsilon * (ratio6 - ratio6 * ratio6) / (r * r);
      add(gradient, term.a, coefficient * dx, coefficient * dy, coefficient * dz);
      add(gradient, term.b, -coefficient * dx, -coefficient * dy, -coefficient * dz);
    }
  }
}

function push(map: Map<number, number[]>, key: number, value: number): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

function pairKey(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

function distance(atoms: readonly AtomData[], a: number, b: number): number {
  const first = atoms[a];
  const second = atoms[b];
  return Math.hypot(first.x - second.x, first.y - second.y, first.z - second.z);
}

function angleBetween(atoms: readonly AtomData[], i: number, j: number, k: number): number | null {
  const first = atoms[i];
  const center = atoms[j];
  const last = atoms[k];
  const ux = first.x - center.x, uy = first.y - center.y, uz = first.z - center.z;
  const vx = last.x - center.x, vy = last.y - center.y, vz = last.z - center.z;
  const lu = Math.hypot(ux, uy, uz);
  const lv = Math.hypot(vx, vy, vz);
  if (lu < 1e-8 || lv < 1e-8) return null;
  return Math.acos(clamp((ux * vx + uy * vy + uz * vz) / (lu * lv), -1, 1)) * 180 / Math.PI;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function add(gradient: Float64Array, atom: number, x: number, y: number, z: number): void {
  gradient[atom * 3] += x;
  gradient[atom * 3 + 1] += y;
  gradient[atom * 3 + 2] += z;
}
