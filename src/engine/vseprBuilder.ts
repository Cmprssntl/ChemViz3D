import * as THREE from "three";
import type { MoleculeData, AtomData, BondData } from "../types/molecule";
import { vseprPositions } from "./geometry";
import { bestFitPlane } from "./coplanarity";
import { placeRingAtoms } from "./placement/ringTemplate";
import { placeRingHydrogens } from "./placement/ringHydrogens";
import { fillHydrogens } from "./placement/hydrogenFill";
import { bondLen, getHybrid, nSubstituents, type BondSpec, type Hybrid } from "./placement/spec";
import { KNOWN_SPECS, NAME_MAP, generateName } from "./placement/knownSpecs";
import { enforceSp2CarbonPlanarity, normalizeTerminalMethyls } from "./placement/postPlacement";

export type { BondSpec } from "./placement/spec";

export function buildFromBondSpec(
  spec: BondSpec,
  formula: string,
  smiles: string,
  jsonName?: string,
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

  normalizeTerminalMethyls(spec, hyb, atoms, bonds);

  // Apply the exact local trigonal-planar constraint last so the displayed
  // three bonds of every sp2 carbon (including its implicit H) are coplanar.
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
