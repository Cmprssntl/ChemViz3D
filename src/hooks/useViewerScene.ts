import { useEffect, type RefObject } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { CameraRig } from "../engine/view/CameraRig";
import { MoleculeScene } from "../engine/view/MoleculeScene";
import { setResetCameraFn, setScreenshotFn } from "../utils/screenshot";

export interface ViewerSceneRefs {
  containerRef: RefObject<HTMLDivElement | null>;
  sceneRef: RefObject<THREE.Scene | null>;
  cameraRef: RefObject<THREE.PerspectiveCamera | null>;
  rendererRef: RefObject<THREE.WebGLRenderer | null>;
  controlsRef: RefObject<OrbitControls | null>;
  rigRef: RefObject<CameraRig | null>;
  moleculeSceneRef: RefObject<MoleculeScene | null>;
  moleculeGroupRef: RefObject<THREE.Group | null>;
  cameraTouchedRef: RefObject<boolean>;
}

function createLighting(scene: THREE.Scene): void {
  scene.add(new THREE.AmbientLight(0x404060, 0.5));
  const key = new THREE.DirectionalLight(0xffffff, 1.2);
  key.position.set(10, 15, 10);
  key.castShadow = true;
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x8888ff, 0.4);
  fill.position.set(-5, -5, -10);
  scene.add(fill);
  scene.add(new THREE.HemisphereLight(0x444488, 0x222244, 0.6));
}

/**
 * Creates the renderer, camera, controls and the one persistent molecule
 * group. Kept in a hook so `MoleculeViewer` only owns React-facing state and
 * the per-molecule sync effects.
 */
export function useViewerScene(refs: ViewerSceneRefs): void {
  const {
    containerRef, sceneRef, cameraRef, rendererRef, controlsRef,
    rigRef, moleculeSceneRef, moleculeGroupRef, cameraTouchedRef,
  } = refs;

  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x111122);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    camera.position.set(8, 6, 10);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(width, height);
    setScreenshotFn(() => { renderer.render(scene, camera); return renderer.domElement.toDataURL("image/png"); });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.15;
    controls.minDistance = 3;
    controls.maxDistance = 30;
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

    const group = new THREE.Group();
    group.name = "molecule-root";
    scene.add(group);
    moleculeGroupRef.current = group;

    const moleculeScene = new MoleculeScene();
    group.add(moleculeScene.group);
    moleculeSceneRef.current = moleculeScene;
    rig.reset();

    let animationId = 0;
    const animate = () => {
      animationId = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const onResize = () => {
      if (!containerRef.current || !cameraRef.current || !rendererRef.current) return;
      const nextWidth = containerRef.current.clientWidth;
      const nextHeight = containerRef.current.clientHeight;
      if (nextWidth <= 0 || nextHeight <= 0) return;
      const previousAspect = cameraRef.current.aspect;
      cameraRef.current.aspect = nextWidth / nextHeight;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(nextWidth, nextHeight);
      // Panel collapse and rotation change the usable canvas; re-frame unless
      // the user has already chosen a view.
      const aspectChanged = Math.abs(previousAspect - cameraRef.current.aspect) > 0.01;
      if (aspectChanged && !cameraTouchedRef.current && moleculeGroupRef.current) {
        rigRef.current?.fit(moleculeGroupRef.current);
      }
    };
    window.addEventListener("resize", onResize);
    const resizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(onResize) : null;
    resizeObserver?.observe(container);

    return () => {
      setScreenshotFn(null);
      window.removeEventListener("resize", onResize);
      resizeObserver?.disconnect();
      cancelAnimationFrame(animationId);
      moleculeScene.dispose();
      moleculeSceneRef.current = null;
      rigRef.current = null;
      renderer.dispose();
      if (container.contains(renderer.domElement)) container.removeChild(renderer.domElement);
    };
  }, []);
}
