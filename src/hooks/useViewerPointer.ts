import { useCallback, type RefObject } from "react";
import type React from "react";
import * as THREE from "three";
import { useStore } from "../store/useStore";
import { clearHighlights, highlightAtom, highlightBond, raycastHit } from "../engine/interaction";
import type { LabelDisplayMode } from "../types/molecule";

export interface ViewerPointerRefs {
  containerRef: RefObject<HTMLDivElement | null>;
  cameraRef: RefObject<THREE.PerspectiveCamera | null>;
  moleculeGroupRef: RefObject<THREE.Group | null>;
  raycasterRef: RefObject<THREE.Raycaster>;
  mouseRef: RefObject<THREE.Vector2>;
  pointerTypeRef: RefObject<string>;
}

export interface ViewerPointerOptions extends ViewerPointerRefs {
  isTouchLayout: boolean;
  labelDisplayMode: LabelDisplayMode;
}

export interface ViewerPointerHandlers {
  onClick: (event: React.MouseEvent) => void;
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: React.MouseEvent) => void;
  onContextMenu: (event: React.MouseEvent) => void;
}

/**
 * Pointer interaction for the 3D view: measurement picking, atom/bond
 * selection and label reveal. Extracted from the component so the viewer stays
 * focused on scene lifecycle.
 */
export function useViewerPointer(options: ViewerPointerOptions): ViewerPointerHandlers {
  const {
    containerRef, cameraRef, moleculeGroupRef, raycasterRef, mouseRef, pointerTypeRef,
    isTouchLayout, labelDisplayMode,
  } = options;
  const setSelected = useStore((state) => state.setSelected);

  const toNdc = useCallback((clientX: number, clientY: number): boolean => {
    if (!containerRef.current) return false;
    const rect = containerRef.current.getBoundingClientRect();
    mouseRef.current.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    return true;
  }, [containerRef, mouseRef]);

  const hideAllLabels = useCallback(() => {
    moleculeGroupRef.current?.traverse((node) => {
      if (node.name.startsWith("label-")) (node as THREE.Sprite).visible = false;
    });
  }, [moleculeGroupRef]);

  const showLabel = useCallback((index: number) => {
    const label = moleculeGroupRef.current?.getObjectByName(`label-${index}`);
    if (label) label.visible = true;
  }, [moleculeGroupRef]);

  const onClick = useCallback((event: React.MouseEvent) => {
    if (!cameraRef.current || !moleculeGroupRef.current) return;
    if (!toNdc(event.clientX, event.clientY)) return;
    const state = useStore.getState();

    if (state.measureMode && state.measureType) {
      clearHighlights(moleculeGroupRef.current);
      const hit = raycastHit(raycasterRef.current, mouseRef.current, cameraRef.current, moleculeGroupRef.current);
      if (hit?.type === "atom") {
        const target = state.measureType === "dihedral" ? 4 : state.measureType === "angle" ? 3 : 2;
        const points = state.measurePoints.length >= target ? [hit.index] : [...state.measurePoints, hit.index];
        state.setMeasurePoints(points);
      }
      return;
    }

    clearHighlights(moleculeGroupRef.current);
    const hit = raycastHit(raycasterRef.current, mouseRef.current, cameraRef.current, moleculeGroupRef.current);
    if (!hit) {
      setSelected(null);
      return;
    }
    setSelected({ type: hit.type, index: hit.index });
    hit.mesh.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      if (hit.type === "atom") highlightAtom(node, true);
      else highlightBond(node, true);
    });
    // Touch screens have no hover: treat "hover" labels as "show on tap".
    if (hit.type === "atom" && labelDisplayMode === "hover"
      && (isTouchLayout || pointerTypeRef.current === "touch")) {
      hideAllLabels();
      showLabel(hit.index);
    }
  }, [cameraRef, hideAllLabels, isTouchLayout, labelDisplayMode, moleculeGroupRef, mouseRef, pointerTypeRef, raycasterRef, setSelected, showLabel, toNdc]);

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    pointerTypeRef.current = event.pointerType;
  }, [pointerTypeRef]);

  const onPointerMove = useCallback((event: React.MouseEvent) => {
    if (isTouchLayout || labelDisplayMode !== "hover") return;
    if (!cameraRef.current || !moleculeGroupRef.current) return;
    if (!toNdc(event.clientX, event.clientY)) return;
    const hit = raycastHit(raycasterRef.current, mouseRef.current, cameraRef.current, moleculeGroupRef.current);
    hideAllLabels();
    if (hit?.type === "atom") showLabel(hit.index);
  }, [cameraRef, hideAllLabels, isTouchLayout, labelDisplayMode, moleculeGroupRef, mouseRef, raycasterRef, showLabel, toNdc]);

  const onContextMenu = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    const state = useStore.getState();
    if (state.measurePoints.length > 0) state.clearMeasurePoints();
    if (state.measureType) state.setMeasureType(null);
  }, []);

  return { onClick, onPointerDown, onPointerMove, onContextMenu };
}
