/**
 * Builds per-platform artifacts from the single source tree.
 *
 *   node scripts/package.mjs                 # all three
 *   node scripts/package.mjs web desktop     # a subset
 *
 * Each artifact is the same IIFE bundle; only `platform.json` differs, which
 * the runtime uses as a marker when no build flag or bridge is present.
 */
import { execFileSync } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const releaseDir = path.join(root, "release");
const PLATFORMS = ["web", "desktop", "android"];

const requested = process.argv.slice(2).filter((value) => !value.startsWith("-"));
const targets = requested.length > 0 ? requested : PLATFORMS;
const unknown = targets.filter((target) => !PLATFORMS.includes(target));
if (unknown.length > 0) {
  console.error(`Unknown platform(s): ${unknown.join(", ")}. Use ${PLATFORMS.join(" | ")}.`);
  process.exit(1);
}

function build(platform) {
  execFileSync("npx", ["vite", "build"], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, VITE_PLATFORM: platform },
  });
}

async function verify(dist, platform) {
  const marker = JSON.parse(await readFile(path.join(dist, "platform.json"), "utf8"));
  if (marker.platform !== platform) {
    throw new Error(`platform.json says ${marker.platform}, expected ${platform}`);
  }
  const html = await readFile(path.join(dist, "index.html"), "utf8");
  if (!/src="\.\/assets\/main\.js"/.test(html)) {
    throw new Error("index.html does not load the single assets/main.js bundle");
  }
  if (/type="module"/.test(html)) {
    throw new Error("index.html still uses a module script; file:// shells need a classic script");
  }
  const bundle = await readFile(path.join(dist, "assets/main.js"), "utf8");
  if (/\bimport\.meta\b/.test(bundle)) {
    throw new Error("bundle still contains import.meta");
  }
}

for (const platform of targets) {
  console.log(`\n=== ${platform} ===`);
  build(platform);
  const dist = path.join(root, "dist");
  await verify(dist, platform);
  const target = path.join(releaseDir, platform);
  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });
  await cp(dist, target, { recursive: true });
  const size = (await readFile(path.join(target, "assets/main.js"))).byteLength;
  const version = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")).version;
  await writeFile(
    path.join(target, "build-info.json"),
    JSON.stringify({ platform, version, bundleBytes: size, builtAt: new Date().toISOString() }, null, 2),
  );
  console.log(`[package] ${platform} -> release/${platform} (${(size / 1024).toFixed(0)} KiB)`);
}
