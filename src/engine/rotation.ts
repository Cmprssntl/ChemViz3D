import * as THREE from "three";
import type { MoleculeData, AtomData } from "../types/molecule";
import { MolecularGraph } from "../domain/graph/MolecularGraph";

/** Canonical graph for a molecule. Every geometry feature shares this one. */
export function graphOf(molecule: MoleculeData): MolecularGraph {
  return new MolecularGraph(
    molecule.atoms.length,
    molecule.bonds.map((bond) => ({
      index: bond.index,
      a: bond.atom1Idx,
      b: bond.atom2Idx,
      order: bond.order,
    })),
  );
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

  const graph = graphOf(molecule);
  const bond = graph.bonds.find(
    (candidate) =>
      (candidate.a === bondAtom1Idx && candidate.b === bondAtom2Idx)
      || (candidate.a === bondAtom2Idx && candidate.b === bondAtom1Idx),
  );
  if (!bond) return molecule;

  const side = graph.sideOf(bond);
  if (!side) return molecule;

  const anchorAtom = molecule.atoms[side.anchor];
  const rotateAtom = molecule.atoms[side.rotor];
  if (!anchorAtom || !rotateAtom) return molecule;

  const axis = new THREE.Vector3(
    anchorAtom.x - rotateAtom.x,
    anchorAtom.y - rotateAtom.y,
    anchorAtom.z - rotateAtom.z
  ).normalize();

  const angleRad = (angleDeg * Math.PI) / 180;
  const quat = new THREE.Quaternion().setFromAxisAngle(axis, angleRad);

  const newAtoms: AtomData[] = molecule.atoms.map((atom) => ({ ...atom }));
  for (const atomIdx of side.atoms) {
    const atom = newAtoms[atomIdx];
    if (!atom) continue;
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
