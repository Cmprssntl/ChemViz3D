import * as THREE from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export interface FitResult {
  center: THREE.Vector3;
  radius: number;
  distance: number;
}

/**
 * Keeps the camera framed around whatever structure is loaded.
 *
 * The old viewer hard-coded `position (8, 6, 10)`, `maxDistance = 30` and
 * `near/far = 0.1/100`, so anything larger than a dozen atoms either fell
 * outside the frustum or was clipped by the far plane. The rig derives
 * distance, clip planes and zoom limits from the bounding sphere instead, so a
 * 40-carbon chain and a water molecule are both fully visible.
 */
export class CameraRig {
  private static readonly HOME_DIRECTION = new THREE.Vector3(0.62, 0.47, 0.78).normalize();
  private static readonly MIN_RADIUS = 0.8;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly controls: OrbitControls,
  ) {}

  /**
   * Frames the object and points the controls at its centre. `radius` is the
   * bounding-sphere radius, already padded for the requested margin.
   */
  fit(object: THREE.Object3D, margin = 1.08): FitResult {
    const sphere = boundingSphereOf(object);
    if (!sphere) return this.reset();
    const radius = Math.max(sphere.radius, CameraRig.MIN_RADIUS);
    const distance = Math.max(this.projectedDistance(object, sphere.center), radius * 0.8) * margin;

    this.applyClipPlanes(radius, distance);
    this.applyZoomLimits(radius);
    this.controls.target.copy(sphere.center);
    this.camera.position.copy(sphere.center).addScaledVector(CameraRig.HOME_DIRECTION, distance);
    this.camera.lookAt(sphere.center);
    this.controls.update();
    return { center: sphere.center.clone(), radius, distance };
  }

  /** Restores the home view without any geometry loaded. */
  reset(): FitResult {
    const radius = CameraRig.MIN_RADIUS;
    const distance = this.distanceFor(radius) * 1.25;
    this.applyClipPlanes(radius, distance);
    this.applyZoomLimits(radius);
    this.controls.target.set(0, 0, 0);
    this.camera.position.copy(CameraRig.HOME_DIRECTION).multiplyScalar(distance);
    this.camera.lookAt(this.controls.target);
    this.controls.update();
    return { center: new THREE.Vector3(), radius, distance };
  }

  /**
   * Distance needed for every corner to fall inside the frustum when viewed
   * from the home direction.
   *
   * A sphere fit is rotation-invariant but wasteful: a 40-carbon chain has a
   * 25 Å radius while being only 4 Å thick, so an isotropic fit pushed the
   * camera so far back that the molecule occupied a third of the viewport.
   * Testing corners against the real horizontal and vertical half-angles lets
   * a long chain fill the long axis of the screen instead.
   */
  private projectedDistance(object: THREE.Object3D, center: THREE.Vector3): number {
    const vertical = THREE.MathUtils.degToRad(this.camera.fov) / 2;
    const tanV = Math.tan(vertical);
    const tanH = tanV * Math.max(this.camera.aspect, 1e-3);
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), CameraRig.HOME_DIRECTION).normalize();
    const up = new THREE.Vector3().crossVectors(CameraRig.HOME_DIRECTION, right).normalize();

    let distance = 0;
    const offset = new THREE.Vector3();
    for (const corner of worldCornersOf(object)) {
      offset.subVectors(corner, center);
      const x = Math.abs(offset.dot(right));
      const y = Math.abs(offset.dot(up));
      const z = offset.dot(CameraRig.HOME_DIRECTION);
      distance = Math.max(distance, z + x / tanH, z + y / tanV);
    }
    return distance;
  }

  /** Distance at which a sphere of `radius` fills the smaller view axis. */
  private distanceFor(radius: number): number {
    const vertical = THREE.MathUtils.degToRad(this.camera.fov) / 2;
    const horizontal = Math.atan(Math.tan(vertical) * Math.max(this.camera.aspect, 1e-3));
    const limiting = Math.min(vertical, horizontal);
    return radius / Math.sin(limiting);
  }

  private applyClipPlanes(radius: number, distance: number): void {
    this.camera.near = Math.max(0.001, radius * 0.01);
    this.camera.far = Math.max(100, distance + radius * 4);
    this.camera.updateProjectionMatrix();
  }

  private applyZoomLimits(radius: number): void {
    this.controls.minDistance = radius * 0.6;
    this.controls.maxDistance = radius * 12 + 4;
  }
}

/**
 * Tight bounding sphere built from the actual geometry.
 *
 * `Box3.setFromObject` returns the AABB, whose bounding sphere is the box
 * diagonal — for a bent chain that is up to ~70 % larger than the molecule,
 * which is why the first version framed everything too far away. Unioning the
 * per-geometry spheres follows the real shape instead.
 */
export function boundingSphereOf(object: THREE.Object3D): THREE.Sphere | null {
  object.updateMatrixWorld(true);
  let sphere: THREE.Sphere | null = null;
  const scratch = new THREE.Sphere();
  object.traverse((node) => {
    const geometry = geometryOf(node);
    if (!geometry) return;
    if (!geometry.boundingSphere) geometry.computeBoundingSphere();
    const local = geometry.boundingSphere;
    if (!local) return;
    scratch.copy(local).applyMatrix4(node.matrixWorld);
    sphere = sphere ? unionSphere(sphere, scratch) : scratch.clone();
  });
  return sphere;
}

function geometryOf(node: THREE.Object3D): THREE.BufferGeometry | null {
  if (node instanceof THREE.Sprite) return null;
  if (node instanceof THREE.Mesh || node instanceof THREE.Line || node instanceof THREE.LineSegments) {
    return node.geometry ?? null;
  }
  return null;
}

/** World-space corners of every rendered geometry's bounding box. */
export function worldCornersOf(object: THREE.Object3D): THREE.Vector3[] {
  object.updateMatrixWorld(true);
  const corners: THREE.Vector3[] = [];
  const box = new THREE.Box3();
  object.traverse((node) => {
    const geometry = geometryOf(node);
    if (!geometry) return;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    if (!geometry.boundingBox) return;
    box.copy(geometry.boundingBox).applyMatrix4(node.matrixWorld);
    for (const x of [box.min.x, box.max.x]) {
      for (const y of [box.min.y, box.max.y]) {
        for (const z of [box.min.z, box.max.z]) corners.push(new THREE.Vector3(x, y, z));
      }
    }
  });
  return corners;
}

/** Smallest sphere containing both inputs (Ritter-style merge). */
function unionSphere(a: THREE.Sphere, b: THREE.Sphere): THREE.Sphere {
  const delta = new THREE.Vector3().subVectors(b.center, a.center);
  const distance = delta.length();
  if (distance + b.radius <= a.radius) return a;
  if (distance + a.radius <= b.radius) return b.clone();
  const radius = (distance + a.radius + b.radius) / 2;
  const center = a.center.clone().addScaledVector(delta, (radius - a.radius) / (distance || 1));
  return new THREE.Sphere(center, radius);
}
