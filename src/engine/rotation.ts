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
  const visited = new Set<number>();

  function dfs(start: number, current: number, path: number[]) {
    visited.add(current);
    const neighbors = simpleAdj.get(current) || [];
    for (const next of neighbors) {
      if (next === start && path.length >= 3 && path.length <= maxSize) {
        const ring = [...path];
        const minIdx = ring.indexOf(Math.min(...ring));
        const fwd = [...ring.slice(minIdx), ...ring.slice(0, minIdx)];
        // Compute normalized reverse to deduplicate rings found in
        // opposite traversal directions (e.g. [0,1,2,3,4,5] and [0,5,4,3,2,1]
        // are the same physical ring traversed in opposite directions).
        const revRaw = [...fwd].reverse();
        const revMinIdx = revRaw.indexOf(Math.min(...revRaw));
        const rev = [...revRaw.slice(revMinIdx), ...revRaw.slice(0, revMinIdx)];
        const fwdKey = fwd.join(",");
        const revKey = rev.join(",");
        const canonicalKey = fwdKey < revKey ? fwdKey : revKey;
        if (!rings.some((r) => r.join(",") === canonicalKey)) {
          rings.push(fwd);
        }
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

  for (const [node] of simpleAdj) {
    visited.clear();
    if (!rings.some((r) => r.includes(node))) {
      dfs(node, node, [node]);
    }
  }

  return rings;
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
