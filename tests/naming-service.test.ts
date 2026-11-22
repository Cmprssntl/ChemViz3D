import test from "node:test";
import assert from "node:assert/strict";
import { NamingService, type NamingServiceDeps } from "../src/naming/NamingService";
import type { MoleculeData } from "../src/types/molecule";

function molecule(smiles: string): MoleculeData {
  return { atoms: [], bonds: [], name: smiles, formula: "", smiles };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function deps(overrides: Partial<NamingServiceDeps> = {}): NamingServiceDeps {
  return {
    resolveLocal: () => ({ name: "local-name", source: "local" }),
    getCached: async () => null,
    saveCached: async () => {},
    nameWithAI: async () => "ai-name",
    hasAI: () => true,
    ...overrides,
  };
}

test("preset names win over the local namer", () => {
  const service = new NamingService(deps({
    resolveLocal: (_mol, preset) => preset
      ? { name: preset, source: "preset" }
      : { name: "local-name", source: "local" },
  }));
  assert.deepEqual(service.resolve(molecule("CC"), "ethane"), { name: "ethane", source: "preset" });
});

test("local resolution returns the namer result unchanged", () => {
  const service = new NamingService(deps());
  assert.deepEqual(service.resolve(molecule("CC")), { name: "local-name", source: "local" });
});

test("cache hit resolves without calling the model", async () => {
  let aiCalls = 0;
  const service = new NamingService(deps({
    getCached: async () => "cached-name",
    nameWithAI: async () => { aiCalls++; return "ai-name"; },
  }));
  let resolved: [string, string] | null = null;
  await service.upgrade(molecule("CC"), (name, source) => { resolved = [name, source]; });
  assert.deepEqual(resolved, ["cached-name", "cache"]);
  assert.equal(aiCalls, 0);
});

test("cache miss falls through to the model and stores the result", async () => {
  let saved: [MoleculeData, string] | null = null;
  const service = new NamingService(deps({
    saveCached: async (mol, name) => { saved = [mol, name]; },
  }));
  let resolved: [string, string] | null = null;
  await service.upgrade(molecule("CC"), (name, source) => { resolved = [name, source]; });
  assert.deepEqual(resolved, ["ai-name", "ai"]);
  assert.equal(saved?.[1], "ai-name");
});

test("model failure falls back silently unless onError is supplied", async () => {
  const service = new NamingService(deps({
    nameWithAI: async () => { throw new Error("offline"); },
  }));
  let resolved = false;
  let reported: unknown = null;
  await service.upgrade(
    molecule("CC"),
    () => { resolved = true; },
    (error) => { reported = error; },
  );
  assert.equal(resolved, false);
  assert.ok(reported instanceof Error);
});

test("without AI configuration the upgrade does nothing", async () => {
  let touched = false;
  const service = new NamingService(deps({
    hasAI: () => false,
    getCached: async () => { touched = true; return "cached"; },
    nameWithAI: async () => { touched = true; return "ai"; },
  }));
  await service.upgrade(molecule("CC"), () => { touched = true; });
  assert.equal(touched, false);
});

test("a newer request discards the older reply", async () => {
  const first = deferred<string>();
  const service = new NamingService(deps({
    nameWithAI: () => first.promise,
  }));
  const results: string[] = [];
  const pending = service.upgrade(molecule("CC"), (name) => results.push(name));

  // A new molecule arrives while the first request is in flight.
  service.cancel();
  first.resolve("stale-name");
  await pending;

  assert.deepEqual(results, []);
});
