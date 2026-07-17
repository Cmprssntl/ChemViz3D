import * as THREE from "three";
import type { MoleculeData, BondData } from "../types/molecule";

// ── Graph helpers ──

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
function findRings(adj: Map<number, number[]>, maxSize = 8): Set<string> {
  const ringSet = new Set<string>();
  const visited = new Set<number>();

  function dfs(start: number, current: number, path: number[]) {
    visited.add(current);
    const neighbors = adj.get(current) || [];
    for (const next of neighbors) {
      if (next === start && path.length >= 3 && path.length <= maxSize) {
        // Found a cycle back to start — canonicalize
        const ring = [...path];
        const minIdx = ring.indexOf(Math.min(...ring));
        const normalized = [...ring.slice(minIdx), ...ring.slice(0, minIdx)].join(",");
        ringSet.add(normalized);
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
    dfs(node, node, [node]);
  }

  return ringSet;
}

/**
 * Build a set of bonds that are part of any ring (as "atom1Idx,atom2Idx" key).
 */
function buildRingBondSet(adj: Map<number, number[]>, bonds: BondData[]): Set<string> {
  const rings = findRings(adj);
  const ringBonds = new Set<string>();

  for (const ringStr of rings) {
    const ring = ringStr.split(",").map(Number);
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      // Normalize key
      const key = Math.min(a, b) + "," + Math.max(a, b);
      ringBonds.add(key);
    }
  }

  return ringBonds;
}

function bfs(adj: Map<number, number[]>, start: number, blocked: number): Set<number> {
  const visited = new Set<number>([start]);
  const q: number[] = [start];
  while (q.length) {
    const cur = q.shift()!;
    for (const n of adj.get(cur) || []) {
      if (n !== blocked && !visited.has(n)) { visited.add(n); q.push(n); }
    }
  }
  return visited;
}

/**
 * For each rotatable C-C single bond NOT in a ring, find the rotation angle that
 * maximises the minimum distance between the two fragments.
 *
 * ⚠ Ring bonds are skipped to avoid breaking cyclic structures (e.g. benzene).
 */
export function optimizeConformation(mol: MoleculeData): MoleculeData {
  let cur = mol;
  const adj = buildAdj(cur.bonds);
  const ringBonds = buildRingBondSet(adj, cur.bonds);

  const bonds = cur.bonds.filter((b) => {
    if (b.order !== 1) return false;
    // Skip ring bonds!
    const key = Math.min(b.atom1Idx, b.atom2Idx) + "," + Math.max(b.atom1Idx, b.atom2Idx);
    if (ringBonds.has(key)) return false;
    const a1 = cur.atoms[b.atom1Idx], a2 = cur.atoms[b.atom2Idx];
    return (a1.element === "C" && a2.element === "C") ||
           (a1.element === "C" && a2.element === "O") ||
           (a1.element === "O" && a2.element === "C");
  });

  for (const bond of bonds) {
    const i1 = bond.atom1Idx, i2 = bond.atom2Idx;
    const sA = bfs(adj, i1, i2);
    const sB = bfs(adj, i2, i1);

    const rotSmall = sA.size <= sB.size;
    const ancIdx = rotSmall ? i2 : i1;
    const rotIdx = rotSmall ? i1 : i2;
    const rotSet = new Set(rotSmall ? sA : sB);
    rotSet.delete(ancIdx);
    rotSet.delete(rotIdx);
    if (rotSet.size === 0) continue;

    // Exclude atoms within 2 bonds (steric evaluation)
    const exclude = new Set<number>([ancIdx, rotIdx]);
    for (const ri of rotSet) {
      exclude.add(ri);
      for (const n of adj.get(ri) || []) {
        exclude.add(n);
        for (const n2 of adj.get(n) || []) {
          if (!rotSet.has(n2)) exclude.add(n2);
        }
      }
    }

    const fixed: number[] = [];
    for (const a of cur.atoms) {
      if (!exclude.has(a.index)) fixed.push(a.index);
    }
    if (fixed.length === 0) continue;

    const bA = cur.bonds.filter((b) => b.atom1Idx === ancIdx || b.atom2Idx === ancIdx);
    const bB = cur.bonds.filter((b) => b.atom1Idx === rotIdx || b.atom2Idx === rotIdx);
    const sp3 = Math.max(...bA.map((b) => b.order), 1) === 1 &&
                Math.max(...bB.map((b) => b.order), 1) === 1;
    const step = sp3 ? 30 : 15;
    const maxAng = sp3 ? 120 : 360;

    let bestAng = 0, bestScore = 0;

    const anc = cur.atoms[ancIdx];
    const rot = cur.atoms[rotIdx];
    const axis = new THREE.Vector3(anc.x - rot.x, anc.y - rot.y, anc.z - rot.z).normalize();

    for (let ang = 0; ang <= maxAng; ang += step) {
      if (Math.abs(ang) < 0.5) continue;
      const quat = new THREE.Quaternion().setFromAxisAngle(axis, (ang * Math.PI) / 180);

      const rPos = new Map<number, THREE.Vector3>();
      for (const ri of rotSet) {
        const a = cur.atoms[ri];
        const rel = new THREE.Vector3(a.x - rot.x, a.y - rot.y, a.z - rot.z);
        rel.applyQuaternion(quat);
        rPos.set(ri, new THREE.Vector3(rot.x + rel.x, rot.y + rel.y, rot.z + rel.z));
      }

      let minDist = Infinity;
      for (const [ri, rv] of rPos) {
        for (const fi of fixed) {
          const fa = cur.atoms[fi];
          if (ri === fi) continue;
          const dx = rv.x - fa.x, dy = rv.y - fa.y, dz = rv.z - fa.z;
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (d < minDist) minDist = d;
        }
      }

      if (minDist > bestScore) { bestScore = minDist; bestAng = ang; }
    }

    if (bestAng !== 0) {
      cur = applyBondRotation(cur, rotIdx, ancIdx, bestAng);
    }
  }

  return cur;
}

function applyBondRotation(
  mol: MoleculeData, rotIdx: number, ancIdx: number, angleDeg: number
): MoleculeData {
  const anc = mol.atoms[ancIdx], rot = mol.atoms[rotIdx];
  const axis = new THREE.Vector3(anc.x - rot.x, anc.y - rot.y, anc.z - rot.z).normalize();
  const quat = new THREE.Quaternion().setFromAxisAngle(axis, (angleDeg * Math.PI) / 180);

  const adj = buildAdj(mol.bonds);
  const side = bfs(adj, rotIdx, ancIdx);
  side.delete(ancIdx);
  side.delete(rotIdx);
  if (side.size === 0) return mol;

  const newAtoms = mol.atoms.map((a) => ({ ...a }));
  for (const idx of side) {
    const rel = new THREE.Vector3(newAtoms[idx].x - rot.x, newAtoms[idx].y - rot.y, newAtoms[idx].z - rot.z);
    rel.applyQuaternion(quat);
    newAtoms[idx].x = rot.x + rel.x;
    newAtoms[idx].y = rot.y + rel.y;
    newAtoms[idx].z = rot.z + rel.z;
  }
  return { ...mol, atoms: newAtoms };
}
