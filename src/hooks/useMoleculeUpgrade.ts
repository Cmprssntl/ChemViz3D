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
