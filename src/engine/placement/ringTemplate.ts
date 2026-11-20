import * as THREE from "three";
import { MolecularGraph } from "../../domain/graph/MolecularGraph";
import { vseprPositions } from "../geometry";
import { bondLen, type BondSpec, type Hybrid } from "./spec";

/**
 * Places every ring atom with a geometric template before the BFS pass.
 *
 * BFS cannot close a ring: each new atom only sees already-placed neighbours,
 * never the unplaced one that will close the cycle. Templates handle that:
 *
 *   - sp3 ring  → alternating ±z (chair for six, generalized pucker otherwise)
 *   - sp2 / sp  → planar, 120° / 180°
 *
 * Afterwards the two ring-bond VSEPR slots of each ring atom are marked as
 * occupied, so neither BFS nor the hydrogen pass can place anything along a
 * ring bond.
 */
export function placeRingAtoms(
  spec: BondSpec,
  hyb: readonly Hybrid[],
  pos: THREE.Vector3[],
  placed: Set<number>,
  occupied: Map<number, Set<number>>,
): { rings: number[][] } {
  // ── 2a) Ring pre-placement ──
  // BFS placement can't close a ring (each new atom only sees already-placed
  // neighbours, never the unplaced one that will close the cycle). For any
  // ring, we use a geometric template instead:
  //   - sp3 ring  → chair conformation (alternating ±z), tetrahedral ring angles
  //   - sp2 / sp ring → planar (all z=0), 120° / 180° angles
  // After placing all ring atoms, we mark the two ring-bond VSEPR slots on
  // each ring atom as "occupied" so the H-fill loop doesn't place H's in the
  // wrong place. The remaining VSEPR slots on each ring atom are then
  // correctly available for H placement.
  // Local adjacency helper: spec.bonds is [i,j,order][] not BondData[]
  const graph = new MolecularGraph(
    spec.atoms.length,
    spec.bonds.map((b, index) => ({ index, a: b[0], b: b[1], order: b[2] })),
  );
  const rings = graph.findRings(20);
  // Place ring atoms with a template that targets the sp3 ideal C-C-C angle
  // (~109.47°). For an alternating-z n-gon (each atom up/down alternately),
  // the C-C-C angle θ depends on z, R, n via:
  //   cos θ = 1 - 2u cos²(π/n) / (u + v),  u = R² sin²(π/n), v = z²
  // With the 3D-bond constraint u + v = avgBL²/4, solving for z:
  //   z² = avgBL²/4 - (1 - cos θ) * avgBL² / (8 cos²(π/n))
  // For θ = 109.47° and avgBL = 1.54 Å, this gives z values like:
  //   n=6 → 0.26,  n=7 → 0.33,  n=8 → 0.35,  n=9 → 0.38,  n=12 → 0.41
  // For n=4 the formula gives z² < 0 (Baeyer strain — the planar angle
  // is too far from sp3 ideal to be rescued by pucker); we keep them planar.
  // For n=5 (cyclopentane), the formula also fails, but cyclopentane
  // adopts an ENVELOPE conformation in reality: 1 atom out of plane.
  // This is critical for substituents on cyclopentane — without pucker,
  // the substituent's gauche H's crash into the ring H's.
  const TARGET_ANGLE_DEG = 109.47;
  const cosTarget = Math.cos(TARGET_ANGLE_DEG * Math.PI / 180);
  const ringAtomSet = new Set<number>();
  for (const ring of rings) {
    if (ring.length < 3) continue;
    const allSp3 = ring.every(i => hyb[i] === "sp3");
    const size = ring.length;
    // Compute the average bond length of the ring to set a sensible radius
    let totalBL = 0;
    for (let i = 0; i < size; i++) {
      const a = ring[i], b = ring[(i + 1) % size];
      const bond = spec.bonds.find(
        (bb) => (bb[0] === a && bb[1] === b) || (bb[0] === b && bb[1] === a)
      );
      totalBL += bond ? bondLen(spec.atoms[a], spec.atoms[b], bond[2]) : 1.5;
    }
    const avgBL = totalBL / size;
    // Compute target z that gives the sp3 ideal C-C-C angle
    let zAmp = 0;
    if (allSp3) {
      const cosHalf = Math.cos(Math.PI / size);
      const u = (1 - cosTarget) * avgBL * avgBL / (8 * cosHalf * cosHalf);
      const v = avgBL * avgBL / 4 - u;
      if (v > 0) zAmp = Math.sqrt(v);
    }
    // Back-compute horizontal radius so 3D bond length = avgBL
    const horizSide = zAmp > 0
      ? Math.sqrt(Math.max(0.001, avgBL * avgBL - (2 * zAmp) * (2 * zAmp)))
      : avgBL;
    let radius = horizSide / (2 * Math.sin(Math.PI / size));
    for (let i = 0; i < size; i++) {
      const angle = (i / size) * Math.PI * 2 - Math.PI / 2;
      // Alternating +z / -z (chair-like for 6-ring, generalized for others)
      // n < 6: z² < 0 (Baeyer strain — the planar angle is too far from
      // sp3 ideal to be rescued by pucker). Keep them planar.
      const z = (i % 2 === 0 ? zAmp : -zAmp);
      pos[ring[i]].set(Math.cos(angle) * radius, Math.sin(angle) * radius, z);
      placed.add(ring[i]);
      ringAtomSet.add(ring[i]);
    }
  }

  // For ring atoms, pre-mark the two ring-bond VSEPR slots as occupied so
  // the H-fill loop and BFS don't accidentally place other things there.
  for (const ring of rings) {
    if (ring.length < 3) continue;
    const size = ring.length;
    for (let i = 0; i < size; i++) {
      const atomIdx = ring[i];
      const prev = ring[(i - 1 + size) % size];
      const next = ring[(i + 1) % size];
      // "toward prev" and "toward next" normalized vectors
      const toPrev = new THREE.Vector3().subVectors(pos[prev], pos[atomIdx]).normalize();
      const toNext = new THREE.Vector3().subVectors(pos[next], pos[atomIdx]).normalize();
      const h = hyb[atomIdx];
      // For sp3 (tetrahedral), get the 4 VSEPR positions; for sp2, 3; for sp, 2
      const nDir = h === "sp3" ? 4 : h === "sp2" ? 3 : 2;
      // Use the "average of the 2 ring bond dirs" as toward, then find
      // which slots are closest to toPrev and toNext
      const avg = new THREE.Vector3().addVectors(toPrev, toNext).normalize();
      const dirs = vseprPositions(avg, nDir);
      const used = occupied.get(atomIdx) || new Set<number>();
      // closest slot to toPrev
      let bestPrev = -1, bestPrevD = Infinity;
      for (let s = 0; s < dirs.length; s++) {
        const d = dirs[s].distanceTo(toPrev);
        if (d < bestPrevD) { bestPrevD = d; bestPrev = s; }
      }
      used.add(bestPrev);
      // closest remaining slot to toNext
      let bestNext = -1, bestNextD = Infinity;
      for (let s = 0; s < dirs.length; s++) {
        if (used.has(s)) continue;
        const d = dirs[s].distanceTo(toNext);
        if (d < bestNextD) { bestNextD = d; bestNext = s; }
      }
      if (bestNext >= 0) used.add(bestNext);
      occupied.set(atomIdx, used);
    }
  }

  return { rings };
}
