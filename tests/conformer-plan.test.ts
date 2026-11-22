import test from "node:test";
import assert from "node:assert/strict";
import { ConformerService } from "../src/engine/conformer/ConformerService";
import { OpenChemLibBackend } from "../src/engine/conformer/OpenChemLibBackend";
import { planConformer } from "../src/engine/conformer/ConformerPlan";
import { effectiveSearchQuality } from "../src/engine/conformer/search/types";
import { GeometryValidator } from "../src/engine/relax/GeometryValidator";
import type { ConformerInput } from "../src/engine/conformer/ConformerBackend";

function chain(carbons: number, extraBonds = 0): ConformerInput {
  const bonds: Array<[number, number, number]> = Array.from(
    { length: carbons - 1 },
    (_, index) => [index, index + 1, 1] as [number, number, number],
  );
  // Extra bonds close rings without changing the atom count.
  for (let index = 0; index < extraBonds; index++) {
    const first = index % carbons;
    const second = (index + 5) % carbons;
    if (first !== second) bonds.push([first, second, 1]);
  }
  return {
    elements: Array.from({ length: carbons }, () => "C"),
    bonds,
    formula: `C${carbons}H${2 * carbons + 2}`,
    smiles: "C".repeat(carbons),
  };
}

test("small molecules stay on the fine plan", () => {
  const plan = planConformer(chain(40));
  assert.equal(plan.quality, "fine");
  assert.equal(plan.initialMinimise, true);
  assert.equal(plan.refine, false);
});

test("medium molecules use balanced two-stage generation", () => {
  const c80 = planConformer(chain(80));
  assert.equal(c80.quality, "balanced");
  assert.equal(c80.initialMinimise, false);
  assert.equal(c80.refine, true);
  assert.equal(c80.refineWithConstrained, false);
  assert.equal(c80.refineIterations, 120);

  const c150 = planConformer(chain(150));
  assert.equal(c150.quality, "balanced");
  assert.equal(c150.refineIterations, 60);
});

test("very large molecules use the constrained refinement", () => {
  const plan = planConformer(chain(201));
  assert.equal(plan.quality, "coarse");
  assert.equal(plan.refine, true);
  assert.equal(plan.refineWithConstrained, true);
});

test("a high ring count downgrades an otherwise fine molecule", () => {
  const plan = planConformer(chain(40, 12));
  assert.ok(plan.ringCount > 8);
  assert.equal(plan.quality, "balanced");
});

test("large structures automatically downgrade the conformer search", () => {
  assert.equal(effectiveSearchQuality(50, "precise"), "precise");
  assert.equal(effectiveSearchQuality(150, "precise"), "balanced");
  assert.equal(effectiveSearchQuality(150, "balanced"), "balanced");
  assert.equal(effectiveSearchQuality(250, "precise"), "fast");
  assert.equal(effectiveSearchQuality(250, "balanced"), "fast");
});

test("C120 coarse geometry is produced within the first-frame budget", () => {
  const service = new ConformerService();
  // The first OCL call pays module/resource registration in a cold process;
  // warm it up so the measurement reflects a loaded app.
  service.build(chain(20));
  const input = chain(120);
  const started = performance.now();
  const result = service.build(input);
  const elapsed = performance.now() - started;

  assert.equal(result.plan.quality, "balanced");
  assert.ok(result.refine, "balanced plans must expose a refine step");
  assert.ok(elapsed < 1500, `C120 coarse build took ${elapsed.toFixed(0)} ms`);

  const report = new GeometryValidator().validate(result.molecule.atoms, result.molecule.bonds);
  assert.equal(report.ok, true, report.issues[0]?.message);
  assert.ok(result.molecule.atoms.length > 120, "expected explicit hydrogens");
});

test("the refine step preserves a valid graph and finite coordinates", async () => {
  const backend = new OpenChemLibBackend();
  const input = chain(80);
  const coarse = backend.build(input, { skipMinimise: true });
  assert.ok(coarse);

  const refined = await backend.refine(input, coarse, { maxIterations: 20, chunkIterations: 5 });
  assert.ok(refined);
  assert.equal(refined.atoms.length, coarse.atoms.length);
  assert.equal(refined.bonds.length, coarse.bonds.length);
  for (const atom of refined.atoms) {
    assert.ok(Number.isFinite(atom.x) && Number.isFinite(atom.y) && Number.isFinite(atom.z));
  }
  const report = new GeometryValidator().validate(refined.atoms, refined.bonds);
  assert.equal(report.ok, true, report.issues[0]?.message);
});

test("the constrained refinement branch is valid for large graphs", async () => {
  const backend = new OpenChemLibBackend();
  const input = chain(80);
  const coarse = backend.build(input, { skipMinimise: true });
  assert.ok(coarse);

  const refined = await backend.refine(input, coarse, { useConstrained: true, maxIterations: 20 });
  assert.ok(refined);
  assert.equal(refined.atoms.length, coarse.atoms.length);
  const report = new GeometryValidator().validate(refined.atoms, refined.bonds);
  assert.equal(report.ok, true, report.issues[0]?.message);
});
