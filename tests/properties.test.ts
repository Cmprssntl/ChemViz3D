import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chemVZToBondSpec } from "../src/types/moleculeFormat";
import { validateAIChemVZ } from "../src/ai/aiParser";
import { ConformerService } from "../src/engine/conformer/ConformerService";
import { calcMoleculeProperties } from "../src/engine/properties";
import type { MoleculeData } from "../src/types/molecule";

const service = new ConformerService();
const presetsDir = path.join(process.cwd(), "molecules/presets");

function build(file: string): MoleculeData {
  const raw = JSON.parse(fs.readFileSync(path.join(presetsDir, file), "utf8")) as { chemvz: unknown };
  const spec = chemVZToBondSpec(validateAIChemVZ(raw.chemvz));
  return service.build({
    elements: spec.atoms,
    bonds: spec.bonds,
    ...(spec.hybridizations ? { hybridizations: spec.hybridizations } : {}),
    ...(spec.charges ? { charges: spec.charges } : {}),
    formula: spec.formula,
    smiles: "",
  }, { name: "test" }).molecule;
}

function rotatable(file: string): number {
  const molecule = build(file);
  return calcMoleculeProperties(molecule.atoms, molecule.bonds).rotatableBonds;
}

/**
 * Ring bonds never rotate freely and a bond to a terminal atom has no torsional
 * degree of freedom, so both count as zero. The old local implementation only
 * looked at heavy-neighbour counts and reported 7 for cycloheptane.
 */
const EXPECTED: Record<string, number> = {
  "ethane.json": 0,
  "propane.json": 0,
  "butane.json": 1,
  "methanol.json": 0,
  "ethanol.json": 0,
  "acetic-acid.json": 0,
  "acetone.json": 0,
  "benzene.json": 0,
  "toluene.json": 0,
  "cyclohexane.json": 0,
  "cycloheptane.json": 0,
  "ethyne.json": 0,
};

for (const [file, expected] of Object.entries(EXPECTED)) {
  test(`rotatable bonds: ${file}`, () => {
    assert.equal(rotatable(file), expected);
  });
}

test("rotatable bonds never count ring bonds in any preset", () => {
  for (const file of fs.readdirSync(presetsDir).filter((name) => name.endsWith(".json"))) {
    const molecule = build(file);
    const props = calcMoleculeProperties(molecule.atoms, molecule.bonds);
    assert.ok(Number.isInteger(props.rotatableBonds) && props.rotatableBonds >= 0, `${file}: ${props.rotatableBonds}`);
    assert.ok(props.rotatableBonds <= molecule.bonds.length, `${file}: more rotors than bonds`);
  }
});
