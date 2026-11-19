import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { CameraRig, worldCornersOf } from "../src/engine/view/CameraRig";

/** Minimal OrbitControls stand-in: the rig only touches these fields. */
function stubControls(): any {
  return {
    target: new THREE.Vector3(),
    minDistance: 0,
    maxDistance: Infinity,
    update() {},
  };
}

function makeRig(aspect: number) {
  const camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 100);
  const controls = stubControls();
  return { camera, controls, rig: new CameraRig(camera, controls) };
}

function makeChain(length: number): THREE.Group {
  const group = new THREE.Group();
  for (let i = 0; i < length; i++) {
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(0.4, 4, 4));
    sphere.position.set(i * 1.5, 0, 0);
    group.add(sphere);
  }
  return group;
}

/** True when every bounding-box corner projects inside the clip volume. */
function fullyVisible(camera: THREE.PerspectiveCamera, object: THREE.Object3D): boolean {
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
  const box = new THREE.Box3().setFromObject(object);
  const corners: THREE.Vector3[] = [];
  for (const x of [box.min.x, box.max.x]) {
    for (const y of [box.min.y, box.max.y]) {
      for (const z of [box.min.z, box.max.z]) corners.push(new THREE.Vector3(x, y, z));
    }
  }
  return corners.every((corner) => {
    const view = corner.clone().applyMatrix4(camera.matrixWorldInverse);
    const depth = -view.z;
    if (depth <= camera.near || depth >= camera.far) return false;
    const projected = corner.clone().project(camera);
    return Math.abs(projected.x) <= 1.0001 && Math.abs(projected.y) <= 1.0001;
  });
}

for (const atoms of [3, 12, 40]) {
  for (const aspect of [1.6, 0.55]) {
    test(`camera fits a ${atoms}-atom chain (aspect ${aspect})`, () => {
      const { camera, controls, rig } = makeRig(aspect);
      const chain = makeChain(atoms);
      const result = rig.fit(chain);

      assert.ok(Number.isFinite(result.distance) && result.distance > 0);
      assert.ok(camera.near > 0 && camera.near < result.distance);
      assert.ok(camera.far > result.distance + result.radius);
      assert.ok(controls.maxDistance > result.distance, "zoom-out limit must not clamp the fitted view");
      assert.ok(controls.minDistance < result.distance);
      assert.ok(fullyVisible(camera, chain), `structure is clipped (radius ${result.radius.toFixed(2)})`);
    });
  }
}

test("a long chain fills the viewport instead of floating in the middle", () => {
  const { camera, rig } = makeRig(1.9);
  const chain = makeChain(40);
  rig.fit(chain);
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
  let extentX = 0;
  let extentY = 0;
  for (const corner of worldCornersOf(chain)) {
    const ndc = corner.clone().project(camera);
    extentX = Math.max(extentX, Math.abs(ndc.x));
    extentY = Math.max(extentY, Math.abs(ndc.y));
  }
  assert.ok(extentX > 0.7, `chain only spans ${(extentX * 100).toFixed(0)} % of the viewport width`);
  assert.ok(extentX <= 1.0001 && extentY <= 1.0001, "nothing may leave the viewport");
});

test("camera distance scales with structure size", () => {  const small = makeRig(1.5);
  const large = makeRig(1.5);
  const smallFit = small.rig.fit(makeChain(3));
  const largeFit = large.rig.fit(makeChain(40));
  assert.ok(largeFit.distance > smallFit.distance * 5, "distance must grow with the structure");
  assert.ok(small.camera.far <= 400, "small structures keep a sane far plane");
});

test("reset returns the camera to a usable home view", () => {
  const { camera, controls, rig } = makeRig(1.5);
  rig.fit(makeChain(20));
  const home = rig.reset();
  assert.deepEqual(controls.target.toArray(), [0, 0, 0]);
  assert.ok(Math.abs(camera.position.length() - home.distance) < 1e-6);
  assert.ok(Number.isFinite(camera.near) && camera.near > 0);
});
