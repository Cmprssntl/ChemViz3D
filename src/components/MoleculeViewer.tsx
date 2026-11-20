import React, { useRef, useEffect, useCallback, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { useStore } from "../store/useStore";
import { MoleculeScene } from "../engine/view/MoleculeScene";
import { CameraRig } from "../engine/view/CameraRig";
import { centerGroupAtOrigin } from "../engine/view/centerGroup";
import { platform } from "../platform";
import { applyBondRotation, snapshotPositions } from "../engine/rotation";
import { updateMeasurementOverlays, clearMeasurementOverlays } from "../engine/measurement";
import { addCoplanarityIndicators, clearCoplanarityIndicators } from "../engine/view/CoplanarityOverlay";
import { t } from "../i18n/index";
import { setScreenshotFn, setResetCameraFn } from "../utils/screenshot";
import { useViewerPointer } from "../hooks/useViewerPointer";

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

export const MoleculeViewer: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const rigRef = useRef<CameraRig | null>(null);
  const moleculeSceneRef = useRef<MoleculeScene | null>(null);
  const moleculeGroupRef = useRef<THREE.Group | null>(null);
  const structureKeyRef = useRef<string>("");
  /** Set as soon as the user orbits/zooms, so a resize never yanks the view. */
  const cameraTouchedRef = useRef(false);
  const raycasterRef = useRef<THREE.Raycaster>(new THREE.Raycaster());
  const mouseRef = useRef<THREE.Vector2>(new THREE.Vector2());
  const pointerTypeRef = useRef<string>("mouse");
  const originalPositionsRef = useRef<Array<{ x: number; y: number; z: number }> | null>(null);
  const [isTouchLayout, setIsTouchLayout] = useState(platform.capabilities.touchFirst);

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
  const pointer = useViewerPointer({
    containerRef, cameraRef, moleculeGroupRef, raycasterRef, mouseRef, pointerTypeRef,
    isTouchLayout, labelDisplayMode,
  });

  useEffect(() => {
    const updateTouchLayout = () => {
      setIsTouchLayout(platform.capabilities.touchFirst
        || navigator.maxTouchPoints > 0
        || window.matchMedia("(pointer: coarse)").matches);
    };
    updateTouchLayout();
    window.addEventListener("resize", updateTouchLayout);
    return () => window.removeEventListener("resize", updateTouchLayout);
  }, []);

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

    const rig = new CameraRig(camera, controls);
    rigRef.current = rig;
    // "Reset" means "frame the molecule again": the empty-scene distance is
    // far too close for a loaded structure on a short mobile viewport.
    setResetCameraFn(() => {
      const group = moleculeGroupRef.current;
      if (group) rig.fit(group);
      else rig.reset();
    });
    controls.addEventListener("start", () => { cameraTouchedRef.current = true; });

    createLighting(scene);
    scene.add(new THREE.GridHelper(15, 15, 0x333366, 0x222244));

    const molGroup = new THREE.Group();
    molGroup.name = "molecule-root";
    scene.add(molGroup);
    moleculeGroupRef.current = molGroup;

    const moleculeScene = new MoleculeScene();
    molGroup.add(moleculeScene.group);
    moleculeSceneRef.current = moleculeScene;
    rig.reset();

    let animId = 0;
    const animate = () => { animId = requestAnimationFrame(animate); controls.update(); renderer.render(scene, camera); };
    animate();

    const onResize = () => {
      if (!containerRef.current || !cameraRef.current || !rendererRef.current) return;
      const width = containerRef.current.clientWidth;
      const height = containerRef.current.clientHeight;
      if (width <= 0 || height <= 0) return;
      const previousAspect = cameraRef.current.aspect;
      cameraRef.current.aspect = width / height;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(width, height);
      // Panel collapse and rotation change the usable canvas; re-frame unless
      // the user has already chosen a view.
      const aspectChanged = Math.abs(previousAspect - cameraRef.current.aspect) > 0.01;
      if (aspectChanged && !cameraTouchedRef.current && moleculeGroupRef.current) {
        rigRef.current?.fit(moleculeGroupRef.current);
      }
    };
    window.addEventListener("resize", onResize);
    const resizeObserver = typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(onResize)
      : null;
    resizeObserver?.observe(container);

    return () => {
      setScreenshotFn(null);
      window.removeEventListener("resize", onResize);
      resizeObserver?.disconnect();
      cancelAnimationFrame(animId);
      moleculeScene.dispose();
      moleculeSceneRef.current = null;
      rigRef.current = null;
      renderer.dispose();
      if (container.contains(renderer.domElement)) container.removeChild(renderer.domElement);
    };
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

  // ── Scene sync when molecule / displayMode / label mode change ──
  useEffect(() => {
    const moleculeScene = moleculeSceneRef.current;
    if (!moleculeScene || !moleculeGroupRef.current) return;
    if (!molecule) {
      moleculeScene.dispose();
      structureKeyRef.current = "";
      return;
    }
    moleculeScene.sync(molecule, displayMode, labelDisplayMode);

    // Only recentre and re-frame when a different structure is loaded.
    // Doing it on every torsional rotation would slide the molecule and yank
    // the camera while the user is dragging a bond.
    const key = `${molecule.atoms.length}:${molecule.bonds.length}:${molecule.name}:${molecule.formula}:${displayMode}`;
    if (key !== structureKeyRef.current) {
      structureKeyRef.current = key;
      centerGroupAtOrigin(moleculeGroupRef.current);
      cameraTouchedRef.current = false;
      rigRef.current?.fit(moleculeGroupRef.current);
    }
  }, [molecule, displayMode, labelDisplayMode]);

  // Refresh coplanarity indicators after any scene change so the plane
  // This ensures coplanarity persists through bond rotation, conformer search, etc.
  useEffect(() => {
    if (!moleculeGroupRef.current) return;
    // Always clear first: the previous molecule's plane must not linger.
    clearCoplanarityIndicators(moleculeGroupRef.current);
    if (!molecule) return;
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

  return (
    <div ref={containerRef} className="viewer-root"
         onClick={pointer.onClick} onPointerDown={pointer.onPointerDown}
         onPointerMove={pointer.onPointerMove} onContextMenu={pointer.onContextMenu}
         tabIndex={-1}>
      {isLoading && <div className="viewer-loading">{t("processingMol")}</div>}
      {measureMode && molecule && (
        <div className="viewer-hint">
          {measureType === "distance" ? t("distance") : measureType === "angle" ? t("angle") : measureType === "dihedral" ? t("dihedralShort") : t("measureMode")}
          {" "}{(measurePoints.length === 0 || (measureType === "distance" && measurePoints.length >= 2) ||
            (measureType === "angle" && measurePoints.length >= 3) ||
            (measureType === "dihedral" && measurePoints.length >= 4)) ? t("measureClick1") : t("measureNext")}
        </div>
      )}
      {!molecule && !isLoading && (
        <div className="viewer-empty">
          <div className="viewer-empty-icon">
            <svg width="80" height="80" viewBox="0 0 100 100" fill="none" stroke="#666" strokeWidth="2">
              <circle cx="50" cy="30" r="12" /><circle cx="25" cy="65" r="12" /><circle cx="75" cy="65" r="12" />
              <line x1="40" y1="23" x2="30" y2="58" /><line x1="60" y1="23" x2="70" y2="58" /><line x1="35" y1="70" x2="65" y2="70" />
            </svg>
          </div>
          <div className="viewer-empty-text">{t("enterFormula")}</div>
        </div>
      )}
    </div>
  );
};
