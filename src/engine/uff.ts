// UFF (Universal Force Field) – simplified implementation for geometry relaxation.
// Supports: H, C, N, O with sp3/sp2/sp hybridization.
// Energy terms: bond stretching (harmonic), angle bending (harmonic), VDW (LJ 12-6).
// Optimizer: steepest descent with numerical gradient + Armijo line search.

// ── Types ──

export interface UFFAtom {
  el: string;   // element: "C", "H", "N", "O"
  hyb: string;  // hybridization: "sp3", "sp2", "sp", ""
  x: number;
  y: number;
  z: number;
}

export interface UFFTopology {
  bonds: [number, number][];
  angles: [number, number, number][];
  vdwExcl: Set<number>[];   // per-atom set of excluded VDW partners (1-2 + 1-3)
  n: number;
}

export interface UFFOptions {
  maxIters?: number;   // default 200
  tol?: number;        // convergence: max gradient < tol kcal/mol/Å, default 0.005
  verbose?: boolean;   // log progress
}

// ── Bond parameters (r0 in Å, k in kcal/mol/Å²) ──

interface BP { r0: number; k: number; }
const BP_MAP: Record<string, BP> = {};

function setBP(e1: string, h1: string, e2: string, h2: string, r0: number, k = 350) {
  const k1 = `${e1}:${h1}-${e2}:${h2}`;
  const k2 = `${e2}:${h2}-${e1}:${h1}`;
  BP_MAP[k1] = { r0, k };
  BP_MAP[k2] = { r0, k };
}
setBP("C","sp3","C","sp3", 1.54);
setBP("C","sp2","C","sp2", 1.39, 525);
setBP("C","sp2","C","sp3", 1.51, 350);
setBP("C","sp","C","sp2",  1.42, 700);
setBP("C","sp3","H","",    1.09);
setBP("C","sp2","H","",    1.09);
setBP("C","sp","H","",     1.06);
setBP("C","sp3","N","sp3", 1.46);
setBP("C","sp2","N","sp2", 1.38, 525);
setBP("C","sp3","O","",    1.43);
setBP("C","sp2","O","",    1.22, 525);
setBP("N","sp3","H","",    1.01);
setBP("O","","H","",       0.97);
setBP("C","sp3","O","sp2", 1.43, 350);
setBP("N","sp3","N","sp3", 1.45, 350);

function getBP(e1: string, h1: string, e2: string, h2: string): BP {
  return BP_MAP[`${e1}:${h1}-${e2}:${h2}`] ?? { r0: 1.50, k: 350 };
}

// ── Angle parameters (θ0 in degrees, k in kcal/mol/rad²) ──

interface AP { th0: number; k: number; }
function getAP(hyb: string): AP {
  if (hyb === "sp3") return { th0: 109.47, k: 60 };
  if (hyb === "sp2") return { th0: 120.0, k: 80 };
  if (hyb === "sp")  return { th0: 180.0, k: 100 };
  return { th0: 109.47, k: 50 };
}

// ── VDW parameters (eps in kcal/mol, sigma in Å) ──

interface VP { eps: number; sigma: number; }
const VP_MAP: Record<string, VP> = {
  H: { eps: 0.044, sigma: 2.89 },
  C: { eps: 0.105, sigma: 3.85 },
  N: { eps: 0.069, sigma: 3.66 },
  O: { eps: 0.095, sigma: 3.50 },
};
function getVP(el: string): VP { return VP_MAP[el] ?? { eps: 0.1, sigma: 3.5 }; }

// ── Helpers ──

const DEG = Math.PI / 180;
function dist2(a: UFFAtom, b: UFFAtom): number {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}
function dotAB(a: UFFAtom, a0: UFFAtom, b: UFFAtom, b0: UFFAtom): number {
  return (a.x - a0.x) * (b.x - b0.x) + (a.y - a0.y) * (b.y - b0.y) + (a.z - a0.z) * (b.z - b0.z);
}
function pairKey(i: number, j: number): string {
  return i < j ? `${i}-${j}` : `${j}-${i}`;
}

// ── Topology builder ──

export function buildTopology(atoms: UFFAtom[], bondPairs: [number, number][]): UFFTopology {
  const n = atoms.length;
  const adj: Set<number>[] = Array.from({ length: n }, () => new Set<number>());
  for (const [i, j] of bondPairs) {
    adj[i].add(j); adj[j].add(i);
  }

  // Enumerate angles (i - j - k where j is central)
  const angles: [number, number, number][] = [];
  for (let j = 0; j < n; j++) {
    const nbrs = [...adj[j]];
    for (let a = 0; a < nbrs.length; a++) {
      for (let b = a + 1; b < nbrs.length; b++) {
        angles.push([nbrs[a], j, nbrs[b]]);
      }
    }
  }

  // VDW exclusion: 1-2 (bonded) and 1-3 (share atom j)
  const exclKeys = new Set<string>();
  for (const [i, j] of bondPairs) exclKeys.add(pairKey(i, j));
  for (const [i, , k] of angles) exclKeys.add(pairKey(i, k));

  const vdwExcl: Set<number>[] = Array.from({ length: n }, () => new Set<number>());
  for (const k of exclKeys) {
    const [p, q] = k.split("-").map(Number);
    vdwExcl[p].add(q);
    vdwExcl[q].add(p);
  }

  return { bonds: bondPairs, angles, vdwExcl, n };
}

// ── Energy function ──

export function uffEnergy(atoms: UFFAtom[], topo: UFFTopology): number {
  let e = 0;

  // Bond stretching
  for (const [i, j] of topo.bonds) {
    const d2 = dist2(atoms[i], atoms[j]);
    const r = Math.sqrt(Math.max(d2, 1e-16));
    const bp = getBP(atoms[i].el, atoms[i].hyb, atoms[j].el, atoms[j].hyb);
    const dr = r - bp.r0;
    e += 0.5 * bp.k * dr * dr;
  }

  // Angle bending
  for (const [i, j, k] of topo.angles) {
    const dij = Math.sqrt(Math.max(dist2(atoms[i], atoms[j]), 1e-16));
    const djk = Math.sqrt(Math.max(dist2(atoms[j], atoms[k]), 1e-16));
    const dp = dotAB(atoms[i], atoms[j], atoms[k], atoms[j]);
    const cosTh = Math.max(-1, Math.min(1, dp / (dij * djk)));
    const th = Math.acos(cosTh) / DEG;
    const ap = getAP(atoms[j].hyb);
    const dth = (th - ap.th0) * DEG;  // rad
    e += 0.5 * ap.k * dth * dth;
  }

  // VDW (Lennard-Jones 12-6)
  for (let i = 0; i < topo.n; i++) {
    for (let j = i + 1; j < topo.n; j++) {
      if (topo.vdwExcl[i].has(j)) continue;
      const d2 = dist2(atoms[i], atoms[j]);
      const r = Math.sqrt(Math.max(d2, 1e-16));
      const vpi = getVP(atoms[i].el);
      const vpj = getVP(atoms[j].el);
      const eps = Math.sqrt(vpi.eps * vpj.eps);
      const sig = 0.5 * (vpi.sigma + vpj.sigma);
      const sr = sig / r;
      const sr6 = sr * sr * sr * sr * sr * sr;
      e += eps * (sr6 * sr6 - 2 * sr6);
    }
  }

  return e;
}

// ── Optimization ──

export function uffRelax(atoms: UFFAtom[], topo: UFFTopology, opts: UFFOptions = {}): { energy: number; iterations: number } {
  const maxIters = opts.maxIters ?? 200;
  const tol = opts.tol ?? 0.005;
  const n = topo.n;
  const ng = n * 3;

  const H = 0.0005; // finite-difference step (Å)
  let stepSize = 0.005;
  let prevE = uffEnergy(atoms, topo);
  if (opts.verbose) console.log(`[UFF] init energy = ${prevE.toFixed(3)} kcal/mol`);

  let iter = 0;
  for (; iter < maxIters; iter++) {
    // ── Numerical gradient (forward difference) ──
    const grad = new Float64Array(ng);
    let gradSumSq = 0;

    for (let i = 0; i < n; i++) {
      const arr = [atoms[i].x, atoms[i].y, atoms[i].z] as const;
      for (let d = 0; d < 3; d++) {
        const orig = arr[d];
        // Shift +H
        if (d === 0) atoms[i].x = orig + H;
        else if (d === 1) atoms[i].y = orig + H;
        else atoms[i].z = orig + H;
        const ePlus = uffEnergy(atoms, topo);
        // Restore
        if (d === 0) atoms[i].x = orig;
        else if (d === 1) atoms[i].y = orig;
        else atoms[i].z = orig;
        const g = (ePlus - prevE) / H;
        grad[i * 3 + d] = g;
        gradSumSq += g * g;
      }
    }

    const rmsGrad = Math.sqrt(gradSumSq / ng);
    if (opts.verbose && iter % 20 === 0) {
      console.log(`[UFF] iter ${iter}: E=${prevE.toFixed(3)}  RMS_grad=${rmsGrad.toFixed(4)}  step=${stepSize.toFixed(4)}`);
    }
    if (rmsGrad < tol) break;

    // ── Line search (Armijo) ──
    let alpha = stepSize;
    let accepted = false;
    for (let ls = 0; ls < 20; ls++) {
      // Save current positions
      const saved: [number, number, number][] = atoms.map(a => [a.x, a.y, a.z]);

      // Step along -grad
      for (let i = 0; i < n; i++) {
        atoms[i].x -= alpha * grad[i * 3];
        atoms[i].y -= alpha * grad[i * 3 + 1];
        atoms[i].z -= alpha * grad[i * 3 + 2];
      }

      const newE = uffEnergy(atoms, topo);
      if (newE < prevE) {
        // Accept
        prevE = newE;
        stepSize = Math.min(alpha * 1.3, 0.05);  // increase for next iteration, cap
        accepted = true;
        break;
      }

      // Reject – restore and reduce alpha
      for (let i = 0; i < n; i++) {
        atoms[i].x = saved[i][0];
        atoms[i].y = saved[i][1];
        atoms[i].z = saved[i][2];
      }
      alpha *= 0.5;
    }

    if (!accepted) {
      stepSize *= 0.5;
      if (stepSize < 1e-6) break;  // can't move anymore
    }
  }

  if (opts.verbose) console.log(`[UFF] final  iter ${iter}: E=${prevE.toFixed(3)} kcal/mol`);
  return { energy: prevE, iterations: iter };
}
