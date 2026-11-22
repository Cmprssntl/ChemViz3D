/**
 * Coordinate snapshot for the VSEPR builder.
 *
 * The builder is a long procedural placement pass; splitting it into modules is
 * only safe if the output cannot drift. This test records every preset's atom
 * positions and bonds, so a refactor that moves a single atom fails loudly.
 *
 * Regenerate intentionally with:
 *
 *   UPDATE_SNAPSHOTS=1 node scripts/run-tests.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chemVZToBondSpec } from "../src/types/moleculeFormat";
import { validateAIChemVZ } from "../src/ai/aiParser";
import { buildFromBondSpec } from "../src/engine/vseprBuilder";

const presetsDir = path.join(process.cwd(), "molecules/presets");
const fixturePath = path.join(process.cwd(), "tests/fixtures/vsepr-geometry.json");

interface SnapshotEntry {
  atoms: Array<{ element: string; x: number; y: number; z: number }>;
  bonds: Array<{ a: number; b: number; order: number }>;
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000 + 0; // "+ 0" normalises -0
}

function snapshot(file: string): SnapshotEntry {
  const raw = JSON.parse(fs.readFileSync(path.join(presetsDir, file), "utf8")) as { chemvz: unknown };
  const chemvz = validateAIChemVZ(raw.chemvz);
  const spec = chemVZToBondSpec(chemvz);
  const molecule = buildFromBondSpec(
    {
      atoms: spec.atoms,
      bonds: spec.bonds,
      ...(spec.hybridizations ? { hybridizations: spec.hybridizations } : {}),
      ...(spec.charges ? { charges: spec.charges } : {}),
    },
    spec.formula,
    chemvz.smiles ?? "",
  );
  return {
    atoms: molecule.atoms.map((atom) => ({
      element: atom.element,
      x: round(atom.x),
      y: round(atom.y),
      z: round(atom.z),
    })),
    bonds: molecule.bonds.map((bond) => ({ a: bond.atom1Idx, b: bond.atom2Idx, order: bond.order })),
  };
}

const files = fs.readdirSync(presetsDir).filter((name) => name.endsWith(".json")).sort();
const current: Record<string, SnapshotEntry> = {};
for (const file of files) current[file] = snapshot(file);

if (process.env.UPDATE_SNAPSHOTS === "1") {
  fs.mkdirSync(path.dirname(fixturePath), { recursive: true });
  fs.writeFileSync(fixturePath, `${JSON.stringify(current, null, 1)}\n`);
}

const expected = JSON.parse(fs.readFileSync(fixturePath, "utf8")) as Record<string, SnapshotEntry>;

test("every preset has a geometry snapshot", () => {
  assert.deepEqual(Object.keys(current).sort(), Object.keys(expected).sort());
});

for (const file of files) {
  test(`builder geometry is unchanged: ${file}`, () => {
    assert.deepEqual(current[file], expected[file]);
  });
}
