import { useCallback, useRef } from "react";
import type { MoleculeData } from "../types/molecule";
import { ConformerError, ConformerService } from "../engine/conformer/ConformerService";
import { isChemVZ, chemVZToBondSpec } from "../types/moleculeFormat";
import { useStore } from "../store/useStore";
import { parseLocalInput } from "../ai/localParser";
import { getAIConfig, hasValidTextAISettings, requestAISettings } from "../ai/config";
import { AIParseError, parseImageWithAI, parseWithAI } from "../ai/aiParser";
import { imageCacheInput } from "../ai/image";
import type { ChemVZMolecule } from "../types/moleculeFormat";
import { clearAllCachedChemVZ, clearCachedChemVZ, getCachedChemVZ, saveCachedChemVZ } from "../ai/cache";
import { namingService } from "../naming/NamingService";
import { useMoleculeUpgrade, type BuiltMolecule } from "./useMoleculeUpgrade";
import { t } from "../i18n/index";

function selectChemVZName(name: ChemVZMolecule["name"], locale: string): string | undefined {
  if (typeof name === "string") return name;
  if (!name || typeof name !== "object") return undefined;
  return name[locale] || name["en-US"] || Object.values(name)[0];
}

const conformerService = new ConformerService();

function buildMoleculeFromChemVZObject(
  obj: ChemVZMolecule,
  locale = "zh-CN",
  presetIupac?: string,
): BuiltMolecule {
  const spec = chemVZToBondSpec(obj);
  const name = selectChemVZName(obj.name, locale);
  const result = conformerService.build(
    {
      elements: spec.atoms,
      bonds: spec.bonds,
      ...(spec.hybridizations ? { hybridizations: spec.hybridizations } : {}),
      ...(spec.charges ? { charges: spec.charges } : {}),
      formula: spec.formula,
      smiles: obj.smiles || "",
    },
    { name },
  );
  if (result.warnings.length > 0) {
    console.warn(`[conformer:${result.backend}]`, ...result.warnings);
  }
  return {
    molecule: withIupacName(result.molecule, presetIupac),
    refine: result.refine,
  };
}

/**
 * Naming is a separate, deterministic stage. Preset names are authoritative;
 * everything else starts with the local namer. A failure is stored verbatim
 * so the UI can show "not nameable" instead of silently substituting the
 * formula. The caller upgrades the name asynchronously when AI is available.
 */
function withIupacName(molecule: MoleculeData, presetIupac?: string): MoleculeData {
  const resolution = namingService.resolve(molecule, presetIupac);
  return {
    ...molecule,
    iupacName: resolution.name,
    iupacSource: resolution.source,
    iupacError: resolution.error,
  };
}

/**
 * Geometry failures are reported explicitly. Silently rendering nothing (or
 * falling back to a 2D sketch) is what made the old "structure got stretched"
 * bug so hard to diagnose.
 */
function describeBuildFailure(error: unknown): string {
  if (error instanceof ConformerError) return `${t("conformerFailed")}: ${error.message}`;
  return t("conformerFailed") + ": " + (error instanceof Error ? error.message : String(error));
}

export function useMolecule() {
  const setMolecule = useStore(s => s.setMolecule);
  const setLoading = useStore(s => s.setLoading);
  const setError = useStore(s => s.setError);
  const setInfoMessage = useStore(s => s.setInfoMessage);
  const setRotatingBond = useStore(s => s.setRotatingBond);
  const setConformerStats = useStore(s => s.setConformerStats);
  const setParseSource = useStore(s => s.setParseSource);
  const locale = useStore(s => s.locale);
  /** Last imported image, so "regenerate" repeats the vision request. */
  const lastImageRef = useRef<{ cacheInput: string; dataUrl: string } | null>(null);
  const { apply: applyMolecule, cancel: cancelUpgrades } = useMoleculeUpgrade(setMolecule);

  const resetInputState = () => {
    cancelUpgrades();
    setLoading(true); setError(null); setInfoMessage(null); setMolecule(null);
    setRotatingBond(null); setConformerStats(null); setParseSource(null);
  };

  const processChemVZFile = useCallback(async (file: File) => {
    resetInputState();
    try {
      const obj = JSON.parse(await file.text());
      if (!isChemVZ(obj)) {
        setError(t("invalidChemvzFile"));
        return;
      }
      applyMolecule(buildMoleculeFromChemVZObject(obj, locale));
    } catch (error) {
      setError(error instanceof ConformerError
        ? describeBuildFailure(error)
        : t("fileErrorPrefix") + (error instanceof Error ? error.message : String(error)));
    } finally {
      setLoading(false);
    }
  }, [applyMolecule, locale, setError, setLoading, setParseSource, setRotatingBond, setConformerStats, setInfoMessage]);

  const processInput = useCallback(async (input: string, forceAI = false) => {
    resetInputState();
    try {
      const local = parseLocalInput(input);
      if (local) {
        applyMolecule(buildMoleculeFromChemVZObject(local.chemvz, locale, local.iupac));
        setParseSource("preset");
        setInfoMessage(t("localPresetLoaded", { id: local.presetId }));
        return;
      }

      // Reject unavailable AI before touching the desktop cache bridge. This
      // keeps an unconfigured desktop responsive even when its bridge is slow.
      if (!hasValidTextAISettings()) {
        requestAISettings(t("aiDisabledMessage"));
        return;
      }

      if (!forceAI) {
        try {
          const cached = await getCachedChemVZ(input);
          if (cached) {
            applyMolecule(buildMoleculeFromChemVZObject(cached.chemvz, locale));
            setParseSource("cache", input);
            setInfoMessage(t("aiCacheLoaded"));
            return;
          }
        } catch (cacheError) {
          console.warn("Unable to read AI cache; continuing with AI parsing", cacheError);
        }
      }

      const chemvz = await parseWithAI(input, getAIConfig());
      applyMolecule(buildMoleculeFromChemVZObject(chemvz, locale));
      setParseSource("ai", input);
      try {
        await saveCachedChemVZ(input, chemvz);
      } catch (cacheError) {
        console.warn("Unable to save AI cache", cacheError);
      }
      setInfoMessage(chemvz.comment ? t("aiParsingComment", { comment: chemvz.comment }) : t("aiParsingComplete"));
    } catch (error) {
      if (error instanceof ConformerError) setError(describeBuildFailure(error));
      else if (error instanceof AIParseError) setError(error.message);
      else setError(t("aiParsingFailed") + (error instanceof Error ? error.message : String(error)));
    } finally {
      setLoading(false);
    }
  }, [applyMolecule, locale, setError, setInfoMessage, setLoading, setParseSource, setRotatingBond, setConformerStats]);


  /**
   * Runs the vision model on an image data URL. Shares the cache and error
   * handling of the text path so both behave identically.
   */
  const processImageData = useCallback(async (dataUrl: string, forceAI = false) => {
    resetInputState();
    try {
      const cacheInput = await imageCacheInput(dataUrl);
      lastImageRef.current = { cacheInput, dataUrl };
      if (!forceAI) {
        try {
          const cached = await getCachedChemVZ(cacheInput);
          if (cached) {
            applyMolecule(buildMoleculeFromChemVZObject(cached.chemvz, locale));
            setParseSource("cache", cacheInput);
            setInfoMessage(t("aiCacheLoaded"));
            return;
          }
        } catch (cacheError) {
          console.warn("Unable to read image AI cache; continuing with AI parsing", cacheError);
        }
      }
      const chemvz = await parseImageWithAI(dataUrl);
      applyMolecule(buildMoleculeFromChemVZObject(chemvz, locale));
      setParseSource("ai", cacheInput);
      try {
        await saveCachedChemVZ(cacheInput, chemvz);
      } catch (cacheError) {
        console.warn("Unable to save image AI cache", cacheError);
      }
      setInfoMessage(chemvz.comment ? t("aiParsingComment", { comment: chemvz.comment }) : t("aiParsingComplete"));
    } catch (error) {
      if (error instanceof AIParseError) setError(error.message);
      else setError(t("aiParsingFailed") + (error instanceof Error ? error.message : String(error)));
    } finally {
      setLoading(false);
    }
  }, [applyMolecule, locale, setError, setInfoMessage, setLoading, setParseSource, setRotatingBond, setConformerStats]);

  const clearCurrentCache = useCallback(async (input: string) => {
    await clearCachedChemVZ(input);
    setParseSource(null);
  }, [setParseSource]);

  const clearAllCache = useCallback(async () => {
    await clearAllCachedChemVZ();
    setParseSource(null);
  }, [setParseSource]);

  const regenerate = useCallback(async (input: string) => {
    if (lastImageRef.current?.cacheInput === input) {
      await processImageData(lastImageRef.current.dataUrl, true);
      return;
    }
    await processInput(input, true);
  }, [processImageData, processInput]);

  return { processChemVZFile, processInput, processImageData, regenerate, clearCurrentCache, clearAllCache };
}
