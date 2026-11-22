import type { BondSpec } from "./spec";

/**
 * Deterministic heavy-atom skeletons for the built-in examples.
 *
 * These are the last-resort source for formula-only callers; the normal input
 * path uses preset JSON or AI output and never consults this table.
 */
export const KNOWN_SPECS: Record<string, BondSpec> = {
  // Hydrocarbons
  CH4:  { atoms: ["C"],                       bonds: [] },
  C2H6: { atoms: ["C","C"],                   bonds: [[0,1,1]] },
  C2H4: { atoms: ["C","C"],                   bonds: [[0,1,2]] },
  C2H2: { atoms: ["C","C"],                   bonds: [[0,1,3]] },
  C3H8: { atoms: ["C","C","C"],               bonds: [[0,1,1],[1,2,1]] },
  C4H10:{ atoms: ["C","C","C","C"],           bonds: [[0,1,1],[1,2,1],[2,3,1]] },
  C5H12:{ atoms: ["C","C","C","C","C"],       bonds: [[0,1,1],[0,2,1],[0,3,1],[0,4,1]] }, // neopentane
  // Cycloalkanes
  C3H6: { atoms: ["C","C","C"],               bonds: [[0,1,1],[1,2,1],[2,0,1]],
          hybridizations: ["sp3","sp3","sp3"] },
  C4H8: { atoms: ["C","C","C","C"],           bonds: [[0,1,1],[1,2,1],[2,3,1],[3,0,1]],
          hybridizations: ["sp3","sp3","sp3","sp3"] },
  C5H10:{ atoms: ["C","C","C","C","C"],       bonds: [[0,1,1],[1,2,1],[2,3,1],[3,4,1],[4,0,1]],
          hybridizations: ["sp3","sp3","sp3","sp3","sp3"] },
  C6H12:{ atoms: ["C","C","C","C","C","C"],   bonds: [[0,1,1],[1,2,1],[2,3,1],[3,4,1],[4,5,1],[5,0,1]],
          hybridizations: ["sp3","sp3","sp3","sp3","sp3","sp3"] },
  C7H14:{ atoms: ["C","C","C","C","C","C","C"], bonds: [[0,1,1],[1,2,1],[2,3,1],[3,4,1],[4,5,1],[5,6,1],[6,0,1]],
          hybridizations: ["sp3","sp3","sp3","sp3","sp3","sp3","sp3"] },
  C8H16:{ atoms: ["C","C","C","C","C","C","C","C"], bonds: [[0,1,1],[1,2,1],[2,3,1],[3,4,1],[4,5,1],[5,6,1],[6,7,1],[7,0,1]],
          hybridizations: ["sp3","sp3","sp3","sp3","sp3","sp3","sp3","sp3"] },
  C9H18:{ atoms: ["C","C","C","C","C","C","C","C","C"], bonds: [[0,1,1],[1,2,1],[2,3,1],[3,4,1],[4,5,1],[5,6,1],[6,7,1],[7,8,1],[8,0,1]],
          hybridizations: ["sp3","sp3","sp3","sp3","sp3","sp3","sp3","sp3","sp3"] },
  C10H20:{ atoms: ["C","C","C","C","C","C","C","C","C","C"], bonds: [[0,1,1],[1,2,1],[2,3,1],[3,4,1],[4,5,1],[5,6,1],[6,7,1],[7,8,1],[8,9,1],[9,0,1]],
          hybridizations: ["sp3","sp3","sp3","sp3","sp3","sp3","sp3","sp3","sp3","sp3"] },

  // Alcohols & ethers
  CH4O: { atoms: ["C","O"],                   bonds: [[0,1,1]] },      // methanol
  C2H6O:{ atoms: ["C","C","O"],               bonds: [[0,1,1],[1,2,1]] }, // ethanol
  C2H6O2:{atoms: ["C","O","C"],               bonds: [[0,1,1],[1,2,1]] }, // dimethyl ether

  // Carbonyl compounds
  C2H4O:{ atoms: ["C","C","O"],               bonds: [[0,1,1],[1,2,2]] }, // acetaldehyde
  CH2O2:{ atoms: ["C","O","O"],               bonds: [[0,1,2],[0,2,1]] }, // formic acid
  C2H4O2:{atoms: ["C","C","O","O"],           bonds: [[0,1,1],[1,2,2],[1,3,1]] }, // acetic acid

  // Esters
  C3H6O2:{atoms:["C","C","O","O","C"],        bonds:[[0,1,1],[1,2,2],[1,3,1],[3,4,1]] }, // methyl acetate
  C4H8O2:{atoms:["C","C","C","O","O","C"],    bonds:[[0,1,1],[1,2,1],[2,3,2],[2,4,1],[4,5,1]] }, // ethyl acetate

  // Inorganic
  H2O:  { atoms: ["O"],                       bonds: [] },
  NH3:  { atoms: ["N"],                       bonds: [] },
  CO2:  { atoms: ["C","O","O"],               bonds: [[0,1,2],[0,2,2]] },

  // Amines
  CH5N: { atoms: ["C","N"],                   bonds: [[0,1,1]] },      // methylamine
  C2H7N:{ atoms: ["C","C","N"],               bonds: [[0,1,1],[1,2,1]] }, // ethylamine
};

export const NAME_MAP: Record<string, string> = {
  CH4:"methane", C2H6:"ethane", C2H4:"ethene", C2H2:"ethyne", C6H6:"benzene",
  C3H8:"propane", C4H10:"butane",
  C3H6:"cyclopropane", C4H8:"cyclobutane", C5H10:"cyclopentane",
  C6H12:"cyclohexane", C7H14:"cycloheptane",
  C8H16:"cyclooctane", C9H18:"cyclononane", C10H20:"cyclodecane",
  C3H6O2:"methyl acetate", C4H8O2:"ethyl acetate",
  CH4O:"methanol", C2H6O:"ethanol", C2H4O2:"acetic acid", CH2O2:"formic acid",
  C2H4O:"acetaldehyde", C2H6O2:"dimethyl ether",
  H2O:"water", NH3:"ammonia", CO2:"carbon dioxide",
  CH5N:"methylamine", C2H7N:"ethylamine",
};

/** Last-resort common-name pattern for simple hydrocarbon/oxygen/nitrogen formulas. */
export function generateName(formula: string): string | null {
  const match = formula.match(/^C(\d*)H(\d*)(.*)$/);
  if (!match) return null;
  const carbon = parseInt(match[1] || "1", 10);
  const hydrogen = parseInt(match[2] || "0", 10);
  const suffix = match[3];
  const prefix = ["","meth","eth","prop","but","pent","hex","hept","oct","non","dec"][carbon];
  if (!prefix) return null;
  if (!suffix) {
    if (hydrogen === 2 * carbon + 2) return prefix + "ane";
    if (hydrogen === 2 * carbon) return prefix + "ene";
    if (hydrogen === 2 * carbon - 2) return prefix + "yne";
    return null;
  }
  if (suffix === "O") {
    if (hydrogen === 2 * carbon + 2) return prefix + "anol";
    if (hydrogen === 2 * carbon) return prefix + "anal";
    return null;
  }
  if (suffix === "O2") {
    if (hydrogen === 2 * carbon + 2) return prefix + "anoic acid";
    return null;
  }
  if (suffix === "N") {
    if (hydrogen === 2 * carbon + 3) return prefix + "ylamine";
    return null;
  }
  return null;
}
