import * as THREE from "three";

//  VSEPR geometry helpers 

const TET_ANGLE = 109.471; // degrees (arccos(-1/3))
const TET_RAD = THREE.MathUtils.degToRad(TET_ANGLE);

/**
 * Return `count` normalized direction vectors for substituents around a center,
 * given one fixed direction `toward` (e.g. towards a bonded neighbour).
 * Uses proper VSEPR geometry based on `count`:
 *   1  opposite direction       (linear, diatomic)
 *   2  180 apart               (linear, sp)
 *   3  120 in a plane          (trigonal planar, sp2)
 *   4  ~109.5 tetrahedral      (tetrahedral, sp3)
 */
export function vseprPositions(toward: THREE.Vector3, count: number): THREE.Vector3[] {
  if (count <= 0) return [];
  const d = toward.clone().normalize();

  if (count === 1) {
    // Single substituent  place directly opposite to `toward`
    return [d.clone().negate()];
  }

  if (count === 2) {
    // Linear (sp): pos[0]= -d (away), pos[1]= d (toward neighbour)
    const dnorm = d.clone().normalize();
    return [dnorm.clone().negate(), dnorm];
  }

  if (count === 3) {
    // Trigonal planar (sp2): pos[0..1] at 120d from d, pos[2] = d
    const perp = findPerp(d);
    const dnorm = d.clone().normalize();
    const c120 = -0.5, s120 = 0.8660254037844386;
    const positions: THREE.Vector3[] = [];
    for (let i = 0; i < 2; i++) {
      const ang = (i / 2) * Math.PI * 2;
      const rp = new THREE.Vector3().copy(perp).applyAxisAngle(dnorm, ang);
      positions.push(new THREE.Vector3().addScaledVector(dnorm, c120).addScaledVector(rp, s120).normalize());
    }
    positions.push(dnorm);
    return positions;
  }

  if (count === 4) {
    // Tetrahedral (sp3): 3 H's around the bond axis, at 109.47 from `d`
    const perp = findPerp(d);
    const cosT = Math.cos(TET_RAD);
    const sinT = Math.sin(TET_RAD);

    const positions: THREE.Vector3[] = [];
    for (let i = 0; i < 3; i++) {
      const angle = (i / 3) * Math.PI * 2;
      const rotPerp = new THREE.Vector3().copy(perp).applyAxisAngle(d, angle);
      const v = new THREE.Vector3()
        .addScaledVector(d, cosT)   // opposite direction of bond
        .addScaledVector(rotPerp, sinT);
      positions.push(v.normalize());
    }
    // The fourth position (opposite the 3 H's) is used by the bond partner
    // Add it too for completeness
    positions.push(d.clone().normalize());
    return positions;
  }

  return [];
}

/**
 * Tetrahedral positions for 4-equivalent substituents (e.g. CH?, CCl?).
 * All 4 are at 109.47 from each other.
 */
export function tetrahedralPositions(): THREE.Vector3[] {
  const raw: [number, number, number][] = [
    [1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1],
  ];
  return raw.map(([x, y, z]) => new THREE.Vector3(x, y, z).normalize());
}

/**
 * Find an arbitrary unit vector perpendicular to `v`.
 */
export function findPerp(v: THREE.Vector3): THREE.Vector3 {
  const absX = Math.abs(v.x), absY = Math.abs(v.y), absZ = Math.abs(v.z);
  const up = (absX <= absY && absX <= absZ)
    ? new THREE.Vector3(1, 0, 0)
    : (absY <= absZ ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1));
  return new THREE.Vector3().crossVectors(v, up).normalize();
}

//  Geometry helpers for the molecule builder 

export type Hybridization = "sp" | "sp2" | "sp3";

/**
 * Determine the carbon hybridization from bond info.
 */
export function carbonHybridization(
  atomIdx: number,
  bonds: ReadonlyArray<{ atom1Idx: number; atom2Idx: number; order: number }>
): Hybridization {
  const myBonds = bonds.filter((b) => b.atom1Idx === atomIdx || b.atom2Idx === atomIdx);
  let maxOrder = 1;
  for (const b of myBonds) {
    if (b.order > maxOrder) maxOrder = b.order;
  }
  if (maxOrder === 3) return "sp";
  if (maxOrder === 2) return "sp2";
  return "sp3";
}

/**
 * Get VSEPR angle for a given hybridization.
 */
export function hybridizationAngle(h: Hybridization): number {
  switch (h) {
    case "sp": return 180;
    case "sp2": return 120;
    case "sp3": return TET_ANGLE;
  }
}

/**
 * Generate `count` normalized vectors for VSEPR positions given hybridization.
 * The first position in the returned array is always the `toward` direction.
 */
export function vseprForHybridization(
  toward: THREE.Vector3,
  h: Hybridization,
  totalBonds: number
): THREE.Vector3[] {
  const substituents = totalBonds; // how many bonds this atom has (including heavy atom bonds)
  const hydrogensNeeded = substituents;

  if (h === "sp") {
    // Linear: 2 positions at 180
    const d = toward.clone().normalize();
    return [d.clone(), d.clone().negate()];
  }

  if (h === "sp2") {
    // Trigonal planar: 120 apart in a plane
    const d = toward.clone().normalize();
    const perp = findPerp(d);
    const pos: THREE.Vector3[] = [];
    for (let i = 0; i < substituents; i++) {
      const angle = (i / substituents) * Math.PI * 2;
      const v = new THREE.Vector3().copy(perp).applyAxisAngle(d, angle);
      pos.push(v.normalize());
    }
    return pos;
  }

  // sp3  tetrahedral
  if (substituents === 1) {
    return [toward.clone().normalize()];
  }
  if (substituents === 4) {
    return tetrahedralPositions();
  }
  // substituents = 2 or 3: one direction is toward, rest are tetrahedral positions
  const d = toward.clone().normalize();
  const perp = findPerp(d);
  const cosT = Math.cos(TET_RAD);
  const sinT = Math.sin(TET_RAD);
  const pos: THREE.Vector3[] = [d.clone()];

  for (let i = 0; i < substituents - 1; i++) {
    const angle = (i / (substituents - 1)) * Math.PI * 2;
    const rotPerp = new THREE.Vector3().copy(perp).applyAxisAngle(d, angle);
    const v = new THREE.Vector3()
      .addScaledVector(d, cosT)
      .addScaledVector(rotPerp, sinT);
    pos.push(v.normalize());
  }
  return pos;
}
