import { useEffect, useCallback, useRef } from "react";
import type { MoleculeData } from "../types/molecule";
import { buildFromBondSpec } from "../engine/vseprBuilder";
import { optimizeConformation } from "../engine/conformer";
import { isChemVZ, chemVZToBondSpec } from "../types/moleculeFormat";
import { useStore } from "../store/useStore";
import { parseLocalInput } from "../ai/localParser";
import { getAIConfig, hasValidTextAISettings, requestAISettings } from "../ai/config";
import { AIParseError, parseImageWithAI, parseWithAI } from "../ai/aiParser";
import type { ChemVZMolecule } from "../types/moleculeFormat";
import { clearAllCachedChemVZ, clearCachedChemVZ, getCachedChemVZ, saveCachedChemVZ } from "../ai/cache";
import { t } from "../i18n/index";

let rdkitModule: any = null;

async function initRDKitInternal(): Promise<boolean> {
  if (rdkitModule) return true;
  if (location.protocol === "file:") return false;
  try {
    if (typeof (window as any).initRDKitModule === "function") {
      rdkitModule = await (window as any).initRDKitModule({ locateFile: () => "RDKit_minimal.wasm" });
      return true;
    }
    console.warn("RDKit initRDKitModule not found on window");
    return false;
  } catch (error) {
    console.warn("RDKit WASM not available, using heuristic mode:", error);
    return false;
  }
}

function selectChemVZName(name: ChemVZMolecule["name"], locale: string): string | undefined {
  if (typeof name === "string") return name;
  if (!name || typeof name !== "object") return undefined;
  return name[locale] || name["en-US"] || Object.values(name)[0];
}

function buildMoleculeFromChemVZObject(obj: ChemVZMolecule, locale = "zh-CN"): MoleculeData {
  const spec = chemVZToBondSpec(obj);
  let result = buildFromBondSpec(spec, spec.formula, obj.smiles || "", selectChemVZName(obj.name, locale));
  result = optimizeConformation(result);
  return { ...result, name: selectChemVZName(obj.name, locale) || result.name, smiles: obj.smiles || result.smiles };
}

function resizeImageForAI(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      try {
        const maxDimension = 1600;
        const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
        const width = Math.max(1, Math.round(image.naturalWidth * scale));
        const height = Math.max(1, Math.round(image.naturalHeight * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("无法创建图片处理画布");
        context.drawImage(image, 0, 0, width, height);
        canvas.toBlob((blob) => {
          URL.revokeObjectURL(objectUrl);
          if (!blob) {
            reject(new Error("无法压缩图片"));
            return;
          }
          const reader = new FileReader();
          reader.onload = () => typeof reader.result === "string"
            ? resolve(reader.result)
            : reject(new Error("无法读取压缩图片"));
          reader.onerror = () => reject(reader.error || new Error("无法读取压缩图片"));
          reader.readAsDataURL(blob);
        }, "image/jpeg", 0.82);
      } catch (error) {
        URL.revokeObjectURL(objectUrl);
        reject(error);
      }
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("无法读取图片"));
    };
    image.src = objectUrl;
  });
}

async function imageCacheInput(dataUrl: string): Promise<string> {
  try {
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(dataUrl));
    return `image:${Array.from(new Uint8Array(bytes)).map((value) => value.toString(16).padStart(2, "0")).join("")}`;
  } catch {
    let hash = 2166136261;
    for (const char of dataUrl) {
      hash ^= char.codePointAt(0) || 0;
      hash = Math.imul(hash, 16777619);
    }
    return `image:${(hash >>> 0).toString(16).padStart(8, "0")}`;
  }
}

export function useMolecule() {
  const setMolecule = useStore(s => s.setMolecule);
  const setLoading = useStore(s => s.setLoading);
  const setError = useStore(s => s.setError);
  const setInfoMessage = useStore(s => s.setInfoMessage);
  const setRdkitReady = useStore(s => s.setRdkitReady);
  const setRotatingBond = useStore(s => s.setRotatingBond);
  const setConformerStats = useStore(s => s.setConformerStats);
  const setParseSource = useStore(s => s.setParseSource);
  const locale = useStore(s => s.locale);
  const rdkitReady = useStore(s => s.rdkitReady);
  const lastImageRef = useRef<{ cacheInput: string; dataUrl: string } | null>(null);

  useEffect(() => {
    if (rdkitReady) return;
    initRDKitInternal().then(ready => { setRdkitReady(ready); console.log(`RDKit WASM ${ready ? "loaded" : "not available, using heuristic mode"}`); });
  }, [rdkitReady, setRdkitReady]);

  const resetInputState = () => {
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
      setMolecule(buildMoleculeFromChemVZObject(obj, locale));
    } catch (error) {
      setError(t("fileErrorPrefix") + (error instanceof Error ? error.message : String(error)));
    } finally {
      setLoading(false);
    }
  }, [locale, setError, setLoading, setMolecule, setParseSource, setRotatingBond, setConformerStats, setInfoMessage]);

  const processInput = useCallback(async (input: string, forceAI = false) => {
    resetInputState();
    try {
      const local = parseLocalInput(input);
      if (local) {
        setMolecule(buildMoleculeFromChemVZObject(local.chemvz, locale));
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
            setMolecule(buildMoleculeFromChemVZObject(cached.chemvz, locale));
            setParseSource("cache", input);
            setInfoMessage(t("aiCacheLoaded"));
            return;
          }
        } catch (cacheError) {
          console.warn("Unable to read AI cache; continuing with AI parsing", cacheError);
        }
      }

      const chemvz = await parseWithAI(input, getAIConfig());
      setMolecule(buildMoleculeFromChemVZObject(chemvz, locale));
      setParseSource("ai", input);
      try {
        await saveCachedChemVZ(input, chemvz);
      } catch (cacheError) {
        console.warn("Unable to save AI cache", cacheError);
      }
      setInfoMessage(chemvz.comment ? t("aiParsingComment", { comment: chemvz.comment }) : t("aiParsingComplete"));
    } catch (error) {
      if (error instanceof AIParseError) setError(error.message);
      else setError(t("aiParsingFailed") + (error instanceof Error ? error.message : String(error)));
    } finally {
      setLoading(false);
    }
  }, [locale, setError, setInfoMessage, setLoading, setMolecule, setParseSource, setRotatingBond, setConformerStats]);

  const processImageData = useCallback(async (dataUrl: string, forceAI = false) => {
    resetInputState();
    try {
      const cacheInput = await imageCacheInput(dataUrl);
      lastImageRef.current = { cacheInput, dataUrl };
      if (!forceAI) {
        try {
          const cached = await getCachedChemVZ(cacheInput);
          if (cached) {
            setMolecule(buildMoleculeFromChemVZObject(cached.chemvz, locale));
            setParseSource("cache", cacheInput);
            setInfoMessage(t("aiCacheLoaded"));
            return;
          }
        } catch (cacheError) {
          console.warn("Unable to read image AI cache; continuing with AI parsing", cacheError);
        }
      }
      const chemvz = await parseImageWithAI(dataUrl);
      setMolecule(buildMoleculeFromChemVZObject(chemvz, locale));
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
  }, [locale, setError, setInfoMessage, setLoading, setMolecule, setParseSource, setRotatingBond, setConformerStats]);

  const processImage = useCallback(async (file: File) => {
    resetInputState();
    try {
      const dataUrl = await resizeImageForAI(file);
      await processImageData(dataUrl);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
      setLoading(false);
    }
  }, [processImageData, setError, setInfoMessage, setLoading]);

  const regenerate = useCallback(async (input: string) => {
    if (lastImageRef.current?.cacheInput === input) {
      await processImageData(lastImageRef.current.dataUrl, true);
    } else {
      await processInput(input, true);
    }
  }, [processImageData, processInput]);


  const clearCurrentCache = useCallback(async (input: string) => {
    await clearCachedChemVZ(input);
    setParseSource(null);
  }, [setParseSource]);

  const clearAllCache = useCallback(async () => {
    await clearAllCachedChemVZ();
    setParseSource(null);
  }, [setParseSource]);

  return { processChemVZFile, processInput, processImage, processImageData, regenerate, clearCurrentCache, clearAllCache };
}
