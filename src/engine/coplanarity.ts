import * as THREE from "three";
import type { AtomData, BondData, MoleculeData } from "../types/molecule";

export interface CoplanarSet {
  /** Atom indices in this planar fragment */
  atomIndices: number[];
  /** The type of planar fragment */
  type: "ring" | "alkene" | "carbonyl" | "chain" | "other";
  /** Dihedral angles between consecutive 4-atom sets (degrees) */
  dihedralAngles?: number[];
  /** Normal vector of the best-fit plane */
  normal: THREE.Vector3;
  /** Center of the fragment */
  center: THREE.Vector3;
}

// ©¤©¤ graph helpers ©¤©¤

function buildAdj(bonds: BondData[]): Map<number, number[]> {
  const adj = new Map<number, number[]>();
  for (const b of bonds) {
    if (!adj.has(b.atom1Idx)) adj.set(b.atom1Idx, []);
    if (!adj.has(b.atom2Idx)) adj.set(b.atom2Idx, []);
    adj.get(b.atom1Idx)!.push(b.atom2Idx);
    adj.get(b.atom2Idx)!.push(b.atom1Idx);
  }
  return adj;
}

/**
 * Find all simple cycles (rings) in the graph using DFS backtracking.
 */
function findRings(adj: Map<number, number[]>, maxSize = 8): number[][] {
  const rings: number[][] = [];
  const visited = new Set<number>();

  function dfs(start: number, current: number, path: number[]) {
    visited.add(current);
    const neighbors = adj.get(current) || [];
    for (const next of neighbors) {
      if (next === start && path.length >= 3 && path.length <= maxSize) {
        const ring = [...path];
        const minIdx = ring.indexOf(Math.min(...ring));
        const normalized = [...ring.slice(minIdx), ...ring.slice(0, minIdx)];
        const key = normalized.join(",");
        if (!rings.some((r) => r.join(",") === key)) rings.push(normalized);
      } else if (!visited.has(next) && path.length < maxSize && next > start) {
        if (next > start || !path.includes(next)) {
          path.push(next);
          dfs(start, next, path);
          path.pop();
        }
      }
    }
    visited.delete(current);
  }

  for (const [node] of adj) {
    visited.clear();
    if (!rings.some((r) => r.includes(node))) dfs(node, node, [node]);
  }
  return rings;
}

/**
 * Compute best-fit plane for a set of positions.
 */
export function bestFitPlane(positions: THREE.Vector3[]): { normal: THREE.Vector3; center: THREE.Vector3 } {
  const n = positions.length;
  if (n < 3) return { normal: new THREE.Vector3(0, 0, 1), center: new THREE.Vector3(0, 0, 0) };

  const center = new THREE.Vector3();
  for (const p of positions) center.add(p);
  center.divideScalar(n);

  let xx = 0, xy = 0, xz = 0, yy = 0, yz = 0, zz = 0;
  for (const p of positions) {
    const dx = p.x - center.x, dy = p.y - center.y, dz = p.z - center.z;
    xx += dx * dx; xy += dx * dy; xz += dx * dz;
    yy += dy * dy; yz += dy * dz;
    zz += dz * dz;
  }

  const v1 = new THREE.Vector3(xx, xy, xz);
  const v2 = new THREE.Vector3(xy, yy, yz);

  // Handle degenerate case: data lies in a coordinate-aligned plane
  // e.g. all atoms have y=0 ¡ú v2 ¡Ö (0,0,0) ¡ú cross(v1, v2) = (0,0,0)
  // This causes downstream merging failures since angleTo on zero vectors returns NaN.
  // The normal should be the axis corresponding to the zero row.
  const EPS = 0.0001;
  const v1Len = v1.length();
  const v2Len = v2.length();

  if (v1Len < EPS) {
    // No x-variation ¡ú normal is along x-axis
    return { normal: new THREE.Vector3(1, 0, 0), center };
  }
  if (v2Len < EPS) {
    // No y-variation ¡ú normal is along y-axis
    return { normal: new THREE.Vector3(0, 1, 0), center };
  }
  // Also check zz indirectly: if cross(v1, v2) has near-zero x,y components
  // and zz is near-zero, the plane is the xy-plane ¡ú normal along z-axis.
  // But cross(v1, v2) for 2D data in xy-plane would give some z-value
  // only if v1 and v2 aren't collinear. For truly 2D xy data (all z=0),
  // v1 = (xx, xy, 0), v2 = (xy, yy, 0), cross = (0, 0, det).
  // So zz=0 won't break cross. We only need to guard v1Len¡Ö0 and v2Len¡Ö0.

  return { normal: new THREE.Vector3().crossVectors(v1, v2).normalize(), center };
}

/**
 * Compute dihedral angle (0-180) between 4 points: a-b-c-d
 */
export function dihedralAngle(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3): number {
  const v1 = new THREE.Vector3().subVectors(b, a);
  const v2 = new THREE.Vector3().subVectors(c, b);
  const v3 = new THREE.Vector3().subVectors(d, c);
  const n1 = new THREE.Vector3().crossVectors(v1, v2);
  const n2 = new THREE.Vector3().crossVectors(v2, v3);

  // Degenerate case: three consecutive atoms are collinear
  // (e.g. C-C=O all along x-axis). Dihedral is undefined but
  // the four-atom chain is always planar.
  if (n1.length() < 0.0001 || n2.length() < 0.0001) {
    return 0;
  }

  n1.normalize();
  n2.normalize();
  const cosA = THREE.MathUtils.clamp(n1.dot(n2), -1, 1);
  return THREE.MathUtils.radToDeg(Math.acos(cosA));
}

function planarityDeviation(positions: THREE.Vector3[], planeNormal: THREE.Vector3, planeCenter: THREE.Vector3): number {
  let maxDist = 0;
  for (const p of positions) {
    const vec = new THREE.Vector3().subVectors(p, planeCenter);
    const dist = Math.abs(vec.dot(planeNormal));
    if (dist > maxDist) maxDist = dist;
  }
  return maxDist;
}

/**
 * Find genuinely planar 4-atom chains (consecutive dihedral near 0/180 deg).
 * ? Does NOT include 3-atom chains.
 */
function detectPlanarChains(atoms: any[], bonds: any[], adj: Map<number, number[]>): CoplanarSet[] {
  const results: CoplanarSet[] = [];
  const visited = new Set<string>();
  const DIHEDRAL_THRESHOLD = 15;

  for (const b of bonds) {
    const a = b.atom1Idx;
    const c = b.atom2Idx;
    const aNeighbors = adj.get(a) || [];
    const cNeighbors = adj.get(c) || [];

    for (const a2 of aNeighbors) {
      if (a2 === c) continue;
      for (const c2 of cNeighbors) {
        if (c2 === a || c2 === a2) continue;
        // Chain: a2 - a - c - c2 (4 consecutive atoms)
        const p1 = new THREE.Vector3(atoms[a2].x, atoms[a2].y, atoms[a2].z);
        const p2 = new THREE.Vector3(atoms[a].x, atoms[a].y, atoms[a].z);
        const p3 = new THREE.Vector3(atoms[c].x, atoms[c].y, atoms[c].z);
        const p4 = new THREE.Vector3(atoms[c2].x, atoms[c2].y, atoms[c2].z);

        const dihedralVal = dihedralAngle(p1, p2, p3, p4);
        const planarity = Math.min(dihedralVal, 180 - dihedralVal);

        if (planarity < DIHEDRAL_THRESHOLD) {
          const indices = [a2, a, c, c2].sort((x, y) => x - y);
          const key = indices.join(',');
          if (!visited.has(key)) {
            visited.add(key);
            const positions = indices.map(i => new THREE.Vector3(atoms[i].x, atoms[i].y, atoms[i].z));
            const clusterCenter = new THREE.Vector3();
            for (const p of positions) clusterCenter.add(p);
            clusterCenter.divideScalar(positions.length);
            const va = new THREE.Vector3().subVectors(positions[1], positions[0]);
            const vb = new THREE.Vector3().subVectors(positions[2], positions[0]);
            const nml = new THREE.Vector3().crossVectors(va, vb).normalize();
            results.push({ atomIndices: indices, type: 'chain', normal: nml, center: clusterCenter });
          }
        }
      }
    }
  }
  return results;
}

/**
 * Detect all planar fragments in a molecule.
 *
 * Algorithm:
 * 1. Rings with planarity deviation < 0.5
 * 2. C=C alkene fragments (planar sp2 system)
 * 3. C=O carbonyl fragments (planar sp2 system) ¡ª NEW
 * 4. Genuinely planar 4-atom chains (dihedral < 15¡ã)
 * ? 3-atom chains are NOT included.
 */
export function detectPlanarFragments(molecule: MoleculeData): CoplanarSet[] {
  const atoms = molecule.atoms;
  const bonds = molecule.bonds;
  const adj = buildAdj(bonds);
  const results: CoplanarSet[] = [];

  // 1. Ring detection
  const rings = findRings(adj);
  for (const ring of rings) {
    const positions = ring.map((idx) => new THREE.Vector3(atoms[idx].x, atoms[idx].y, atoms[idx].z));
    if (positions.length < 3) continue;
    const { normal, center } = bestFitPlane(positions);
    const deviation = planarityDeviation(positions, normal, center);
    if (deviation < 0.5) {
      const angles: number[] = [];
      for (let i = 0; i < ring.length; i++) {
        angles.push(dihedralAngle(
          new THREE.Vector3(atoms[ring[i]].x, atoms[ring[i]].y, atoms[ring[i]].z),
          new THREE.Vector3(atoms[ring[(i+1)%ring.length]].x, atoms[ring[(i+1)%ring.length]].y, atoms[ring[(i+1)%ring.length]].z),
          new THREE.Vector3(atoms[ring[(i+2)%ring.length]].x, atoms[ring[(i+2)%ring.length]].y, atoms[ring[(i+2)%ring.length]].z),
          new THREE.Vector3(atoms[ring[(i+3)%ring.length]].x, atoms[ring[(i+3)%ring.length]].y, atoms[ring[(i+3)%ring.length]].z)
        ));
      }
      results.push({ atomIndices: ring, type: ring.length === 6 ? "ring" : "other", dihedralAngles: angles, normal, center });
    }
  }

  // 2. C=C alkene planar detection
  for (const bond of bonds) {
    if (bond.order !== 2) continue;
    const a1 = atoms[bond.atom1Idx];
    const a2 = atoms[bond.atom2Idx];
    if (a1.element !== "C" || a2.element !== "C") continue;

    const subs1 = (adj.get(bond.atom1Idx) || []).filter((n) => n !== bond.atom2Idx);
    const subs2 = (adj.get(bond.atom2Idx) || []).filter((n) => n !== bond.atom1Idx);
    const allIndices = [bond.atom1Idx, bond.atom2Idx, ...subs1, ...subs2];
    const positions = allIndices.map((idx) => new THREE.Vector3(atoms[idx].x, atoms[idx].y, atoms[idx].z));
    if (positions.length >= 3) {
      const { normal, center } = bestFitPlane(positions);
      if (planarityDeviation(positions, normal, center) < 0.5) {
        results.push({ atomIndices: allIndices, type: "alkene", normal, center });
      }
    }
  }

  // 3. C=O carbonyl planar detection (new!)
  // Carbonyl carbon is sp2: C and bonded atoms are planar
  for (const bond of bonds) {
    if (bond.order !== 2) continue;
    const a1 = atoms[bond.atom1Idx];
    const a2 = atoms[bond.atom2Idx];
    // C=O check (carbonyl)
    const cIdx = a1.element === "C" ? bond.atom1Idx : (a2.element === "C" ? bond.atom2Idx : -1);
    const oIdx = a1.element === "O" ? bond.atom1Idx : (a2.element === "O" ? bond.atom2Idx : -1);
    if (cIdx < 0 || oIdx < 0) continue;

    // Find all atoms bonded to the carbonyl C (including the carbonyl O)
    const cNeighbors = adj.get(cIdx) || [];
    // All neighbors of C + C itself = planar
    const planarSet = [cIdx, ...cNeighbors.filter(n => n !== oIdx), oIdx];
    // Also include the O neighbor's other neighbors (like -OH)
    // But O-H is at ~104¡ã from plane, so skip
    const positions = planarSet.map((idx) => new THREE.Vector3(atoms[idx].x, atoms[idx].y, atoms[idx].z));
    if (positions.length >= 3) {
      const { normal, center } = bestFitPlane(positions);
      if (planarityDeviation(positions, normal, center) < 0.5) {
        results.push({ atomIndices: planarSet, type: "carbonyl", normal, center });
      }
    }
  }

  // 4. Planar 4-atom chains (NOT 3-atom chains)
  const chains = detectPlanarChains(atoms, bonds, adj);
  results.push(...chains);

  // Remove duplicates
  const seen = new Set<string>();
  return results.filter((r) => {
    const key = [...r.atomIndices].sort((a, b) => a - b).join(",");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

