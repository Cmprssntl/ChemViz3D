import * as THREE from "three";
import type { AtomData, BondData, DisplayMode, LabelDisplayMode, MoleculeData } from "../../types/molecule";
import { createBondGroup } from "../atoms";
import { MeshResources } from "./MeshResources";
import { atomRenderRadius } from "../config";

interface BondEntry {
  bond: BondData;
  group: THREE.Group;
}

/**
 * Owns the three.js representation of one molecule.
 *
 * `sync` reuses atom spheres and label sprites when only coordinates changed
 * (bond rotation, conformer search) and rebuilds just the bond cylinders, so
 * dragging a torsional angle no longer recreates hundreds of sphere geometries
 * and canvas textures per frame. Topology or display-mode changes still rebuild
 * the whole group, because radii and label visibility change with them.
 */
export class MoleculeScene {
  readonly group = new THREE.Group();
  private atomMeshes: THREE.Mesh[] = [];
  private labels: THREE.Sprite[] = [];
  private bonds: BondEntry[] = [];
  private signature = "";
  private mode: DisplayMode = "ball-and-stick";
  private readonly resources = new MeshResources();

  constructor() {
    this.group.name = "molecule";
  }

  /** Returns true when the whole group was rebuilt. */
  sync(molecule: MoleculeData, mode: DisplayMode, labelMode: LabelDisplayMode): boolean {
    const signature = MoleculeScene.signatureOf(molecule, mode, labelMode);
    if (signature === this.signature) {
      this.updatePositions(molecule);
      return false;
    }
    this.rebuild(molecule, mode, labelMode);
    this.signature = signature;
    return true;
  }

  dispose(): void {
    this.clearChildren();
    this.resources.dispose();
    this.signature = "";
  }

  private static signatureOf(molecule: MoleculeData, mode: DisplayMode, labelMode: LabelDisplayMode): string {
    const atoms = molecule.atoms.map((atom) => atom.element).join(",");
    const bonds = molecule.bonds.map((bond) => `${bond.atom1Idx}-${bond.atom2Idx}:${bond.order}`).join(",");
    return `${mode}|${labelMode}|${atoms}|${bonds}`;
  }

  private rebuild(molecule: MoleculeData, mode: DisplayMode, labelMode: LabelDisplayMode): void {
    this.clearChildren();
    this.mode = mode;
    this.atomMeshes = molecule.atoms.map((atom) => {
      const mesh = this.resources.atomMesh(atom, mode);
      this.group.add(mesh);
      return mesh;
    });

    const showLabels = mode === "ball-and-stick" && labelMode !== "never";
    this.labels = [];
    if (showLabels) {
      for (const atom of molecule.atoms) {
        if (atom.element === "H") continue;
        const label = this.resources.label(atom);
        if (labelMode === "hover") label.visible = false;
        this.group.add(label);
        this.labels.push(label);
      }
    }

    this.buildBonds(molecule);
  }

  private buildBonds(molecule: MoleculeData): void {
    // In space-filling mode the vdW spheres hide the bonds, so they are built
    // once (for picking) and kept invisible.
    const visible = this.mode === "ball-and-stick";
    for (const bond of molecule.bonds) {
      const first = molecule.atoms[bond.atom1Idx];
      const second = molecule.atoms[bond.atom2Idx];
      if (!first || !second) continue;
      const group = createBondGroup(bond, first, second, this.mode);
      group.visible = visible;
      this.group.add(group);
      this.bonds.push({ bond, group });
    }
  }

  private updatePositions(molecule: MoleculeData): void {
    this.atomMeshes.forEach((mesh, position) => {
      const atom = molecule.atoms[position];
      if (atom) mesh.position.set(atom.x, atom.y, atom.z);
    });
    for (const label of this.labels) {
      const atom = molecule.atoms[label.userData.atomIndex as number];
      if (!atom) continue;
      const radius = atomRenderRadius(atom.element);
      label.position.set(atom.x, atom.y + radius + 0.25, atom.z);
    }
    this.refreshBonds(molecule);
  }

  /**
   * Bond cylinders are cheap compared to sphere geometries, and multi-bond
   * tubes bake their curve into the geometry, so they are rebuilt rather than
   * stretched. Single-bond cylinders could be scaled, but keeping one code path
   * avoids a class of subtle orientation bugs.
   */
  private refreshBonds(molecule: MoleculeData): void {
    for (const entry of this.bonds) {
      this.group.remove(entry.group);
      disposeTree(entry.group);
    }
    this.bonds = [];
    this.buildBonds(molecule);
  }

  private clearChildren(): void {
    for (const child of [...this.group.children]) {
      this.group.remove(child);
      disposeTree(child);
    }
    this.atomMeshes = [];
    this.labels = [];
    this.bonds = [];
  }
}

function disposeTree(root: THREE.Object3D): void {
  root.traverse((node) => {
    // Atom meshes and labels share cached geometry/material/texture; the cache
    // owns them and frees them in MeshResources.dispose().
    if (node.userData?.shared) return;
    if (node instanceof THREE.Sprite) {
      const material = node.material;
      material.map?.dispose();
      material.dispose();
      return;
    }
    if (!(node instanceof THREE.Mesh)) return;
    node.geometry?.dispose();
    const material = node.material;
    if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
    else material?.dispose();
  });
}
