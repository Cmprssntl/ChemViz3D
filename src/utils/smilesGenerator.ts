import { parseFormula, ATOMIC_DATA } from "./formulaParser";

/**
 * Generate a plausible SMILES string from a molecular formula.
 * This is a heuristic approach for simple organic molecules.
 * For complex cases, RDKit handles the conversion properly.
 */
export function formulaToSMILES(formula: string): string | null {
  const counts = parseFormula(formula);
  const C = counts.get("C") || 0;
  const H = counts.get("H") || 0;
  const O = counts.get("O") || 0;
  const N = counts.get("N") || 0;
  const F = counts.get("F") || 0;
  const Cl = counts.get("Cl") || 0;
  const Br = counts.get("Br") || 0;
  const I = counts.get("I") || 0;
  const S = counts.get("S") || 0;
  const P = counts.get("P") || 0;

  // Known molecules - direct mappings
  const known: Record<string, string> = {
    "CH4": "C",
    "C2H6": "CC",
    "C3H8": "CCC",
    "C4H10": "CCCC",
    "C2H4": "C=C",
    "C3H6": "CC=C",
    "C2H2": "C#C",
    "C6H6": "c1ccccc1",
    "CH3OH": "CO",
    "C2H5OH": "CCO",
    "C3H7OH": "CCCO",
    "CH3COOH": "CC(=O)O",
    "HCOOH": "C(=O)O",
    "CH3OCH3": "COC",
    "C2H5OC2H5": "CCOCC",
    "CH3CHO": "CC=O",
    "CH3COCH3": "CC(=O)C",
    "CH3NH2": "CN",
    "C2H5NH2": "CCN",
    "CH3Cl": "CCl",
    "CH2Cl2": "C(Cl)Cl",
    "CHCl3": "C(Cl)(Cl)Cl",
    "CCl4": "C(Cl)(Cl)(Cl)Cl",
    "H2O": "O",
    "NH3": "N",
    "CO2": "C(=O)=O",
    "C2H6O": "CCO",
    "CH2O": "C=O",
    "C3H8O": "CCCO",
  };

  // Remove hydrogens for lookup
  const heavyFormula = formula.replace(/H\d*/g, "").replace(/(\D)0/, "$1");
  const lookupKey = Object.keys(known).find(
    (k) => parseFormula(k).get("C") === C && parseFormula(k).get("H") === H &&
           parseFormula(k).get("O") === O && parseFormula(k).get("N") === N
  );
  if (lookupKey) return known[lookupKey];

  // If only carbon backbone: build linear alkane/alkene/alkyne
  if (C > 0 && O === 0 && N === 0 && S === 0 && P === 0) {
    const halogens = F + Cl + Br + I;
    if (H === 2 * C + 2 - halogens) {
      // Alkane: C-C-C-...
      return Array(C).fill("C").join("");
    }
    if (H === 2 * C - halogens) {
      // Alkene with one double bond
      if (C >= 2) {
        const chain = Array(C).fill("C");
        chain[0] = "C";
        chain[1] = "=C";
        return chain.join("");
      }
    }
  }

  // Generic: build a carbon backbone with functional groups
  if (C > 0) {
    let smiles = "";
    if (O > 0) {
      // Try alcohol: C-C-...-O
      smiles = Array(C).fill("C").join("") + (O === 1 ? "O" : Array(O).fill("O").join(""));
      return smiles;
    }
  }

  // Single atom or simple
  if (C === 1 && O === 0 && N === 0) {
    const halogens = F + Cl + Br + I;
    if (halogens === 1) return "C" + (F ? "F" : Cl ? "Cl" : Br ? "Br" : "I");
    return "C";
  }

  return null;
}

/**
 * Get atomic radius for display mode
 */
export function getAtomicRadius(element: string, mode: "ball-and-stick" | "space-filling"): number {
  const data = ATOMIC_DATA[element];
  if (!data) return mode === "ball-and-stick" ? 0.4 : 1.0;
  if (mode === "ball-and-stick") {
    // Scale covalent radius to visible size (covalent radius in pm / 100)
    return Math.max(0.25, data.covalentRadius / 100);
  }
  // Space-filling: van der Waals radius
  return Math.max(0.4, data.vdwRadius / 100);
}
