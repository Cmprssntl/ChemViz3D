export interface AtomData {
  index: number;
  element: string;
  x: number;
  y: number;
  z: number;
  covalentRadius: number;
  vdwRadius: number;
  charge?: number;
  hybridization?: string;
  mass?: number;
}

export interface BondData {
  index: number;
  atom1Idx: number;
  atom2Idx: number;
  order: number;
  length?: number;
}

export interface MoleculeData {
  atoms: AtomData[];
  bonds: BondData[];
  name: string;
  formula: string;
  smiles: string;
  conformer?: Float64Array;
}

export type DisplayMode = "ball-and-stick" | "space-filling";

export type LabelDisplayMode = "always" | "hover" | "never";

export interface SelectedEntity {
  type: "atom" | "bond";
  index: number;
}
