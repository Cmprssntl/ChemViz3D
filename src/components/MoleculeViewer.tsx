import React, { useRef, useEffect, useCallback } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { useStore } from "../store/useStore";
import { updateMoleculeScene, centerMolecule } from "../engine/bonds";
import { raycastHit, clearHighlights, highlightAtom, highlightBond } from "../engine/interaction";
import { applyBondRotation, snapshotPositions } from "../engine/rotation";
import { detectPlanarFragments, bestFitPlane } from "../engine/coplanarity";
import { countMaxPlanarAtoms } from "../engine/conformerSearch";
import { updateMeasurementOverlays, clearMeasurementOverlays } from "../engine/measurement";
import { t } from "../i18n/index";
import { setScreenshotFn, setResetCameraFn } from "../utils/screenshot";

function createLighting(scene: THREE.Scene): void {
  scene.add(new THREE.AmbientLight(0x404060, 0.5));
  const dl = new THREE.DirectionalLight(0xffffff, 1.2);
  dl.position.set(10, 15, 10);
  dl.castShadow = true;
  scene.add(dl);
  const dl2 = new THREE.DirectionalLight(0x8888ff, 0.4);
  dl2.position.set(-5, -5, -10);
  scene.add(dl2);
  scene.add(new THREE.HemisphereLight(0x444488, 0x222244, 0.6));
}

function addCoplanarityIndicators(
  sceneGroup: THREE.Group,
  molecule: import("../types/molecule").MoleculeData,
  groupName = "coplanarity-hints"
): void {
  // Clean old coplanarity group
  const old = sceneGroup.getObjectByName(groupName);
  if (old) {
    old.parent?.remove(old);
    old.traverse((n) => { if (n instanceof THREE.Mesh) { n.geometry?.dispose(); (n.material as THREE.Material)?.dispose(); } });
  }

  const fragments = detectPlanarFragments(molecule);

  // Separate chemically meaningful fragments from trivial chain fragments
  const nonChainFragments = fragments.filter((f) => f.type !== "chain");

  let atomIndices: number[];
  let normal: THREE.Vector3;
  let center: THREE.Vector3;
  let color: number;
  let planeOpacity: number;
  let ringOpacity: number;

  if (nonChainFragments.length > 0) {
    // ── Preferred path: chemically meaningful fragments exist ──
    // Highlight the merged set (whatever countMaxPlanarAtoms returned) so
    // the visual atom count matches the "可能共面" stat shown in the panel.
    // The plane is the best-fit through exactly those atoms, so it always
    // passes through the highlighted set.
    const sorted = [...nonChainFragments].sort((a, b) => b.atomIndices.length - a.atomIndices.length);
    const largest = sorted[0];
    const merged = countMaxPlanarAtoms(molecule);
    const mergedSet = new Set(merged.largestIndices);
    const pos = [...mergedSet].map((idx) => {
      const a = molecule.atoms[idx];
      return new THREE.Vector3(a.x, a.y, a.z);
    });
    let { normal: n, center: c } = bestFitPlane(pos);
    let chosenIndices = [...mergedSet];

    // Robustness: if the merged set includes a strongly off-plane atom
    // (e.g. a chain that happened to be merged but lies in a different
    // plane), iteratively drop the worst offender and re-fit. This keeps
    // the plane "looking right" without sacrificing the count, because
    // the loop only removes atoms that are more than PLANE_TOL away from
    // the dominant plane.
    const PLANE_TOL = 0.55; // Å
    for (let iter = 0; iter < 5 && chosenIndices.length >= 4; iter++) {
      const distances = chosenIndices.map((idx) => {
        const a = molecule.atoms[idx];
        return Math.abs(new THREE.Vector3(a.x - c.x, a.y - c.y, a.z - c.z).dot(n));
      });
      const maxDev = Math.max(...distances);
      if (maxDev <= PLANE_TOL) break;
      // Drop the worst atom
      const worstIdx = distances.indexOf(maxDev);
      chosenIndices = chosenIndices.filter((_, i) => i !== worstIdx);
      if (chosenIndices.length < 3) {
        chosenIndices = [...mergedSet];
        break;
      }
      // Re-fit
      const newPos = chosenIndices.map((idx) => {
        const a = molecule.atoms[idx];
        return new THREE.Vector3(a.x, a.y, a.z);
      });
      const refit = bestFitPlane(newPos);
      n = refit.normal;
      c = refit.center;
    }
    atomIndices = chosenIndices;
    normal = n;
    center = c;

    // Color: ring=blue, alkene=orange, carbonyl=yellow-green
    const colorMap: Record<string, number> = {
      ring: 0x44aaff, alkene: 0xffaa44, carbonyl: 0x88dd44,
      other: 0x888888,
    };
    color = colorMap[largest.type] ?? 0x888888;
    planeOpacity = 0.18;
    ringOpacity = 0.5;
  } else if (fragments.length > 0) {
    // ── Fallback: only chain fragments exist ──
    // Use the merged set so the visual count matches the "可能共面" stat
    // (e.g. ethanol's most-planar search reports 5 atoms). The merged set
    // can include atoms from chains that share a bond axis but tilt in
    // different directions; iteratively drop the worst offender and
    // re-fit so the plane stays consistent with the marked atoms.
    const merged = countMaxPlanarAtoms(molecule);
    const mergedSet = new Set(merged.largestIndices);
    const pos = [...mergedSet].map((idx) => {
      const a = molecule.atoms[idx];
      return new THREE.Vector3(a.x, a.y, a.z);
    });
    let { normal: n, center: c } = bestFitPlane(pos);
    let chosenIndices = [...mergedSet];
    const PLANE_TOL = 0.55; // Å
    for (let iter = 0; iter < 5 && chosenIndices.length >= 4; iter++) {
      const distances = chosenIndices.map((idx) => {
        const a = molecule.atoms[idx];
        return Math.abs(new THREE.Vector3(a.x - c.x, a.y - c.y, a.z - c.z).dot(n));
      });
      const maxDev = Math.max(...distances);
      if (maxDev <= PLANE_TOL) break;
      const worstIdx = distances.indexOf(maxDev);
      chosenIndices = chosenIndices.filter((_, i) => i !== worstIdx);
      if (chosenIndices.length < 3) {
        chosenIndices = [...mergedSet];
        break;
      }
      const newPos = chosenIndices.map((idx) => {
        const a = molecule.atoms[idx];
        return new THREE.Vector3(a.x, a.y, a.z);
      });
      const refit = bestFitPlane(newPos);
      n = refit.normal;
      c = refit.center;
    }
    atomIndices = chosenIndices;
    normal = n;
    center = c;
    color = 0x44dddd; // cyan for chain
    planeOpacity = 0.12;
    ringOpacity = 0.45;
  } else {
    // ── No fragments at all: this is the "least planar" case (e.g.
    // ethanol's gauche conformation has no dihedral within 15° of 0/180).
    // Fall back to the 3-atom geometric floor (any 3 points are coplanar)
    // and draw a small, low-opacity indicator. ──
    if (molecule.atoms.length < 3) return;
    atomIndices = [0, 1, 2];
    const positions = atomIndices.map((idx) => {
      const a = molecule.atoms[idx];
      return new THREE.Vector3(a.x, a.y, a.z);
    });
    const { normal: n, center: c } = bestFitPlane(positions);
    normal = n;
    center = c;
    color = 0x888888; // neutral gray: indicates trivial coplanarity
    planeOpacity = 0.06;
    ringOpacity = 0.25;
  }

  // Compute positions and plane size from the final atomIndices
  const finalPositions = atomIndices.map((idx) => {
    const a = molecule.atoms[idx];
    return new THREE.Vector3(a.x, a.y, a.z);
  });
  // (normal/center are already the best-fit of these atoms, set by the
  // branch above.)

  let maxDist = 1.5;
  for (const p of finalPositions) { const d = p.distanceTo(center); if (d > maxDist) maxDist = d; }
  const planeSize = maxDist * 2.2;

  const hintGroup = new THREE.Group();
  hintGroup.name = groupName;

  // Semi-transparent plane
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(planeSize, planeSize),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: planeOpacity, side: THREE.DoubleSide, depthWrite: false, depthTest: false })
  );
  plane.position.copy(center);
  plane.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
  hintGroup.add(plane);

  // Wireframe
  const wire = new THREE.Mesh(
    new THREE.PlaneGeometry(planeSize, planeSize),
    new THREE.MeshBasicMaterial({ color, wireframe: true, transparent: true, opacity: Math.min(planeOpacity * 2, 0.35), depthTest: false })
  );
  wire.position.copy(center);
  wire.quaternion.copy(plane.quaternion);
  hintGroup.add(wire);

  // Atom rings (subtle highlight on planar atoms)
  for (const idx of atomIndices) {
    const a = molecule.atoms[idx];
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.35, 0.5, 24),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: ringOpacity, side: THREE.DoubleSide, depthWrite: false, depthTest: false })
    );
    ring.position.set(a.x, a.y, a.z);
    hintGroup.add(ring);
  }

  sceneGroup.add(hintGroup);
}

export const MoleculeViewer: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const moleculeGroupRef = useRef<THREE.Group | null>(null);
  const raycasterRef = useRef<THREE.Raycaster>(new THREE.Raycaster());
  const mouseRef = useRef<THREE.Vector2>(new THREE.Vector2());
  const molJsonRef = useRef<string>("");
  const originalPositionsRef = useRef<Array<{ x: number; y: number; z: number }> | null>(null);

  const molecule = useStore((s) => s.molecule);
  const displayMode = useStore((s) => s.displayMode);
  const isLoading = useStore((s) => s.isLoading);
  const setSelected = useStore((s) => s.setSelected);
  const rotatingBond = useStore((s) => s.rotatingBond);
  const rotationAngle = useStore((s) => s.rotationAngle);
  const setMolecule = useStore((s) => s.setMolecule);
  const highlightCoplanar = useStore((s) => s.highlightCoplanar);
  const labelDisplayMode = useStore((s) => s.labelDisplayMode);
  const measureMode = useStore((s) => s.measureMode);
  const measurePoints = useStore((s) => s.measurePoints);
  const setMeasurePoints = useStore((s) => s.setMeasurePoints);
  const clearMeasurePoints = useStore((s) => s.clearMeasurePoints);
  const measureType = useStore((s) => s.measureType);
  // Language reactivity: force re-render when locale changes
  const _locale = useStore((s) => s.locale);

  const rotatingBondKey = rotatingBond ? `bond-${rotatingBond.index}` : null;

  // Init scene once
  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current, w = container.clientWidth, h = container.clientHeight;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x111122);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 100);
    camera.position.set(8, 6, 10);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(w, h);
    setScreenshotFn(() => { renderer.render(scene, camera); return renderer.domElement.toDataURL("image/png"); });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.15;
    controls.minDistance = 3; controls.maxDistance = 30;
    controlsRef.current = controls;
    setResetCameraFn(() => { controls.target.set(0,0,0); camera.position.set(8,6,10); controls.update(); });

    createLighting(scene);
    scene.add(new THREE.GridHelper(15, 15, 0x333366, 0x222244));

    const molGroup = new THREE.Group();
    molGroup.name = "molecule-root";
    scene.add(molGroup);
    moleculeGroupRef.current = molGroup;

    let animId = 0;
    const animate = () => { animId = requestAnimationFrame(animate); controls.update(); renderer.render(scene, camera); };
    animate();

    const onResize = () => {
      if (!containerRef.current || !cameraRef.current || !rendererRef.current) return;
      cameraRef.current.aspect = containerRef.current.clientWidth / containerRef.current.clientHeight;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
    };
    window.addEventListener("resize", onResize);

    return () => { setScreenshotFn(null); window.removeEventListener("resize", onResize); cancelAnimationFrame(animId); renderer.dispose(); if (container.contains(renderer.domElement)) container.removeChild(renderer.domElement); };
  }, []);

  // Snapshot positions when rotation starts
  useEffect(() => {
    if (rotatingBondKey && molecule) originalPositionsRef.current = snapshotPositions(molecule.atoms);
    else originalPositionsRef.current = null;
  }, [rotatingBondKey]);

  // Apply rotation when angle changes �� O(1) by using original snapshot
  useEffect(() => {
    if (!rotatingBond || !molecule || !originalPositionsRef.current) return;
    const bond = molecule.bonds.find((b) => b.index === rotatingBond.index);
    if (!bond) return;
    const base = originalPositionsRef.current;
    const baseMolecule = { ...molecule, atoms: molecule.atoms.map((a, i) => ({
      ...a, x: base[i]?.x ?? a.x, y: base[i]?.y ?? a.y, z: base[i]?.z ?? a.z,
    })) };
    setMolecule(applyBondRotation(baseMolecule, bond.atom1Idx, bond.atom2Idx, rotationAngle));
  }, [rotationAngle]);

  // ���� Scene rebuild when molecule/displayMode/label changes ����
  useEffect(() => {
    if (!moleculeGroupRef.current || !molecule) return;
    const key = JSON.stringify({ atoms: molecule.atoms, bonds: molecule.bonds, mode: displayMode, labelMode: labelDisplayMode });
    if (key === molJsonRef.current) return;
    molJsonRef.current = key;

    updateMoleculeScene(moleculeGroupRef.current, molecule, displayMode, labelDisplayMode);
    centerMolecule(moleculeGroupRef.current);
  }, [molecule, displayMode, labelDisplayMode]);

  // ���� Refresh coplanarity indicators AFTER scene rebuild, on ANY change ����
  // This ensures coplanarity persists through bond rotation, conformer search, etc.
  useEffect(() => {
    if (!moleculeGroupRef.current || !molecule) return;
    // ALWAYS remove the old coplanarity plane first, regardless of toggle state.
    // This ensures the plane updates immediately when the molecule changes
    // (old plane from previous molecule must not linger after a model switch).
    const old = moleculeGroupRef.current.getObjectByName("coplanarity-hints");
    if (old) {
      old.parent?.remove(old);
      old.traverse((n) => {
        if (n instanceof THREE.Mesh) { n.geometry?.dispose(); (n.material as THREE.Material)?.dispose(); }
      });
    }
    // Then add the new plane if the toggle is on
    if (highlightCoplanar) {
      addCoplanarityIndicators(moleculeGroupRef.current, molecule);
    }
  }, [molecule, highlightCoplanar]);

  // Measurement overlays
  useEffect(() => {
    if (!moleculeGroupRef.current) return;
    if (!molecule) { clearMeasurementOverlays(moleculeGroupRef.current); return; }
    updateMeasurementOverlays(moleculeGroupRef.current, molecule.atoms, measurePoints, measureType);
  }, [measurePoints, molecule, measureType]);

  // Click �� raycast
  const handleClick = useCallback((e: React.MouseEvent) => {
    if (!cameraRef.current || !moleculeGroupRef.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    mouseRef.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouseRef.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    const st = useStore.getState();
    if (st.measureMode && st.measureType) {
      clearHighlights(moleculeGroupRef.current);
      const hit = raycastHit(raycasterRef.current, mouseRef.current, cameraRef.current, moleculeGroupRef.current);
      if (hit && hit.type === "atom") {
        const targetLen = st.measureType === "dihedral" ? 4 : st.measureType === "angle" ? 3 : 2;
        const completed = st.measurePoints.length >= targetLen;
        const newPts = completed ? [hit.index] : [...st.measurePoints, hit.index];
        st.setMeasurePoints(newPts);
      }
    } else {
      clearHighlights(moleculeGroupRef.current);
      const hit = raycastHit(raycasterRef.current, mouseRef.current, cameraRef.current, moleculeGroupRef.current);
      if (hit) {
        setSelected({ type: hit.type, index: hit.index });
        hit.mesh.traverse((node) => { if (node instanceof THREE.Mesh) { if (hit.type === "atom") highlightAtom(node, true); else highlightBond(node, true); } });
      } else setSelected(null);
    }
  }, [setSelected]);

  // Hover handler for atom labels
  const handleHover = useCallback((e: React.MouseEvent) => {
    if (labelDisplayMode !== "hover" || !moleculeGroupRef.current || !cameraRef.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const mx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const my = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    mouseRef.current.set(mx, my);
    const hit = raycastHit(raycasterRef.current, mouseRef.current, cameraRef.current, moleculeGroupRef.current);

    moleculeGroupRef.current.traverse((node) => {
      if (node.name.startsWith("label-")) (node as THREE.Sprite).visible = false;
    });
    if (hit && hit.type === "atom") {
      const label = moleculeGroupRef.current.getObjectByName("label-" + hit.index);
      if (label) label.visible = true;
    }
  }, [labelDisplayMode]);

  // Right-click cancels measurement
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const st = useStore.getState();
    if (st.measurePoints.length > 0) st.clearMeasurePoints();
    if (st.measureType) st.setMeasureType(null);
  }, []);

  return (
    <div ref={containerRef} style={{ width: "100%", height: "100%", cursor: "pointer", position: "relative" }}
         onClick={handleClick} onPointerMove={handleHover} onContextMenu={handleContextMenu}>
      {isLoading && <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
          color: "#fff", fontSize: 18, background: "rgba(0,0,0,0.6)", padding: "12px 24px", borderRadius: 8, pointerEvents: "none" }}>
        {t('processingMol')}
      </div>}
      {measureMode && molecule && (
        <div style={{ position: "absolute", top: 12, left: "50%", transform: "translateX(-50%)",
            color: "#44ff88", fontSize: 13, background: "rgba(0,0,0,0.7)", padding: "6px 14px", borderRadius: 6, pointerEvents: "none", whiteSpace: "nowrap" }}>
          {measureType === "distance" ? t("distance") : measureType === "angle" ? t("angle") : measureType === "dihedral" ? t("dihedralShort") : t("measureMode")}
          {" "}{(measurePoints.length === 0 || (measureType === "distance" && measurePoints.length >= 2) ||
            (measureType === "angle" && measurePoints.length >= 3) ||
            (measureType === "dihedral" && measurePoints.length >= 4)) ? t("measureClick1") : t("measureNext")}
        </div>
      )}
      {!molecule && !isLoading && (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
            flexDirection: "column", gap: 12, pointerEvents: "none" }}>
          <div style={{ color: "#444", fontSize: 48, opacity: 0.3 }}>
            <svg width="80" height="80" viewBox="0 0 100 100" fill="none" stroke="#666" strokeWidth="2">
              <circle cx="50" cy="30" r="12" /><circle cx="25" cy="65" r="12" /><circle cx="75" cy="65" r="12" />
              <line x1="40" y1="23" x2="30" y2="58" /><line x1="60" y1="23" x2="70" y2="58" /><line x1="35" y1="70" x2="65" y2="70" />
            </svg>
          </div>
          <div style={{ color: "#666", fontSize: 14, textAlign: "center" }}>{t('enterFormula')}</div>
        </div>
      )}
    </div>
  );
};


