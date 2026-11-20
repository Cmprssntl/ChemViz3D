import * as THREE from "three";
import type { MoleculeData, AtomData, BondData } from "../types/molecule";
import { BL_CC, BL_CC2, BL_CC3, BL_CH, BL_CO, BL_CO2, BL_CN, BL_OH, BL_NH, atomRenderRadius } from "./config";
import { vseprPositions, tetrahedralPositions } from "./geometry";
import { bestFitPlane } from "./coplanarity";
import { placeRingAtoms } from "./placement/ringTemplate";
import { placeRingHydrogens } from "./placement/ringHydrogens";
import { fillHydrogens } from "./placement/hydrogenFill";
import { bondLen, getHybrid, nSubstituents, valenceForAtom, type BondSpec, type Hybrid } from "./placement/spec";

export type { BondSpec } from "./placement/spec";
import { uffRelax, buildTopology, type UFFAtom } from "./uff";

/**
 * Restore the defining geometry of trigonal-planar carbon after force-field
 * relaxation.  The lightweight UFF model has bond and angle terms, but no
 * improper/out-of-plane term, so a carbon can retain three nearly 120 degree
 * angles while its three bond vectors are still skewed in 3D.  Projecting
 * each neighbour vector onto a deterministic least-squares plane fixes that
 * ambiguity while preserving every C-X bond length.
 */
function enforceSp2CarbonPlanarity(
  atoms: AtomData[],
  bonds: BondData[],
): void {
  const adjacency = new Map<number, number[]>();
  for (const bond of bonds) {
    if (!adjacency.has(bond.atom1Idx)) adjacency.set(bond.atom1Idx, []);
    if (!adjacency.has(bond.atom2Idx)) adjacency.set(bond.atom2Idx, []);
    adjacency.get(bond.atom1Idx)!.push(bond.atom2Idx);
    adjacency.get(bond.atom2Idx)!.push(bond.atom1Idx);
  }
  for (const neighbors of adjacency.values()) neighbors.sort((a, b) => a - b);

  const planarCarbons = atoms
    .filter((atom) => atom.element === "C" && atom.hybridization === "sp2")
    .map((atom) => atom.index)
    .sort((a, b) => a - b);

  // A few fixed projection rounds handle fused rings and conjugated chains,
  // where correcting one centre also moves a shared sp2 neighbour.
  for (let round = 0; round < 16; round++) {
    for (const carbonIndex of planarCarbons) {
      const carbon = atoms[carbonIndex];
      const neighbors = (adjacency.get(carbonIndex) || []).filter((index) => index !== carbonIndex);
      if (neighbors.length < 3) continue;

      const center = new THREE.Vector3(carbon.x, carbon.y, carbon.z);
      const points = [center, ...neighbors.map((index) => {
        const atom = atoms[index];
        return new THREE.Vector3(atom.x, atom.y, atom.z);
      })];
      const fit = bestFitPlane(points);
      const normal = fit.normal.clone().normalize();
      if (!Number.isFinite(normal.x) || normal.lengthSq() < 1e-12) continue;

      for (const neighborIndex of neighbors) {
        const neighbor = atoms[neighborIndex];
        const vector = new THREE.Vector3(neighbor.x - carbon.x, neighbor.y - carbon.y, neighbor.z - carbon.z);
        const length = vector.length();
        if (length < 1e-8) continue;
        vector.addScaledVector(normal, -vector.dot(normal));
        if (vector.lengthSq() < 1e-12) continue;
        vector.normalize().multiplyScalar(length);
        neighbor.x = carbon.x + vector.x;
        neighbor.y = carbon.y + vector.y;
        neighbor.z = carbon.z + vector.z;
      }
    }
  }
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

export interface BuildOptions {
  /** Run the legacy in-builder UFF relaxation. The conformer service disables
   *  it and uses the constrained minimizer instead. */
  relax?: boolean;
}

export function buildFromBondSpec(
  spec: BondSpec,
  formula: string,
  smiles: string,
  jsonName?: string,
  options: BuildOptions = {},
): MoleculeData {
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

  // 2a) Ring atoms first: templates place the cycle, BFS places the rest.
  const { rings } = placeRingAtoms(spec, hyb, pos, placed, occupied);

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
  const counter = { index: n };

  for (let i = 0; i < n; i++) {
    const el = spec.atoms[i];
    const hy = hyb[i];
    const p = pos[i];
    atoms.push({
      index: i, element: el,
      x: p.x, y: p.y, z: p.z,
      covalentRadius: 76, vdwRadius: 170,
      hybridization: hy,
      ...(spec.charges?.[i] !== undefined ? { charge: spec.charges[i] } : {}),
    });
  }

  for (const b of spec.bonds) {
    bonds.push({ index: bonds.length, atom1Idx: b[0], atom2Idx: b[1], order: b[2] });
  }

  // Ring hydrogens come from the ring plane, not VSEPR slots.
  const ringHPlaced = placeRingHydrogens({
    spec, hyb, rings, pos, ringMeta, atoms, bonds, counter,
  });

  fillHydrogens({
    spec, hyb, pos, placed, occupied, ringHPlaced,
    vseprDirs: getVSEPRDirs, atoms, bonds, counter,
  });

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
  if (options.relax !== false) uffRelax(uffAtoms, topo);
  // Copy optimized positions back into AtomData
  for (let i = 0; i < atoms.length; i++) {
    atoms[i].x = uffAtoms[i].x;
    atoms[i].y = uffAtoms[i].y;
    atoms[i].z = uffAtoms[i].z;
  }

  // The simplified UFF implementation can distort terminal methyl groups in
  // larger aromatic molecules. Restore their exact tetrahedral geometry from
  // the optimized C-heavy-atom bond direction after relaxation.
  for (let carbonIdx = 0; carbonIdx < n; carbonIdx++) {
    if (spec.atoms[carbonIdx] !== "C" || hyb[carbonIdx] !== "sp3") continue;

    const attachedBonds = bonds.filter(
      (bond) => bond.atom1Idx === carbonIdx || bond.atom2Idx === carbonIdx,
    );
    const hydrogenIdxs = attachedBonds
      .map((bond) => bond.atom1Idx === carbonIdx ? bond.atom2Idx : bond.atom1Idx)
      .filter((idx) => atoms[idx].element === "H");
    const heavyIdxs = attachedBonds
      .map((bond) => bond.atom1Idx === carbonIdx ? bond.atom2Idx : bond.atom1Idx)
      .filter((idx) => atoms[idx].element !== "H");

    if (hydrogenIdxs.length !== 3 || heavyIdxs.length !== 1) continue;

    const carbon = atoms[carbonIdx];
    const heavy = atoms[heavyIdxs[0]];
    const towardHeavy = new THREE.Vector3(heavy.x - carbon.x, heavy.y - carbon.y, heavy.z - carbon.z);
    const hydrogenDirs = vseprPositions(towardHeavy, 4).slice(0, 3);
    for (let h = 0; h < hydrogenIdxs.length; h++) {
      const hydrogen = atoms[hydrogenIdxs[h]];
      hydrogen.x = carbon.x + hydrogenDirs[h].x * BL_CH;
      hydrogen.y = carbon.y + hydrogenDirs[h].y * BL_CH;
      hydrogen.z = carbon.z + hydrogenDirs[h].z * BL_CH;
    }
  }

  // UFF does not include an improper torsion term.  Apply the exact local
  // trigonal-planar constraint last so the displayed three bonds of every
  // sp2 carbon (including its implicit H, when present) are truly coplanar.
  enforceSp2CarbonPlanarity(atoms, bonds);

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
