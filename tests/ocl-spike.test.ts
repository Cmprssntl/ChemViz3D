import test from "node:test";
import assert from "node:assert/strict";
import { ConformerGenerator, ForceFieldMMFF94, Molecule, Resources } from "openchemlib";
import resources from "../src/engine/conformer/ocl-resources.generated.json";

const Z = { H: 1, C: 6, N: 7, O: 8, F: 9, P: 15, S: 16, Cl: 17, Br: 35, I: 53 } as const;

Resources.register(resources as unknown as Record<string, string>);

interface Spec {
  atoms: Array<{ el: keyof typeof Z; charge?: number }>;
  bonds: Array<{ i: [number, number]; order: number }>;
}

function buildMolecule(spec: Spec): Molecule {
  const mol = new Molecule(spec.atoms.length + 8, spec.bonds.length + 8);
  for (const atom of spec.atoms) {
    const index = mol.addAtom(Z[atom.el]);
    if (atom.charge) mol.setAtomCharge(index, atom.charge);
  }
  for (const bond of spec.bonds) {
    const index = mol.addBond(bond.i[0], bond.i[1]);
    mol.setBondOrder(index, Math.round(bond.order));
  }
  mol.ensureHelperArrays(Molecule.cHelperParities);
  return mol;
}

function measure(mol: Molecule) {
  let minBond = Infinity;
  let maxBond = -Infinity;
  for (let bond = 0; bond < mol.getAllBonds(); bond++) {
    const a = mol.getBondAtom(0, bond);
    const b = mol.getBondAtom(1, bond);
    const distance = Math.hypot(
      mol.getAtomX(a) - mol.getAtomX(b),
      mol.getAtomY(a) - mol.getAtomY(b),
      mol.getAtomZ(a) - mol.getAtomZ(b),
    );
    minBond = Math.min(minBond, distance);
    maxBond = Math.max(maxBond, distance);
  }
  const n = mol.getAllAtoms();
  let minPair = Infinity;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const distance = Math.hypot(
        mol.getAtomX(i) - mol.getAtomX(j),
        mol.getAtomY(i) - mol.getAtomY(j),
        mol.getAtomZ(i) - mol.getAtomZ(j),
      );
      minPair = Math.min(minPair, distance);
    }
  }
  const xs: number[] = [];
  const ys: number[] = [];
  const zs: number[] = [];
  for (let i = 0; i < n; i++) {
    xs.push(mol.getAtomX(i));
    ys.push(mol.getAtomY(i));
    zs.push(mol.getAtomZ(i));
  }
  const span = (values: number[]) => Math.max(...values) - Math.min(...values);
  return { n, minBond, maxBond, minPair, span: [span(xs), span(ys), span(zs)] };
}

function chain(carbons: number): Spec {
  return {
    atoms: Array.from({ length: carbons }, () => ({ el: "C" as const })),
    bonds: Array.from({ length: carbons - 1 }, (_, i) => ({ i: [i, i + 1] as [number, number], order: 1 })),
  };
}

const cases: Record<string, Spec> = {
  methane: { atoms: [{ el: "C" }], bonds: [] },
  ethanol: {
    atoms: [{ el: "C" }, { el: "C" }, { el: "O" }],
    bonds: [{ i: [0, 1], order: 1 }, { i: [1, 2], order: 1 }],
  },
  benzene: {
    atoms: Array.from({ length: 6 }, () => ({ el: "C" as const })),
    bonds: [[0, 1, 1], [1, 2, 2], [2, 3, 1], [3, 4, 2], [4, 5, 1], [5, 0, 2]]
      .map(([a, b, order]) => ({ i: [a, b] as [number, number], order })),
  },
  cyclohexane: {
    atoms: Array.from({ length: 6 }, () => ({ el: "C" as const })),
    bonds: Array.from({ length: 6 }, (_, i) => ({ i: [i, (i + 1) % 6] as [number, number], order: 1 })),
  },
  chain6: chain(6),
  chain12: chain(12),
  chain20: chain(20),
  chain40: chain(40),
};

for (const [name, spec] of Object.entries(cases)) {
  test(`openchemlib conformer: ${name}`, () => {
    const started = performance.now();
    const source = buildMolecule(spec);
    const generator = new ConformerGenerator(42);
    const conformer = generator.getOneConformerAsMolecule(source);
    assert.ok(conformer, "conformer generation returned null");

    const generated = measure(conformer);
    const forceField = new ForceFieldMMFF94(conformer, "MMFF94");
    const code = forceField.minimise({ maxIts: 500, gradTol: 1e-3, funcTol: 1e-4 });
    const refined = measure(conformer);
    const elapsed = performance.now() - started;

    assert.equal(code, 0, `MMFF94 minimise failed with code ${code}`);
    assert.ok(Number.isFinite(refined.minBond), "non-finite bond length");
    assert.ok(refined.minBond > 0.7, `bond too short: ${refined.minBond.toFixed(3)}`);
    assert.ok(refined.maxBond < 2.0, `bond too long: ${refined.maxBond.toFixed(3)}`);
    assert.ok(refined.minPair > 0.6, `atoms too close: ${refined.minPair.toFixed(3)}`);

    console.log(
      `${name.padEnd(12)} atoms=${String(refined.n).padStart(3)}`,
      `gen=${generated.minBond.toFixed(2)}-${generated.maxBond.toFixed(2)}`,
      `mmff=${refined.minBond.toFixed(2)}-${refined.maxBond.toFixed(2)}`,
      `minPair=${refined.minPair.toFixed(2)}`,
      `span=${refined.span.map((v) => v.toFixed(1)).join("/")}`,
      `${elapsed.toFixed(0)}ms`,
    );
  });
}
