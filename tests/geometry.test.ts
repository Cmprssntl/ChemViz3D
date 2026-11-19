import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import * as THREE from "three";
import { chemVZToBondSpec, type ChemVZMolecule } from "../src/types/moleculeFormat";
import { validateAIChemVZ } from "../src/ai/aiParser";
import { ConformerService } from "../src/engine/conformer/ConformerService";
import { GeometryValidator } from "../src/engine/relax/GeometryValidator";
import { bestFitPlane, detectPlanarFragments, planarityDeviation } from "../src/engine/coplanarity";

const service = new ConformerService();
const validator = new GeometryValidator();
const presetsDir = path.join(process.cwd(), "molecules/presets");

function buildFromChemVZ(chemvz: ChemVZMolecule) {
  const spec = chemVZToBondSpec(chemvz);
  const result = service.build({
    elements: spec.atoms,
    bonds: spec.bonds,
    ...(spec.hybridizations ? { hybridizations: spec.hybridizations } : {}),
    ...(spec.charges ? { charges: spec.charges } : {}),
    formula: spec.formula,
    smiles: chemvz.smiles ?? "",
  }, { name: "test" });
  return { ...result, report: validator.validate(result.molecule.atoms, result.molecule.bonds) };
}

function assertValid(label: string, report: ReturnType<GeometryValidator["validate"]>) {
  assert.ok(
    report.ok,
    `${label}: ${report.issues.map((issue) => issue.message).join("; ")}`,
  );
  assert.ok(report.stats.minBond > 0.8, `${label}: bond too short ${report.stats.minBond}`);
  assert.ok(report.stats.maxBond < 2.0, `${label}: bond too long ${report.stats.maxBond}`);
  assert.ok(report.stats.minNonBonded > 0.6, `${label}: atoms overlap ${report.stats.minNonBonded}`);
}

for (const file of fs.readdirSync(presetsDir).filter((name) => name.endsWith(".json")).sort()) {
  test(`preset geometry: ${file}`, () => {
    const raw = JSON.parse(fs.readFileSync(path.join(presetsDir, file), "utf8")) as { chemvz: unknown };
    const chemvz = validateAIChemVZ(raw.chemvz);
    const result = buildFromChemVZ(chemvz);
    assertValid(file, result.report);
    console.log(`${file.padEnd(26)} backend=${result.backend.padEnd(12)} atoms=${String(result.molecule.atoms.length).padStart(3)} bonds=${result.molecule.bonds.length}`);
  });
}

function chain(carbons: number): ChemVZMolecule {
  return {
    chemvz: 2,
    atoms: Array.from({ length: carbons }, () => ({ el: "C" as const })),
    bonds: Array.from({ length: carbons - 1 }, (_, index) => ({
      i: [index, index + 1] as [number, number],
      order: 1,
    })),
  };
}

for (const carbons of [3, 6, 10, 16, 24, 40]) {  test(`chain geometry: C${carbons}`, () => {
    const result = buildFromChemVZ(chain(carbons));
    assertValid(`C${carbons}`, result.report);
    assert.ok(result.report.stats.extent < 120, `C${carbons}: extent ${result.report.stats.extent}`);
    console.log(`C${carbons}`.padEnd(26), `backend=${result.backend.padEnd(12)} extent=${result.report.stats.extent.toFixed(1)} bond=${result.report.stats.minBond.toFixed(2)}-${result.report.stats.maxBond.toFixed(2)}`);
  });
}

test("benzene ring is planar after conformer generation", () => {
  const raw = JSON.parse(fs.readFileSync(path.join(presetsDir, "benzene.json"), "utf8")) as { chemvz: unknown };
  const chemvz = validateAIChemVZ(raw.chemvz);
  const result = buildFromChemVZ(chemvz);
  const carbonIndices = result.molecule.atoms
    .filter((atom) => atom.element === "C")
    .map((atom) => atom.index);
  const positions = carbonIndices.map((index) => {
    const atom = result.molecule.atoms[index];
    return new THREE.Vector3(atom.x, atom.y, atom.z);
  });
  const fit = bestFitPlane(positions);
  const deviation = planarityDeviation(positions, fit.normal, fit.center);
  assert.ok(deviation < 0.08, `benzene carbons deviate ${deviation.toFixed(3)} Å from a plane`);
});

test("coplanarity detection finds the benzene ring through the shared graph", () => {
  const raw = JSON.parse(fs.readFileSync(path.join(presetsDir, "benzene.json"), "utf8")) as { chemvz: unknown };
  const chemvz = validateAIChemVZ(raw.chemvz);
  const { molecule } = buildFromChemVZ(chemvz);
  const fragments = detectPlanarFragments(molecule);
  const ring = fragments.find((fragment) => fragment.type === "ring");
  assert.ok(ring, "no ring fragment detected");
  assert.equal(ring.atomIndices.length, 6);
});
