import type { HeavyMolecule } from "./HeavyMolecule";
import type { PrincipalSite } from "./FunctionalGroups";
import { NamingError } from "./NamingError";
import { collectSubstituents, type Substituent } from "./Substituents";
import { alphabeticalKey } from "./stems";

export type ParentKind = "chain" | "ring" | "benzene";

export interface NumberedParent {
  kind: ParentKind;
  /** Parent atoms ordered so that `atoms[i]` has locant `i + 1`. */
  atoms: number[];
  locantOf: Map<number, number>;
  doubleBonds: number[];
  tripleBonds: number[];
  substituents: Substituent[];
}

interface Skeleton {
  kind: ParentKind;
  atoms: number[];
}

const MAX_CANDIDATE_PATHS = 4000;

/**
 * Chooses the parent hydride and numbers it so that the principal group gets
 * the lowest locant, then multiple bonds, then substituents — the order
 * required by IUPAC, applied as a lexicographic comparison of locant sets.
 */
export function selectParent(heavy: HeavyMolecule, principal: PrincipalSite): NumberedParent {
  const skeleton = chooseSkeleton(heavy, principal);
  const candidates = numberingCandidates(skeleton);
  let best: NumberedParent | null = null;
  let bestScore: number[][] | null = null;

  for (const atoms of candidates) {
    const candidate = buildNumbered(heavy, skeleton.kind, atoms, principal);
    const score = scoreOf(heavy, candidate, principal);
    if (!best || !bestScore || compareTuples(score, bestScore) < 0) {
      best = candidate;
      bestScore = score;
    }
  }
  if (!best) throw new NamingError("ambiguous-parent");
  return best;
}

function chooseSkeleton(heavy: HeavyMolecule, principal: PrincipalSite): Skeleton {
  const rings = heavy.graph.findRings(12).filter((ring) => ring.every((atom) => heavy.isCarbon(atom)));
  if (rings.length > 1) throw new NamingError("unsupported-ring-system", "稠环或桥环");
  if (rings.length === 1) {
    const ring = rings[0];
    return { kind: isBenzene(heavy, ring) ? "benzene" : "ring", atoms: ring };
  }
  const chain = longestChain(heavy, principal);
  return { kind: "chain", atoms: chain };
}

function isBenzene(heavy: HeavyMolecule, ring: number[]): boolean {
  if (ring.length !== 6) return false;
  let doubles = 0;
  for (let i = 0; i < ring.length; i++) {
    if (heavy.order(ring[i], ring[(i + 1) % ring.length]) === 2) doubles++;
  }
  return doubles === 3;
}

/**
 * Longest carbon path, preferring paths that contain the principal carbon and
 * then paths with more multiple bonds.
 */
function longestChain(heavy: HeavyMolecule, principal: PrincipalSite): number[] {
  const carbons = new Set<number>();
  for (let atom = 0; atom < heavy.size; atom++) {
    if (heavy.isCarbon(atom)) carbons.add(atom);
  }
  if (carbons.size === 0) throw new NamingError("no-carbon-parent");

  const paths: number[][] = [];
  const visit = (current: number, path: number[], visited: Set<number>) => {
    if (paths.length > MAX_CANDIDATE_PATHS) return;
    let extended = false;
    for (const neighbor of heavy.neighbors(current)) {
      if (!carbons.has(neighbor) || visited.has(neighbor)) continue;
      extended = true;
      visited.add(neighbor);
      path.push(neighbor);
      visit(neighbor, path, visited);
      path.pop();
      visited.delete(neighbor);
    }
    if (!extended && path.length > 0) paths.push([...path]);
  };
  for (const start of carbons) {
    visit(start, [start], new Set([start]));
  }
  if (paths.length === 0) throw new NamingError("no-carbon-parent");

  const score = (path: number[]) => {
    const multiple = countMultipleBonds(heavy, path);
    const containsPrincipal = principal.carbon !== undefined && path.includes(principal.carbon) ? 1 : 0;
    return [containsPrincipal, path.length, multiple];
  };

  let best = paths[0];
  let bestScore = score(best);
  for (const path of paths.slice(1)) {
    const current = score(path);
    if (compareArrays(current, bestScore) > 0) {
      best = path;
      bestScore = current;
    }
  }
  if (best.length === 1) {
    const only = best[0];
    // A lone carbon with no hydrogens and no carbon neighbours is not a parent
    // hydride: that is CO2, CCl4, HCN and friends.
    const isParentHydride = heavy.hydrogens[only] > 0 || heavy.neighbors(only).length === 0;
    if (!isParentHydride) throw new NamingError("no-carbon-parent");
  }
  return best;
}

function countMultipleBonds(heavy: HeavyMolecule, path: number[]): number {
  let count = 0;
  for (let i = 0; i + 1 < path.length; i++) {
    if (heavy.order(path[i], path[i + 1]) > 1) count++;
  }
  return count;
}

function numberingCandidates(skeleton: Skeleton): number[][] {
  if (skeleton.kind === "chain") {
    return [skeleton.atoms, [...skeleton.atoms].reverse()];
  }
  const ring = skeleton.atoms;
  const candidates: number[][] = [];
  for (let start = 0; start < ring.length; start++) {
    const forward: number[] = [];
    for (let step = 0; step < ring.length; step++) forward.push(ring[(start + step) % ring.length]);
    candidates.push(forward, [...forward].reverse());
  }
  return candidates;
}

function buildNumbered(
  heavy: HeavyMolecule,
  kind: ParentKind,
  atoms: number[],
  principal: PrincipalSite,
): NumberedParent {
  const locantOf = new Map<number, number>();
  atoms.forEach((atom, index) => locantOf.set(atom, index + 1));

  const doubleBonds: number[] = [];
  const tripleBonds: number[] = [];
  for (let i = 0; i < atoms.length; i++) {
    const next = atoms[(i + 1) % atoms.length];
    if (kind === "chain" && i + 1 >= atoms.length) break;
    const order = heavy.order(atoms[i], next);
    if (order === 2) doubleBonds.push(i + 1);
    if (order === 3) tripleBonds.push(i + 1);
  }
  if (kind === "benzene") {
    doubleBonds.length = 0;
    tripleBonds.length = 0;
  }

  const substituents = collectSubstituents(heavy, new Set(atoms), principal);
  return { kind, atoms, locantOf, doubleBonds, tripleBonds, substituents };
}

function scoreOf(heavy: HeavyMolecule, parent: NumberedParent, principal: PrincipalSite): number[][] {
  const principalLocants = principal.carbons
    .map((carbon) => parent.locantOf.get(carbon))
    .filter((locant): locant is number => locant !== undefined)
    .sort((a, b) => a - b);

  const unsaturation = [...parent.doubleBonds, ...parent.tripleBonds].sort((a, b) => a - b);
  const substituentLocants = parent.substituents
    .map((substituent) => parent.locantOf.get(substituent.parentAtom) ?? 0)
    .sort((a, b) => a - b);

  // Tie-break: the alphabetically first substituent gets the lowest locant.
  const alphabetical = [...parent.substituents].sort((a, b) =>
    alphabeticalKey(a.name).localeCompare(alphabeticalKey(b.name)));
  const firstLocant = alphabetical.length > 0
    ? [parent.locantOf.get(alphabetical[0].parentAtom) ?? 0]
    : [];

  void heavy;
  return [principalLocants, unsaturation, substituentLocants, firstLocant];
}

function compareTuples(a: number[][], b: number[][]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const result = compareLocantSets(a[i] ?? [], b[i] ?? []);
    if (result !== 0) return result;
  }
  return 0;
}

function compareLocantSets(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const left = a[i] ?? Infinity;
    const right = b[i] ?? Infinity;
    if (left !== right) return left - right;
  }
  return 0;
}

function compareArrays(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const left = a[i] ?? -Infinity;
    const right = b[i] ?? -Infinity;
    if (left !== right) return left - right;
  }
  return 0;
}
