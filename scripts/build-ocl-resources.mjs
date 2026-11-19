/**
 * Builds the OpenChemLib resource bundle used by the conformer backend.
 *
 * The upstream resources.json also carries druglikeness and toxicity tables
 * that ChemViz3D never uses. Keeping only the conformer (COD) and MMFF94
 * tables cuts the payload roughly in half and lets the bundle be inlined,
 * which is required on Android where the page is served from file:// (or
 * appassets) and cannot fetch side files reliably.
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const source = path.join(root, "node_modules/openchemlib/dist/resources.json");
const target = path.join(root, "src/engine/conformer/ocl-resources.generated.json");

const KEEP_PREFIXES = ["/resources/cod/", "/resources/forcefield/"];

if (!fs.existsSync(source)) {
  throw new Error(`openchemlib resources not found at ${source}. Run npm install first.`);
}

const all = JSON.parse(fs.readFileSync(source, "utf8"));
const kept = Object.fromEntries(
  Object.entries(all).filter(([key]) => KEEP_PREFIXES.some((prefix) => key.startsWith(prefix))),
);
const dropped = Object.keys(all).length - Object.keys(kept).length;

fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, `${JSON.stringify(kept)}\n`, "utf8");

const bytes = fs.statSync(target).size;
console.log(`[ocl-resources] kept ${Object.keys(kept).length} entries, dropped ${dropped}`);
console.log(`[ocl-resources] wrote ${path.relative(root, target)} (${(bytes / 1024).toFixed(0)} KiB)`);
