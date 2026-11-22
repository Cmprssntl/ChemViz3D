import test from "node:test";
import assert from "node:assert/strict";
import { namingCacheKey } from "../src/naming/cache";
import type { AtomData, BondData, MoleculeData } from "../src/types/molecule";

function atom(index: number, element: string, x = 0, y = 0, z = 0): AtomData {
  return { index, element, x, y, z, covalentRadius: 70, vdwRadius: 170 };
}

function bond(index: number, atom1Idx: number, atom2Idx: number, order = 1): BondData {
  return { index, atom1Idx, atom2Idx, order };
}

function molecule(atoms: AtomData[], bonds: BondData[], smiles = ""): MoleculeData {
  return { atoms, bonds, smiles, name: "test", formula: "C2H6" };
}

test("canonical SMILES wins over the structure signature", () => {
  const mol = molecule([atom(0, "C"), atom(1, "C")], [bond(0, 0, 1)], "CC");
  assert.equal(namingCacheKey(mol), "CC");
  assert.equal(namingCacheKey({ ...mol, smiles: "  CCO  " }), "CCO");
});

test("structures without SMILES get a deterministic signature", () => {
  const mol = molecule([atom(0, "C"), atom(1, "O")], [bond(0, 0, 1)]);
  const key = namingCacheKey(mol);
  assert.match(key, /^sig:/);
  assert.equal(key, namingCacheKey({ ...mol, smiles: "   " }));
});

test("signature ignores atom coordinates and bond ordering", () => {
  const first = molecule(
    [atom(0, "C", 1, 2, 3), atom(1, "O", 4, 5, 6), atom(2, "C", 7, 8, 9)],
    [bond(0, 0, 1), bond(1, 1, 2), bond(2, 0, 2)],
  );
  const second = molecule(
    [atom(0, "C", -1, -2, -3), atom(1, "O", 0, 0, 0), atom(2, "C", 10, 10, 10)],
    [bond(0, 2, 0), bond(1, 1, 2), bond(2, 0, 1)],
  );
  assert.equal(namingCacheKey(first), namingCacheKey(second));
});

test("different structures produce different signatures", () => {
  const ethanol = molecule([atom(0, "C"), atom(1, "C"), atom(2, "O")], [bond(0, 0, 1), bond(1, 1, 2)]);
  const dimethylEther = molecule([atom(0, "C"), atom(1, "O"), atom(2, "C")], [bond(0, 0, 1), bond(1, 1, 2)]);
  assert.notEqual(namingCacheKey(ethanol), namingCacheKey(dimethylEther));
});

test("charges and hybridization participate in the signature", () => {
  const plain = molecule([atom(0, "N")], []);
  const charged = molecule([{ ...atom(0, "N"), charge: 1, hybridization: "sp3" }], []);
  assert.notEqual(namingCacheKey(plain), namingCacheKey(charged));
});
