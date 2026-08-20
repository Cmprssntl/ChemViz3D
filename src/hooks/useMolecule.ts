import { useEffect, useCallback } from "react";
import type { MoleculeData } from "../types/molecule";
import { buildFromBondSpec } from "../engine/vseprBuilder";
import { optimizeConformation } from "../engine/conformer";
import { isChemVZ, chemVZToBondSpec } from "../types/moleculeFormat";
import { useStore } from "../store/useStore";
import { parseLocalInput } from "../ai/localParser";
import { getAIConfig, hasValidTextAISettings, requestAISettings } from "../ai/config";
import { AIParseError, parseWithAI } from "../ai/aiParser";
import type { ChemVZMolecule } from "../types/moleculeFormat";
import { clearAllCachedChemVZ, clearCachedChemVZ, getCachedChemVZ, saveCachedChemVZ } from "../ai/cache";

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
        setError("Invalid chemvz.json format (chemvz: 1, atoms[], bonds[] required)");
        return;
      }
      setMolecule(buildMoleculeFromChemVZObject(obj, locale));
    } catch (error) {
      setError("File error: " + (error instanceof Error ? error.message : String(error)));
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
        setInfoMessage(`本地预设：${local.presetId}`);
        return;
      }

      // Reject unavailable AI before touching the desktop cache bridge. This
      // keeps an unconfigured desktop responsive even when its bridge is slow.
      if (!hasValidTextAISettings()) {
        requestAISettings("AI 功能已禁用：请先填写有效的 API 配置。");
        return;
      }

      if (!forceAI) {
        try {
          const cached = await getCachedChemVZ(input);
          if (cached) {
            setMolecule(buildMoleculeFromChemVZObject(cached.chemvz, locale));
            setParseSource("cache", input);
            setInfoMessage("已从 AI 缓存加载");
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
      setInfoMessage(chemvz.comment ? `AI：${chemvz.comment}` : "AI 解析完成");
    } catch (error) {
      if (error instanceof AIParseError) setError(error.message);
      else setError("AI 解析失败：" + (error instanceof Error ? error.message : String(error)));
    } finally {
      setLoading(false);
    }
  }, [locale, setError, setInfoMessage, setLoading, setMolecule, setParseSource, setRotatingBond, setConformerStats]);

  const clearCurrentCache = useCallback(async (input: string) => {
    await clearCachedChemVZ(input);
    setParseSource(null);
  }, [setParseSource]);

  const clearAllCache = useCallback(async () => {
    await clearAllCachedChemVZ();
    setParseSource(null);
  }, [setParseSource]);

  return { processChemVZFile, processInput, clearCurrentCache, clearAllCache };
}
