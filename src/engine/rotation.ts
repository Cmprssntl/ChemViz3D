import * as THREE from "three";
import type { MoleculeData, AtomData, BondData } from "../types/molecule";

/**
 * Build an adjacency list from bonds: Map<atomIndex, Map<neighborIdx, bondData>>
 */
export function buildAdjacency(bonds: BondData[]): Map<number, Map<number, BondData>> {
  const adj = new Map<number, Map<number, BondData>>();
  for (const b of bonds) {
    if (!adj.has(b.atom1Idx)) adj.set(b.atom1Idx, new Map());
    if (!adj.has(b.atom2Idx)) adj.set(b.atom2Idx, new Map());
    adj.get(b.atom1Idx)!.set(b.atom2Idx, b);
    adj.get(b.atom2Idx)!.set(b.atom1Idx, b);
  }
  return adj;
}

/**
 * Build a simple adjacency list (just neighbors, no bond data)
 */
export function buildAdj(bonds: BondData[]): Map<number, number[]> {
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
 * Returns an array of rings, each ring being an array of atom indices in order.
 * Each ring appears only once, normalized (smallest index first, lex-smallest
 * of forward/reverse orientations).
 */
export function findRings(
  simpleAdj: Map<number, number[]>,
  maxSize = 20
): number[][] {
  const rings: number[][] = [];
  const seen = new Set<string>();
  const canonical = (cycle: number[]) => {
    const variants: string[] = [];
    for (const ordered of [cycle, [...cycle].reverse()]) {
      for (let offset = 0; offset < ordered.length; offset++) {
        variants.push([...ordered.slice(offset), ...ordered.slice(0, offset)].join(","));
      }
    }
    return variants.sort()[0];
  };
  const visit = (start: number, current: number, path: number[], used: Set<number>) => {
    const neighbors = [...(simpleAdj.get(current) || [])].sort((a, b) => a - b);
    for (const next of neighbors) {
      if (next === start) {
        if (path.length >= 3 && path.length <= maxSize) {
          const key = canonical(path);
          if (!seen.has(key)) {
            seen.add(key);
            rings.push([...path]);
          }
        }
        continue;
      }
      if (next < start || used.has(next) || path.length >= maxSize) continue;
      used.add(next);
      path.push(next);
      visit(start, next, path, used);
      path.pop();
      used.delete(next);
    }
  };

  for (const start of [...simpleAdj.keys()].sort((a, b) => a - b)) {
    visit(start, start, [start], new Set([start]));
  }
  return rings.sort((a, b) => a.length - b.length || canonical(a).localeCompare(canonical(b)));
}

/**
 * Build a set of ring bonds (as "atom1Idx,atom2Idx" key with min,max ordering).
 * Uses DFS to find all rings, then collects all bond pairs in those rings.
 */
export function buildRingBondSet(
  simpleAdj: Map<number, number[]>,
  bonds: BondData[]
): Set<string> {
  const rings = findRings(simpleAdj);

  const ringBonds = new Set<string>();
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const a = Math.min(ring[i], ring[(i + 1) % ring.length]);
      const b = Math.max(ring[i], ring[(i + 1) % ring.length]);
      ringBonds.add(a + "," + b);
    }
  }

  return ringBonds;
}

/**
 * BFS from `start` without crossing `blockedNode`.
 * Returns the set of reachable atom indices.
 */
function bfsSide(
  adj: Map<number, Map<number, BondData>>,
  start: number,
  blockedNode: number
): Set<number> {
  const visited = new Set<number>();
  const queue: number[] = [start];
  visited.add(start);
  while (queue.length > 0) {
    const current = queue.shift()!;
    const neighbors = adj.get(current);
    if (!neighbors) continue;
    for (const [neighbor] of neighbors) {
      if (neighbor === blockedNode) continue;
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
  }
  return visited;
}

/**
 * Apply a bond rotation to molecule data.
 *
 * @param molecule        The molecule to rotate (cloned internally)
 * @param bondAtom1Idx    Index of one atom in the bond
 * @param bondAtom2Idx    Index of the other atom in the bond
 * @param angleDeg        Rotation angle in degrees
 * @returns               New molecule with rotated atom positions
 */
export function applyBondRotation(
  molecule: MoleculeData,
  bondAtom1Idx: number,
  bondAtom2Idx: number,
  angleDeg: number
): MoleculeData {
  if (Math.abs(angleDeg) < 0.5) {
    return molecule;
  }

  const adj = buildAdjacency(molecule.bonds);

  // Find which side to rotate (the smaller fragment)
  const sideA = bfsSide(adj, bondAtom1Idx, bondAtom2Idx);
  const sideB = bfsSide(adj, bondAtom2Idx, bondAtom1Idx);

  let anchorIdx: number;
  let rotateIdx: number;
  let rotatingSet: Set<number>;

  if (sideA.size <= sideB.size) {
    anchorIdx = bondAtom2Idx;
    rotateIdx = bondAtom1Idx;
    rotatingSet = sideA;
  } else {
    anchorIdx = bondAtom1Idx;
    rotateIdx = bondAtom2Idx;
    rotatingSet = sideB;
  }

  // Remove the anchor itself and rotateIdx from the rotating set
  rotatingSet.delete(anchorIdx);
  rotatingSet.delete(rotateIdx);

  if (rotatingSet.size === 0) {
    return molecule;
  }

  const anchorAtom = molecule.atoms[anchorIdx];
  const rotateAtom = molecule.atoms[rotateIdx];
  const axis = new THREE.Vector3(
    anchorAtom.x - rotateAtom.x,
    anchorAtom.y - rotateAtom.y,
    anchorAtom.z - rotateAtom.z
  ).normalize();

  const angleRad = (angleDeg * Math.PI) / 180;
  const quat = new THREE.Quaternion().setFromAxisAngle(axis, angleRad);

  const newAtoms: AtomData[] = molecule.atoms.map((atom) => ({ ...atom }));

  for (const atomIdx of rotatingSet) {
    const atom = newAtoms[atomIdx];
    const rel = new THREE.Vector3(
      atom.x - rotateAtom.x,
      atom.y - rotateAtom.y,
      atom.z - rotateAtom.z
    );
    rel.applyQuaternion(quat);
    atom.x = rotateAtom.x + rel.x;
    atom.y = rotateAtom.y + rel.y;
    atom.z = rotateAtom.z + rel.z;
  }

  return {
    ...molecule,
    atoms: newAtoms,
  };
}

/**
 * Helper: deep-clone atom positions for snapshotting
 */
export function snapshotPositions(atoms: AtomData[]): Array<{ x: number; y: number; z: number }> {
  return atoms.map((a) => ({ x: a.x, y: a.y, z: a.z }));
}

/**
 * Restore atom positions from a snapshot
 */
export function restorePositions(
  molecule: MoleculeData,
  snapshot: Array<{ x: number; y: number; z: number }>
): MoleculeData {
  const newAtoms = molecule.atoms.map((a, i) => ({
    ...a,
    x: snapshot[i]?.x ?? a.x,
    y: snapshot[i]?.y ?? a.y,
    z: snapshot[i]?.z ?? a.z,
  }));
  return { ...molecule, atoms: newAtoms };
}
