import { useEffect, useCallback } from "react";
import type { MoleculeData } from "../types/molecule";
import { parseFormula, ATOMIC_DATA } from "../utils/formulaParser";
import { formulaToSMILES } from "../utils/smilesGenerator";
import { buildHeuristicMolecule } from "../engine/builder";
import { buildFromBondSpec } from "../engine/vseprBuilder";
import { optimizeConformation } from "../engine/conformer";
import { isChemVZ, chemVZToBondSpec, moleculeDataToChemVZ } from "../types/moleculeFormat";
import { useStore } from "../store/useStore";
import { validateFormula } from "../engine/validation";

const KNOWN_FORMULAS: Record<string, string> = {
  "CH4": "C", "C2H6": "CC", "C3H8": "CCC", "C4H10": "CCCC",
  "C2H4": "C=C", "C3H6": "CC=C", "C2H2": "C#C", "C6H6": "c1ccccc1",
  "CH3OH": "CO", "C2H5OH": "CCO", "C3H7OH": "CCCO",
  "CH3COOH": "CC(=O)O", "HCOOH": "C(=O)O", "CH3OCH3": "COC",
  "CH3CHO": "CC=O", "C3H6O2": "CC(=O)OC", "C4H8O2": "CC(=O)OCC", "C5H12": "CC(C)(C)C", "H2O": "O", "NH3": "N", "CO2": "O=C=O",
  };

let rdkitModule: any = null;

async function initRDKitInternal(): Promise<boolean> {
  if (rdkitModule) return true;
  try {
    if (typeof (window as any).initRDKitModule === "function") {
      const module = await (window as any).initRDKitModule({ locateFile: () => "/RDKit_minimal.wasm" });
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

function processWithRDKit(smiles: string, formula: string): MoleculeData | null {
  // Disabled - heuristic builder is more reliable for 3D coordinates
  // Only used for IUPAC name via the processFormula path
  return null;
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

  const processFormula = useCallback(async (formula: string) => {
    setLoading(true); setError(null); setInfoMessage(null); setMolecule(null);
    setRotatingBond(null); setConformerStats(null);
    try {
      const cleaned = formula.trim();
      if (!cleaned) { setError("Please enter a chemical formula"); setLoading(false); return; }
      if (parseFormula(cleaned).size === 0) { setError("Invalid formula format. Use format like C2H5OH"); setLoading(false); return; }


      // Build canonical formula from counts (handles CH2=CH2 -> C2H4, etc.)
      const _counts = parseFormula(cleaned);
      const _order = ["C","H","O","N","S","P","F","Cl","Br","I"];
      const canonical = [ ..._counts.entries() ]
        .sort((a,b) => _order.indexOf(a[0]) - _order.indexOf(b[0]))
        .map(([el,cnt]) => el + (cnt > 1 ? cnt : ""))
        .join("");
      const formulaKey = KNOWN_FORMULAS[canonical] ? canonical : cleaned;

      // Validate chemical sanity before building
      const valResult = validateFormula(canonical);
      if (!valResult.valid) {
        setError(valResult.errors.join("; "));
        setLoading(false);
        return;
      }

      // Auto-correct incomplete formulas (e.g. CH3CH2 -> C2H6)
      let correctedFormula = canonical;
      let correctionMsg: string | null = null;
      if (valResult.suggestedCorrection) {
        correctedFormula = valResult.suggestedCorrection;
        correctionMsg = "Assuming missing H, treating as " + correctedFormula;
        setInfoMessage(correctionMsg);
      }

      let result: MoleculeData | null = null;
      // Always use heuristic builder for reliable 3D coordinates
      {
        const buildFormula = correctionMsg ? correctedFormula : canonical;
        const h = KNOWN_FORMULAS[buildFormula] || formulaToSMILES(buildFormula) || buildFormula;
        result = buildHeuristicMolecule(buildFormula, h);
      }
      // RDKit for IUPAC name only (not 3D coordinates)
      if (result && rdkitReady) {
        try {
          const nmol = rdkitModule.get_mol(result.smiles || KNOWN_FORMULAS[canonical] || canonical);
          if (nmol) {
            try { const n = nmol.get_iupac_name(); if (n) result = { ...result, name: n }; } catch {}
            nmol.delete();
          }
        } catch {}
      }
      // Optimize conformation: rotate single bonds to maximize steric separation
      if (result) result = optimizeConformation(result);
      if (result) setMolecule(result); else setError("Could not process formula: " + cleaned);
    } catch (e) { setError("Error: " + (e instanceof Error ? e.message : String(e))); }
    setLoading(false);
  }, [rdkitReady, setMolecule, setLoading, setError, setRotatingBond]);

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
      const spec = chemVZToBondSpec(obj);
      let result = buildFromBondSpec(spec, spec.formula, spec.formula);
      if (result) result = optimizeConformation(result);
      if (result) {
        result = { ...result, name: obj.name || spec.formula };
        setMolecule(result);
      } else {
        setError("Could not build molecule from file: " + (obj.name || "unknown"));
      }
    } catch (e) {
      setError("File error: " + (e instanceof Error ? e.message : String(e)));
    }
    setLoading(false);
  }, [setMolecule, setLoading, setError, setRotatingBond]);

  return { processFormula, processChemVZFile };
}
