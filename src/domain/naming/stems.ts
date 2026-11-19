/** Parent-stem and multiplier tables shared by every naming stage. */

const CHAIN_STEMS = [
  "meth", "eth", "prop", "but", "pent", "hex", "hept", "oct", "non", "dec",
  "undec", "dodec", "tridec", "tetradec", "pentadec", "hexadec", "heptadec",
  "octadec", "nonadec", "eicos",
];

const MULTIPLIERS = [
  "", "di", "tri", "tetra", "penta", "hexa", "hepta", "octa", "nona", "deca",
];

export function chainStem(carbons: number): string {
  return CHAIN_STEMS[carbons - 1] ?? `C${carbons}`;
}

export function isSupportedChainLength(carbons: number): boolean {
  return carbons >= 1 && carbons <= CHAIN_STEMS.length;
}

/** Multiplicative prefix, empty for a single group. */
export function multiplier(count: number): string {
  return MULTIPLIERS[count - 1] ?? `${count}`;
}

/** `[1, 2]` -> `1,2` */
export function locants(values: readonly number[]): string {
  return [...values].sort((a, b) => a - b).join(",");
}

/**
 * IUPAC alphabetical order ignores multiplicative prefixes, so `dichloro`
 * sorts as `chloro` and `trinitro` as `nitro`.
 */
export function alphabeticalKey(name: string): string {
  for (const prefix of [...MULTIPLIERS].reverse()) {
    if (prefix && name.startsWith(prefix) && name.length > prefix.length) {
      const rest = name.slice(prefix.length);
      if (REST_ALPHABETICAL.has(rest)) return rest;
    }
  }
  return name;
}

const REST_ALPHABETICAL = new Set([
  "fluoro", "chloro", "bromo", "iodo", "methyl", "ethyl", "propyl", "butyl",
  "pentyl", "hexyl", "hydroxy", "oxo", "amino", "nitro",
]);
