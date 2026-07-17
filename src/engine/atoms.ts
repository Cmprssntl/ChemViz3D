import * as THREE from "three";
import { ATOMIC_DATA } from "../utils/formulaParser";
import { atomRenderRadius, BOND_RADIUS_BALL, BOND_RADIUS_SPACE, BOND_EXT_FACTOR, BOND_EXT_CAP, CURVE_EP_OFF, CURVE_BULGE } from "./config";
import type { AtomData, BondData, DisplayMode } from "../types/molecule";

/**
 * Create a 3D sphere mesh for an atom
 */
export function createAtomMesh(
  atom: AtomData,
  mode: DisplayMode
): THREE.Mesh {
  const atomicData = ATOMIC_DATA[atom.element];
  const color = atomicData?.color || "#808080";

  let radius: number;
  if (mode === "ball-and-stick") {
    radius = Math.max(0.08, (atomicData?.covalentRadius || 76) / 200);
  } else {
    radius = Math.max(0.4, (atomicData?.vdwRadius || 170) / 100);
  }

  const geometry = new THREE.SphereGeometry(radius, 32, 32);
  const material = new THREE.MeshPhongMaterial({
    color: color,
    shininess: mode === "ball-and-stick" ? 80 : 30,
    specular: mode === "ball-and-stick" ? new THREE.Color(0x444444) : new THREE.Color(0x222222),
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(atom.x, atom.y, atom.z);
  mesh.userData = { type: "atom", index: atom.index, element: atom.element };
  mesh.name = `atom-${atom.index}`;

  return mesh;
}

/**
 * Create a 3D cylinder mesh for a bond between two atoms
 */
export function createBondMesh(
  bond: BondData,
  atom1: AtomData,
  atom2: AtomData,
  mode: DisplayMode
): THREE.Mesh {
  const p1 = new THREE.Vector3(atom1.x, atom1.y, atom1.z);
  const p2 = new THREE.Vector3(atom2.x, atom2.y, atom2.z);

  const direction = new THREE.Vector3().subVectors(p2, p1);
  const length = direction.length();
  // Extend bond past each atom surface by 85% of atom rendering radius
  const _d1 = ATOMIC_DATA[atom1.element];
  const _d2 = ATOMIC_DATA[atom2.element];
  const _r1 = _d1 ? atomRenderRadius(atom1.element) : 0.3;
  const _r2 = _d2 ? atomRenderRadius(atom2.element) : 0.3;
  const _ext1 = Math.min(_r1 * BOND_EXT_FACTOR, length * BOND_EXT_CAP);
  const _ext2 = Math.min(_r2 * BOND_EXT_FACTOR, length * BOND_EXT_CAP);
  const bondLength = length + _ext1 + _ext2;

  if (length < 0.001) {
    // Degenerate bond
    const geo = new THREE.BufferGeometry();
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial());
    mesh.name = `bond-${bond.index}`;
    return mesh;
  }

  direction.normalize();

  let bondRadius: number;
  if (mode === "ball-and-stick") {
    bondRadius = BOND_RADIUS_BALL;
  } else {
    bondRadius = 0.05;
  }

  // For multi-bonds, offset slightly
  const geo = new THREE.CylinderGeometry(bondRadius, bondRadius, bondLength, 8, 1);
  const mat = new THREE.MeshPhongMaterial({
    color: "#CCCCCC",
    shininess: 40,
  });
  const mesh = new THREE.Mesh(geo, mat);

  // Position at midpoint, orient along bond axis
  const midPoint = new THREE.Vector3().addVectors(p1, p2).multiplyScalar(0.5);
  mesh.position.copy(midPoint);

  // Orient cylinder: default is along Y, need to rotate to align with direction
  const up = new THREE.Vector3(0, 1, 0);
  const quat = new THREE.Quaternion().setFromUnitVectors(up, direction);
  mesh.quaternion.copy(quat);

  mesh.userData = {
    type: "bond",
    index: bond.index,
    order: bond.order,
    atom1Idx: bond.atom1Idx,
    atom2Idx: bond.atom2Idx,
  };
  mesh.name = `bond-${bond.index}`;

  return mesh;
}

/**
 * Create multiple bond cylinders for double/triple bonds with offsets
 */
export function createBondGroup(
  bond: BondData,
  atom1: AtomData,
  atom2: AtomData,
  mode: DisplayMode
): THREE.Group {
  const group = new THREE.Group();
  group.name = `bond-group-${bond.index}`;
  group.userData = {
    type: "bond",
    index: bond.index,
    order: bond.order,
    atom1Idx: bond.atom1Idx,
    atom2Idx: bond.atom2Idx,
  };

  if (bond.order === 1) {
    const mesh = createBondMesh(bond, atom1, atom2, mode);
    group.add(mesh);
    return group;
  }

  const p1 = new THREE.Vector3(atom1.x, atom1.y, atom1.z);
  const p2 = new THREE.Vector3(atom2.x, atom2.y, atom2.z);
  const direction = new THREE.Vector3().subVectors(p2, p1).normalize();

  // Find a perpendicular vector for offset
  const up = new THREE.Vector3(0, 1, 0);
  if (Math.abs(direction.dot(up)) > 0.99) up.set(1, 0, 0);
  const perp = new THREE.Vector3().crossVectors(direction, up).normalize();

    const count = bond.order;
  const bondMat = new THREE.MeshPhongMaterial({ color: "#CCCCCC", shininess: 40 });
  const bondRadius = mode === "ball-and-stick" ? BOND_RADIUS_BALL : BOND_RADIUS_SPACE;

  const _bA = ATOMIC_DATA[atom1.element];
  const _bB = ATOMIC_DATA[atom2.element];
  const _rA = _bA ? atomRenderRadius(atom1.element) : 0.3;
  const _rB = _bB ? atomRenderRadius(atom2.element) : 0.3;
  const _len = p1.distanceTo(p2);
  const insA = Math.min(_rA * 0.35, _len * 0.35);
  const insB = Math.min(_rB * 0.35, _len * 0.35);

  const s = p1.clone().add(direction.clone().multiplyScalar(insA));
  const e = p2.clone().add(direction.clone().multiplyScalar(-insB));
  const mid = new THREE.Vector3().addVectors(s, e).multiplyScalar(0.5);

  const epO = CURVE_EP_OFF;
  const blg = CURVE_BULGE;

  for (let sgn = -1; sgn <= 1; sgn += 2) {
    const st = s.clone().add(perp.clone().multiplyScalar(sgn * epO));
    const en = e.clone().add(perp.clone().multiplyScalar(sgn * epO));
    const ct = mid.clone().add(perp.clone().multiplyScalar(sgn * (epO + blg)));
    const cv = new THREE.QuadraticBezierCurve3(st, ct, en);
    const tg = new THREE.TubeGeometry(cv, 10, bondRadius, 6, false);
    const me = new THREE.Mesh(tg, bondMat);
    me.userData = { type: "bond", index: bond.index, order: bond.order, atom1Idx: bond.atom1Idx, atom2Idx: bond.atom2Idx };
    me.name = "b" + bond.index + "c" + (sgn > 0 ? "r" : "l");
    group.add(me);
  }

  if (count === 3) {
    group.add(createBondMesh(bond, atom1, atom2, mode));
  }

  return group;
}

/**
 * Element color lookup for labels
 */
export function getElementColor(element: string): string {
  return ATOMIC_DATA[element]?.color || "#808080";
}

/**
 * Create a 3D text label sprite for an atom (element symbol).
 * Rendered as a canvas-drawn text on a sprite for performance.
 */
export function createAtomLabel(atom: AtomData): THREE.Sprite {
  const color = getElementColor(atom.element);
  const symbol = atom.element;
  const fontSize = 48;
  const padding = 10;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;

  // Measure text
  ctx.font = `bold ${fontSize}px -apple-system, "Segoe UI", Arial, sans-serif`;
  const metrics = ctx.measureText(symbol);
  const textWidth = metrics.width;
  const size = Math.max(textWidth + padding * 2, fontSize + padding * 2);

  canvas.width = size;
  canvas.height = size;

  // Background circle (semi-transparent)
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(13, 13, 26, 0.55)";
  ctx.fill();

  // Element symbol
  ctx.font = `bold ${fontSize}px -apple-system, "Segoe UI", Arial, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = color;
  ctx.fillText(symbol, size / 2, size / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;

  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    sizeAttenuation: true,
  });

  const sprite = new THREE.Sprite(material);
  // Position above the atom sphere
  const r = atomRenderRadius(atom.element);
  sprite.position.set(atom.x, atom.y + r + 0.25, atom.z);
  sprite.scale.set(0.6, 0.6, 1);
  sprite.userData = { type: "label", atomIndex: atom.index };
  sprite.name = `label-${atom.index}`;

  return sprite;
}
