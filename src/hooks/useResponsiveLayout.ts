import { useSyncExternalStore } from "react";
import { platform } from "../platform";

export type Orientation = "portrait" | "landscape";

export interface ResponsiveLayout {
  orientation: Orientation;
  isTouch: boolean;
}

function computeLayout(): ResponsiveLayout {
  if (typeof window === "undefined") return { orientation: "landscape", isTouch: false };
  const coarsePointer = typeof window.matchMedia === "function"
    && window.matchMedia("(pointer: coarse)").matches;
  return {
    orientation: window.innerWidth < window.innerHeight ? "portrait" : "landscape",
    isTouch: platform.capabilities.touchFirst || navigator.maxTouchPoints > 0 || coarsePointer,
  };
}

let current = computeLayout();
const listeners = new Set<() => void>();

function handleResize(): void {
  const next = computeLayout();
  if (next.orientation === current.orientation && next.isTouch === current.isTouch) return;
  current = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1 && typeof window !== "undefined") {
    window.addEventListener("resize", handleResize);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && typeof window !== "undefined") {
      window.removeEventListener("resize", handleResize);
    }
  };
}

/**
 * Single source for orientation and touch capability.
 *
 * `App`, `MoleculeViewer` and `LeftPanel` used to each attach their own resize
 * listener with slightly different touch checks. They now share one external
 * store, so a resize updates all three from the same snapshot.
 */
export function useResponsiveLayout(): ResponsiveLayout {
  return useSyncExternalStore(subscribe, () => current, () => current);
}
