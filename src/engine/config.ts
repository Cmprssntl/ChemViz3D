// ============================================================
// Shared rendering & geometry constants
// ============================================================

export const ATOM_RADIUS_DIVISOR = 150;
export const ATOM_RADIUS_FLOOR = 0.08;

export const BOND_RADIUS_BALL = 0.09;
export const BOND_RADIUS_SPACE = 0.05;
export const BOND_EXT_FACTOR = 0.35;
export const BOND_EXT_CAP = 0.30;

export const CURVE_EP_OFF = 0.18;
export const CURVE_BULGE = 0.14;
export const CURVE_SEGMENTS = 10;
export const CURVE_RADIAL = 6;

// bond lengths (Angstrom)
export const BL_CC   = 1.54;
export const BL_CC2  = 1.34;
export const BL_CC3  = 1.20;
export const BL_CH   = 1.09;
export const BL_CO   = 1.43;
export const BL_CO2  = 1.20;
export const BL_CN   = 1.47;
export const BL_OH   = 0.96;
export const BL_NH   = 1.01;

export function atomRenderRadius(element: string): number {
  const tbl: Record<string, number> = {
    H:31, C:76, N:71, O:66, F:57, Cl:99, Br:114, I:133, S:103, P:107,
  };
  const r = tbl[element] ?? 76;
  return Math.max(ATOM_RADIUS_FLOOR, r / ATOM_RADIUS_DIVISOR);
}
