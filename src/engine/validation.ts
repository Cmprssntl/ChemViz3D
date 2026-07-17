/**
 * Chemical formula validation for ChemViz3D — 键价视角的通用验证
 *
 * 核心原则：从键价（bond-valence）角度判断结构是否可能。
 * 每个原子必须满足其化合价，总键级和必须与总价电子数一致。
 * 使用 "Σvalence/2 = total_bond_order" 原理检查公式可行性。
 *
 * Rejects impossible formulas like CH5 (pentavalent carbon), CO3 (impossible valence),
 * while allowing valid ones like C2H5OH (ethanol).
 */
import { parseFormula } from "../utils/formulaParser";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  degreeUnsaturation: number | null;
  valenceElectrons: number | null;
  suggestedCorrection: string | null;
}

const VALENCE: Record<string, number> = {
  H: 1, C: 4, N: 5, O: 6, F: 7,
  Na: 1, Mg: 2, Si: 4, P: 5, S: 6, Cl: 7,
  Br: 7, I: 7,
};

/** 每种元素的σ键容量（价电子形成的键数 — 即化合价） */
const BOND_CAPACITY: Record<string, number> = {
  H: 1, C: 4, N: 3, O: 2, F: 1,
  Na: 1, Mg: 2, Si: 4, P: 3, S: 2, Cl: 1,
  Br: 1, I: 1,
};

/**
 * Validate a chemical formula for basic chemical sanity.
 *
 * 通用的键价验证算法：
 * 1. DoU 必须 ≥ 0 且为整数 → 检查 H 计数奇偶
 * 2. 每个原子必须有可能的键连接数（不超价）
 * 3. 对于无 H 环境下的重原子，需验证是否能通过键级分配满足化合价
 */
export function validateFormula(formula: string): ValidationResult {
  const result: ValidationResult = {
    valid: true,
    errors: [],
    warnings: [],
    degreeUnsaturation: null,
    valenceElectrons: null,
    suggestedCorrection: null,
  };

  const counts = parseFormula(formula);
  if (counts.size === 0) {
    result.valid = false;
    result.errors.push("No elements detected");
    return result;
  }

  // 1. Unknown element check
  for (const [el] of counts) {
    if (!(el in BOND_CAPACITY)) {
      result.warnings.push("Unknown element: " + el);
    }
  }

  // Get element counts
  const C = counts.get("C") ?? 0;
  const H = counts.get("H") ?? 0;
  const O = counts.get("O") ?? 0;
  const N = counts.get("N") ?? 0;
  let X = 0; // halogens counted as H
  for (const [el, cnt] of counts) {
    if (el === "F" || el === "Cl" || el === "Br" || el === "I") X += cnt;
  }

  // Total valence electrons
  let totalValence = 0;
  for (const [el, cnt] of counts) {
    totalValence += (VALENCE[el] ?? 0) * cnt;
  }
  result.valenceElectrons = totalValence;

  // Odd total valence = radical
  if (totalValence % 2 !== 0) {
    result.warnings.push("Odd valence electrons (radical?)");
  }

  // 2. Degree of Unsaturation (DoU)
  const dou = (2 * C + 2 + N - H - X) / 2;
  result.degreeUnsaturation = dou;

  // 2a) DoU negative → too many H
  if (dou < 0) {
    result.valid = false;
    const maxH = 2 * C + 2 + N;
    result.errors.push(
      "Impossible formula: too many hydrogens. "
      + (C > 0 ? "Max H for this skeleton is " + maxH : "")
    );
    return result;
  }

  // 2b) Non-integer DoU (incomplete H count, e.g. CH3CH2 -> C2H5 has DoU=0.5)
  const parityCheck = 2 * C + 2 + N - H - X;
  if (parityCheck % 2 !== 0) {
    const correctedCounts = new Map(counts);
    correctedCounts.set("H", H + 1);
    const order = ["C", "H", "O", "N", "S", "P", "F", "Cl", "Br", "I"];
    const corrected = order
      .filter(el => correctedCounts.has(el))
      .map(el => { const n = correctedCounts.get(el)!; return el + (n > 1 ? String(n) : ""); })
      .join("");
    result.suggestedCorrection = corrected;
    result.warnings.push("Formula may have incomplete H count. Suggest " + corrected);
  }

  // 3. Bond-Valence Balance checks
  // 重原子总数
  const heavyAtoms = C + O + N + [...counts.entries()]
    .filter(([el]) => !["C","H","O","N","F","Cl","Br","I"].includes(el))
    .reduce((sum, [,cnt]) => sum + cnt, 0);

  // 3i) Oxygen capacity check
  if (O > 0 && !result.errors.length) {
    const nonOCapacity = C * 4 + N * 3 + H * 1 + X * 1;
    const oDemand = O * 2;
    if (oDemand > nonOCapacity) {
      const totalAtoms = C + H + N + O + X;
      if (O === totalAtoms) {
        result.warnings.push("Oxygen-only molecule (unusual bonding)");
      } else {
        result.valid = false;
        result.errors.push(
          "Not enough bonding partners for oxygen atoms. " +
          "Needs " + oDemand + " bond-orders, only " + nonOCapacity + " available. " +
          "Builder cannot create O-O bonds."
        );
      }
    }
  }

  // 3ii) C-O no-H molecule check (e.g. CO3)
  if (O > 0 && C > 0 && H === 0 && !result.errors.length) {
    // Each C can satisfy at most 2 O atoms in a neutral molecule (e.g. CO2)
    // CO3 (1C+3O) is impossible because:
    //   C has valence 4, with 3 O neighbors needs bond sum 4
    //   Each O needs bond sum 2 from C
    //   Total O need = 6, C can provide max 4 → impossible
    if (O > C * 2) {
      result.valid = false;
      result.errors.push(
        "Cannot satisfy oxygen valency: " + O + " O atoms need " + (O*2) +
        " bond-orders from C, but each C can satisfy at most 2 O atoms. " +
        "C*2=" + (C*2) + " < O=" + O
      );
    }
  }

  // 3iii) Nitrogen capacity check
  if (N > 0 && !result.errors.length) {
    const nonNCapacity = C * 4 + O * 2 + H * 1 + X * 1;
    const nDemand = N * 3;
    if (nDemand > nonNCapacity) {
      result.valid = false;
      result.errors.push(
        "Not enough bonding partners for nitrogen atoms. " +
        "(short by " + (nDemand - nonNCapacity) + ")"
      );
    }
  }

  return result;
}
