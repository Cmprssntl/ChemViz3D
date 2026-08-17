import { useEffect, useCallback } from "react";
import type { MoleculeData } from "../types/molecule";
import { buildFromBondSpec } from "../engine/vseprBuilder";
import { optimizeConformation } from "../engine/conformer";
import { isChemVZ, chemVZToBondSpec } from "../types/moleculeFormat";
import { useStore } from "../store/useStore";
import { parseLocalInput } from "../ai/localParser";
import { getAIConfig } from "../ai/config";
import { AIParseError, parseWithAI } from "../ai/aiParser";
import type { ChemVZMolecule } from "../types/moleculeFormat";

let rdkitModule: any = null;

async function initRDKitInternal(): Promise<boolean> {
  if (rdkitModule) return true;
  // RDKit WASM can't load in file:// protocol (Android WebView, local file).
  // Skip gracefully instead of hanging forever on the await.
  if (location.protocol === "file:") return false;
  try {
    if (typeof (window as any).initRDKitModule === "function") {
      const module = await (window as any).initRDKitModule({ locateFile: () => "RDKit_minimal.wasm" });
      rdkitModule = module;
      return true;
    }
    console.warn("RDKit initRDKitModule not found on window");
    return false;
  } catch (e) {
    console.warn("RDKit WASM not available, using heuristic mode:", e);
    return false;
  }
}

function buildMoleculeFromChemVZObject(obj: ChemVZMolecule): MoleculeData {
  const spec = chemVZToBondSpec(obj);
  let result = buildFromBondSpec(spec, spec.formula, spec.formula);
  result = optimizeConformation(result);
  return { ...result, name: obj.name || result.name };
}

export function useMolecule() {
  const setMolecule = useStore(s => s.setMolecule);
  const setLoading = useStore(s => s.setLoading);
  const setError = useStore(s => s.setError);
  const setInfoMessage = useStore(s => s.setInfoMessage);
  const setRdkitReady = useStore(s => s.setRdkitReady);
  const setRotatingBond = useStore(s => s.setRotatingBond);
  const setConformerStats = useStore(s => s.setConformerStats);
  const rdkitReady = useStore(s => s.rdkitReady);

  useEffect(() => {
    if (rdkitReady) return;
    initRDKitInternal().then(ready => { setRdkitReady(ready); console.log(`RDKit WASM ${ready ? "loaded" : "not available, using heuristic mode"}`); });
  }, []);

  const processChemVZFile = useCallback(async (file: File) => {
    setLoading(true); setError(null); setInfoMessage(null); setMolecule(null);
    setRotatingBond(null); setConformerStats(null);
    try {
      const text = await file.text();
      const obj = JSON.parse(text);
      if (!isChemVZ(obj)) {
        setError("Invalid chemvz.json format (chemvz: 1, atoms[], bonds[] required)");
        setLoading(false); return;
      }
      setMolecule(buildMoleculeFromChemVZObject(obj));
    } catch (e) {
      setError("File error: " + (e instanceof Error ? e.message : String(e)));
    }
    setLoading(false);
  }, [setMolecule, setLoading, setError, setRotatingBond]);

  const processInput = useCallback(async (input: string) => {
    setLoading(true); setError(null); setInfoMessage(null); setMolecule(null);
    setRotatingBond(null); setConformerStats(null);
    try {
      const local = parseLocalInput(input);
      if (local) {
        setMolecule(buildMoleculeFromChemVZObject(local.chemvz));
        setInfoMessage(`本地预设：${local.presetId}（未调用 AI）`);
        return;
      }

      const chemvz = await parseWithAI(input, getAIConfig());
      setMolecule(buildMoleculeFromChemVZObject(chemvz));
      setInfoMessage(chemvz.comment ? `AI：${chemvz.comment}` : "AI 解析完成");
    } catch (error) {
      if (error instanceof AIParseError) {
        setError(error.message);
      } else {
        setError("AI 解析失败：" + (error instanceof Error ? error.message : String(error)));
      }
    } finally {
      setLoading(false);
    }
  }, [setConformerStats, setError, setInfoMessage, setLoading, setMolecule, setRotatingBond]);

  return { processChemVZFile, processInput };
}
