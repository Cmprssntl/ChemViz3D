import * as THREE from "three";

// ── Canvas text sprite helper ──

function makeLabelSprite(text: string, color: string, bgOpacity = 0.6): THREE.Sprite {
  const fontSize = 36;
  const padding = 8;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  ctx.font = `bold ${fontSize}px -apple-system, "Segoe UI", Arial, sans-serif`;
  const tw = ctx.measureText(text).width;
  const size = Math.max(tw + padding * 2, fontSize + padding * 2);
  canvas.width = size;
  canvas.height = fontSize + padding * 2;

  // background pill
  const r = (fontSize + padding * 2) / 2;
  ctx.beginPath();
  ctx.roundRect(0, 0, canvas.width, canvas.height, r);
  ctx.fillStyle = `rgba(0,0,0,${bgOpacity})`;
  ctx.fill();

  ctx.font = `bold ${fontSize}px -apple-system, "Segoe UI", Arial, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = color;
  ctx.fillText(text, size / 2, canvas.height / 2);

  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, sizeAttenuation: true });
  const sp = new THREE.Sprite(mat);
  sp.scale.set(1, 0.35, 1);
  return sp;
}

function makeLabelSpriteC(text: string, color: string, bgOpacity = 0.6): THREE.Sprite {
  const fontSize = 36;
  const padding = 10;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  ctx.font = `bold ${fontSize}px -apple-system, "Segoe UI", Arial, sans-serif`;
  const tw = ctx.measureText(text).width;
  const sz = Math.max(tw + padding * 2, fontSize + padding * 2);
  canvas.width = sz;
  canvas.height = sz;

  ctx.beginPath();
  ctx.arc(sz / 2, sz / 2, sz / 2 - 2, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(0,0,0,${bgOpacity})`;
  ctx.fill();

  ctx.font = `bold ${fontSize}px -apple-system, "Segoe UI", Arial, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = color;
  ctx.fillText(text, sz / 2, sz / 2);

  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: true, depthWrite: false, sizeAttenuation: true });
  const sp = new THREE.Sprite(mat);
  sp.scale.set(0.5, 0.5, 1);
  return sp;
}

// ── Distance overlay ──

export function createDistanceOverlay(
  p1: THREE.Vector3, p2: THREE.Vector3, label?: string
): THREE.Group {
  const g = new THREE.Group();
  g.name = "measure-distance";

  const dist = p1.distanceTo(p2);
  const mid = new THREE.Vector3().addVectors(p1, p2).multiplyScalar(0.5);

  // dashed line
  const pts = [p1.clone(), p2.clone()];
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  const mat = new THREE.LineDashedMaterial({ color: 0x44ff88, dashSize: 0.06, gapSize: 0.04, linewidth: 1 });
  const line = new THREE.Line(geo, mat);
  line.computeLineDistances();
  g.add(line);

  // small endpoint spheres
  for (const p of [p1, p2]) {
    const dot = new THREE.Mesh(
      new THREE.SphereGeometry(0.06, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0x44ff88 })
    );
    dot.position.copy(p);
    g.add(dot);
  }

  // label
  const txt = label || `${dist.toFixed(2)} \u00C5`;
  const sp = makeLabelSprite(txt, "#88ffbb");
  sp.position.copy(mid).add(new THREE.Vector3(0, 0.25, 0));
  g.add(sp);

  return g;
}

// ── Angle overlay ──

export function createAngleOverlay(
  p1: THREE.Vector3, apex: THREE.Vector3, p2: THREE.Vector3
): THREE.Group {
  const g = new THREE.Group();
  g.name = "measure-angle";

  const v1 = new THREE.Vector3().subVectors(p1, apex).normalize();
  const v2 = new THREE.Vector3().subVectors(p2, apex).normalize();
  const angleRad = v1.angleTo(v2);
  const angleDeg = THREE.MathUtils.radToDeg(angleRad);

  // lines from apex to each point
  for (const p of [p1, p2]) {
    const pts = [apex.clone(), p.clone()];
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineDashedMaterial({ color: 0x44ccff, dashSize: 0.06, gapSize: 0.04 });
    const line = new THREE.Line(geo, mat);
    line.computeLineDistances();
    g.add(line);
  }

  // angle arc
  const arcRadius = 0.4;
  const segments = 20;
  const arcPts: THREE.Vector3[] = [];
  const normal = new THREE.Vector3().crossVectors(v1, v2).normalize();
  const startAngle = 0;
  const totalAngle = angleRad;

  for (let i = 0; i <= segments; i++) {
    const t = (i / segments) * totalAngle;
    const dir = new THREE.Vector3().copy(v1).applyAxisAngle(normal, t);
    arcPts.push(new THREE.Vector3().copy(apex).add(dir.multiplyScalar(arcRadius)));
  }

  const arcGeo = new THREE.BufferGeometry().setFromPoints(arcPts);
  const arcMat = new THREE.LineBasicMaterial({ color: 0x44ccff });
  const arc = new THREE.Line(arcGeo, arcMat);
  g.add(arc);

  // label at arc midpoint
  const midDir = new THREE.Vector3().copy(v1).applyAxisAngle(normal, totalAngle / 2);
  const labelPos = new THREE.Vector3().copy(apex).add(midDir.multiplyScalar(arcRadius + 0.3));
  const sp = makeLabelSpriteC(`${angleDeg.toFixed(1)}\u00B0`, "#88ddff");
  sp.position.copy(labelPos);
  g.add(sp);

  return g;
}

// ── Dihedral overlay ──

export function createDihedralOverlay(
  p1: THREE.Vector3, p2: THREE.Vector3, p3: THREE.Vector3, p4: THREE.Vector3
): THREE.Group {
  const g = new THREE.Group();
  g.name = "measure-dihedral";

  const v1 = new THREE.Vector3().subVectors(p2, p1);
  const v2 = new THREE.Vector3().subVectors(p3, p2);
  const v3 = new THREE.Vector3().subVectors(p4, p3);
  const n1 = new THREE.Vector3().crossVectors(v1, v2).normalize();
  const n2 = new THREE.Vector3().crossVectors(v2, v3).normalize();
  const dihedralRad = Math.acos(THREE.MathUtils.clamp(n1.dot(n2), -1, 1));
  const dihedralDeg = THREE.MathUtils.radToDeg(dihedralRad);

  // bond axis thick line
  const bondPts = [p2.clone(), p3.clone()];
  const bGeo = new THREE.BufferGeometry().setFromPoints(bondPts);
  const bMat = new THREE.LineBasicMaterial({ color: 0xffaa44, linewidth: 2 });
  g.add(new THREE.Line(bGeo, bMat));

  // dashed lines for outer bonds
  for (const [a, b] of [[p1, p2], [p3, p4]]) {
    const pts = [a.clone(), b.clone()];
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineDashedMaterial({ color: 0xffaa44, dashSize: 0.06, gapSize: 0.04 });
    const line = new THREE.Line(geo, mat);
    line.computeLineDistances();
    g.add(line);
  }

  // label
  const mid = new THREE.Vector3().addVectors(p2, p3).multiplyScalar(0.5);
  const sp = makeLabelSprite(`${dihedralDeg.toFixed(1)}\u00B0`, "#ffcc66");
  sp.position.copy(mid).add(new THREE.Vector3(0, 0.35, 0));
  g.add(sp);

  return g;
}

// ── Clear all measurement overlays from a group ──

export function clearMeasurementOverlays(sceneGroup: THREE.Group | null): void {
  if (!sceneGroup) return;
  // Use a dedicated named group so we can remove all overlays in one shot
  // instead of traversing the entire scene tree.
  const old = sceneGroup.getObjectByName("measurement-overlays");
  if (old) {
    sceneGroup.remove(old);
    old.traverse((n) => {
      if (n instanceof THREE.Mesh) { n.geometry?.dispose(); if (Array.isArray(n.material)) n.material.forEach(m => m.dispose()); else n.material?.dispose(); }
      if (n instanceof THREE.Line) { n.geometry?.dispose(); n.material?.dispose(); }
      if (n instanceof THREE.Sprite) { n.material?.dispose(); }
    });
  }
}

// ── Refresh all measurement overlays from the current points ──

export function updateMeasurementOverlays(
  sceneGroup: THREE.Group,
  atoms: Array<{ x: number; y: number; z: number }>,
  indices: number[],
  measureType?: "distance" | "angle" | "dihedral" | null
): void {
  clearMeasurementOverlays(sceneGroup);
  if (indices.length < 2) return;

  const overlays = new THREE.Group();
  overlays.name = "measurement-overlays";
  const ps = indices.map(i => new THREE.Vector3(atoms[i].x, atoms[i].y, atoms[i].z));

  if (indices.length === 2) {
    // Only distance mode shows a preview at 2 points.
    // Angle and dihedral need more clicks; show nothing until complete.
    if (measureType !== "distance") return;
    overlays.add(createDistanceOverlay(ps[0], ps[1]));
  } else if (indices.length === 3) {
    // Only angle mode reaches 3 points; distance resets at 2, dihedral needs 4.
    // ps[0] is the vertex (first click), ps[1] and ps[2] are the two arms.
    if (measureType !== "angle") return;
    overlays.add(createAngleOverlay(ps[1], ps[0], ps[2]));
  } else if (indices.length >= 4) {
    // Only dihedral mode reaches 4+ points.
    overlays.add(createDihedralOverlay(ps[0], ps[1], ps[2], ps[3]));
  }
  sceneGroup.add(overlays);
}
