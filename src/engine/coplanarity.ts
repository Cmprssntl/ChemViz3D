import * as THREE from "three";
import type { BondData, MoleculeData } from "../types/molecule";
import { findRings } from "./rotation";

export type CoplanarFragmentType = "ring" | "alkene" | "carbonyl" | "chain" | "other";

export interface CoplanarSet {
  atomIndices: number[];
  type: CoplanarFragmentType;
  dihedralAngles?: number[];
  normal: THREE.Vector3;
  center: THREE.Vector3;
  /** Maximum point-to-plane distance in Angstroms. */
  deviation?: number;
  /** Maximum accepted deviation for this chemically meaningful fragment. */
  tolerance?: number;
  /** Number of bonds contained by the fragment. */
  continuity?: number;
}

function buildAdj(bonds: BondData[]): Map<number, number[]> {
  const adj = new Map<number, number[]>();
  for (const bond of bonds) {
    if (!adj.has(bond.atom1Idx)) adj.set(bond.atom1Idx, []);
    if (!adj.has(bond.atom2Idx)) adj.set(bond.atom2Idx, []);
    adj.get(bond.atom1Idx)!.push(bond.atom2Idx);
    adj.get(bond.atom2Idx)!.push(bond.atom1Idx);
  }
  for (const neighbors of adj.values()) neighbors.sort((a, b) => a - b);
  return adj;
}

function canonicalNormal(normal: THREE.Vector3): THREE.Vector3 {
  const result = normal.clone();
  if (result.lengthSq() < 1e-18) return new THREE.Vector3(0, 0, 1);
  result.normalize();
  const components = [Math.abs(result.x), Math.abs(result.y), Math.abs(result.z)];
  const dominant = components.indexOf(Math.max(...components));
  const signed = dominant === 0 ? result.x : dominant === 1 ? result.y : result.z;
  if (signed < 0) result.negate();
  return result;
}

/**
 * Compute the least-squares plane using the eigenvector belonging to the
 * smallest eigenvalue of the centered covariance matrix.
 */
export function bestFitPlane(positions: THREE.Vector3[]): { normal: THREE.Vector3; center: THREE.Vector3 } {
  if (positions.length === 0) {
    return { normal: new THREE.Vector3(0, 0, 1), center: new THREE.Vector3() };
  }

  const center = new THREE.Vector3();
  for (const position of positions) center.add(position);
  center.divideScalar(positions.length);
  if (positions.length < 3) return { normal: new THREE.Vector3(0, 0, 1), center };

  const covariance = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (const position of positions) {
    const d = [position.x - center.x, position.y - center.y, position.z - center.z];
    for (let row = 0; row < 3; row++) {
      for (let column = row; column < 3; column++) {
        covariance[row][column] += d[row] * d[column];
        if (row !== column) covariance[column][row] = covariance[row][column];
      }
    }
  }

  const vectors = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  for (let iteration = 0; iteration < 24; iteration++) {
    let p = 0;
    let q = 1;
    let largest = Math.abs(covariance[0][1]);
    if (Math.abs(covariance[0][2]) > largest) {
      p = 0; q = 2; largest = Math.abs(covariance[0][2]);
    }
    if (Math.abs(covariance[1][2]) > largest) {
      p = 1; q = 2; largest = Math.abs(covariance[1][2]);
    }
    if (largest < 1e-12) break;

    const app = covariance[p][p];
    const aqq = covariance[q][q];
    const apq = covariance[p][q];
    const tau = (aqq - app) / (2 * apq);
    const t = Math.sign(tau || 1) / (Math.abs(tau) + Math.sqrt(1 + tau * tau));
    const c = 1 / Math.sqrt(1 + t * t);
    const s = t * c;

    for (let k = 0; k < 3; k++) {
      if (k === p || k === q) continue;
      const akp = covariance[k][p];
      const akq = covariance[k][q];
      covariance[k][p] = covariance[p][k] = c * akp - s * akq;
      covariance[k][q] = covariance[q][k] = s * akp + c * akq;
    }
    covariance[p][p] = c * c * app - 2 * s * c * apq + s * s * aqq;
    covariance[q][q] = s * s * app + 2 * s * c * apq + c * c * aqq;
    covariance[p][q] = covariance[q][p] = 0;

    for (let k = 0; k < 3; k++) {
      const vkp = vectors[k][p];
      const vkq = vectors[k][q];
      vectors[k][p] = c * vkp - s * vkq;
      vectors[k][q] = s * vkp + c * vkq;
    }
  }

  let smallestIndex = 0;
  for (let index = 1; index < 3; index++) {
    if (covariance[index][index] < covariance[smallestIndex][smallestIndex] - 1e-12) {
      smallestIndex = index;
    }
  }
  return {
    normal: canonicalNormal(new THREE.Vector3(
      vectors[0][smallestIndex],
      vectors[1][smallestIndex],
      vectors[2][smallestIndex],
    )),
    center,
  };
}

export function dihedralAngle(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3): number {
  const v1 = new THREE.Vector3().subVectors(b, a);
  const v2 = new THREE.Vector3().subVectors(c, b);
  const v3 = new THREE.Vector3().subVectors(d, c);
  const n1 = new THREE.Vector3().crossVectors(v1, v2);
  const n2 = new THREE.Vector3().crossVectors(v2, v3);
  if (n1.lengthSq() < 1e-8 || n2.lengthSq() < 1e-8) return 0;
  n1.normalize();
  n2.normalize();
  return THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(n1.dot(n2), -1, 1)));
}

export function planarityDeviation(
  positions: THREE.Vector3[],
  planeNormal: THREE.Vector3,
  planeCenter: THREE.Vector3,
): number {
  const normal = planeNormal.clone();
  if (normal.lengthSq() < 1e-18) return Number.POSITIVE_INFINITY;
  normal.normalize();
  let maxDist = 0;
  for (const position of positions) {
    maxDist = Math.max(maxDist, Math.abs(position.clone().sub(planeCenter).dot(normal)));
  }
  return maxDist;
}

export function planarityRmsDeviation(
  positions: THREE.Vector3[],
  planeNormal: THREE.Vector3,
  planeCenter: THREE.Vector3,
): number {
  if (positions.length === 0) return 0;
  const normal = planeNormal.clone().normalize();
  const sum = positions.reduce((total, position) => {
    const distance = position.clone().sub(planeCenter).dot(normal);
    return total + distance * distance;
  }, 0);
  return Math.sqrt(sum / positions.length);
}

function fragmentContinuity(indices: number[], bonds: BondData[]): number {
  const members = new Set(indices);
  return bonds.reduce((count, bond) => count + (members.has(bond.atom1Idx) && members.has(bond.atom2Idx) ? 1 : 0), 0);
}

function makeFragment(
  atomIndices: number[],
  type: CoplanarFragmentType,
  molecule: MoleculeData,
  tolerance: number,
  dihedralAngles?: number[],
): CoplanarSet | null {
  const indices = [...new Set(atomIndices)].sort((a, b) => a - b);
  if (indices.length < 3) return null;
  const positions = indices.map((index) => {
    const atom = molecule.atoms[index];
    return new THREE.Vector3(atom.x, atom.y, atom.z);
  });
  const fit = bestFitPlane(positions);
  const deviation = planarityDeviation(positions, fit.normal, fit.center);
  if (deviation >= tolerance) return null;
  return {
    atomIndices: indices,
    type,
    dihedralAngles,
    normal: fit.normal,
    center: fit.center,
    deviation,
    tolerance,
    continuity: fragmentContinuity(indices, molecule.bonds),
  };
}

function detectPlanarChains(molecule: MoleculeData, adj: Map<number, number[]>): CoplanarSet[] {
  const results: CoplanarSet[] = [];
  const visited = new Set<string>();
  const PLANAR_TOL = 0.1;
  for (const bond of molecule.bonds) {
    const a = bond.atom1Idx;
    const c = bond.atom2Idx;
    for (const a2 of adj.get(a) || []) {
      if (a2 === c) continue;
      for (const c2 of adj.get(c) || []) {
        if (c2 === a || c2 === a2) continue;
        const chain = [a2, a, c, c2];
        const nHeavy = chain.reduce((sum, index) => sum + (molecule.atoms[index].element === "H" ? 0 : 1), 0);
        const isCOCenter = (molecule.atoms[a].element === "C" && molecule.atoms[c].element === "O")
          || (molecule.atoms[a].element === "O" && molecule.atoms[c].element === "C");
        const hydrogenCount = chain.length - nHeavy;
        const hasPlanarCenter = molecule.atoms[a].hybridization === "sp2"
          || molecule.atoms[c].hybridization === "sp2";
        if (nHeavy < 3 && !(nHeavy >= 2 && isCOCenter)) continue;
        // Several H-C(sp3)-C(sp3)-H combinations can each look planar in
        // isolation while the tetrahedral hydrogens are not coplanar with
        // one another. Keep multi-hydrogen chains only for the chemically
        // meaningful C-O case (methanol/acid) or when a central atom is sp2.
        if (hydrogenCount >= 2 && !isCOCenter && !hasPlanarCenter) continue;
        const positions = chain.map((index) => {
          const atom = molecule.atoms[index];
          return new THREE.Vector3(atom.x, atom.y, atom.z);
        });
        const dihedral = dihedralAngle(positions[0], positions[1], positions[2], positions[3]);
        if (Math.min(dihedral, 180 - dihedral) >= 5) continue;
        const indices = [...chain].sort((x, y) => x - y);
        const key = indices.join(",");
        if (visited.has(key)) continue;
        const fragment = makeFragment(indices, "chain", molecule, PLANAR_TOL, [dihedral]);
        if (fragment) {
          visited.add(key);
          results.push(fragment);
        }
      }
    }
  }
  return results;
}

function typePriority(type: CoplanarFragmentType): number {
  return type === "ring" ? 5 : type === "alkene" ? 4 : type === "carbonyl" ? 3 : type === "chain" ? 2 : 1;
}

export function detectPlanarFragments(molecule: MoleculeData): CoplanarSet[] {
  const atoms = molecule.atoms;
  const bonds = molecule.bonds;
  const adj = buildAdj(bonds);
  const fragments: CoplanarSet[] = [];

  for (const ring of findRings(adj)) {
    const fragment = makeFragment(ring, ring.length === 6 ? "ring" : "other", molecule, 0.12);
    if (fragment) fragments.push(fragment);
  }

  for (const bond of bonds) {
    if (bond.order !== 2) continue;
    const first = atoms[bond.atom1Idx];
    const second = atoms[bond.atom2Idx];
    if (first.element === "C" && second.element === "C") {
      const indices = [bond.atom1Idx, bond.atom2Idx, ...(adj.get(bond.atom1Idx) || []).filter((i) => i !== bond.atom2Idx), ...(adj.get(bond.atom2Idx) || []).filter((i) => i !== bond.atom1Idx)];
      const fragment = makeFragment(indices, "alkene", molecule, 0.12);
      if (fragment) fragments.push(fragment);
    }
    const carbonIndex = first.element === "C" ? bond.atom1Idx : second.element === "C" ? bond.atom2Idx : -1;
    const oxygenIndex = first.element === "O" ? bond.atom1Idx : second.element === "O" ? bond.atom2Idx : -1;
    if (carbonIndex >= 0 && oxygenIndex >= 0) {
      const indices = [carbonIndex, oxygenIndex, ...(adj.get(carbonIndex) || []).filter((i) => i !== oxygenIndex)];
      const fragment = makeFragment(indices, "carbonyl", molecule, 0.12);
      if (fragment) fragments.push(fragment);
    }
  }
  fragments.push(...detectPlanarChains(molecule, adj));

  const byAtoms = new Map<string, CoplanarSet>();
  for (const fragment of fragments) {
    const key = fragment.atomIndices.join(",");
    const previous = byAtoms.get(key);
    if (!previous || typePriority(fragment.type) > typePriority(previous.type)
      || (typePriority(fragment.type) === typePriority(previous.type)
        && (fragment.deviation ?? Infinity) < (previous.deviation ?? Infinity))) {
      byAtoms.set(key, fragment);
    }
  }
  return [...byAtoms.values()].sort((a, b) => b.atomIndices.length - a.atomIndices.length || a.atomIndices[0] - b.atomIndices[0]);
}
