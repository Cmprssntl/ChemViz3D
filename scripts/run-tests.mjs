/**
 * Bundles every tests/**\/*.test.ts with rolldown and runs them through the
 * Node test runner. Bundling is required because the application source uses
 * extensionless TypeScript imports, which Node's type stripping cannot resolve.
 */
import { readdir, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { build } from "rolldown";

const root = process.cwd();
const testsDir = path.join(root, "tests");
const outDir = path.join(root, ".tmp/tests");

async function collect(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await collect(full));
    else if (entry.name.endsWith(".test.ts")) files.push(full);
  }
  return files.sort();
}

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

const files = await collect(testsDir);
if (files.length === 0) {
  console.error("No test files found in tests/");
  process.exit(1);
}

const outputs = [];
for (const file of files) {
  const name = path.relative(testsDir, file).replace(/\.test\.ts$/, "").replace(/[\\/]/g, "-");
  const outfile = path.join(outDir, `${name}.test.mjs`);
  await build({
    input: file,
    platform: "node",
    output: { file: outfile, format: "esm" },
  });
  outputs.push(outfile);
}

const child = spawn(process.execPath, ["--test", ...outputs], { stdio: "inherit", cwd: root });
child.on("exit", (code) => process.exit(code ?? 1));
