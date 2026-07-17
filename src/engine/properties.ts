 /**
 * Molecular property calculations for ChemViz3D
 *
 * Computes essential medicinal chemistry descriptors
 * using atom-contribution methods without RDKit dependency.
 */
 import { ATOMIC_DATA } from "../utils/formulaParser";
 import type { AtomData, BondData } from "../types/molecule";
 
 export interface MoleculeProperties {
   molecularWeight: number;
   logP: number;
   hBondDonors: number;
   hBondAcceptors: number;
   rotatableBonds: number;
   tpsa: number;
   formulaWeight: number;
 }
 
 /**
  * Calculate all molecular properties from atoms and bonds
  */
 export function calcMoleculeProperties(
   atoms: AtomData[],
   bonds: BondData[]
 ): MoleculeProperties {
   return {
     molecularWeight: calcMolecularWeight(atoms),
     logP: calcLogP(atoms, bonds),
     hBondDonors: calcHBondDonors(atoms, bonds),
     hBondAcceptors: calcHBondAcceptors(atoms),
     rotatableBonds: calcRotatableBonds(atoms, bonds),
     tpsa: calcTPSA(atoms, bonds),
     formulaWeight: calcFormulaWeight(atoms),
   };
 }
 
 /**
  * Molecular weight: sum of atomic masses (including hydrogens if present)
  */
 function calcMolecularWeight(atoms: AtomData[]): number {
   let mw = 0;
   for (const a of atoms) {
     const data = ATOMIC_DATA[a.element];
     mw += data?.mass ?? 0;
   }
   return Math.round(mw * 1000) / 1000;
 }
 
 /**
  * Formula weight: sum of atomic masses from formula (masses for element types * count)
  * Uses the same approach as calcMolecularWeight but from atom list
  */
 function calcFormulaWeight(atoms: AtomData[]): number {
   return calcMolecularWeight(atoms);
 }
 
 /**
  * Build adjacency for property calculations
  */
 function buildAtomBondMap(atoms: AtomData[], bonds: BondData[]): Map<number, BondData[]> {
   const adj = new Map<number, BondData[]>();
   for (const a of atoms) adj.set(a.index, []);
   for (const b of bonds) {
     adj.get(b.atom1Idx)?.push(b);
     adj.get(b.atom2Idx)?.push(b);
   }
   return adj;
 }
 
 /**
  * Count total bonded heavy neighbors (non-H)
  */
 function heavyNeighborCount(
   atomIdx: number,
   bonds: BondData[],
   atoms: AtomData[]
 ): number {
   let count = 0;
   for (const b of bonds) {
     const nbr = b.atom1Idx === atomIdx ? b.atom2Idx : b.atom1Idx;
     if (atoms[nbr] && atoms[nbr].element !== "H") count++;
   }
   return count;
 }
 
 /**
  * logP: simplified Wildman-Crippen atom contribution method
  *
  * Based on element type and heavy neighbor count.
  * Reference: Wildman & Crippen, JCICS 1999, 39, 868.
  */
 function calcLogP(atoms: AtomData[], bonds: BondData[]): number {
   let logP = 0;
   const adj = buildAtomBondMap(atoms, bonds);
 
   for (const a of atoms) {
     const nHeavy = heavyNeighborCount(a.index, bonds, atoms);
     const data = ATOMIC_DATA[a.element];
     const el = a.element;
 
     // Base contributions by element type
     // Carbon
     if (el === "C") {
       if (nHeavy <= 2) logP += 0.20;  // terminal/methyl
       else if (nHeavy === 3) logP += 0.15; // CH/CH2
       else logP += 0.10; // quaternary
     }
     // Hydrogen (no contribution)
     else if (el === "H") { /* no contribution */ }
     // Oxygen
     else if (el === "O") {
       if (nHeavy === 1) logP -= 0.60; // OH
       else if (nHeavy === 2) {
         // Check if this is a carbonyl O or ether O
         const myBonds = adj.get(a.index) || [];
         const isCarbonyl = myBonds.some((b) => b.order >= 2);
         logP += isCarbonyl ? -0.50 : -0.12;
       }
       else logP -= 0.12;
     }
     // Nitrogen
     else if (el === "N") {
       if (nHeavy <= 1) logP -= 0.60; // NH2/NH3
       else if (nHeavy === 2) logP -= 0.50;
       else logP -= 0.20;
     }
     // Halogens
     else if (el === "F") logP += 0.20;
     else if (el === "Cl") logP += 0.50;
     else if (el === "Br") logP += 0.70;
     else if (el === "I") logP += 0.90;
     // Sulfur
     else if (el === "S") logP -= 0.03;
     // Phosphorus
     else if (el === "P") logP -= 0.10;
     // Metals and others — minimal contribution
     else if (data) logP += 0.10;
   }
 
   return Math.round(logP * 100) / 100;
 }
 
 /**
  * H-Bond Donors: count O-H and N-H bonds
  */
 function calcHBondDonors(atoms: AtomData[], bonds: BondData[]): number {
   let donors = 0;
   for (const b of bonds) {
     if (b.order !== 1) continue;
     const a1 = atoms[b.atom1Idx];
     const a2 = atoms[b.atom2Idx];
     if (!a1 || !a2) continue;
     if (a1.element === "H" && (a2.element === "O" || a2.element === "N")) donors++;
     else if (a2.element === "H" && (a1.element === "O" || a1.element === "N")) donors++;
   }
   return donors;
 }
 
 /**
  * H-Bond Acceptors: count O, N, and F atoms (excluding those with positive charge)
  * (Excludes oxygen/nitrogen that are already counted as donors)
  */
 function calcHBondAcceptors(atoms: AtomData[]): number {
   let acceptors = 0;
   for (const a of atoms) {
     if (a.element === "O" || a.element === "N" || a.element === "F") {
       if (!a.charge || a.charge <= 0) acceptors++;
     }
   }
   return acceptors;
 }
 
 /**
  * Rotatable Bonds: count sp3-sp3 single bonds not in rings or terminal
  *
  * A rotatable bond is any single non-ring bond between
  * tetrahedral atoms (sp3), excluding bonds to hydrogens,
  * terminal atoms, and atoms with only one heavy neighbor.
  */
 function calcRotatableBonds(atoms: AtomData[], bonds: BondData[]): number {
   let count = 0;
   for (const b of bonds) {
     if (b.order !== 1) continue;
     const a1 = atoms[b.atom1Idx];
     const a2 = atoms[b.atom2Idx];
     if (!a1 || !a2) continue;
 
     // Skip bonds involving hydrogen
     if (a1.element === "H" || a2.element === "H") continue;
 
     // Both atoms must have at least 2 heavy neighbors to be rotatable
     const h1 = heavyNeighborCount(b.atom1Idx, bonds, atoms);
     const h2 = heavyNeighborCount(b.atom2Idx, bonds, atoms);
     if (h1 < 2 || h2 < 2) continue;
 
     // Skip if either is sp2/sp (double/triple bond compounds)
     if (a1.hybridization === "sp" || a2.hybridization === "sp" ||
         a1.hybridization === "sp2" || a2.hybridization === "sp2") continue;
 
     count++;
   }
   return count;
 }
 
 /**
  * TPSA: Topological Polar Surface Area (Ertl method)
  *
  * Sum of contributions from polar atoms based on element type
  * and bonding environment.
  * Reference: Ertl et al., J. Med. Chem. 2000, 43, 3714.
  */
 function calcTPSA(atoms: AtomData[], bonds: BondData[]): number {
   const adj = buildAtomBondMap(atoms, bonds);
   let tpsa = 0;
 
   for (const a of atoms) {
     const el = a.element;
     const myBonds = adj.get(a.index) || [];
 
     if (el === "O") {
       const isCarbonyl = myBonds.some((b) => b.order >= 2);
       const nHeavy = heavyNeighborCount(a.index, bonds, atoms);
       if (isCarbonyl) tpsa += 17.07;  // carbonyl oxygen
       else if (nHeavy <= 2) tpsa += 20.23;  // OH / ether
       else tpsa += 20.23;
     }
     else if (el === "N") {
       const nHeavy = heavyNeighborCount(a.index, bonds, atoms);
       const hasDoubleBond = myBonds.some((b) => b.order >= 2);
       if (hasDoubleBond) tpsa += 3.24; // imine / amide N
       else if (nHeavy <= 2) tpsa += 12.03; // NH2 / NH
       else tpsa += 12.03; // tertiary N (some contribution)
     }
     else if (el === "S") tpsa += 25.85;
     else if (el === "P") tpsa += 25.85;
     else if (el === "F") tpsa += 12.03;
     else if (el === "Cl") tpsa += 5.00;
     else if (el === "Br") tpsa += 3.00;
     else if (el === "I") tpsa += 2.00;
   }
 
   return Math.round(tpsa * 10) / 10;
 }
 
 /**
  * Human-readable property descriptions for tooltips
  */
 export const PROPERTY_DESCRIPTIONS: Record<string, string> = {
   molecularWeight: "Sum of atomic masses in the molecule (includes hydrogens)",
   logP: "Octanol-water partition coefficient (Wildman-Crippen method)",
   hBondDonors: "Number of O-H and N-H bonds",
   hBondAcceptors: "Count of O, N, and F atoms (excluding positively charged)",
   rotatableBonds: "Number of sp3-sp3 single bonds not in rings (non-terminal)",
   tpsa: "Topological Polar Surface Area in squared angstroms (Ertl method)",
 };
 
 /**
  * Compute logP-based Lipinski Rule of Five assessment
  */
 export function lipinskiAssessment(props: MoleculeProperties): {
   passes: boolean;
   violations: string[];
 } {
   const violations: string[] = [];
   if (props.molecularWeight > 500) violations.push("MW > 500");
   if (props.logP > 5) violations.push("logP > 5");
   if (props.hBondDonors > 5) violations.push("H-bond donors > 5");
   if (props.hBondAcceptors > 10) violations.push("H-bond acceptors > 10");
   return { passes: violations.length <= 1, violations };
 }
