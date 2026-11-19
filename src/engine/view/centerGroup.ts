import * as THREE from "three";

/**
 * Shifts a group so the geometry it contains is centred on the world origin.
 * The group position is recomputed from scratch each call, so repeated
 * recentring cannot accumulate floating-point drift.
 */
export function centerGroupAtOrigin(group: THREE.Object3D): void {
  group.position.set(0, 0, 0);
  group.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(group);
  if (!Number.isFinite(box.min.x)) return;
  const center = box.getCenter(new THREE.Vector3());
  group.position.sub(center);
  group.updateMatrixWorld(true);
}
