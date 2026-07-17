import * as THREE from "three";
import type { MoleculeData, LabelDisplayMode } from "../types/molecule";
import { createAtomMesh, createAtomLabel, createBondGroup } from "./atoms";

/**
 * Build a Three.js scene group from molecule data
 */
export function buildMoleculeScene(
  molecule: MoleculeData,
  mode: "ball-and-stick" | "space-filling",
  labelMode: LabelDisplayMode = "always"
): THREE.Group {
  const group = new THREE.Group();
  group.name = "molecule";

  for (const atom of molecule.atoms) {
    group.add(createAtomMesh(atom, mode));
  }

  // Atom labels (ball-and-stick only, too cluttered in space-filling)
  if (mode === "ball-and-stick" && labelMode !== "never") {
    for (const atom of molecule.atoms) {
      if (atom.element !== "H") {
        const lbl = createAtomLabel(atom);
        if (labelMode === "hover") lbl.visible = false;
        group.add(lbl);
      }
    }
  }

  for (const bond of molecule.bonds) {
    const atom1 = molecule.atoms[bond.atom1Idx];
    const atom2 = molecule.atoms[bond.atom2Idx];
    if (atom1 && atom2) {
      group.add(createBondGroup(bond, atom1, atom2, mode));
    }
  }

  // In space-filling mode, bonds are hidden behind vdW spheres
  if (mode === "space-filling") {
    group.children.forEach((child) => {
      if (child.name.startsWith("bond-")) {
        child.visible = false;
      }
    });
  }

  return group;
}

/**
 * Rebuild the molecule scene inside an existing group
 */
export function updateMoleculeScene(
  sceneGroup: THREE.Group,
  molecule: MoleculeData,
  mode: "ball-and-stick" | "space-filling",
  labelMode: LabelDisplayMode = "always"
): void {
  // Only remove the "molecule" child group, preserving measurement and
  // coplanarity overlays that live as siblings inside sceneGroup.
  const oldGroup = sceneGroup.getObjectByName("molecule");
  if (oldGroup) {
    sceneGroup.remove(oldGroup);
    oldGroup.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        node.geometry?.dispose();
        if (Array.isArray(node.material)) {
          node.material.forEach((m) => m.dispose());
        } else {
          node.material?.dispose();
        }
      }
    });
  }

  // Add fresh molecule group
  const newGroup = buildMoleculeScene(molecule, mode, labelMode);
  sceneGroup.add(newGroup);
}

/**
 * Center molecule group origin so the molecule sits at (0,0,0)
 */
export function centerMolecule(sceneGroup: THREE.Group): void {
  const box = new THREE.Box3().setFromObject(sceneGroup);
  if (box.min.x === Infinity) return;
  const center = new THREE.Vector3();
  box.getCenter(center);
  sceneGroup.position.sub(center);
}
