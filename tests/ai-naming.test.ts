import test from "node:test";
import assert from "node:assert/strict";
import { NamingAIError, describeMolecule, validateIupacName } from "../src/naming/aiNamer";
import type { MoleculeData } from "../src/types/molecule";

const ethanol: MoleculeData = {
  atoms: [
    { index: 0, element: "C", x: 0, y: 0, z: 0, covalentRadius: 70, vdwRadius: 170 },
    { index: 1, element: "C", x: 1, y: 0, z: 0, covalentRadius: 70, vdwRadius: 170 },
    { index: 2, element: "O", x: 2, y: 0, z: 0, covalentRadius: 66, vdwRadius: 152 },
  ],
  bonds: [
    { index: 0, atom1Idx: 0, atom2Idx: 1, order: 1 },
    { index: 1, atom1Idx: 1, atom2Idx: 2, order: 1 },
  ],
  name: "ethanol",
  formula: "C2H6O",
  smiles: "CCO",
};

test("accepts a clean IUPAC name", () => {
  assert.equal(validateIupacName("propan-2-one"), "propan-2-one");
});

test("trims and collapses internal whitespace", () => {
  assert.equal(validateIupacName("  2,4,6-trinitrotoluene  "), "2,4,6-trinitrotoluene");
  assert.equal(validateIupacName("ethanoic   acid"), "ethanoic acid");
});

test("rejects empty, multiline, overlong and labelled replies", () => {
  assert.throws(() => validateIupacName(""), NamingAIError);
  assert.throws(() => validateIupacName("   "), NamingAIError);
  assert.throws(() => validateIupacName("ethanol\nsecond line"), NamingAIError);
  assert.throws(() => validateIupacName("x".repeat(121)), NamingAIError);
  assert.throws(() => validateIupacName("IUPAC: ethanol"), NamingAIError);
  assert.throws(() => validateIupacName("name：ethanol"), NamingAIError);
  assert.throws(() => validateIupacName("`ethanol`"), NamingAIError);
  assert.throws(() => validateIupacName(42), NamingAIError);
});

test("structure description carries formula, SMILES and connectivity", () => {
  const text = describeMolecule(ethanol);
  assert.match(text, /Formula: C2H6O/);
  assert.match(text, /SMILES: CCO/);
  assert.match(text, /Atoms \(3\): C2O/);
  assert.match(text, /0C-1C:1/);
  assert.match(text, /1C-2O:1/);
});

test("structure description marks a missing SMILES explicitly", () => {
  const text = describeMolecule({ ...ethanol, smiles: "" });
  assert.match(text, /SMILES: \(not provided\)/);
});
