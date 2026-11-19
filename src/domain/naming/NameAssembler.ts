import type { PrincipalSite } from "./FunctionalGroups";
import type { NumberedParent } from "./ParentSelector";
import { NamingError } from "./NamingError";
import { alphabeticalKey, chainStem, locants, multiplier } from "./stems";

interface Suffix {
  text: string;
}

/**
 * Turns the numbered parent plus its prefixes into a name, applying the
 * elision rules (propan-2-ol, ethanoic acid, buta-1,3-diene) and the
 * alphabetical ordering of prefixes.
 */
export function assembleName(parent: NumberedParent, principal: PrincipalSite): string {
  const parentName = buildParentName(parent, principal);
  const prefix = buildPrefixes(parent);
  return prefix ? `${prefix}${parentName}` : parentName;
}

function buildParentName(parent: NumberedParent, principal: PrincipalSite): string {
  if (parent.kind === "benzene") {
    if (principal.group !== "alkane" && principal.group !== "alkene") {
      throw new NamingError("unsupported-functional-group", "苯环上的特征官能团");
    }
    return "benzene";
  }

  const stem = (parent.kind === "ring" ? "cyclo" : "") + chainStem(parent.atoms.length);
  const totalUnsaturation = parent.doubleBonds.length + parent.tripleBonds.length;
  const unsaturation = unsaturationSegments(parent);
  const suffix = suffixFor(parent, principal);

  if (!suffix) {
    if (totalUnsaturation === 0) return `${stem}ane`;
    return `${stem}${totalUnsaturation > 1 ? "a" : ""}${unsaturation}`;
  }
  const core = totalUnsaturation === 0
    ? `${stem}an`
    : `${stem}${totalUnsaturation > 1 ? "a" : ""}${unsaturation}-`;
  // A suffix that starts with a locant needs a hyphen after the parent stem
  // ("propan-2-one"), while vowel suffixes attach directly ("ethan"+"ol").
  const separator = /^\d/.test(suffix.text) ? "-" : "";
  return `${core}${separator}${suffix.text}`;
}

function unsaturationSegments(parent: NumberedParent): string {
  const total = parent.doubleBonds.length + parent.tripleBonds.length;
  const showLocants = parent.atoms.length > 2 && !(parent.kind === "ring" && total === 1);
  const segments: string[] = [];
  if (parent.doubleBonds.length > 0) {
    segments.push(`${showLocants ? `${locants(parent.doubleBonds)}-` : ""}${multiplier(parent.doubleBonds.length)}ene`);
  }
  if (parent.tripleBonds.length > 0) {
    segments.push(`${showLocants ? `${locants(parent.tripleBonds)}-` : ""}${multiplier(parent.tripleBonds.length)}yne`);
  }
  return segments.join("-");
}

function suffixFor(parent: NumberedParent, principal: PrincipalSite): Suffix | null {
  const sites = principal.carbons
    .map((carbon) => parent.locantOf.get(carbon))
    .filter((locant): locant is number => locant !== undefined)
    .sort((a, b) => a - b);
  const count = Math.max(sites.length, 1);

  switch (principal.group) {
    case "carboxylic-acid":
      return { text: `${multiplier(count)}oic acid` };
    case "aldehyde":
      return { text: withLocants(parent, sites, count, "al") };
    case "ketone":
      return { text: withLocants(parent, sites, count, "one") };
    case "alcohol":
      return { text: withLocants(parent, sites, count, "ol") };
    case "amine":
      return { text: withLocants(parent, sites, count, "amine") };
    default:
      return null;
  }
}

function withLocants(parent: NumberedParent, sites: number[], count: number, base: string): string {
  const omit = count === 1
    && (parent.atoms.length <= 2 || (parent.kind !== "chain" && parent.substituents.length === 0));
  const prefix = omit ? "" : `${locants(sites)}-`;
  return `${prefix}${multiplier(count)}${base}`;
}

function buildPrefixes(parent: NumberedParent): string {
  const grouped = new Map<string, number[]>();
  for (const substituent of parent.substituents) {
    const locant = parent.locantOf.get(substituent.parentAtom);
    if (locant === undefined) continue;
    const list = grouped.get(substituent.name);
    if (list) list.push(locant);
    else grouped.set(substituent.name, [locant]);
  }
  const parts = [...grouped.entries()]
    .sort((a, b) => alphabeticalKey(a[0]).localeCompare(alphabeticalKey(b[0])))
    .map(([name, values]) => `${locants(values)}-${multiplier(values.length)}${name}`);
  // Prefixes are hyphen-separated from each other but attach directly to the
  // parent hydride: 1-methylbenzene, 1-bromo-2-chloroethane.
  return parts.length > 0 ? parts.join("-") : "";
}
