// Parse a chemical formula like "C2H5OH" or "CH3COOH" into element counts.
// Returns a map: element symbol -> count
export function parseFormula(formula: string): Map<string, number> {
  const counts = new Map<string, number>();

  // Remove bond notation but keep parentheses for grouping
  const clean = formula.replace(/[=\u2261\[\]]/g, '');

  let i = 0;
  while (i < clean.length) {
    const ch = clean[i];
    if (ch >= 'A' && ch <= 'Z') {
      let el = ch;
      i++;
      while (i < clean.length && clean[i] >= 'a' && clean[i] <= 'z') {
        el += clean[i];
        i++;
      }
      let cntStr = '';
      while (i < clean.length && clean[i] >= '0' && clean[i] <= '9') {
        cntStr += clean[i];
        i++;
      }
      const cnt = cntStr === '' ? 1 : parseInt(cntStr, 10);
      counts.set(el, (counts.get(el) || 0) + cnt);
    } else if (ch === '(' || ch === '{') {
      const close = ch === '(' ? ')' : '}';
      let depth = 1;
      let j = i + 1;
      while (j < clean.length && depth > 0) {
        if (clean[j] === ch) depth++;
        else if (clean[j] === close) depth--;
        j++;
      }
      const inner = clean.substring(i + 1, j - 1);
      i = j;
      let multStr = '';
      while (i < clean.length && clean[i] >= '0' && clean[i] <= '9') {
        multStr += clean[i];
        i++;
      }
      const mult = multStr === '' ? 1 : parseInt(multStr, 10);
      const innerCounts = parseFormula(inner);
      for (const [el, cnt] of innerCounts) {
        counts.set(el, (counts.get(el) || 0) + cnt * mult);
      }
    } else {
      i++;
    }
  }
  return counts;
}

// Get the total number of atoms from a parsed formula
export function totalAtomCount(formula: string): number {
  const counts = parseFormula(formula);
  let total = 0;
  for (const count of counts.values()) {
    total += count;
  }
  return total;
}

// Atomic data lookup
export interface AtomicData {
  symbol: string;
  name: string;
  covalentRadius: number;  // in picometers
  vdwRadius: number;       // in picometers (CPK)
  mass: number;
  color: string;           // CPK color hex
}

export const ATOMIC_DATA: Record<string, AtomicData> = {
  H:  { symbol: "H",  name: "Hydrogen",     covalentRadius: 31,  vdwRadius: 120, mass: 1.008,  color: "#FFFFFF" },
  C:  { symbol: "C",  name: "Carbon",       covalentRadius: 76,  vdwRadius: 170, mass: 12.011, color: "#909090" },
  N:  { symbol: "N",  name: "Nitrogen",     covalentRadius: 71,  vdwRadius: 155, mass: 14.007, color: "#3050F8" },
  O:  { symbol: "O",  name: "Oxygen",       covalentRadius: 66,  vdwRadius: 152, mass: 15.999, color: "#FF0D0D" },
  F:  { symbol: "F",  name: "Fluorine",     covalentRadius: 57,  vdwRadius: 147, mass: 18.998, color: "#90E050" },
  Cl: { symbol: "Cl", name: "Chlorine",     covalentRadius: 99,  vdwRadius: 175, mass: 35.453, color: "#1FF01F" },
  Br: { symbol: "Br", name: "Bromine",      covalentRadius: 114, vdwRadius: 185, mass: 79.904, color: "#A62929" },
  I:  { symbol: "I",  name: "Iodine",       covalentRadius: 133, vdwRadius: 198, mass: 126.904, color: "#940094" },
  S:  { symbol: "S",  name: "Sulfur",       covalentRadius: 103, vdwRadius: 180, mass: 32.065, color: "#FFFF30" },
  P:  { symbol: "P",  name: "Phosphorus",   covalentRadius: 107, vdwRadius: 180, mass: 30.974, color: "#FF8000" },
  Na: { symbol: "Na", name: "Sodium",       covalentRadius: 154, vdwRadius: 227, mass: 22.990, color: "#AB5CF2" },
  Mg: { symbol: "Mg", name: "Magnesium",    covalentRadius: 130, vdwRadius: 173, mass: 24.305, color: "#8AFF00" },
};