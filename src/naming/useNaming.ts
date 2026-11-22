import { useCallback, useState } from "react";
import { hasValidTextAISettings } from "../ai/config";
import { useStore } from "../store/useStore";
import { t } from "../i18n/index";
import { namingService } from "./NamingService";
import { clearAllNamingCache, clearCachedName, namingCacheKey } from "./cache";

/** UI actions for the name badge: regenerate and clear the naming cache. */
export function useNaming() {
  const molecule = useStore((s) => s.molecule);
  const setMolecule = useStore((s) => s.setMolecule);
  const setInfoMessage = useStore((s) => s.setInfoMessage);
  const [regenerating, setRegenerating] = useState(false);

  const regenerate = useCallback(async () => {
    if (!molecule || regenerating) return;
    if (!hasValidTextAISettings()) {
      setInfoMessage(t("namingRegenerateUnavailable"));
      return;
    }
    setRegenerating(true);
    try {
      await clearCachedName(molecule);
      const key = namingCacheKey(molecule);
      await namingService.upgrade(
        molecule,
        (name, source) => {
          const current = useStore.getState().molecule;
          if (!current || namingCacheKey(current) !== key) return;
          setMolecule({ ...current, iupacName: name, iupacSource: source, iupacError: undefined });
          setInfoMessage(t("namingRegenerated"));
        },
        () => setInfoMessage(t("namingRegenerateFailed")),
      );
    } catch {
      setInfoMessage(t("namingRegenerateFailed"));
    } finally {
      setRegenerating(false);
    }
  }, [molecule, regenerating, setInfoMessage, setMolecule]);

  const clearAll = useCallback(async () => {
    try {
      await clearAllNamingCache();
      setInfoMessage(t("namingCacheCleared"));
    } catch {
      setInfoMessage(t("namingRegenerateFailed"));
    }
  }, [setInfoMessage]);

  return { regenerate, clearAll, regenerating, canRegenerate: hasValidTextAISettings() };
}
