// ============================================================
// ChemViz3D Molecular JSON format (chemvz.json)
//
// A JSON-based molecular structure specification format.
// Records atom types, bonds, and optional positions.
// Designed for AI generation and unambiguous computer parsing.
//
// Example:
//   {
//     "chemvz": 1,
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
  /** Format version (currently 1) */
  chemvz: 1;
  /** Optional human-readable name */
  name?: string;
  /** Optional comment */
  comment?: string;
  /** Atoms in the molecule */
  atoms: ChemVZAtom[];
  /** Bonds between atoms */
  bonds: ChemVZBond[];
}

export interface ChemVZAtom {
  /** Element symbol (C, H, O, N, etc.) */
  el: string;
  /** Optional label (e.g. "C=O", "CH3") */
  label?: string;
  /** Formal charge */
  charge?: number;
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
  return m.chemvz === 1 && Array.isArray(m.atoms) && Array.isArray(m.bonds);
}

// ---- Convert to BondSpec (for the VSEPR builder) ----
// import type { BondSpec } from "./vseprBuilder"; // circular? check
// Actually just define the conversion inline

export function chemVZToBondSpec(mol: ChemVZMolecule): {
  atoms: string[];
  bonds: [number, number, number][];
  formula: string;
} {
  const atoms = mol.atoms.map((a) => a.el);
  const bonds: [number, number, number][] = mol.bonds.map((b) => [b.i[0], b.i[1], b.order]);

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

  return { atoms, bonds, formula };
}

// ---- Convert MoleculeData back to ChemVZMolecule (export) ----
export function moleculeDataToChemVZ(
  atoms: Array<{ index: number; element: string; charge?: number }>,
  bonds: Array<{ index: number; atom1Idx: number; atom2Idx: number; order: number; stereo?: "up" | "down" | "any" }>,
  name?: string
): ChemVZMolecule {
  // Only include heavy atoms (non-H) in the atom list
  const heavyMap = new Map<number, number>();
  const heavyAtoms: ChemVZAtom[] = [];

  for (const a of atoms) {
    if (a.element !== "H") {
      heavyMap.set(a.index, heavyAtoms.length);
      heavyAtoms.push({ el: a.element, charge: a.charge });
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
    chemvz: 1,
    name,
    atoms: heavyAtoms,
    bonds: chemvzBonds,
  };
}
