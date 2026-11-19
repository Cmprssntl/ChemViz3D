import { NamingError } from "./NamingError";
import type { HeavyMolecule } from "./HeavyMolecule";

export type PrincipalGroup =
  | "carboxylic-acid"
  | "aldehyde"
  | "ketone"
  | "alcohol"
  | "amine"
  | "alkene"
  | "alkyne"
  | "alkane";

const PRIORITY: PrincipalGroup[] = [
  "carboxylic-acid",
  "aldehyde",
  "ketone",
  "alcohol",
  "amine",
  "alkene",
  "alkyne",
  "alkane",
];

export interface PrincipalSite {
  group: PrincipalGroup;
  /** Atoms that belong to the group and must not be named as substituents. */
  atoms: number[];
  /** Carbon that carries the group and therefore takes the lowest locant. */
  carbon?: number;
  /** One entry per group occurrence (e.g. two carboxylic acids). */
  carbons: number[];
}

/**
 * Picks the principal characteristic group by IUPAC seniority. Groups that are
 * recognised but not implemented (esters, amides, nitriles) raise an explicit
 * error instead of being mis-named as something else.
 */
export function detectPrincipal(heavy: HeavyMolecule): PrincipalSite {
  if (heavy.size === 0) throw new NamingError("empty-structure");
  rejectUnsupportedGroups(heavy);

  const acids = findCarboxylicAcids(heavy);
  if (acids.length > 0) {
    return { group: "carboxylic-acid", atoms: acids.flatMap((site) => site.atoms), carbon: acids[0].carbon, carbons: acids.map((site) => site.carbon) };
  }
  const aldehydes = findAldehydes(heavy);
  if (aldehydes.length > 0) {
    return { group: "aldehyde", atoms: aldehydes.flatMap((site) => site.atoms), carbon: aldehydes[0].carbon, carbons: aldehydes.map((site) => site.carbon) };
  }
  const ketones = findKetones(heavy);
  if (ketones.length > 0) {
    return { group: "ketone", atoms: ketones.flatMap((site) => site.atoms), carbon: ketones[0].carbon, carbons: ketones.map((site) => site.carbon) };
  }
  const alcohols = findAlcohols(heavy);
  if (alcohols.length > 0) {
    return { group: "alcohol", atoms: alcohols.map((site) => site.oxygen), carbon: alcohols[0].carbon, carbons: alcohols.map((site) => site.carbon) };
  }
  const amines = findAmines(heavy);
  if (amines.length > 0) {
    return { group: "amine", atoms: amines.map((site) => site.nitrogen), carbon: amines[0].carbon, carbons: amines.map((site) => site.carbon) };
  }
  const unsaturation = findUnsaturation(heavy);
  if (unsaturation) return { group: unsaturation, atoms: [], carbons: [] };
  return { group: "alkane", atoms: [], carbons: [] };
}

function rejectUnsupportedGroups(heavy: HeavyMolecule): void {
  for (let atom = 0; atom < heavy.size; atom++) {
    if (heavy.elements[atom] !== "C") continue;
    const doubleO = heavy.doubleBondedNeighbors(atom).filter((n) => heavy.elements[n] === "O");
    if (doubleO.length !== 1) continue;
    const singleO = heavy.singleBondedNeighbors(atom).filter((n) => heavy.elements[n] === "O");
    const singleN = heavy.singleBondedNeighbors(atom).filter((n) => heavy.elements[n] === "N");
    const singleS = heavy.singleBondedNeighbors(atom).filter((n) => heavy.elements[n] === "S");
    for (const oxygen of singleO) {
      // Carboxyl (-C(=O)OH) is supported; an ester has a second carbon on the
      // oxygen besides the carbonyl carbon itself.
      if (heavy.neighbors(oxygen).some((n) => heavy.isCarbon(n) && n !== atom)) {
        throw new NamingError("unsupported-functional-group", "酯");
      }
    }
    if (singleN.length > 0) {
      throw new NamingError("unsupported-functional-group", "酰胺");
    }
    if (singleS.length > 0) {
      throw new NamingError("unsupported-functional-group", "硫代酸");
    }
  }
  for (let atom = 0; atom < heavy.size; atom++) {
    if (heavy.elements[atom] !== "C") continue;
    if (heavy.graph.bondsOf(atom).some((bond) => bond.order === 3 && heavy.elements[bond.a === atom ? bond.b : bond.a] === "N")) {
      throw new NamingError("unsupported-functional-group", "腈");
    }
  }
}

interface CarboxylSite {
  carbon: number;
  atoms: number[];
}

function findCarboxylicAcids(heavy: HeavyMolecule): CarboxylSite[] {
  const sites: CarboxylSite[] = [];
  for (let atom = 0; atom < heavy.size; atom++) {
    if (heavy.elements[atom] !== "C") continue;
    const doubleO = heavy.doubleBondedNeighbors(atom).filter((n) => heavy.elements[n] === "O");
    const singleO = heavy.singleBondedNeighbors(atom).filter((n) => heavy.elements[n] === "O");
    if (doubleO.length !== 1 || singleO.length !== 1) continue;
    const oxygen = singleO[0];
    if (heavy.neighbors(oxygen).length !== 1) continue; // ester, not acid
    if (heavy.hydrogens[oxygen] < 1) continue;
    sites.push({ carbon: atom, atoms: [oxygen, doubleO[0]] });
  }
  return sites;
}

interface CarbonylSite {
  carbon: number;
  atoms: number[];
}

function findAldehydes(heavy: HeavyMolecule): CarbonylSite[] {
  const sites: CarbonylSite[] = [];
  for (let atom = 0; atom < heavy.size; atom++) {
    if (heavy.elements[atom] !== "C") continue;
    const doubleO = heavy.doubleBondedNeighbors(atom).filter((n) => heavy.elements[n] === "O");
    if (doubleO.length !== 1) continue;
    // Formaldehyde has no carbon neighbour at all, acetaldehyde exactly one.
    if (heavy.carbonNeighbors(atom).length > 1) continue;
    if (heavy.hydrogens[atom] < 1) continue;
    sites.push({ carbon: atom, atoms: [doubleO[0]] });
  }
  return sites;
}

function findKetones(heavy: HeavyMolecule): CarbonylSite[] {
  const sites: CarbonylSite[] = [];
  for (let atom = 0; atom < heavy.size; atom++) {
    if (heavy.elements[atom] !== "C") continue;
    const doubleO = heavy.doubleBondedNeighbors(atom).filter((n) => heavy.elements[n] === "O");
    if (doubleO.length !== 1) continue;
    if (heavy.carbonNeighbors(atom).length < 2) continue;
    sites.push({ carbon: atom, atoms: [doubleO[0]] });
  }
  return sites;
}

interface HydroxySite {
  oxygen: number;
  carbon: number;
}

function findAlcohols(heavy: HeavyMolecule): HydroxySite[] {
  const sites: HydroxySite[] = [];
  for (let atom = 0; atom < heavy.size; atom++) {
    if (heavy.elements[atom] !== "O") continue;
    const neighbors = heavy.neighbors(atom);
    if (neighbors.length !== 1 || !heavy.isCarbon(neighbors[0])) continue;
    if (heavy.hydrogens[atom] < 1) continue;
    sites.push({ oxygen: atom, carbon: neighbors[0] });
  }
  return sites;
}

interface AmineSite {
  nitrogen: number;
  carbon: number;
}

function findAmines(heavy: HeavyMolecule): AmineSite[] {
  const sites: AmineSite[] = [];
  for (let atom = 0; atom < heavy.size; atom++) {
    if (heavy.elements[atom] !== "N") continue;
    const neighbors = heavy.neighbors(atom);
    if (neighbors.length === 0 || !neighbors.every((n) => heavy.isCarbon(n))) continue;
    sites.push({ nitrogen: atom, carbon: neighbors[0] });
  }
  return sites;
}

function findUnsaturation(heavy: HeavyMolecule): "alkene" | "alkyne" | null {
  let double = false;
  let triple = false;
  for (const bond of heavy.bonds) {
    if (!heavy.isCarbon(bond.a) || !heavy.isCarbon(bond.b)) continue;
    if (bond.order === 2) double = true;
    if (bond.order === 3) triple = true;
  }
  if (triple) return "alkyne";
  return double ? "alkene" : null;
}

export function groupPriority(group: PrincipalGroup): number {
  return PRIORITY.indexOf(group);
}
