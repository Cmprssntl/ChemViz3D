import { useCallback, useRef } from "react";
import type { MoleculeData } from "../types/molecule";
import { useStore } from "../store/useStore";
import { namingService } from "../naming/NamingService";
import { namingCacheKey } from "../naming/cache";

export interface BuiltMolecule {
  molecule: MoleculeData;
  /** Background refinement for balanced/coarse plans. */
  refine?: () => Promise<MoleculeData | null>;
}

/** True when the user has not rotated or re-searched the structure. */
export function coordinatesUnchanged(current: MoleculeData, original: MoleculeData): boolean {
  if (current.atoms.length !== original.atoms.length) return false;
  for (let index = 0; index < current.atoms.length; index++) {
    const first = current.atoms[index];
    const second = original.atoms[index];
    if (Math.abs(first.x - second.x) > 1e-6
      || Math.abs(first.y - second.y) > 1e-6
      || Math.abs(first.z - second.z) > 1e-6) {
      return false;
    }
  }
  return true;
}

/**
 * Publishes a molecule immediately, then upgrades its name and geometry in the
 * background. Both callbacks re-read the store so a rotated molecule keeps its
 * current coordinates, and both compare structure keys so stale work is ignored.
 */
export function useMoleculeUpgrade(setMolecule: (molecule: MoleculeData) => void) {
  const refineTokenRef = useRef(0);

  const cancel = useCallback(() => {
    namingService.cancel();
    refineTokenRef.current++;
  }, []);

  const apply = useCallback((built: BuiltMolecule) => {
    const { molecule, refine } = built;
    setMolecule(molecule);
    const key = namingCacheKey(molecule);

    if (molecule.iupacSource !== "preset") {
      void namingService.upgrade(molecule, (name, source) => {
        const current = useStore.getState().molecule;
        if (!current || namingCacheKey(current) !== key) return;
        setMolecule({ ...current, iupacName: name, iupacSource: source, iupacError: undefined });
      });
    }

    if (!refine) return;
    const token = ++refineTokenRef.current;
    void refine().then((refined) => {
      if (!refined || token !== refineTokenRef.current) return;
      const current = useStore.getState().molecule;
      if (!current || namingCacheKey(current) !== key) return;
      // A bond rotation or conformer search changed the coordinates on
      // purpose; never snap the user's result back to the refined conformer.
      if (!coordinatesUnchanged(current, molecule)) return;
      setMolecule({
        ...refined,
        iupacName: current.iupacName,
        iupacSource: current.iupacSource,
        iupacError: current.iupacError,
      });
    }).catch(() => {
      // Refinement is best-effort; the coarse geometry stays on screen.
    });
  }, [setMolecule]);

  return { apply, cancel };
}
