import * as THREE from "three";

export interface HitResult {
  type: "atom" | "bond";
  index: number;
  mesh: THREE.Object3D;
}

/**
 * Cast a ray from screen coordinates and find the first intersected
 * molecular entity (atom or bond), ignoring the ground/background.
 */
export function raycastHit(
  raycaster: THREE.Raycaster,
  mouse: THREE.Vector2,
  camera: THREE.Camera,
  sceneGroup: THREE.Group
): HitResult | null {
  raycaster.setFromCamera(mouse, camera);

  // Collect all mesh children that have userData.type set
  const targets: THREE.Object3D[] = [];
  sceneGroup.traverse((node) => {
    if (node instanceof THREE.Mesh && node.userData.type) {
      targets.push(node);
    }
  });

  const intersects = raycaster.intersectObjects(targets, false);
  if (intersects.length === 0) return null;

  const hit = intersects[0].object;
  const type = hit.userData.type as "atom" | "bond";
  const index = hit.userData.index as number;

  return { type, index, mesh: hit };
}

/**
 * Highlight an atom by changing its emissive color
 */
export function highlightAtom(mesh: THREE.Mesh, highlight: boolean): void {
  if (mesh.material instanceof THREE.MeshPhongMaterial) {
    mesh.material.emissive = highlight
      ? new THREE.Color(0xffff00)
      : new THREE.Color(0x000000);
    mesh.material.emissiveIntensity = highlight ? 0.5 : 0;
  }
}

/**
 * Highlight a bond by changing its emissive color
 */
export function highlightBond(mesh: THREE.Mesh, highlight: boolean): void {
  if (mesh.material instanceof THREE.MeshPhongMaterial) {
    mesh.material.emissive = highlight
      ? new THREE.Color(0x00ffff)
      : new THREE.Color(0x000000);
    mesh.material.emissiveIntensity = highlight ? 0.3 : 0;
  }
}

/**
 * Clear all highlights from a scene group
 */
export function clearHighlights(sceneGroup: THREE.Group): void {
  sceneGroup.traverse((node) => {
    if (node instanceof THREE.Mesh && node.material instanceof THREE.MeshPhongMaterial) {
      node.material.emissive = new THREE.Color(0x000000);
      node.material.emissiveIntensity = 0;
    }
  });
}
