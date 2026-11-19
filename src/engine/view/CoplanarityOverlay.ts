import * as THREE from "three";
import type { MoleculeData } from "../../types/molecule";
import { bestFitPlane, detectPlanarFragments } from "../coplanarity";
import { countMaxPlanarAtoms } from "../conformerSearch";

const GROUP_NAME = "coplanarity-hints";

interface IndicatorStyle {
  color: number;
  planeOpacity: number;
  ringOpacity: number;
}

const STYLES: Record<string, IndicatorStyle> = {
  ring: { color: 0x44aaff, planeOpacity: 0.18, ringOpacity: 0.5 },
  alkene: { color: 0xffaa44, planeOpacity: 0.18, ringOpacity: 0.5 },
  carbonyl: { color: 0x88dd44, planeOpacity: 0.18, ringOpacity: 0.5 },
  chain: { color: 0x44dddd, planeOpacity: 0.12, ringOpacity: 0.45 },
  other: { color: 0x888888, planeOpacity: 0.18, ringOpacity: 0.5 },
  trivial: { color: 0x888888, planeOpacity: 0.06, ringOpacity: 0.25 },
};

/**
 * Draws the coplanarity hint (plane, wireframe and per-atom rings) for the
 * largest planar fragment. Kept out of the viewer component so the component
 * stays a thin wrapper around the scene lifecycle.
 */
export function addCoplanarityIndicators(sceneGroup: THREE.Group, molecule: MoleculeData): void {
  clearCoplanarityIndicators(sceneGroup);

  const selection = selectAtoms(molecule);
  if (!selection) return;
  const { atomIndices, styleKey } = selection;
  const style = STYLES[styleKey] ?? STYLES.other;

  const positions = atomIndices.map((index) => {
    const atom = molecule.atoms[index];
    return new THREE.Vector3(atom.x, atom.y, atom.z);
  });
  const { normal, center } = bestFitPlane(positions);
  let maxDistance = 1.5;
  for (const position of positions) {
    maxDistance = Math.max(maxDistance, position.distanceTo(center));
  }

  const group = new THREE.Group();
  group.name = GROUP_NAME;
  const planeSize = maxDistance * 2.2;
  const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);

  group.add(createPlane(planeSize, style.color, style.planeOpacity, center, quaternion));
  group.add(createWireframe(planeSize, style.color, style.planeOpacity, center, quaternion));
  for (const position of positions) {
    group.add(createAtomRing(position, style.color, style.ringOpacity, quaternion));
  }
  sceneGroup.add(group);
}

export function clearCoplanarityIndicators(sceneGroup: THREE.Group): void {
  const existing = sceneGroup.getObjectByName(GROUP_NAME);
  if (!existing) return;
  existing.parent?.remove(existing);
  existing.traverse((node) => {
    if (node instanceof THREE.Mesh) {
      node.geometry?.dispose();
      (node.material as THREE.Material)?.dispose();
    }
  });
}

function selectAtoms(molecule: MoleculeData): { atomIndices: number[]; styleKey: string } | null {
  const fragments = detectPlanarFragments(molecule);
  const meaningful = fragments.filter((fragment) => fragment.type !== "chain");
  if (meaningful.length > 0) {
    const largest = [...meaningful].sort((a, b) => b.atomIndices.length - a.atomIndices.length)[0];
    return { atomIndices: mergedPlanarAtoms(molecule), styleKey: largest.type };
  }
  if (fragments.length > 0) {
    return { atomIndices: mergedPlanarAtoms(molecule), styleKey: "chain" };
  }
  if (molecule.atoms.length < 3) return null;
  return { atomIndices: [0, 1, 2], styleKey: "trivial" };
}

function mergedPlanarAtoms(molecule: MoleculeData): number[] {
  return [...new Set(countMaxPlanarAtoms(molecule).largestIndices)].sort((a, b) => a - b);
}

function createPlane(
  size: number,
  color: number,
  opacity: number,
  center: THREE.Vector3,
  quaternion: THREE.Quaternion,
): THREE.Mesh {
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshBasicMaterial({
      color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false, depthTest: false,
    }),
  );
  plane.position.copy(center);
  plane.quaternion.copy(quaternion);
  return plane;
}

function createWireframe(
  size: number,
  color: number,
  opacity: number,
  center: THREE.Vector3,
  quaternion: THREE.Quaternion,
): THREE.Mesh {
  const wire = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshBasicMaterial({
      color, wireframe: true, transparent: true, opacity: Math.min(opacity * 2, 0.35), depthTest: false,
    }),
  );
  wire.position.copy(center);
  wire.quaternion.copy(quaternion);
  return wire;
}

function createAtomRing(
  position: THREE.Vector3,
  color: number,
  opacity: number,
  quaternion: THREE.Quaternion,
): THREE.Mesh {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.35, 0.5, 24),
    new THREE.MeshBasicMaterial({
      color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false, depthTest: false,
    }),
  );
  ring.position.copy(position);
  ring.quaternion.copy(quaternion);
  return ring;
}
