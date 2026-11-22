import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chemVZToBondSpec, type ChemVZMolecule } from "../src/types/moleculeFormat";
import { validateAIChemVZ } from "../src/ai/aiParser";
import { ConformerService } from "../src/engine/conformer/ConformerService";
import { IupacNamer, NamingError } from "../src/domain/naming/IupacNamer";
import type { MoleculeData } from "../src/types/molecule";

const service = new ConformerService();
const namer = new IupacNamer();
const presetsDir = path.join(process.cwd(), "molecules/presets");

const GOLDEN: Record<string, string> = {
  "acetic-acid.json": "ethanoic acid",
  "acetone.json": "propan-2-one",
  "benzene.json": "benzene",
  "butane.json": "butane",
  "cyclobutane.json": "cyclobutane",
  "cycloheptane.json": "cycloheptane",
  "cyclohexane.json": "cyclohexane",
  "cyclopentane.json": "cyclopentane",
  "cyclopropane.json": "cyclopropane",
  "ethane.json": "ethane",
  "ethanol.json": "ethanol",
  "ethene.json": "ethene",
  "ethyne.json": "ethyne",
  "formaldehyde.json": "methanal",
  "methane.json": "methane",
  "methanol.json": "methanol",
  "propane.json": "propane",
  "toluene.json": "1-methylbenzene",
  // Lowest locant set for the ring substituents ({1,2,3,5} beats {1,2,4,6}),
  // then alphabetical order puts methyl before nitro.
  "trinitrotoluene.json": "2-methyl-1,3,5-trinitrobenzene",
};

/** Molecules with no carbon parent must fail loudly, never fall back. */
const EXPECTED_ERRORS: Record<string, string> = {
  "ammonia.json": "no-carbon-parent",
  "carbon-dioxide.json": "no-carbon-parent",
  "water.json": "no-carbon-parent",
};

function build(file: string): MoleculeData {
  const raw = JSON.parse(fs.readFileSync(path.join(presetsDir, file), "utf8")) as { chemvz: unknown };
  const chemvz = validateAIChemVZ(raw.chemvz);
  const spec = chemVZToBondSpec(chemvz);
  return service.build({
    elements: spec.atoms,
    bonds: spec.bonds,
    ...(spec.hybridizations ? { hybridizations: spec.hybridizations } : {}),
    ...(spec.charges ? { charges: spec.charges } : {}),
    formula: spec.formula,
    smiles: chemvz.smiles ?? "",
  }, { name: "test" }).molecule;
}

for (const [file, expected] of Object.entries(GOLDEN)) {
  test(`iupac name: ${file}`, () => {
    assert.equal(namer.name(build(file)), expected);
  });
}

for (const [file, code] of Object.entries(EXPECTED_ERRORS)) {
  test(`iupac name fails explicitly: ${file}`, () => {
    assert.throws(
      () => namer.name(build(file)),
      (error: unknown) => error instanceof NamingError && error.code === code,
    );
  });
}

test("every preset either names cleanly or raises a typed error", () => {
  for (const file of fs.readdirSync(presetsDir).filter((name) => name.endsWith(".json"))) {
    const result = namer.tryName(build(file));
    if ("error" in result) {
      assert.ok(result.error instanceof NamingError, `${file}: unexpected error type`);
      continue;
    }
    assert.ok(result.name.length > 0, `${file}: empty name`);
  }
});

test("every preset declares a unique, non-empty IUPAC name", () => {
  const files = fs.readdirSync(presetsDir).filter((name) => name.endsWith(".json"));
  assert.equal(files.length, 22);
  const seen = new Set<string>();
  for (const file of files) {
    const raw = JSON.parse(fs.readFileSync(path.join(presetsDir, file), "utf8")) as { iupac?: unknown };
    assert.equal(typeof raw.iupac, "string", `${file}: missing iupac`);
    const name = (raw.iupac as string).trim();
    assert.ok(name.length > 0, `${file}: empty iupac`);
    assert.ok(!seen.has(name), `${file}: duplicate iupac ${name}`);
    seen.add(name);
  }
});

test("preset IUPAC names agree with the local namer where it succeeds", () => {
  for (const [file, expected] of Object.entries(GOLDEN)) {
    const raw = JSON.parse(fs.readFileSync(path.join(presetsDir, file), "utf8")) as { iupac?: unknown };
    assert.equal(raw.iupac, expected, `${file}: preset iupac drifted from the local namer`);
  }
});
