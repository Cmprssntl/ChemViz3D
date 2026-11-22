import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import OCL from "openchemlib";
import { validateAIChemVZ } from "../src/ai/aiParser";
import { ConformerService } from "../src/engine/conformer/ConformerService";
import { GeometryValidator } from "../src/engine/relax/GeometryValidator";
import { chemVZToBondSpec } from "../src/types/moleculeFormat";

const PRESET_DIR = path.join(process.cwd(), "presets-pack/molecules/presets");

/**
 * The supplement archive is optional, but it ships from this repository and is
 * uploaded to the release. Every file must therefore pass the same validator
 * the app uses when it loads a config-directory preset.
 */
test("supplement preset pack contains 2000 valid chemvz: 2 presets", () => {
  const files = fs.readdirSync(PRESET_DIR).filter((name) => name.endsWith(".json"));
  assert.equal(files.length, 2000);

  const keys = new Set<string>();
  for (const file of files) {
    const raw = JSON.parse(fs.readFileSync(path.join(PRESET_DIR, file), "utf8")) as {
      id?: unknown;
      formula?: unknown;
      inputs?: unknown;
      chemvz?: unknown;
    };
    assert.equal(typeof raw.id, "string", `${file}: missing id`);
    assert.equal(typeof raw.formula, "string", `${file}: missing formula`);
    assert.ok(Array.isArray(raw.inputs) && raw.inputs.length > 0, `${file}: missing inputs`);

    const chemvz = validateAIChemVZ(raw.chemvz);
    assert.ok(chemvz.smiles, `${file}: missing smiles`);
    const molecule = OCL.Molecule.fromSmiles(chemvz.smiles);
    keys.add(molecule.getIDCode());
  }

  // The original 1162-file pack contains a handful of aliases with the same
  // structure; the generated files never add another duplicate.
  assert.ok(keys.size >= 1980, `only ${keys.size} unique structures`);
});

test("sampled generated presets build valid 3D geometry", () => {
  const service = new ConformerService();
  const validator = new GeometryValidator();
  for (const id of ["1-alkene-c25", "2-amine-c25", "acid-c25", "2-one-c25"]) {
    const raw = JSON.parse(fs.readFileSync(path.join(PRESET_DIR, `${id}.json`), "utf8")) as { chemvz: unknown };
    const chemvz = validateAIChemVZ(raw.chemvz);
    const spec = chemVZToBondSpec(chemvz);
    const result = service.build({
      elements: spec.atoms,
      bonds: spec.bonds,
      ...(spec.hybridizations ? { hybridizations: spec.hybridizations } : {}),
      ...(spec.charges ? { charges: spec.charges } : {}),
      formula: spec.formula,
      smiles: chemvz.smiles ?? "",
    }, { name: id });
    const report = validator.validate(result.molecule.atoms, result.molecule.bonds);
    assert.equal(report.ok, true, `${id}: ${report.issues[0]?.message}`);
  }
});
