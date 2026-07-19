import * as THREE from "three";
import type { MoleculeData, AtomData, BondData } from "../types/molecule";
import { BL_CC, BL_CC2, BL_CC3, BL_CH, BL_CO, BL_CO2, BL_CN, BL_OH, BL_NH, atomRenderRadius } from "./config";
import { vseprPositions, tetrahedralPositions } from "./geometry";
import { findRings } from "./rotation";
import { bestFitPlane } from "./coplanarity";
import { uffRelax, buildTopology, type UFFAtom } from "./uff";
export interface BondSpec {
  /** Element symbols in atom order */
  atoms: string[];
  /** [atomIdx1, atomIdx2, bondOrder] */
  bonds: [number, number, number][];
  /** Per-atom hybridization override. When set, the builder uses this
   *  instead of inferring from bond orders. Required to distinguish
   *  sp2 aromatic rings from sp3 cycloalkanes. */
  hybridizations?: (Hybrid | undefined)[];
}

// ── known bond specs indexed by canonical formula ──

const KNOWN_SPECS: Record<string, BondSpec> = {
  // Hydrocarbons
  CH4:  { atoms: ["C"],                       bonds: [] },
  C2H6: { atoms: ["C","C"],                   bonds: [[0,1,1]] },
  C2H4: { atoms: ["C","C"],                   bonds: [[0,1,2]] },
  C2H2: { atoms: ["C","C"],                   bonds: [[0,1,3]] },
  C3H8: { atoms: ["C","C","C"],               bonds: [[0,1,1],[1,2,1]] },
  C4H10:{ atoms: ["C","C","C","C"],           bonds: [[0,1,1],[1,2,1],[2,3,1]] },
  C5H12:{ atoms: ["C","C","C","C","C"],       bonds: [[0,1,1],[0,2,1],[0,3,1],[0,4,1]] }, // neopentane
  // Cycloalkanes
  C3H6: { atoms: ["C","C","C"],               bonds: [[0,1,1],[1,2,1],[2,0,1]],
          hybridizations: ["sp3","sp3","sp3"] },
  C4H8: { atoms: ["C","C","C","C"],           bonds: [[0,1,1],[1,2,1],[2,3,1],[3,0,1]],
          hybridizations: ["sp3","sp3","sp3","sp3"] },
  C5H10:{ atoms: ["C","C","C","C","C"],       bonds: [[0,1,1],[1,2,1],[2,3,1],[3,4,1],[4,0,1]],
          hybridizations: ["sp3","sp3","sp3","sp3","sp3"] },
  C6H12:{ atoms: ["C","C","C","C","C","C"],   bonds: [[0,1,1],[1,2,1],[2,3,1],[3,4,1],[4,5,1],[5,0,1]],
          hybridizations: ["sp3","sp3","sp3","sp3","sp3","sp3"] },
  C7H14:{ atoms: ["C","C","C","C","C","C","C"], bonds: [[0,1,1],[1,2,1],[2,3,1],[3,4,1],[4,5,1],[5,6,1],[6,0,1]],
          hybridizations: ["sp3","sp3","sp3","sp3","sp3","sp3","sp3"] },
  C8H16:{ atoms: ["C","C","C","C","C","C","C","C"], bonds: [[0,1,1],[1,2,1],[2,3,1],[3,4,1],[4,5,1],[5,6,1],[6,7,1],[7,0,1]],
          hybridizations: ["sp3","sp3","sp3","sp3","sp3","sp3","sp3","sp3"] },
  C9H18:{ atoms: ["C","C","C","C","C","C","C","C","C"], bonds: [[0,1,1],[1,2,1],[2,3,1],[3,4,1],[4,5,1],[5,6,1],[6,7,1],[7,8,1],[8,0,1]],
          hybridizations: ["sp3","sp3","sp3","sp3","sp3","sp3","sp3","sp3","sp3"] },
  C10H20:{ atoms: ["C","C","C","C","C","C","C","C","C","C"], bonds: [[0,1,1],[1,2,1],[2,3,1],[3,4,1],[4,5,1],[5,6,1],[6,7,1],[7,8,1],[8,9,1],[9,0,1]],
          hybridizations: ["sp3","sp3","sp3","sp3","sp3","sp3","sp3","sp3","sp3","sp3"] },

  // Alcohols & ethers
  CH4O: { atoms: ["C","O"],                   bonds: [[0,1,1]] },      // methanol
  C2H6O:{ atoms: ["C","C","O"],               bonds: [[0,1,1],[1,2,1]] }, // ethanol
  C2H6O2:{atoms: ["C","O","C"],               bonds: [[0,1,1],[1,2,1]] }, // dimethyl ether

  // Carbonyl compounds
  C2H4O:{ atoms: ["C","C","O"],               bonds: [[0,1,1],[1,2,2]] }, // acetaldehyde
  CH2O2:{ atoms: ["C","O","O"],               bonds: [[0,1,2],[0,2,1]] }, // formic acid
  C2H4O2:{atoms: ["C","C","O","O"],           bonds: [[0,1,1],[1,2,2],[1,3,1]] }, // acetic acid

  // Esters
  C3H6O2:{atoms:["C","C","O","O","C"],        bonds:[[0,1,1],[1,2,2],[1,3,1],[3,4,1]] }, // methyl acetate
  C4H8O2:{atoms:["C","C","C","O","O","C"],    bonds:[[0,1,1],[1,2,1],[2,3,2],[2,4,1],[4,5,1]] }, // ethyl acetate

  // Inorganic
  H2O:  { atoms: ["O"],                       bonds: [] },
  NH3:  { atoms: ["N"],                       bonds: [] },
  CO2:  { atoms: ["C","O","O"],               bonds: [[0,1,2],[0,2,2]] },

  // Amines (NEW)
  CH5N: { atoms: ["C","N"],                   bonds: [[0,1,1]] },      // methylamine
  C2H7N:{ atoms: ["C","C","N"],               bonds: [[0,1,1],[1,2,1]] }, // ethylamine
};

type Hybrid = "sp" | "sp2" | "sp3";

function getHybrid(el: string, bonds: [number,number,number][], idx: number): Hybrid {
  const my = bonds.filter(b => b[0]===idx || b[1]===idx);
  const maxOrd = Math.max(1, ...my.map(b=>b[2]));
  const nHeavy = my.length;
  if (el === "C") {
    if (maxOrd >= 3) return "sp";
    if (maxOrd === 2 && nHeavy === 2) return "sp";
    if (maxOrd === 2) return "sp2";
    return "sp3";
  }
  if (el === "O") {
    if (maxOrd === 2) return "sp2";
    return "sp3";
  }
  if (el === "N") {
    if (maxOrd === 2) return "sp2";
    return "sp3";
  }
  return "sp3";
}

function nSubstituents(el: string, hyb: Hybrid, specBonds: [number,number,number][], idx: number): number {
  const heavy = specBonds.filter(b => b[0]===idx || b[1]===idx).length;
  if (el === "O") {
    if (hyb === "sp2") return 2;   // C=O, no more substituents needed
    // sp3 O: 2 lone pairs + 2 bonding positions = 4 total
    return 4;
  }
  if (el === "N") {
    if (hyb === "sp3") return 4; // 3 bonding + 1 lone pair
    if (hyb === "sp2") return 3; // 2 bonding + 1 lone pair
  }
  // C or other
  if (hyb === "sp")  return 2;
  if (hyb === "sp2") return 3;
  return 4; // sp3
}

// Bond-length lookup
function bondLen(el1: string, el2: string, order: number): number {
  if ((el1==="C"||el1==="O") && (el2==="C"||el2==="O")) {
    if (order === 3) return BL_CC3;
    if (order === 2) return BL_CO2;
    if (el1==="O"||el2==="O") return BL_CO;
    return BL_CC;
  }
  if ((el1==="C"||el1==="N") && (el2==="C"||el2==="N")) return BL_CN;
  if ((el1==="H"||el2==="H")) return BL_CH;
  if ((el1==="C"||el2==="C")) return BL_CC;
  return 1.40;
}

// ── main builder ──

/** Per-element valence (max number of bonds). Used for H counting. */
const VALENCE_LOOKUP: Record<string, number> = { C: 4, N: 3, O: 2, H: 1, F: 1, Cl: 1, Br: 1, I: 1, S: 2, P: 3 };

export function buildFromBondSpec(spec: BondSpec, formula: string, smiles: string, jsonName?: string): MoleculeData {
  const n = spec.atoms.length;
  if (n === 0) return { atoms:[], bonds:[], name:formula, formula, smiles };

  // 1) Hybridisation per atom — use spec-provided override when available
  const hyb: Hybrid[] = spec.atoms.map((el, i) => {
    if (spec.hybridizations && spec.hybridizations[i]) return spec.hybridizations[i]!;
    return getHybrid(el, spec.bonds, i);
  });

  // 2) Place atoms via BFS
  const pos: THREE.Vector3[] = new Array(n).fill(null).map(() => new THREE.Vector3());
  const placed = new Set<number>();
  const occupied = new Map<number, Set<number>>();

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
  const adj = new Map<number, number[]>();
  for (const b of spec.bonds) {
    if (!adj.has(b[0])) adj.set(b[0], []);
    if (!adj.has(b[1])) adj.set(b[1], []);
    adj.get(b[0])!.push(b[1]);
    adj.get(b[1])!.push(b[0]);
  }
  const rings = findRings(adj, 20);
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

  // Build atom → ring map for the ring H-placement pass
  const atomToRing = new Map<number, number[]>();
  for (const ring of rings) {
    if (ring.length < 3) continue;
    for (const idx of ring) atomToRing.set(idx, ring);
  }

  // Compute ring centers and plane normals (cached for H placement)
  // Use bestFitPlane (PCA over all ring atoms) so the normal correctly
  // captures the mean ring plane even for non-planar conformations like
  // chair cyclohexane. Cross-product of first 3 atoms is wrong for chairs
  // because 3 atoms of a chair don't define the mean plane.
  const ringMeta = new Map<number, { center: THREE.Vector3; normal: THREE.Vector3 }>();
  for (const ring of rings) {
    if (ring.length < 3) continue;
    const ringPos = ring.map(idx => pos[idx]);
    const fit = bestFitPlane(ringPos);
    for (const idx of ring) {
      if (!ringMeta.has(idx)) {
        ringMeta.set(idx, { center: fit.center.clone(), normal: fit.normal.clone() });
      }
    }
  }

  function getVSEPRDirs(idx: number, toward: THREE.Vector3): THREE.Vector3[] {
    const h = hyb[idx];
    const el = spec.atoms[idx];
    const heavyBonds = spec.bonds.filter(b => b[0]===idx || b[1]===idx).length;
    let count = nSubstituents(el, h, spec.bonds, idx);
    if (heavyBonds <= 1 && el !== "C") count = Math.max(count, 1);
    return vseprPositions(toward, count);
  }

  // Pick seed only among atoms NOT already placed by the ring template.
  // (The template may have placed all ring atoms; we just need a BFS seed
  // for placing substituents.)
  let seed = -1;
  let maxDeg = -1;
  for (let i = 0; i < n; i++) {
    if (placed.has(i)) continue;
    const deg = spec.bonds.filter(b => b[0]===i || b[1]===i).length;
    if (deg > maxDeg) { maxDeg = deg; seed = i; }
  }
  // If everything is already placed (pure ring), we don't need a BFS seed.
  if (seed < 0) {
    // Use any atom as a no-op seed
    seed = 0;
  } else {
    // Set up first bond. Two cases:
    //   1. The seed's first neighbour is unplaced (e.g. simple chain):
    //      place the seed at origin and the neighbour at distance L along +x.
    //   2. The seed's first neighbour is already placed (e.g. the seed is a
    //      substituent on a ring atom): we MUST NOT teleport the seed to
    //      origin, otherwise the substituent would end up at the ring
    //      center (the user's "支链都插到环里面了" bug). Instead, place
    //      the seed using a free VSEPR slot on the neighbour, so the
    //      substituent extends outward from the ring.
    const seedBonds = spec.bonds.filter(b => b[0]===seed || b[1]===seed);
    if (seedBonds.length > 0 && spec.atoms.length > 1) {
      const firstNbr = seedBonds[0][0] === seed ? seedBonds[0][1] : seedBonds[0][0];
      if (!placed.has(firstNbr)) {
        // Case 1: chain — both unplaced
        placed.add(seed);
        pos[seed].set(0,0,0);
        occupied.set(seed, new Set());

        const bl = bondLen(spec.atoms[seed], spec.atoms[firstNbr], seedBonds[0][2]);
        pos[firstNbr].set(bl, 0, 0);
        placed.add(firstNbr);
        occupied.set(firstNbr, new Set());

        const seedDirs = getVSEPRDirs(seed, new THREE.Vector3(1,0,0));
        const slotAtSeed = seedDirs.length - 1;
        occupied.get(seed)!.add(slotAtSeed);

        const nbrDirs = getVSEPRDirs(firstNbr, new THREE.Vector3(-1,0,0));
        const slotAtNbr = nbrDirs.length - 1;
        occupied.get(firstNbr)!.add(slotAtNbr);
      } else {
        // Case 2: substituent on a placed atom (e.g. ring atom). Place
        // the seed using a free VSEPR slot on the neighbour so it ends
        // up outside the ring rather than at the ring center.
        const bl = bondLen(spec.atoms[firstNbr], spec.atoms[seed], seedBonds[0][2]);

        // Compute the VSEPR slots on the neighbour (same logic as BFS)
        const nbrPlacedNbrs = spec.bonds.filter(b =>
          (b[0] === firstNbr || b[1] === firstNbr) &&
          (b[0] !== firstNbr ? b[0] : b[1]) !== firstNbr &&
          placed.has(b[0] === firstNbr ? b[1] : b[0])
        );
        const avgDir = new THREE.Vector3();
        for (const pb of nbrPlacedNbrs) {
          const nbr2 = pb[0] === firstNbr ? pb[1] : pb[0];
          avgDir.add(new THREE.Vector3().subVectors(pos[nbr2], pos[firstNbr]));
        }
        if (avgDir.length() < 0.001) avgDir.set(1, 0, 0);
        avgDir.normalize();

        const dirs = getVSEPRDirs(firstNbr, avgDir);
        const used = occupied.get(firstNbr) || new Set<number>();
        // Find a free slot
        // SP2 RING-ATOM SPECIAL CASE: for an sp2 C with 2 ring bonds
        // (e.g. C0 in toluene with the methyl substituent), the VSEPR
        // basis (which puts the substituent at a 120°-cone position from
        // the bisector) gives C-substituent angles of ~104.5° instead
        // of the sp2-ideal 120°. The correct sp2 geometry has the
        // substituent at -d (opposite to the ring-bond bisector), in
        // the ring plane, at exactly 120° from each ring bond.
        if (spec.atoms[firstNbr] === "C" && (spec.hybridizations?.[firstNbr] ?? getHybrid(spec.atoms[firstNbr], spec.bonds, firstNbr)) === "sp2") {
          // Find the 2 ring-bond directions from firstNbr (the ring atom).
          const ringNbrs: number[] = [];
          for (const b of spec.bonds) {
            if (b[0] === firstNbr || b[1] === firstNbr) {
              const other = b[0] === firstNbr ? b[1] : b[0];
              // Other ring members are at exactly the ring-bond distance
              // (single bond 1.54 for C, double 1.34) AND in the same ring
              // (i.e. a candidate ring closure that uses the firstNbr as a
              // member). Simplest criterion: heavy neighbour that is
              // already placed AND is sp2 (ring).
              const otherAtom = spec.atoms[other];
              if (placed.has(other) && (spec.hybridizations?.[other] ?? getHybrid(otherAtom, spec.bonds, other)) === "sp2" && other !== seed) {
                ringNbrs.push(other);
              }
            }
          }
          if (ringNbrs.length === 2) {
            // Compute -d, the position opposite to the ring-bond bisector.
            // For an sp2 C with 2 ring bonds at 120°, the substituent
            // should be at -d in the ring plane, giving C-substituent
            // angles of exactly 120° on both sides.
            const o1 = pos[ringNbrs[0]];
            const o2 = pos[ringNbrs[1]];
            const b1x = o1.x - pos[firstNbr].x;
            const b1y = o1.y - pos[firstNbr].y;
            const b1z = o1.z - pos[firstNbr].z;
            const b2x = o2.x - pos[firstNbr].x;
            const b2y = o2.y - pos[firstNbr].y;
            const b2z = o2.z - pos[firstNbr].z;
            const b1l = Math.hypot(b1x, b1y, b1z);
            const b2l = Math.hypot(b2x, b2y, b2z);
            const px = b1x/b1l + b2x/b2l;
            const py = b1y/b1l + b2y/b2l;
            const pz = b1z/b1l + b2z/b2l;
            const pl = Math.hypot(px, py, pz);
            pos[seed].set(
              pos[firstNbr].x - px/pl * bl,
              pos[firstNbr].y - py/pl * bl,
              pos[firstNbr].z - pz/pl * bl
            );
            // Mark the "opposite" VSEPR slot on the ring atom so the
            // BFS loop doesn't try to re-place a different atom here.
            if (used) used.add(dirs.length - 1);
          } else {
            // Fall back to VSEPR (no ring context)
            let slot = -1;
            for (let s = 0; s < dirs.length; s++) {
              if (!used.has(s)) { slot = s; break; }
            }
            if (slot >= 0) {
              const d = dirs[slot];
              pos[seed].copy(pos[firstNbr]).add(d.clone().multiplyScalar(bl));
              used.add(slot);
              occupied.set(firstNbr, used);
            } else {
              pos[seed].copy(pos[firstNbr]).add(new THREE.Vector3(1, 0, 0).multiplyScalar(bl));
            }
          }
        } else {
        let slot = -1;
        for (let s = 0; s < dirs.length; s++) {
          if (!used.has(s)) { slot = s; break; }
        }
        if (slot >= 0) {
          const d = dirs[slot];
          pos[seed].copy(pos[firstNbr]).add(d.clone().multiplyScalar(bl));
          used.add(slot);
          occupied.set(firstNbr, used);
        } else {
          // No free VSEPR slot found (shouldn't happen for valid molecules).
          // Fall back to placing along the +x axis from the neighbour.
          pos[seed].copy(pos[firstNbr]).add(new THREE.Vector3(1, 0, 0).multiplyScalar(bl));
        }
        }
        placed.add(seed);
        occupied.set(seed, new Set());
      }
    } else {
      // No seed bonds (single isolated atom): just place at origin.
      placed.add(seed);
      pos[seed].set(0,0,0);
      occupied.set(seed, new Set());
    }
  }

  // BFS: place remaining atoms
  let changed = true;
  while (changed) {
    changed = false;
    for (let p = 0; p < n; p++) {
      if (!placed.has(p)) continue;
      const pBonds = spec.bonds.filter(b => b[0]===p || b[1]===p);
      const unplacedNbrs = pBonds.filter(b => {
        const nbr = b[0]===p ? b[1] : b[0];
        return !placed.has(nbr);
      });
      if (unplacedNbrs.length === 0) continue;

      const placedNbrs = pBonds.filter(b => {
        const nbr = b[0]===p ? b[1] : b[0];
        return placed.has(nbr) && nbr !== p;
      });
      const avgDir = new THREE.Vector3();
      for (const pb of placedNbrs) {
        const nbr = pb[0]===p ? pb[1] : pb[0];
        avgDir.add(new THREE.Vector3().subVectors(pos[nbr], pos[p]));
      }
      if (avgDir.length() < 0.001) avgDir.set(1,0,0);
      avgDir.normalize();

      const dirs = getVSEPRDirs(p, avgDir);
      const used = occupied.get(p) || new Set();

      for (const pb of unplacedNbrs) {
        const nbr = pb[0]===p ? pb[1] : pb[0];
        const ord = pb[2];

        // SP2 RING-ATOM SPECIAL CASE: same as the seed-setup fix. For
        // an sp2 C with 2 ring bonds, the VSEPR basis gives a
        // substituent position at ~104.5° instead of the sp2-ideal
        // 120°. Use the -bisector formula to put the substituent at
        // 120° from each ring bond, coplanar with the ring.
        const pHybrid = spec.hybridizations?.[p] ?? getHybrid(spec.atoms[p], spec.bonds, p);
        if (spec.atoms[p] === "C" && pHybrid === "sp2" && placedNbrs.length === 2) {
          const o1 = pos[placedNbrs[0][0]===p ? placedNbrs[0][1] : placedNbrs[0][0]];
          const o2 = pos[placedNbrs[1][0]===p ? placedNbrs[1][1] : placedNbrs[1][0]];
          const b1xv = o1.x - pos[p].x;
          const b1yv = o1.y - pos[p].y;
          const b1zv = o1.z - pos[p].z;
          const b2xv = o2.x - pos[p].x;
          const b2yv = o2.y - pos[p].y;
          const b2zv = o2.z - pos[p].z;
          const b1lv = Math.hypot(b1xv, b1yv, b1zv);
          const b2lv = Math.hypot(b2xv, b2yv, b2zv);
          const pxp = b1xv/b1lv + b2xv/b2lv;
          const pyp = b1yv/b1lv + b2yv/b2lv;
          const pzp = b1zv/b1lv + b2zv/b2lv;
          const plv = Math.hypot(pxp, pyp, pzp);
          const blv = bondLen(spec.atoms[p], spec.atoms[nbr], ord);
          pos[nbr].set(
            pos[p].x - pxp/plv * blv,
            pos[p].y - pyp/plv * blv,
            pos[p].z - pzp/plv * blv
          );
          placed.add(nbr);
          occupied.set(nbr, new Set());
          changed = true;
          continue;
        }

        let slot = -1;
        for (let s = 0; s < dirs.length; s++) {
          if (!used.has(s)) { slot = s; break; }
        }
        if (slot < 0) continue;

        const bl = bondLen(spec.atoms[p], spec.atoms[nbr], ord);
        const d = dirs[slot];
        pos[nbr].copy(pos[p]).add(d.clone().multiplyScalar(bl));
        placed.add(nbr);
        occupied.set(nbr, new Set());

        used.add(slot);
        const nbrDirs = getVSEPRDirs(nbr, d.clone().negate());
        occupied.get(nbr)!.add(nbrDirs.length - 1);

        changed = true;
      }
    }
  }

  // 3) Build AtomData[] with all heavy atoms
  const atoms: AtomData[] = [];
  const bonds: BondData[] = [];
  let hAtomIdx = n;

  for (let i = 0; i < n; i++) {
    const el = spec.atoms[i];
    const hy = hyb[i];
    const p = pos[i];
    atoms.push({
      index: i, element: el,
      x: p.x, y: p.y, z: p.z,
      covalentRadius: 76, vdwRadius: 170,
      hybridization: hy,
    });
  }

  for (const b of spec.bonds) {
    bonds.push({ index: bonds.length, atom1Idx: b[0], atom2Idx: b[1], order: b[2] });
  }

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
      const v = VALENCE_LOOKUP[el] ?? 4;
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
              index: hAtomIdx, element: "H",
              x, y, z,
              covalentRadius: 31, vdwRadius: 120,
            });
            bonds.push({ index: bonds.length, atom1Idx: atomIdx, atom2Idx: hAtomIdx, order: 1 });
            hAtomIdx++;
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
            index: hAtomIdx, element: "H",
            x: axialHPos.x, y: axialHPos.y, z: axialHPos.z,
            covalentRadius: 31, vdwRadius: 120,
          });
          bonds.push({ index: bonds.length, atom1Idx: atomIdx, atom2Idx: hAtomIdx, order: 1 });
          hAtomIdx++;
          if (maxH >= 2) {
            const equatDir = outDir.clone().add(meta.normal.clone().multiplyScalar(axialSign * 0.45));
            equatDir.normalize();
            const equatHPos = pos[atomIdx].clone().add(equatDir.multiplyScalar(BL_CH));
            atoms.push({
              index: hAtomIdx, element: "H",
              x: equatHPos.x, y: equatHPos.y, z: equatHPos.z,
              covalentRadius: 31, vdwRadius: 120,
            });
            bonds.push({ index: bonds.length, atom1Idx: atomIdx, atom2Idx: hAtomIdx, order: 1 });
            hAtomIdx++;
          }
        }
      } else if (h === "sp2") {
        // 1 H outward in the ring plane
        const hPos = pos[atomIdx].clone().add(outDir.multiplyScalar(BL_CH));
        atoms.push({
          index: hAtomIdx, element: "H",
          x: hPos.x, y: hPos.y, z: hPos.z,
          covalentRadius: 31, vdwRadius: 120,
        });
        bonds.push({ index: bonds.length, atom1Idx: atomIdx, atom2Idx: hAtomIdx, order: 1 });
        hAtomIdx++;
      }
      // sp: no extra H's
    }
  }

  // Fill remaining VSEPR slots with hydrogens (universal algorithm)
  const VALENCE: Record<string,number> = { C:4, N:3, O:2, H:1, F:1, Cl:1, Br:1, I:1, S:2, P:3 };
  for (let i = 0; i < n; i++) {
    const el = spec.atoms[i];
    if (el === "H") continue;
    // Skip ring atoms whose H's were placed by the dedicated ring path
    if (ringHPlaced.has(i)) continue;

    const pBonds = spec.bonds.filter(b => b[0]===i || b[1]===i);
    const v = VALENCE[el] ?? 4;
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
        index: hAtomIdx, element: "H",
        x: h1Pos.x, y: h1Pos.y, z: h1Pos.z,
        covalentRadius: 31, vdwRadius: 120,
      });
      bonds.push({ index: bonds.length, atom1Idx: i, atom2Idx: hAtomIdx, order: 1 });
      hAtomIdx++;
      const h2Pos = { x: pos[i].x + h2x*BL_CH, y: pos[i].y + h2y*BL_CH, z: pos[i].z + h2z*BL_CH };
      atoms.push({
        index: hAtomIdx, element: "H",
        x: h2Pos.x, y: h2Pos.y, z: h2Pos.z,
        covalentRadius: 31, vdwRadius: 120,
      });
      bonds.push({ index: bonds.length, atom1Idx: i, atom2Idx: hAtomIdx, order: 1 });
      hAtomIdx++;
      continue;
    }

    const dirs = getVSEPRDirs(i, avgDir);
    const used = occupied.get(i) || new Set();

    let hPlaced = 0;
    for (let s = 0; s < dirs.length; s++) {
      if (used.has(s)) continue;
      if (hPlaced >= maxH) break;
      hPlaced++;
      const d = dirs[s];
      const bl = el === "O" ? BL_OH : (el === "N" ? BL_NH : BL_CH);
      atoms.push({
        index: hAtomIdx, element: "H",
        x: pos[i].x + d.x * bl, y: pos[i].y + d.y * bl, z: pos[i].z + d.z * bl,
        covalentRadius: 31, vdwRadius: 120,
      });
      bonds.push({ index: bonds.length, atom1Idx: i, atom2Idx: hAtomIdx, order: 1 });
      hAtomIdx++;
    }
  }

  // Handle H2O special case (only if universal loop didn't run)
  if (spec.atoms.length === 1 && spec.atoms[0] === "O" && spec.bonds.length === 0 && hAtomIdx <= spec.atoms.length) {
    // Place lone pair at +z (up), 2 H's at 104.5° in xy plane
    const ang = THREE.MathUtils.degToRad(104.5);
    for (let s = -1; s <= 1; s += 2) {
      const hDir = new THREE.Vector3(s * Math.sin(ang/2), Math.cos(ang/2), 0).normalize();
      atoms.push({
        index: hAtomIdx, element: "H",
        x: hDir.x * BL_OH, y: hDir.y * BL_OH, z: 0,
        covalentRadius: 31, vdwRadius: 120,
      });
      bonds.push({ index: bonds.length, atom1Idx: 0, atom2Idx: hAtomIdx, order: 1 });
      hAtomIdx++;
    }
  }

  // Handle NH3 special case
  if (spec.atoms.length === 1 && spec.atoms[0] === "N" && spec.bonds.length === 0 && hAtomIdx <= spec.atoms.length) {
    const up = new THREE.Vector3(0, -1, 0);
    for (let i = 0; i < 3; i++) {
      const ang = (i / 3) * Math.PI * 2;
      const dir = new THREE.Vector3()
        .addScaledVector(up, -Math.cos(THREE.MathUtils.degToRad(107)))
        .addScaledVector(new THREE.Vector3(1,0,0).applyAxisAngle(up, ang), Math.sin(THREE.MathUtils.degToRad(107)));
      dir.normalize();
      atoms.push({
        index: hAtomIdx, element: "H",
        x: dir.x * BL_NH, y: dir.y * BL_NH, z: dir.z * BL_NH,
        covalentRadius: 31, vdwRadius: 120,
      });
      bonds.push({ index: bonds.length, atom1Idx: 0, atom2Idx: hAtomIdx, order: 1 });
      hAtomIdx++;
    }
  }

  // Name map
  const NAME_MAP: Record<string, string> = {
    CH4:"methane", C2H6:"ethane", C2H4:"ethene", C2H2:"ethyne", C6H6:"benzene",
    C3H8:"propane", C4H10:"butane",
    C3H6:"cyclopropane", C4H8:"cyclobutane", C5H10:"cyclopentane",
    C6H12:"cyclohexane", C7H14:"cycloheptane",
    C8H16:"cyclooctane", C9H18:"cyclononane", C10H20:"cyclodecane",
    C3H6O2:"methyl acetate", C4H8O2:"ethyl acetate",
    CH4O:"methanol", C2H6O:"ethanol", C2H4O2:"acetic acid", CH2O2:"formic acid",
    C2H4O:"acetaldehyde", C2H6O2:"dimethyl ether",
    H2O:"water", NH3:"ammonia", CO2:"carbon dioxide",
    CH5N:"methylamine", C2H7N:"ethylamine",
  };

  // Compute the actual molecular formula from ALL atoms (including H's
  // added by the VSEPR builder). The `formula` parameter only knows
  // about the heavy atoms (e.g. "C4" for cyclobutane), but the final
  // MoleculeData contains the H's too, so the formula should be "C4H8".
  // Do this FIRST so the name lookup uses the correct formula.
  const elemOrder = ["C", "H", "O", "N", "S", "P", "F", "Cl", "Br", "I"];
  const fcounts = new Map<string, number>();
  for (const a of atoms) {
    fcounts.set(a.element, (fcounts.get(a.element) || 0) + 1);
  }
  const actualFormula = [...fcounts.entries()]
    .sort((a, b) => elemOrder.indexOf(a[0]) - elemOrder.indexOf(b[0]))
    .map(([el, cnt]) => el + (cnt > 1 ? cnt : ""))
    .join("");

  const sysName = generateName(actualFormula);
  const name = jsonName || NAME_MAP[actualFormula] || NAME_MAP[formula] || sysName || actualFormula;

  // ── UFF Force Field Relaxation ──
  // Post-process: run molecular mechanics energy minimization to fix
  // ring pucker (cyclopentane envelope etc.), H-H repulsion (methyl
  // staggered conformation), and general bond/angle/VdW strains.
  // This replaces the hand-rolled "max min H-H" rotation search and
  // the "staggered" offset hacks above — those are kept as initial
  // guesses and the optimizer refines from there.
  const uffAtoms: UFFAtom[] = atoms.map((a, i) => ({
    el: a.element,
    hyb: (hyb[i]?.toString()) ?? "",
    x: a.x, y: a.y, z: a.z,
  }));
  const bondPairs: [number, number][] = bonds.map(b => [b.atom1Idx, b.atom2Idx]);
  const topo = buildTopology(uffAtoms, bondPairs);
  uffRelax(uffAtoms, topo);
  // Copy optimized positions back into AtomData
  for (let i = 0; i < atoms.length; i++) {
    atoms[i].x = uffAtoms[i].x;
    atoms[i].y = uffAtoms[i].y;
    atoms[i].z = uffAtoms[i].z;
  }

  return { atoms, bonds, name, formula: actualFormula, smiles };
}

export function buildFromKnownFormula(formula: string, smiles: string): MoleculeData | null {
  const norm: Record<string, string> = {
    CH3OH:"CH4O", CH4O:"CH4O",
    C2H5OH:"C2H6O", C2H6O:"C2H6O",
    CH3COOH:"C2H4O2", HCOOH:"CH2O2",
    CH3CHO:"C2H4O", CH3OCH3:"C2H6O2",
    CH3CCH33:"C5H12", C5H12:"C5H12",
    CH3CH2CH2CH2CH3:"C5H12",
    C3H8:"C3H8", CH3CH2CH3:"C3H8",
    C4H10:"C4H10", CH3CH2CH2CH3:"C4H10",
    // Cycloalkanes
    C3H6:"C3H6", C4H8:"C4H8", C5H10:"C5H10", C6H12:"C6H12", C7H14:"C7H14",
    C8H16:"C8H16", C9H18:"C9H18", C10H20:"C10H20",
    // Amines
    CH3NH2:"CH5N", CH5N:"CH5N",
    C2H5NH2:"C2H7N", C2H7N:"C2H7N",
    CH3CH2NH2:"C2H7N",
  };
  const key = norm[formula] || formula;
  const spec = KNOWN_SPECS[key];
  if (!spec) return null;
  return buildFromBondSpec(spec, formula, smiles);
}

function generateName(formula: string): string | null {
  const m = formula.match(/^C(\d*)H(\d*)(.*)$/);
  if (!m) return null;
  const c = parseInt(m[1] || "1", 10);
  const h = parseInt(m[2] || "0", 10);
  const suffix = m[3];
  const prefix = ["","meth","eth","prop","but","pent","hex","hept","oct","non","dec"][c];
  if (!prefix) return null;
  if (!suffix) {
    if (h === 2 * c + 2) return prefix + "ane";
    if (h === 2 * c) return prefix + "ene";
    if (h === 2 * c - 2) return prefix + "yne";
    return null;
  }
  if (suffix === "O") {
    if (h === 2 * c + 2) return prefix + "anol";
    if (h === 2 * c) return prefix + "anal";
    return null;
  }
  if (suffix === "O2") {
    if (h === 2 * c + 2) return prefix + "anoic acid";
    return null;
  }
  if (suffix === "N") {
    // Simple amine pattern: CnH2n+3N
    if (h === 2 * c + 3) return prefix + "ylamine";
    return null;
  }
  return null;
}
