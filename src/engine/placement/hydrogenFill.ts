import * as THREE from "three";
import type { AtomData, BondData } from "../../types/molecule";
import { BL_CH, BL_NH, BL_OH } from "../config";
import { vseprPositions } from "../geometry";
import { valenceForAtom, type BondSpec, type Hybrid } from "./spec";

export interface HydrogenFillInput {
  spec: BondSpec;
  hyb: readonly Hybrid[];
  pos: THREE.Vector3[];
  placed: Set<number>;
  occupied: Map<number, Set<number>>;
  /** Atoms already handled by the ring pass; skipped here. */
  ringHPlaced: Set<number>;
  /** VSEPR directions for an atom, biased away from its placed neighbours. */
  vseprDirs: (atom: number, toward: THREE.Vector3) => THREE.Vector3[];
  atoms: AtomData[];
  bonds: BondData[];
  /** Shared running index of the next hydrogen atom. */
  counter: { index: number };
}

/**
 * Completes the structure with hydrogens.
 *
 * Chain atoms take the free VSEPR slots; sp3 carbons with exactly two heavy
 * neighbours use the tetrahedral formula, because their heavy bonds sit at 55°
 * from the bisector rather than on VSEPR positions. Water and ammonia have no
 * heavy neighbours at all and are handled explicitly.
 */
export function fillHydrogens(input: HydrogenFillInput): void {
  const { spec, hyb, pos, placed, occupied, ringHPlaced, vseprDirs, atoms, bonds, counter } = input;
  const n = spec.atoms.length;
  // Fill remaining VSEPR slots with hydrogens (universal algorithm)
  for (let i = 0; i < n; i++) {
    const el = spec.atoms[i];
    if (el === "H") continue;
    // Skip ring atoms whose H's were placed by the dedicated ring path
    if (ringHPlaced.has(i)) continue;

    const pBonds = spec.bonds.filter(b => b[0]===i || b[1]===i);
    const v = valenceForAtom(el, spec.charges?.[i]);
    const sigma = pBonds.length;
    const pi = pBonds.filter(b => b[2] >= 2).length;
    const maxH = Math.max(0, v - sigma - pi);
    if (maxH === 0) continue;

    const placedNbrs = pBonds.filter(b => {
      const nbr = b[0]===i ? b[1] : b[0];
      return placed.has(nbr) && nbr !== i;
    });
    // Use the AVERAGE direction of all placed neighbours, not just the first.
    // For ring atoms (2 placed neighbours) this is essential to get the H's
    // pointing away from the ring center; for chain atoms the average still
    // points away from all current heavy-atom bonds.
    const avgDir = new THREE.Vector3();
    for (const pb of placedNbrs) {
      const nbr = pb[0]===i ? pb[1] : pb[0];
      avgDir.add(new THREE.Vector3().subVectors(pos[nbr], pos[i]));
    }
    if (avgDir.length() < 0.001) avgDir.set(1,0,0);
    avgDir.normalize();

    // SPECIAL CASE: sp3 C with exactly 2 placed heavy-atom neighbours
    // (e.g. -CH2- in an alkyl chain). The generic VSEPR-slot fill gives
    // wrong C–H angles here because the 2 heavy bonds are NOT at the
    // VSEPR positions (they're at 55° from the bisector, not at 0°
    // or 109°). Use the sp3 tetrahedral formula instead so the H's end
    // up at the actual remaining 2 vertices of the tetrahedron.
    //   h = -cos(θ/2) · p  ±  sin(θ/2) · q
    // where p = (b1 + b2) / |b1 + b2| is the bisector and q is the unit
    // vector PERPENDICULAR to the b1-b2 plane (i.e. q = b1 × b2 / |...|).
    // The 2 remaining tetrahedral vertices are on either side of the
    // b1-b2 plane, not in it — using q in the b1-b2 plane (the previous
    // bug) gave H's in the same plane as the heavy bonds, producing
    // C-C-H angles of ~70° / ~180° instead of the tetrahedral 109.47°.
    if (el === "C" && hyb[i] === "sp3" && placedNbrs.length === 2 && maxH === 2) {
      const a = pos[placedNbrs[0][0]===i ? placedNbrs[0][1] : placedNbrs[0][0]];
      const b = pos[placedNbrs[1][0]===i ? placedNbrs[1][1] : placedNbrs[1][0]];
      const b1x = a.x - pos[i].x, b1y = a.y - pos[i].y, b1z = a.z - pos[i].z;
      const b2x = b.x - pos[i].x, b2y = b.y - pos[i].y, b2z = b.z - pos[i].z;
      const b1l = Math.hypot(b1x, b1y, b1z);
      const b2l = Math.hypot(b2x, b2y, b2z);
      const u1x = b1x/b1l, u1y = b1y/b1l, u1z = b1z/b1l;
      const u2x = b2x/b2l, u2y = b2y/b2l, u2z = b2z/b2l;
      // p = bisector (toward the 2 heavy bonds, i.e. into the heavy-bond plane)
      const px = u1x + u2x, py = u1y + u2y, pz = u1z + u2z;
      const pl = Math.hypot(px, py, pz);
      const nx = px/pl, ny = py/pl, nz = pz/pl;
      // q = unit vector perpendicular to b1-b2 plane (= b1 × b2)
      const qx0 = u1y*u2z - u1z*u2y;
      const qy0 = u1z*u2x - u1x*u2z;
      const qz0 = u1x*u2y - u1y*u2x;
      const ql = Math.hypot(qx0, qy0, qz0);
      const qx = qx0/ql, qy = qy0/ql, qz = qz0/ql;
      const cosTh = u1x*u2x + u1y*u2y + u1z*u2z;
      const cosHalf = Math.sqrt(Math.max(0, (1 + cosTh) / 2));
      const sinHalf = Math.sqrt(Math.max(0, 1 - cosHalf*cosHalf));
      // h1, h2 at the remaining 2 tetrahedral vertices (perpendicular to b1-b2)
      const h1x = -cosHalf*nx + sinHalf*qx;
      const h1y = -cosHalf*ny + sinHalf*qy;
      const h1z = -cosHalf*nz + sinHalf*qz;
      const h2x = -cosHalf*nx - sinHalf*qx;
      const h2y = -cosHalf*ny - sinHalf*qy;
      const h2z = -cosHalf*nz - sinHalf*qz;
      const h1Pos = { x: pos[i].x + h1x*BL_CH, y: pos[i].y + h1y*BL_CH, z: pos[i].z + h1z*BL_CH };
      atoms.push({
        index: counter.index, element: "H",
        x: h1Pos.x, y: h1Pos.y, z: h1Pos.z,
        covalentRadius: 31, vdwRadius: 120,
      });
      bonds.push({ index: bonds.length, atom1Idx: i, atom2Idx: counter.index, order: 1 });
      counter.index++;
      const h2Pos = { x: pos[i].x + h2x*BL_CH, y: pos[i].y + h2y*BL_CH, z: pos[i].z + h2z*BL_CH };
      atoms.push({
        index: counter.index, element: "H",
        x: h2Pos.x, y: h2Pos.y, z: h2Pos.z,
        covalentRadius: 31, vdwRadius: 120,
      });
      bonds.push({ index: bonds.length, atom1Idx: i, atom2Idx: counter.index, order: 1 });
      counter.index++;
      continue;
    }

    const dirs = vseprDirs(i, avgDir);
    const used = occupied.get(i) || new Set();

    let hPlaced = 0;
    for (let s = 0; s < dirs.length; s++) {
      if (used.has(s)) continue;
      if (hPlaced >= maxH) break;
      hPlaced++;
      const d = dirs[s];
      const bl = el === "O" ? BL_OH : (el === "N" ? BL_NH : BL_CH);
      atoms.push({
        index: counter.index, element: "H",
        x: pos[i].x + d.x * bl, y: pos[i].y + d.y * bl, z: pos[i].z + d.z * bl,
        covalentRadius: 31, vdwRadius: 120,
      });
      bonds.push({ index: bonds.length, atom1Idx: i, atom2Idx: counter.index, order: 1 });
      counter.index++;
    }
  }

  // Handle H2O special case (only if universal loop didn't run)
  if (spec.atoms.length === 1 && spec.atoms[0] === "O" && spec.bonds.length === 0 && counter.index <= spec.atoms.length) {
    // Place lone pair at +z (up), 2 H's at 104.5° in xy plane
    const ang = THREE.MathUtils.degToRad(104.5);
    for (let s = -1; s <= 1; s += 2) {
      const hDir = new THREE.Vector3(s * Math.sin(ang/2), Math.cos(ang/2), 0).normalize();
      atoms.push({
        index: counter.index, element: "H",
        x: hDir.x * BL_OH, y: hDir.y * BL_OH, z: 0,
        covalentRadius: 31, vdwRadius: 120,
      });
      bonds.push({ index: bonds.length, atom1Idx: 0, atom2Idx: counter.index, order: 1 });
      counter.index++;
    }
  }

  // Handle NH3 special case
  if (spec.atoms.length === 1 && spec.atoms[0] === "N" && spec.bonds.length === 0 && counter.index <= spec.atoms.length) {
    const up = new THREE.Vector3(0, -1, 0);
    for (let i = 0; i < 3; i++) {
      const ang = (i / 3) * Math.PI * 2;
      const dir = new THREE.Vector3()
        .addScaledVector(up, -Math.cos(THREE.MathUtils.degToRad(107)))
        .addScaledVector(new THREE.Vector3(1,0,0).applyAxisAngle(up, ang), Math.sin(THREE.MathUtils.degToRad(107)));
      dir.normalize();
      atoms.push({
        index: counter.index, element: "H",
        x: dir.x * BL_NH, y: dir.y * BL_NH, z: dir.z * BL_NH,
        covalentRadius: 31, vdwRadius: 120,
      });
      bonds.push({ index: bonds.length, atom1Idx: 0, atom2Idx: counter.index, order: 1 });
      counter.index++;
    }
  }
}
