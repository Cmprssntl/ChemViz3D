import * as THREE from "three";
import type { AtomData, BondData } from "../../types/molecule";
import { BL_CH } from "../config";
import { valenceForAtom, type BondSpec, type Hybrid } from "./spec";

export interface RingHydrogenInput {
  spec: BondSpec;
  hyb: readonly Hybrid[];
  rings: number[][];
  pos: THREE.Vector3[];
  ringMeta: Map<number, { center: THREE.Vector3; normal: THREE.Vector3 }>;
  atoms: AtomData[];
  bonds: BondData[];
  /** Shared running index of the next hydrogen atom. */
  counter: { index: number };
}

/**
 * Hydrogens on ring atoms, placed from the ring plane instead of VSEPR slots.
 *
 * The VSEPR basis cannot represent a chair: ring bond directions do not line
 * up with the four tetrahedral positions returned by vseprPositions(avg, 4).
 * Direct geometry instead:
 *
 *   sp3 ring atom → 1 axial H (± ring normal) + 1 equatorial H
 *   sp2 ring atom → 1 H outward in the ring plane
 *   sp  ring atom → no extra H
 *
 * Returns the set of atoms handled here; the generic fill must skip them.
 */
export function placeRingHydrogens(input: RingHydrogenInput): Set<number> {
  const { spec, hyb, rings, pos, ringMeta, atoms, bonds, counter } = input;
  // ── Dedicated H placement for ring atoms ──
  // Bypasses VSEPR slot matching entirely. The VSEPR approach can't
  // represent chair conformation correctly because ring bond directions
  // don't align with the 4 tetrahedral positions returned by
  // vseprPositions(avg, 4). Instead, we use direct geometry:
  //   sp3 ring atom → 1 axial H (along ±ring normal) + 1 equatorial H
  //                    (outward in plane, slight axial tilt)
  //   sp2 ring atom → 1 H outward in the ring plane
  //   sp  ring atom → no extra H's
  //
  // We track which ring atoms have had their H's placed here so the
  // regular H-fill below skips them. VSEPR slots are NOT universally
  // blocked (unlike before) — the 2 ring-bond slots remain marked so
  // the BFS can still place substituents in the other slots.
  const ringHPlaced = new Set<number>();

  // Ring-level puckering decision: if the majority of atoms in a ring
  // are chair-like (local dihedral > 30°), treat the ENTIRE ring as
  // puckered so all atoms use the same H placement strategy. This fixes
  // odd-n rings (e.g. C7H14) where the "seam" atom has dihedral ≈ 0
  // (the alternating-z pattern has a flat bond at the closure point)
  // and would otherwise take a different code path than its 6 chair-like
  // neighbors, producing an inconsistent visual.
  const ringIsPuckered = new Set<number>(); // set of ring array refs
  for (const ring of rings) {
    if (ring.length < 3) continue;
    let nPuckered = 0;
    let nComputed = 0;
    for (let i = 0; i < ring.length; i++) {
      if (ring.length < 4) continue;
      const sizeN = ring.length;
      const i0 = (i - 1 + sizeN) % sizeN;
      const i3 = (i + 2) % sizeN;
      const a = pos[ring[i0]], b = pos[ring[i]];
      const c = pos[ring[(i + 1) % sizeN]], d = pos[ring[i3]];
      const v1x = b.x - a.x, v1y = b.y - a.y, v1z = b.z - a.z;
      const v2x = c.x - b.x, v2y = c.y - b.y, v2z = c.z - b.z;
      const v3x = d.x - c.x, v3y = d.y - c.y, v3z = d.z - c.z;
      const n1x = v1y * v2z - v1z * v2y;
      const n1y = v1z * v2x - v1x * v2z;
      const n1z = v1x * v2y - v1y * v2x;
      const n2x = v2y * v3z - v2z * v3y;
      const n2y = v2z * v3x - v2x * v3z;
      const n2z = v2x * v3y - v2y * v3x;
      const dot = n1x * n2x + n1y * n2y + n1z * n2z;
      const l1 = Math.hypot(n1x, n1y, n1z);
      const l2 = Math.hypot(n2x, n2y, n2z);
      if (l1 > 1e-6 && l2 > 1e-6) {
        const dihedralDeg = Math.acos(Math.max(-1, Math.min(1, Math.abs(dot / (l1 * l2))))) * 180 / Math.PI;
        if (dihedralDeg > 30) nPuckered++;
        nComputed++;
      }
    }
    // Mark as puckered if the majority of computed atoms are chair-like.
    if (nComputed > 0 && nPuckered * 2 >= nComputed) {
      ringIsPuckered.add(ring as unknown as number); // unique ref tag
    }
  }
  // Use ring array identity via a Map for reliable lookup
  const ringPuckeredMap = new Map<number[], boolean>();
  for (const ring of rings) {
    if (ringIsPuckered.has(ring as unknown as number)) {
      ringPuckeredMap.set(ring, true);
    }
  }

  for (const ring of rings) {
    if (ring.length < 3) continue;
    for (let i = 0; i < ring.length; i++) {
      const atomIdx = ring[i];
      const meta = ringMeta.get(atomIdx);
      if (!meta) continue;
      const h = hyb[atomIdx];
      const el = spec.atoms[atomIdx];
      if (el === "H") continue;
      const placedNbrs = spec.bonds.filter(b =>
        (b[0] === atomIdx || b[1] === atomIdx) &&
        (b[0] !== atomIdx ? b[0] : b[1]) !== atomIdx
      );
      const sigma = placedNbrs.length;
      const pi = placedNbrs.filter(b => b[2] >= 2).length;
      const v = valenceForAtom(el, spec.charges?.[atomIdx]);
      const maxH = Math.max(0, v - sigma - pi);
      if (maxH === 0) continue;

      // "outward" = (atom - ringCenter) projected onto ring plane
      const outDir = new THREE.Vector3().subVectors(pos[atomIdx], meta.center);
      outDir.projectOnPlane(meta.normal);
      if (outDir.lengthSq() < 1e-6) {
        // Atom is at ring center (shouldn't happen, fallback)
        outDir.set(1, 0, 0);
      }
      outDir.normalize();

      // "up" sign = sign of (atom position) dot (ring normal)
      const axialSign = pos[atomIdx].dot(meta.normal) > 0 ? 1 : -1;

      // Mark this atom as handled so the regular H-fill skips it.
      // Don't mark all VSEPR slots as occupied – the BFS needs free
      // slots to place substituents on ring atoms (e.g. toluene).
      ringHPlaced.add(atomIdx);

      if (h === "sp3") {
        // Ring-level puckering decision: a whole ring is treated as
        // puckered if the majority of its atoms are chair-like, so the
        // "seam" atom of odd-n rings (which has dihedral ≈ 0 by
        // construction) takes the same code path as its chair-like
        // neighbors and gets visually consistent H placement.
        const puckered = ringPuckeredMap.get(ring) === true;

        if (!puckered) {
          // Near-planar ring: use sp3 tetrahedral formula for the 2 H's.
          // For a C with 2 ring bonds at unit vectors b1, b2 (angle θ between
          // them), the remaining 2 tetrahedral positions are:
          //   h = -cos(θ/2) · p  ±  sin(θ/2) · q
          // where p = (b1 + b2) / |b1 + b2| is the bisector toward the ring
          // and q is the ring normal (perpendicular to the ring plane).
          // - The "outward" component (along -p) dominates when θ < 109.47°
          //   (e.g. 0.866 for cyclopropane), pushing H's outside the ring.
          // - The "axial" component (along q) is small (e.g. 0.5) so the 2 H's
          //   end up mostly on opposite sides of the ring plane, slightly
          //   above and below it.
          // Adjacent C's thus have H's pointing in different directions,
          // which is the minimum-repulsion configuration.
          // DEGENERATE FALLBACK: if sinHalf is very small (θ ≈ 0), the
          // formula collapses to h1 ≈ h2 ≈ -p (both H's in the same
          // direction). This happens at the "seam" of odd-n rings (C6 of
          // C7H14, C8 of C9H18) where the alternating-z pattern has a
          // flat bond. Fall back to axial+equatorial with axialSign
          // determined by the C's z position so the seam C's H's end up
          // on the same side as its "up" / "down" neighbors — visually
          // consistent with the rest of the puckered ring.
          const DEGEN_THR = 0.10;
          const prevIdx = ring[(i - 1 + ring.length) % ring.length];
          const nextIdx = ring[(i + 1) % ring.length];
          const prevPos = pos[prevIdx];
          const nextPos = pos[nextIdx];
          const b1x = prevPos.x - pos[atomIdx].x, b1y = prevPos.y - pos[atomIdx].y, b1z = prevPos.z - pos[atomIdx].z;
          const b2x = nextPos.x - pos[atomIdx].x, b2y = nextPos.y - pos[atomIdx].y, b2z = nextPos.z - pos[atomIdx].z;
          const b1l = Math.hypot(b1x, b1y, b1z);
          const b2l = Math.hypot(b2x, b2y, b2z);
          // Unit bond vectors
          const u1x = b1x / b1l, u1y = b1y / b1l, u1z = b1z / b1l;
          const u2x = b2x / b2l, u2y = b2y / b2l, u2z = b2z / b2l;
          // Bisector p = (u1 + u2) / |u1 + u2|
          const px = u1x + u2x, py = u1y + u2y, pz = u1z + u2z;
          const pl = Math.hypot(px, py, pz);
          const nx = px / pl, ny = py / pl, nz = pz / pl;
          // cos(θ/2) from u1·u2 = cos(θ)
          const cosTh = u1x * u2x + u1y * u2y + u1z * u2z;
          const cosHalf = Math.sqrt(Math.max(0, (1 + cosTh) / 2));
          const sinHalf = Math.sqrt(Math.max(0, 1 - cosHalf * cosHalf));
          // q = ring normal (already in meta.normal)
          const qx = meta.normal.x, qy = meta.normal.y, qz = meta.normal.z;

          function pushH(x: number, y: number, z: number) {
            atoms.push({
              index: counter.index, element: "H",
              x, y, z,
              covalentRadius: 31, vdwRadius: 120,
            });
            bonds.push({ index: bonds.length, atom1Idx: atomIdx, atom2Idx: counter.index, order: 1 });
            counter.index++;
          }

          if (sinHalf >= DEGEN_THR) {
            // Standard tetrahedral formula
            const h1x = -cosHalf * nx + sinHalf * qx;
            const h1y = -cosHalf * ny + sinHalf * qy;
            const h1z = -cosHalf * nz + sinHalf * qz;
            pushH(
              pos[atomIdx].x + h1x * BL_CH,
              pos[atomIdx].y + h1y * BL_CH,
              pos[atomIdx].z + h1z * BL_CH
            );
            if (maxH >= 2) {
              const h2x = -cosHalf * nx - sinHalf * qx;
              const h2y = -cosHalf * ny - sinHalf * qy;
              const h2z = -cosHalf * nz - sinHalf * qz;
              pushH(
                pos[atomIdx].x + h2x * BL_CH,
                pos[atomIdx].y + h2y * BL_CH,
                pos[atomIdx].z + h2z * BL_CH
              );
            }
          } else {
            // Degenerate (seam) fallback: axial + equatorial for visual
            // consistency with the rest of the ring
            const seamAxialSign = pos[atomIdx].dot(meta.normal) > 0 ? 1 : -1;
            const axialDir = meta.normal.clone().multiplyScalar(seamAxialSign);
            pushH(
              pos[atomIdx].x + axialDir.x * BL_CH,
              pos[atomIdx].y + axialDir.y * BL_CH,
              pos[atomIdx].z + axialDir.z * BL_CH
            );
            if (maxH >= 2) {
              const equatDir = outDir.clone().add(meta.normal.clone().multiplyScalar(seamAxialSign * 0.45));
              equatDir.normalize();
              pushH(
                pos[atomIdx].x + equatDir.x * BL_CH,
                pos[atomIdx].y + equatDir.y * BL_CH,
                pos[atomIdx].z + equatDir.z * BL_CH
              );
            }
          }
        } else {
          // Puckered: 1 axial H + 1 equatorial H (chair geometry)
          const axialDir = meta.normal.clone().multiplyScalar(axialSign);
          const axialHPos = pos[atomIdx].clone().add(axialDir.clone().multiplyScalar(BL_CH));
          atoms.push({
            index: counter.index, element: "H",
            x: axialHPos.x, y: axialHPos.y, z: axialHPos.z,
            covalentRadius: 31, vdwRadius: 120,
          });
          bonds.push({ index: bonds.length, atom1Idx: atomIdx, atom2Idx: counter.index, order: 1 });
          counter.index++;
          if (maxH >= 2) {
            const equatDir = outDir.clone().add(meta.normal.clone().multiplyScalar(axialSign * 0.45));
            equatDir.normalize();
            const equatHPos = pos[atomIdx].clone().add(equatDir.multiplyScalar(BL_CH));
            atoms.push({
              index: counter.index, element: "H",
              x: equatHPos.x, y: equatHPos.y, z: equatHPos.z,
              covalentRadius: 31, vdwRadius: 120,
            });
            bonds.push({ index: bonds.length, atom1Idx: atomIdx, atom2Idx: counter.index, order: 1 });
            counter.index++;
          }
        }
      } else if (h === "sp2") {
        // 1 H outward in the ring plane
        const hPos = pos[atomIdx].clone().add(outDir.multiplyScalar(BL_CH));
        atoms.push({
          index: counter.index, element: "H",
          x: hPos.x, y: hPos.y, z: hPos.z,
          covalentRadius: 31, vdwRadius: 120,
        });
        bonds.push({ index: bonds.length, atom1Idx: atomIdx, atom2Idx: counter.index, order: 1 });
        counter.index++;
      }
      // sp: no extra H's
    }
  }

  return ringHPlaced;
}
