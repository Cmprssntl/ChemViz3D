import type { HeavyMolecule } from "./HeavyMolecule";
import { NamingError } from "./NamingError";
import type { PrincipalSite } from "./FunctionalGroups";
import { chainStem, isSupportedChainLength } from "./stems";

export interface Substituent {
  /** Prefix without multiplier, e.g. `chloro`, `methyl`. */
  name: string;
  /** Parent atom the substituent is attached to. */
  parentAtom: number;
  atoms: number[];
}

const HALOGENS: Record<string, string> = {
  F: "fluoro", Cl: "chloro", Br: "bromo", I: "iodo",
};

/**
 * Collects everything that is not part of the parent skeleton or the principal
 * group, and turns each connected fragment into a prefix. Fragments attached at
 * more than one point (bridges, fused rings) are rejected rather than guessed.
 */
export function collectSubstituents(
  heavy: HeavyMolecule,
  parentAtoms: ReadonlySet<number>,
  principal: PrincipalSite,
): Substituent[] {
  const blocked = new Set<number>([...parentAtoms, ...principal.atoms]);
  const visited = new Set<number>();
  const substituents: Substituent[] = [];

  for (let atom = 0; atom < heavy.size; atom++) {
    if (blocked.has(atom) || visited.has(atom)) continue;
    const fragment = reachableWithin(heavy, atom, blocked);
    fragment.forEach((member) => visited.add(member));

    const attachments = new Set<number>();
    for (const member of fragment) {
      for (const neighbor of heavy.neighbors(member)) {
        if (parentAtoms.has(neighbor)) attachments.add(neighbor);
      }
    }
    if (attachments.size !== 1) {
      throw new NamingError("unsupported-substituent", "取代基连接了多个母体原子");
    }
    const parentAtom = [...attachments][0];
    substituents.push({
      name: nameFragment(heavy, fragment, parentAtom),
      parentAtom,
      atoms: fragment,
    });
  }
  return substituents;
}

function reachableWithin(heavy: HeavyMolecule, start: number, blocked: ReadonlySet<number>): number[] {
  const seen = new Set<number>([start]);
  const queue = [start];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const neighbor of heavy.neighbors(current)) {
      if (blocked.has(neighbor) || seen.has(neighbor)) continue;
      seen.add(neighbor);
      queue.push(neighbor);
    }
  }
  return [...seen].sort((a, b) => a - b);
}

function nameFragment(heavy: HeavyMolecule, fragment: number[], parentAtom: number): string {
  if (fragment.length === 1) return nameSingleAtom(heavy, fragment[0], parentAtom);

  const nitro = asNitroGroup(heavy, fragment, parentAtom);
  if (nitro) return "nitro";

  if (!fragment.every((atom) => heavy.isCarbon(atom))) {
    throw new NamingError("unsupported-substituent", "含杂原子的取代基");
  }
  const members = new Set(fragment);
  const degrees = fragment.map((atom) =>
    heavy.neighbors(atom).filter((neighbor) => members.has(neighbor)).length);
  const attachmentDegree = heavy.neighbors(parentAtom).filter((neighbor) => members.has(neighbor)).length;
  if (attachmentDegree !== 1) {
    throw new NamingError("unsupported-substituent", "取代基连接方式不明确");
  }
  const isChain = degrees.filter((degree) => degree > 2).length === 0
    && degrees.filter((degree) => degree === 1).length === 2;
  if (!isChain) {
    throw new NamingError("unsupported-substituent", "支链取代基");
  }
  if (!isSupportedChainLength(fragment.length)) {
    throw new NamingError("unsupported-substituent", "碳链过长");
  }
  return `${chainStem(fragment.length)}yl`;
}

function nameSingleAtom(heavy: HeavyMolecule, atom: number, parentAtom: number): string {
  const element = heavy.elements[atom];
  const halogen = HALOGENS[element];
  if (halogen) return halogen;
  if (element === "C") return "methyl";
  if (element === "O") return heavy.order(atom, parentAtom) === 2 ? "oxo" : "hydroxy";
  if (element === "N") return "amino";
  throw new NamingError("unsupported-substituent", `元素 ${element}`);
}

/** -NO2: one nitrogen carrying two oxygens, attached at a single point. */
function asNitroGroup(heavy: HeavyMolecule, fragment: number[], parentAtom: number): boolean {
  if (fragment.length !== 3) return false;
  const nitrogen = fragment.find((atom) => heavy.elements[atom] === "N");
  if (nitrogen === undefined) return false;
  const oxygens = fragment.filter((atom) => heavy.elements[atom] === "O");
  if (oxygens.length !== 2) return false;
  const attached = heavy.neighbors(nitrogen).filter((neighbor) => fragment.includes(neighbor));
  if (attached.length !== 2) return false;
  return heavy.neighbors(nitrogen).includes(parentAtom)
    && oxygens.every((oxygen) => heavy.order(nitrogen, oxygen) >= 1);
}
