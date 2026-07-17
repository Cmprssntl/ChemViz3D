import * as THREE from "three";
import type { MoleculeData, AtomData, BondData } from "../types/molecule";
import { BL_CC, BL_CC2, BL_CC3, BL_CH, BL_CO, BL_CO2, BL_CN, BL_OH, BL_NH, atomRenderRadius } from "./config";
import { vseprPositions, tetrahedralPositions } from "./geometry";

export interface BondSpec {
  /** Element symbols in atom order */
  atoms: string[];
  /** [atomIdx1, atomIdx2, bondOrder] */
  bonds: [number, number, number][];
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

export function buildFromBondSpec(spec: BondSpec, formula: string, smiles: string): MoleculeData {
  const n = spec.atoms.length;
  if (n === 0) return { atoms:[], bonds:[], name:formula, formula, smiles };

  // 1) Hybridisation per atom
  const hyb: Hybrid[] = spec.atoms.map((el,i) => getHybrid(el, spec.bonds, i));

  // 2) Place atoms via BFS
  const pos: THREE.Vector3[] = new Array(n).fill(null).map(() => new THREE.Vector3());
  const placed = new Set<number>();
  const occupied = new Map<number, Set<number>>();

  function getVSEPRDirs(idx: number, toward: THREE.Vector3): THREE.Vector3[] {
    const h = hyb[idx];
    const el = spec.atoms[idx];
    const heavyBonds = spec.bonds.filter(b => b[0]===idx || b[1]===idx).length;
    let count = nSubstituents(el, h, spec.bonds, idx);
    if (heavyBonds <= 1 && el !== "C") count = Math.max(count, 1);
    return vseprPositions(toward, count);
  }

  let seed = 0;
  let maxDeg = -1;
  for (let i = 0; i < n; i++) {
    const deg = spec.bonds.filter(b => b[0]===i || b[1]===i).length;
    if (deg > maxDeg) { maxDeg = deg; seed = i; }
  }

  placed.add(seed);
  pos[seed].set(0,0,0);
  occupied.set(seed, new Set());

  // Set up first bond
  const seedBonds = spec.bonds.filter(b => b[0]===seed || b[1]===seed);
  if (seedBonds.length > 0 && spec.atoms.length > 1) {
    const firstNbr = seedBonds[0][0] === seed ? seedBonds[0][1] : seedBonds[0][0];
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

  // Fill remaining VSEPR slots with hydrogens (universal algorithm)
  const VALENCE: Record<string,number> = { C:4, N:3, O:2, H:1, F:1, Cl:1, Br:1, I:1, S:2, P:3 };
  for (let i = 0; i < n; i++) {
    const el = spec.atoms[i];
    if (el === "H") continue;

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
    const avgDir = new THREE.Vector3();
    if (placedNbrs.length > 0) {
      const pb = placedNbrs[0];
      const nbr = pb[0]===i ? pb[1] : pb[0];
      avgDir.copy(new THREE.Vector3().subVectors(pos[nbr], pos[i]));
    }
    if (avgDir.length() < 0.001) avgDir.set(1,0,0);
    avgDir.normalize();

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
    C3H6O2:"methyl acetate", C4H8O2:"ethyl acetate",
    CH4O:"methanol", C2H6O:"ethanol", C2H4O2:"acetic acid", CH2O2:"formic acid",
    C2H4O:"acetaldehyde", C2H6O2:"dimethyl ether",
    H2O:"water", NH3:"ammonia", CO2:"carbon dioxide",
    CH5N:"methylamine", C2H7N:"ethylamine",
  };

  const sysName = generateName(formula);
  const name = NAME_MAP[formula] || sysName || formula;

  return { atoms, bonds, name, formula, smiles };
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
