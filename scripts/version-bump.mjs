/**
 * Bump version across all files that must stay in sync:
 *   package.json (root)
 *   packages/mcp-server-core/package.json
 *   plugins/*\/package.json  (4 plugins)
 *   plugins/*\/.claude-plugin/plugin.json  (Claude Code manifest)
 *   .release-please-manifest.json
 *
 * Usage:
 *   node scripts/version-bump.mjs patch   → 0.2.1 → 0.2.2
 *   node scripts/version-bump.mjs minor   → 0.2.1 → 0.3.0
 *   node scripts/version-bump.mjs major   → 0.2.1 → 1.0.0
 *   node scripts/version-bump.mjs 1.2.3   → explicit version
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readJson(p) {
  return JSON.parse(readFileSync(p, "utf8"));
}
function writeJson(p, obj) {
  writeFileSync(p, `${JSON.stringify(obj, null, 2)}\n`, "utf8");
}

function bumpSemver(current, part) {
  const [maj, min, pat] = current.split(".").map(Number);
  if (part === "major") return `${maj + 1}.0.0`;
  if (part === "minor") return `${maj}.${min + 1}.0`;
  if (part === "patch") return `${maj}.${min}.${pat + 1}`;
  // explicit version string
  if (/^\d+\.\d+\.\d+/.test(part)) return part;
  throw new Error(`Unknown bump type: ${part}. Use major | minor | patch | x.y.z`);
}

const arg = process.argv[2] ?? "patch";
const rootPkg = readJson(path.join(root, "package.json"));
const current = rootPkg.version;
const next = bumpSemver(current, arg);

const targets = [
  "package.json",
  "public/packages/mcp-server-core/package.json",
  "public/plugins/claude-code/package.json",
  "public/plugins/claude-code/.claude-plugin/plugin.json",
  "public/plugins/codex/package.json",
  "public/plugins/cursor/package.json",
  "public/plugins/antigravity/package.json",
];

for (const rel of targets) {
  const p = path.join(root, rel);
  const obj = readJson(p);
  obj.version = next;
  writeJson(p, obj);
  console.log(`  ${rel}: ${current} → ${next}`);
}

// .release-please-manifest.json has its own shape: { ".": "x.y.z" }
const manifest = path.join(root, ".release-please-manifest.json");
const m = readJson(manifest);
m["."] = next;
writeJson(manifest, m);
console.log(`  .release-please-manifest.json: ${current} → ${next}`);

console.log('\nDone. Run: npm run build:plugin');
