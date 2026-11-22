#!/usr/bin/env node
/**
 * Builds the optional preset supplement packs.
 *
 * The shipped app only bundles the 22 core presets. Users can drop extra
 * presets into `<config>/molecules/presets`; this script produces two zip
 * archives for that directory:
 *
 *   ChemViz3D-presets-500.zip   444 curated molecules + 56 small homologues
 *   ChemViz3D-presets-2000.zip  the full set (existing pack + generated homologues)
 *
 * Every generated preset is parsed by OpenChemLib, so the emitted chemvz graph
 * is guaranteed to be a connected, valence-valid molecule. Names are generated
 * from IUPAC stem tables instead of being copied from an external database.
 *
 * Usage:
 *   node scripts/build-preset-packs.mjs --dry-run
 *   node scripts/build-preset-packs.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import OCL from "openchemlib";

const ROOT = process.cwd();
const PRESET_DIR = path.join(ROOT, "presets-pack", "molecules", "presets");
const PACK_DIR = path.join(ROOT, "presets-pack");
const TMP_DIR = path.join(ROOT, ".tmp", "preset-packs");
const TARGET_TOTAL = 2000;
const TARGET_SMALL = 500;
const DRY_RUN = process.argv.includes("--dry-run");

const EN_STEMS = [
  "meth", "eth", "prop", "but", "pent", "hex", "hept", "oct", "non", "dec",
  "undec", "dodec", "tridec", "tetradec", "pentadec", "hexadec", "heptadec",
  "octadec", "nonadec", "eicos", "henicos", "docos", "tricos", "tetracos",
  "pentacos", "hexacos", "heptacos", "octacos", "nonacos", "triacont",
  "hentriacont", "dotriacont", "tritriacont", "tetratriacont", "pentatriacont",
  "hexatriacont", "heptatriacont", "octatriacont", "nonatriacont", "tetracont",
];

const ZH_NUMBERS = [
  "一", "二", "三", "四", "五", "六", "七", "八", "九", "十",
  "十一", "十二", "十三", "十四", "十五", "十六", "十七", "十八", "十九", "二十",
  "二十一", "二十二", "二十三", "二十四", "二十五", "二十六", "二十七", "二十八", "二十九", "三十",
  "三十一", "三十二", "三十三", "三十四", "三十五", "三十六", "三十七", "三十八", "三十九", "四十",
];

const HALOGENS = [
  { key: "fluoro", en: "fluoro", zh: "氟", symbol: "F" },
  { key: "chloro", en: "chloro", zh: "氯", symbol: "Cl" },
  { key: "bromo", en: "bromo", zh: "溴", symbol: "Br" },
  { key: "iodo", en: "iodo", zh: "碘", symbol: "I" },
];

const ESTER_ALKYLS = [
  { key: "methyl", en: "methyl", zh: "甲", prefix: "CO" },
  { key: "ethyl", en: "ethyl", zh: "乙", prefix: "CCO" },
  { key: "propyl", en: "propyl", zh: "丙", prefix: "CCCO" },
  { key: "butyl", en: "butyl", zh: "丁", prefix: "CCCCO" },
];

function stem(n) {
  return EN_STEMS[n - 1] ?? `C${n}`;
}

function zhNumber(n) {
  // Chinese IUPAC uses 癸 for ten, not the cardinal 十; 十一 onwards is regular.
  if (n === 10) return "癸";
  return ZH_NUMBERS[n - 1] ?? `${n}`;
}

function alkaneName(n) {
  return `${stem(n)}ane`;
}

function alkaneZh(n) {
  return `${zhNumber(n)}烷`;
}

function alkeneName(n, locant) {
  if (n === 2) return "ethene";
  if (n === 3) return "propene";
  return `${stem(n)}-${locant}-ene`;
}

function alkeneZh(n, locant) {
  if (n === 2) return "乙烯";
  if (n === 3) return "丙烯";
  return `${locant}-${zhNumber(n)}烯`;
}

function alkyneName(n, locant) {
  if (n === 2) return "ethyne";
  if (n === 3) return "propyne";
  return `${stem(n)}-${locant}-yne`;
}

function alkyneZh(n, locant) {
  if (n === 2) return "乙炔";
  if (n === 3) return "丙炔";
  return `${locant}-${zhNumber(n)}炔`;
}

function alcoholName(n, locant) {
  if (n === 1) return "methanol";
  if (n === 2) return "ethanol";
  return `${stem(n)}an-${locant}-ol`;
}

function alcoholZh(n, locant) {
  if (n === 1) return "甲醇";
  if (n === 2) return "乙醇";
  return `${locant}-${zhNumber(n)}醇`;
}

function amineName(n, locant) {
  if (n === 1) return "methanamine";
  if (n === 2) return "ethanamine";
  return `${stem(n)}an-${locant}-amine`;
}

function amineZh(n, locant) {
  if (n === 1) return "甲胺";
  if (n === 2) return "乙胺";
  return `${locant}-${zhNumber(n)}胺`;
}

function acidName(n) {
  return `${stem(n)}anoic acid`;
}

function acidZh(n) {
  return `${zhNumber(n)}酸`;
}

function aldehydeName(n) {
  return `${stem(n)}anal`;
}

function aldehydeZh(n) {
  return `${zhNumber(n)}醛`;
}

function ketoneName(n, locant) {
  return `${stem(n)}an-${locant}-one`;
}

function ketoneZh(n, locant) {
  return `${locant}-${zhNumber(n)}酮`;
}

function haloName(n, locant, halogen) {
  if (n === 1) return `${halogen.en}methane`;
  return `${locant}-${halogen.en}${stem(n)}ane`;
}

function haloZh(n, locant, halogen) {
  if (n === 1) return `${halogen.zh}甲烷`;
  return `${locant}-${halogen.zh}${zhNumber(n)}烷`;
}

function thiolName(n, locant) {
  if (n === 1) return "methanethiol";
  if (n === 2) return "ethanethiol";
  return `${stem(n)}ane-${locant}-thiol`;
}

function thiolZh(n, locant) {
  if (n === 1) return "甲硫醇";
  if (n === 2) return "乙硫醇";
  return `${locant}-${zhNumber(n)}硫醇`;
}

function diolName(n) {
  return `${stem(n)}ane-1,2-diol`;
}

function diolZh(n) {
  return `1,2-${zhNumber(n)}二醇`;
}

function diamineName(n) {
  return `${stem(n)}ane-1,2-diamine`;
}

function diamineZh(n) {
  return `1,2-${zhNumber(n)}二胺`;
}

function diacidName(n) {
  return `${stem(n)}anedioic acid`;
}

function diacidZh(n) {
  return `${zhNumber(n)}二酸`;
}

function nitrileName(n) {
  return `${stem(n)}anenitrile`;
}

function nitrileZh(n) {
  return `${zhNumber(n)}腈`;
}

function esterName(alkyl, n) {
  return `${alkyl.en} ${stem(n)}anoate`;
}

function esterZh(alkyl, n) {
  return `${zhNumber(n)}酸${alkyl.zh}酯`;
}

function chainAt(n, locant, group) {
  return "C".repeat(locant) + `(${group})` + "C".repeat(n - locant);
}

function chainMultiple(n, locant, bond) {
  return "C".repeat(locant) + bond + "C".repeat(n - locant);
}

function ketoneChain(n, locant) {
  return "C".repeat(locant - 1) + "C(=O)" + "C".repeat(n - locant);
}

/**
 * Each series is a family of homologues with the same functional group.
 * `locants` produces positional isomers; equivalent positions are deduped by
 * canonical structure later.
 */
const SERIES = [
  {
    key: "1-alkene", priority: 10, locants: [1], from: 2,
    smiles: (n, locant) => chainMultiple(n, locant, "="),
    en: alkeneName, zh: alkeneZh,
  },
  {
    key: "2-alkene", priority: 11, locants: [2], from: 4,
    smiles: (n, locant) => chainMultiple(n, locant, "="),
    en: alkeneName, zh: alkeneZh,
  },
  {
    key: "3-alkene", priority: 12, locants: [3], from: 5,
    smiles: (n, locant) => chainMultiple(n, locant, "="),
    en: alkeneName, zh: alkeneZh,
  },
  {
    key: "4-alkene", priority: 13, locants: [4], from: 6,
    smiles: (n, locant) => chainMultiple(n, locant, "="),
    en: alkeneName, zh: alkeneZh,
  },
  {
    key: "5-alkene", priority: 14, locants: [5], from: 7,
    smiles: (n, locant) => chainMultiple(n, locant, "="),
    en: alkeneName, zh: alkeneZh,
  },
  {
    key: "6-alkene", priority: 15, locants: [6], from: 8,
    smiles: (n, locant) => chainMultiple(n, locant, "="),
    en: alkeneName, zh: alkeneZh,
  },
  {
    key: "1-alkyne", priority: 20, locants: [1], from: 2,
    smiles: (n, locant) => chainMultiple(n, locant, "#"),
    en: alkyneName, zh: alkyneZh,
  },
  {
    key: "2-alkyne", priority: 21, locants: [2], from: 4,
    smiles: (n, locant) => chainMultiple(n, locant, "#"),
    en: alkyneName, zh: alkyneZh,
  },
  {
    key: "3-alkyne", priority: 22, locants: [3], from: 5,
    smiles: (n, locant) => chainMultiple(n, locant, "#"),
    en: alkyneName, zh: alkyneZh,
  },
  {
    key: "4-alkyne", priority: 23, locants: [4], from: 6,
    smiles: (n, locant) => chainMultiple(n, locant, "#"),
    en: alkyneName, zh: alkyneZh,
  },
  {
    key: "1-ol", priority: 30, locants: [1], from: 1,
    smiles: (n, locant) => chainAt(n, locant, "O"),
    en: alcoholName, zh: alcoholZh,
  },
  {
    key: "2-ol", priority: 31, locants: [2], from: 3,
    smiles: (n, locant) => chainAt(n, locant, "O"),
    en: alcoholName, zh: alcoholZh,
  },
  {
    key: "3-ol", priority: 32, locants: [3], from: 4,
    smiles: (n, locant) => chainAt(n, locant, "O"),
    en: alcoholName, zh: alcoholZh,
  },
  {
    key: "4-ol", priority: 33, locants: [4], from: 5,
    smiles: (n, locant) => chainAt(n, locant, "O"),
    en: alcoholName, zh: alcoholZh,
  },
  {
    key: "1-amine", priority: 40, locants: [1], from: 1,
    smiles: (n, locant) => chainAt(n, locant, "N"),
    en: amineName, zh: amineZh,
  },
  {
    key: "2-amine", priority: 41, locants: [2], from: 3,
    smiles: (n, locant) => chainAt(n, locant, "N"),
    en: amineName, zh: amineZh,
  },
  {
    key: "3-amine", priority: 42, locants: [3], from: 4,
    smiles: (n, locant) => chainAt(n, locant, "N"),
    en: amineName, zh: amineZh,
  },
  {
    key: "acid", priority: 50, locants: [1], from: 1,
    smiles: (n) => (n === 1 ? "C(=O)O" : "C".repeat(n - 1) + "C(=O)O"),
    en: (n) => acidName(n), zh: (n) => acidZh(n),
  },
  {
    key: "aldehyde", priority: 51, locants: [1], from: 1,
    smiles: (n) => (n === 1 ? "C=O" : "C".repeat(n - 1) + "C=O"),
    en: (n) => aldehydeName(n), zh: (n) => aldehydeZh(n),
  },
  {
    key: "2-one", centre: true, priority: 52, locants: [2], from: 3,
    smiles: (n, locant) => ketoneChain(n, locant),
    en: ketoneName, zh: ketoneZh,
  },
  {
    key: "3-one", centre: true, priority: 53, locants: [3], from: 4,
    smiles: (n, locant) => ketoneChain(n, locant),
    en: ketoneName, zh: ketoneZh,
  },
  {
    key: "4-one", centre: true, priority: 54, locants: [4], from: 5,
    smiles: (n, locant) => ketoneChain(n, locant),
    en: ketoneName, zh: ketoneZh,
  },
  {
    key: "5-one", centre: true, priority: 55, locants: [5], from: 6,
    smiles: (n, locant) => ketoneChain(n, locant),
    en: ketoneName, zh: ketoneZh,
  },
  ...HALOGENS.flatMap((halogen, index) => [
    {
      key: `1-${halogen.key}`, priority: 60 + index * 10, locants: [1], from: 1,
      smiles: (n, locant) => chainAt(n, locant, halogen.symbol),
      en: (n, locant) => haloName(n, locant, halogen),
      zh: (n, locant) => haloZh(n, locant, halogen),
    },
    {
      key: `2-${halogen.key}`, priority: 61 + index * 10, locants: [2], from: 3,
      smiles: (n, locant) => chainAt(n, locant, halogen.symbol),
      en: (n, locant) => haloName(n, locant, halogen),
      zh: (n, locant) => haloZh(n, locant, halogen),
    },
    {
      key: `3-${halogen.key}`, priority: 62 + index * 10, locants: [3], from: 4,
      smiles: (n, locant) => chainAt(n, locant, halogen.symbol),
      en: (n, locant) => haloName(n, locant, halogen),
      zh: (n, locant) => haloZh(n, locant, halogen),
    },
    {
      key: `4-${halogen.key}`, priority: 63 + index * 10, locants: [4], from: 5,
      smiles: (n, locant) => chainAt(n, locant, halogen.symbol),
      en: (n, locant) => haloName(n, locant, halogen),
      zh: (n, locant) => haloZh(n, locant, halogen),
    },
  ]),
  {
    key: "1-thiol", priority: 100, locants: [1], from: 1,
    smiles: (n, locant) => chainAt(n, locant, "S"),
    en: thiolName, zh: thiolZh,
  },
  {
    key: "2-thiol", priority: 101, locants: [2], from: 3,
    smiles: (n, locant) => chainAt(n, locant, "S"),
    en: thiolName, zh: thiolZh,
  },
  {
    key: "3-thiol", priority: 102, locants: [3], from: 4,
    smiles: (n, locant) => chainAt(n, locant, "S"),
    en: thiolName, zh: thiolZh,
  },
  {
    key: "4-thiol", priority: 103, locants: [4], from: 5,
    smiles: (n, locant) => chainAt(n, locant, "S"),
    en: thiolName, zh: thiolZh,
  },
  {
    key: "1,2-diol", priority: 110, locants: [1], from: 2,
    smiles: (n) => "C(O)C(O)" + "C".repeat(n - 2),
    en: (n) => diolName(n), zh: (n) => diolZh(n),
  },
  {
    key: "1,2-diamine", priority: 111, locants: [1], from: 2,
    smiles: (n) => "C(N)C(N)" + "C".repeat(n - 2),
    en: (n) => diamineName(n), zh: (n) => diamineZh(n),
  },
  {
    key: "diacid", priority: 112, locants: [1], from: 2,
    smiles: (n) => "O=C(O)" + "C".repeat(n - 2) + "C(=O)O",
    en: (n) => diacidName(n), zh: (n) => diacidZh(n),
  },
  {
    key: "cyano", priority: 113, locants: [1], from: 2,
    smiles: (n) => "C".repeat(n - 1) + "C#N",
    en: (n) => nitrileName(n), zh: (n) => nitrileZh(n),
  },
  ...ESTER_ALKYLS.map((alkyl, index) => ({
    key: `${alkyl.key}-ester`, priority: 120 + index, locants: [1], from: 1,
    smiles: (n) => `${alkyl.prefix}C(=O)` + "C".repeat(n - 1),
    en: (n) => esterName(alkyl, n), zh: (n) => esterZh(alkyl, n),
  })),
];

function hybridizationFor(molecule, atom) {
  let double = false;
  for (let bond = 0; bond < molecule.getAllBonds(); bond++) {
    if (molecule.getBondAtom(0, bond) !== atom && molecule.getBondAtom(1, bond) !== atom) continue;
    const order = molecule.getBondOrder(bond);
    if (order === 3) return "sp";
    if (order === 2) double = true;
  }
  return double ? "sp2" : "sp3";
}

function moleculeFromSmiles(smiles) {
  const parsed = OCL.Molecule.fromSmiles(smiles);
  const atoms = [];
  for (let index = 0; index < parsed.getAllAtoms(); index++) {
    const element = parsed.getAtomLabel(index);
    const charge = parsed.getAtomCharge(index);
    atoms.push({
      el: element,
      hybridization: hybridizationFor(parsed, index),
      ...(charge ? { charge } : {}),
    });
  }
  const bonds = [];
  for (let bond = 0; bond < parsed.getAllBonds(); bond++) {
    bonds.push({
      i: [parsed.getBondAtom(0, bond), parsed.getBondAtom(1, bond)],
      order: parsed.getBondOrder(bond),
    });
  }
  return { parsed, atoms, bonds, formula: parsed.getMolecularFormula().formula };
}

function isConnected(atomCount, bonds) {
  if (atomCount === 0) return false;
  const adjacency = Array.from({ length: atomCount }, () => []);
  for (const bond of bonds) {
    adjacency[bond.i[0]].push(bond.i[1]);
    adjacency[bond.i[1]].push(bond.i[0]);
  }
  const seen = new Set([0]);
  const queue = [0];
  while (queue.length > 0) {
    const current = queue.shift();
    for (const next of adjacency[current]) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return seen.size === atomCount;
}

function isValidGraph(atoms, bonds) {
  if (atoms.length === 0 || atoms.length > 512) return false;
  const pairs = new Set();
  for (const bond of bonds) {
    const [a, b] = bond.i;
    if (a < 0 || b < 0 || a >= atoms.length || b >= atoms.length || a === b) return false;
    const key = a < b ? `${a}-${b}` : `${b}-${a}`;
    if (pairs.has(key)) return false;
    pairs.add(key);
  }
  return isConnected(atoms.length, bonds);
}

function presetFromSmiles(id, smiles, enName, zhName) {
  const { parsed, atoms, bonds, formula } = moleculeFromSmiles(smiles);
  if (!isValidGraph(atoms, bonds)) throw new Error(`invalid graph for ${id}`);
  return {
    id,
    formula,
    inputs: [formula, zhName, enName],
    iupac: enName,
    chemvz: {
      chemvz: 2,
      name: { "zh-CN": zhName, "zh-TW": zhName, "en-US": enName },
      smiles: parsed.toSmiles(),
      atoms,
      bonds,
    },
  };
}

function canonicalKey(preset) {
  return OCL.Molecule.fromSmiles(preset.chemvz.smiles).getIDCode();
}

function readExisting() {
  const files = fs.readdirSync(PRESET_DIR).filter((name) => name.endsWith(".json"));
  const presets = [];
  for (const file of files) {
    try {
      const pathName = path.join(PRESET_DIR, file);
      const raw = JSON.parse(fs.readFileSync(pathName, "utf8"));
      if (!raw || typeof raw.id !== "string" || !raw.chemvz) continue;
      // Older runs of this generator left bookkeeping fields in the JSON.
      // Normalise them in place so the archive is a clean preset file.
      const cleaned = presetPayload(raw);
      if (JSON.stringify(cleaned) !== JSON.stringify(raw)) {
        writeJson(pathName, cleaned);
      }
      presets.push({ file, raw: cleaned, key: canonicalKey(cleaned) });
    } catch (error) {
      console.warn(`Skipping unreadable preset ${file}: ${error.message}`);
    }
  }
  return presets;
}

function generateCandidates(existingKeys, existingIds) {
  const candidates = [];
  const seen = new Set(existingKeys);
  for (const series of SERIES) {
    for (const locant of series.locants) {
      for (let n = series.from; n <= 40; n++) {
        // Only emit the preferred (lowest) locant. The mirror-image locant is
        // the same molecule and would otherwise get a non-IUPAC name. Ketones
        // have a centre carbon, so the valid range is one wider.
        if (locant > 1 && locant * 2 > n + (series.centre ? 1 : 0)) continue;
        const id = `${series.key}-c${n}`;
        if (existingIds.has(id)) continue;
        const smiles = series.smiles(n, locant);
        let preset;
        try {
          preset = presetFromSmiles(id, smiles, series.en(n, locant), series.zh(n, locant));
        } catch (error) {
          console.warn(`Skipping ${id}: ${error.message}`);
          continue;
        }
        const key = canonicalKey(preset);
        if (seen.has(key)) continue;
        seen.add(key);
        candidates.push({
          ...preset,
          seriesKey: series.key,
          priority: series.priority,
          carbons: n,
          locant,
        });
      }
    }
  }
  return candidates;
}

function sortCandidates(a, b) {
  return a.priority - b.priority
    || a.carbons - b.carbons
    || a.locant - b.locant
    || a.id.localeCompare(b.id);
}

/**
 * Round-robin across series so the 2000 pack contains every functional group
 * instead of exhausting the halides first. Within a series the smallest
 * homologues are picked first.
 */
function balancedSelection(candidates, count) {
  const groups = new Map();
  for (const candidate of [...candidates].sort(sortCandidates)) {
    const group = groups.get(candidate.seriesKey);
    if (group) group.push(candidate);
    else groups.set(candidate.seriesKey, [candidate]);
  }
  const ordered = [...groups.values()].sort((a, b) => a[0].priority - b[0].priority);
  const selected = [];
  for (let index = 0; selected.length < count; index++) {
    let added = false;
    for (const group of ordered) {
      if (index >= group.length) continue;
      selected.push(group[index]);
      added = true;
      if (selected.length >= count) break;
    }
    if (!added) break;
  }
  return selected;
}

function seriesName(id) {
  return /-c\d+$/.test(id) || /^di-sub-benzene-/.test(id) || /^mono-sub-benzene-/.test(id);
}

function selectSmall(existing, generated) {
  const named = existing
    .filter((entry) => !seriesName(entry.raw.id))
    .sort((a, b) => a.raw.id.localeCompare(b.raw.id));
  // Prefer real homologues (`-cN`) over the combinatorial di-/mono-substituted
  // benzene series; those are useful in the full pack but poor first examples.
  const homologues = existing
    .filter((entry) => /-c\d+$/.test(entry.raw.id))
    .sort((a, b) => {
      const aCarbons = Number(a.raw.id.match(/-c(\d+)$/)?.[1] ?? 0);
      const bCarbons = Number(b.raw.id.match(/-c(\d+)$/)?.[1] ?? 0);
      return aCarbons - bCarbons || a.raw.id.localeCompare(b.raw.id);
    });
  const selected = [...named];
  for (const entry of homologues) {
    if (selected.length >= TARGET_SMALL) break;
    selected.push(entry);
  }
  for (const entry of generated) {
    if (selected.length >= TARGET_SMALL) break;
    selected.push({ raw: entry, generated: true });
  }
  return selected.slice(0, TARGET_SMALL);
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

/** Strip generator-only bookkeeping before writing a preset file. */
function presetPayload(entry) {
  return {
    id: entry.id,
    formula: entry.formula,
    inputs: entry.inputs,
    ...(entry.iupac ? { iupac: entry.iupac } : {}),
    chemvz: entry.chemvz,
  };
}

function stagePack(name, entries) {
  const root = path.join(TMP_DIR, name);
  fs.rmSync(root, { recursive: true, force: true });
  const presetDir = path.join(root, "molecules", "presets");
  fs.mkdirSync(presetDir, { recursive: true });
  for (const entry of entries) {
    const raw = entry.generated ? presetPayload(entry.raw) : entry.raw;
    writeJson(path.join(presetDir, `${raw.id}.json`), raw);
  }
  const readme = [
    `ChemViz3D preset supplement — ${entries.length} molecules`,
    "",
    "Install:",
    "  1. Close ChemViz3D.",
    "  2. Extract this archive into the ChemViz3D data directory so that",
    "     molecules/presets/ contains the JSON files.",
    "     Portable: the directory containing the executable.",
    "     Installed: ~/.config/ChemViz3D (Linux) or %APPDATA%/ChemViz3D (Windows).",
    "  3. Start ChemViz3D again. The presets are merged with the bundled ones.",
    "",
    "The JSON files are plain chemvz: 2 structures; you can delete individual",
    "files to remove a preset. Inputs include the formula, Chinese name and",
    "English IUPAC name.",
    "",
  ].join("\n");
  fs.writeFileSync(path.join(root, "README.txt"), readme, "utf8");
  const zipPath = path.join(PACK_DIR, `ChemViz3D-presets-${name}.zip`);
  fs.rmSync(zipPath, { force: true });
  execFileSync("zip", ["-r", "-X", "-q", zipPath, "."], { cwd: root });
  return zipPath;
}

function main() {
  if (!fs.existsSync(PRESET_DIR)) throw new Error(`missing preset directory: ${PRESET_DIR}`);
  const existing = readExisting();
  const existingKeys = new Set(existing.map((entry) => entry.key));
  const existingIds = new Set(existing.map((entry) => entry.raw.id));
  const candidates = generateCandidates(existingKeys, existingIds).sort(sortCandidates);

  const needed = TARGET_TOTAL - existing.length;
  if (needed < 0) throw new Error(`existing presets already exceed ${TARGET_TOTAL}`);
  if (candidates.length < needed) {
    throw new Error(`only ${candidates.length} unique candidates, need ${needed}`);
  }
  const selectedGenerated = balancedSelection(candidates, needed);
  const full = [
    ...existing.map((entry) => ({ raw: entry.raw })),
    ...selectedGenerated.map((entry) => ({ raw: entry, generated: true })),
  ];
  const small = selectSmall(existing, selectedGenerated);

  console.log(`existing presets: ${existing.length}`);
  console.log(`unique candidates: ${candidates.length}`);
  console.log(`generated selected: ${selectedGenerated.length}`);
  console.log(`full pack: ${full.length}`);
  console.log(`small pack: ${small.length}`);
  console.log("first generated:", selectedGenerated.slice(0, 5).map((entry) => entry.id).join(", "));
  console.log("last generated:", selectedGenerated.slice(-5).map((entry) => entry.id).join(", "));

  if (DRY_RUN) return;

  for (const entry of selectedGenerated) {
    writeJson(path.join(PRESET_DIR, `${entry.id}.json`), presetPayload(entry));
  }
  const fullZip = stagePack("2000", full);
  const smallZip = stagePack("500", small);
  const manifest = {
    generatedAt: new Date().toISOString(),
    full: { count: full.length, archive: path.basename(fullZip) },
    small: { count: small.length, archive: path.basename(smallZip) },
  };
  writeJson(path.join(PACK_DIR, "manifest.json"), manifest);
  console.log(`wrote ${path.relative(ROOT, fullZip)}`);
  console.log(`wrote ${path.relative(ROOT, smallZip)}`);
}

main();
