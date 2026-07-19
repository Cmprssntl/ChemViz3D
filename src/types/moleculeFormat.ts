// ============================================================
// ChemViz3D Molecular JSON format (chemvz.json)
//
// A JSON-based molecular structure specification format.
// Records atom types, bonds, optional positions, and hybridization.
// Designed for AI generation and unambiguous computer parsing.
//
// Format versions:
//   v1 (chemvz: 1) — atoms/bonds only, hybridization inferred from bond order
//   v2 (chemvz: 2) — optional per-atom hybridization field (sp/sp2/sp3)
//                     required to distinguish sp2 aromatics from sp3 cycloalkanes
//
// Examples:
//   // Benzene (v2, with explicit sp2 hybridization)
//   {
//     "chemvz": 2,
//     "name": "benzene",
//     "atoms": [
//       { "el": "C", "hybridization": "sp2" },
//       { "el": "C", "hybridization": "sp2" },
//       { "el": "C", "hybridization": "sp2" },
//       { "el": "C", "hybridization": "sp2" },
//       { "el": "C", "hybridization": "sp2" },
//       { "el": "C", "hybridization": "sp2" }
//     ],
//     "bonds": [
//       { "i": [0, 1], "order": 1 },
//       { "i": [1, 2], "order": 2 },
//       { "i": [2, 3], "order": 1 },
//       { "i": [3, 4], "order": 2 },
//       { "i": [4, 5], "order": 1 },
//       { "i": [5, 0], "order": 2 }
//     ]
//   }
//
//   // Ethanol (v1 compatible — no hybridization needed, all sp3)
//   {
//     "chemvz": 2,
//     "name": "ethanol",
//     "atoms": [
//       { "el": "C" },
//       { "el": "C" },
//       { "el": "O" }
//     ],
//     "bonds": [
//       { "i": [0, 1], "order": 1 },
//       { "i": [1, 2], "order": 1 }
//     ]
//   }
// ============================================================

export interface ChemVZMolecule {
  /** Format version (currently 2) */
  chemvz: 2;
  /** Optional human-readable name */
  name?: string;
  /** Optional comment */
  comment?: string;
  /** Atoms in the molecule */
  atoms: ChemVZAtom[];
  /** Bonds between atoms */
  bonds: ChemVZBond[];
}

/** Supported hybridization states */
export type ChemVZHybrid = "sp" | "sp2" | "sp3";

export interface ChemVZAtom {
  /** Element symbol (C, H, O, N, etc.) */
  el: string;
  /** Optional label (e.g. "C=O", "CH3") */
  label?: string;
  /** Formal charge */
  charge?: number;
  /** Hybridization (sp/sp2/sp3). When set and unambiguous,
   *  the VSEPR builder uses it directly instead of inferring from bond orders.
   *  Required to distinguish sp2 aromatics from sp3 cycloalkanes. */
  hybridization?: ChemVZHybrid;
}

export interface ChemVZBond {
  /** Atom indices [from, to] */
  i: [number, number];
  /** Bond order: 1=single, 2=double, 3=triple, 1.5=aromatic */
  order: number;
  /** Optional stereochemistry */
  stereo?: "up" | "down" | "any";
}

// ---- Type guard ----
export function isChemVZ(obj: unknown): obj is ChemVZMolecule {
  if (!obj || typeof obj !== "object") return false;
  const m = obj as Record<string, unknown>;
  return (m.chemvz === 1 || m.chemvz === 2) && Array.isArray(m.atoms) && Array.isArray(m.bonds);
}

// ---- Convert to BondSpec (for the VSEPR builder) ----

export function chemVZToBondSpec(mol: ChemVZMolecule): {
  atoms: string[];
  bonds: [number, number, number][];
  formula: string;
  /** Per-atom hybridization hint; undefined = let builder infer */
  hybridizations?: ("sp" | "sp2" | "sp3" | undefined)[];
} {
  const atoms = mol.atoms.map((a) => a.el);
  const bonds: [number, number, number][] = mol.bonds.map((b) => [b.i[0], b.i[1], b.order]);
  // Pass through explicit hybridizations from chemvz.json
  const hybridizations = mol.atoms.map((a) => a.hybridization);

  // Build formula from atom counts
  const counts = new Map<string, number>();
  for (const a of mol.atoms) {
    counts.set(a.el, (counts.get(a.el) || 0) + 1);
  }
  const elemOrder = ["C", "H", "O", "N", "S", "P", "F", "Cl", "Br", "I"];
  const formula = [...counts.entries()]
    .sort((a, b) => elemOrder.indexOf(a[0]) - elemOrder.indexOf(b[0]))
    .map(([el, cnt]) => el + (cnt > 1 ? cnt : ""))
    .join("");

  // Only include hybridizations array if any atom has it set
  const hasHyb = hybridizations.some(h => h !== undefined);
  return { atoms, bonds, formula, ...(hasHyb ? { hybridizations } : {}) };
}

// ---- Convert MoleculeData back to ChemVZMolecule (export) ----
export function moleculeDataToChemVZ(
  atoms: Array<{ index: number; element: string; charge?: number; hybridization?: string }>,
  bonds: Array<{ index: number; atom1Idx: number; atom2Idx: number; order: number; stereo?: "up" | "down" | "any" }>,
  name?: string
): ChemVZMolecule {
  // Only include heavy atoms (non-H) in the atom list
  const heavyMap = new Map<number, number>();
  const heavyAtoms: ChemVZAtom[] = [];

  for (const a of atoms) {
    if (a.element !== "H") {
      heavyMap.set(a.index, heavyAtoms.length);
      const atom: ChemVZAtom = { el: a.element };
      if (a.charge !== undefined) atom.charge = a.charge;
      if (a.hybridization) atom.hybridization = a.hybridization as ChemVZHybrid;
      heavyAtoms.push(atom);
    }
  }

  const chemvzBonds: ChemVZBond[] = [];
  for (const b of bonds) {
    const i1 = heavyMap.get(b.atom1Idx);
    const i2 = heavyMap.get(b.atom2Idx);
    if (i1 !== undefined && i2 !== undefined) {
      chemvzBonds.push({ i: [i1, i2], order: b.order, stereo: b.stereo });
    }
  }

  return {
    chemvz: 2,
    name,
    atoms: heavyAtoms,
    bonds: chemvzBonds,
  };
}
