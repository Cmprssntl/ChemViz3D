import test from "node:test";
import assert from "node:assert/strict";
import { coordinatesUnchanged } from "../src/hooks/useMoleculeUpgrade";
import type { AtomData, MoleculeData } from "../src/types/molecule";

function molecule(points: Array<[number, number, number]>): MoleculeData {
  const atoms: AtomData[] = points.map(([x, y, z], index) => ({
    index, element: "C", x, y, z, covalentRadius: 70, vdwRadius: 170,
  }));
  return { atoms, bonds: [], name: "test", formula: "C", smiles: "C" };
}

test("identical coordinates are accepted", () => {
  assert.equal(coordinatesUnchanged(molecule([[0, 0, 0], [1, 0, 0]]), molecule([[0, 0, 0], [1, 0, 0]])), true);
});

test("a rotated bond blocks the refinement replacement", () => {
  assert.equal(coordinatesUnchanged(molecule([[0, 0, 0], [1, 0.4, 0]]), molecule([[0, 0, 0], [1, 0, 0]])), false);
});

test("a different atom count blocks the refinement replacement", () => {
  assert.equal(coordinatesUnchanged(molecule([[0, 0, 0]]), molecule([[0, 0, 0], [1, 0, 0]])), false);
});
