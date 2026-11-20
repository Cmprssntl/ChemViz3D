import { BL_CC, BL_CC2, BL_CC3, BL_CH, BL_CO, BL_CO2, BL_CN } from "../config";

/** Hybridisation label shared by the builder and every placement module. */
export type Hybrid = "sp" | "sp2" | "sp3";

export interface BondSpec {
  /** Element symbols in atom order */
  atoms: string[];
  /** [atomIdx1, atomIdx2, bondOrder] */
  bonds: [number, number, number][];
  /** Per-atom hybridization override. When set, the builder uses this
   *  instead of inferring from bond orders. Required to distinguish
   *  sp2 aromatic rings from sp3 cycloalkanes. */
  hybridizations?: (Hybrid | undefined)[];
  /** Per-atom formal charge, used to avoid adding implicit H to ions. */
  charges?: (number | undefined)[];
}

export function getHybrid(el: string, bonds: [number,number,number][], idx: number): Hybrid {
  const my = bonds.filter(b => b[0]===idx || b[1]===idx);
  const maxOrd = Math.max(1, ...my.map(b=>b[2]));
  if (el === "C") {
    if (maxOrd >= 3) return "sp";
    const piBonds = my.reduce((sum, bond) => sum + Math.max(0, bond[2] - 1), 0);
    // One pi bond means sp2 (C=C, C=O, or a Kekule aromatic carbon).
    // Two pi bonds means sp (C=C=C or C#C).
    if (piBonds >= 2) return "sp";
    if (piBonds >= 1) return "sp2";
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

export function nSubstituents(el: string, hyb: Hybrid, specBonds: [number,number,number][], idx: number): number {
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
export function bondLen(el1: string, el2: string, order: number): number {
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

export function valenceForAtom(element: string, charge: number | undefined): number {
  const base = VALENCE_LOOKUP[element] ?? 4;
  // Nitro groups are commonly represented as N+ and O-. Preserve that
  // valence state so the implicit-hydrogen pass does not create N-H/O-H.
  if (element === "N" || element === "O") return Math.max(0, base + (charge || 0));
  return base;
}

