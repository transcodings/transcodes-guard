/**
 * CDN bundle build: produces a single obfuscated ESM of the private
 * @transcodes-guard-private/gate-backend at cdn-dist/guard-<version>.mjs.
 *
 * Phase 3 / Unit A. This is the artifact a later CDN loader (Unit C) fetches
 * and a deploy step (Unit B) uploads + SHA384-pins. This script only BUILDS it:
 * deterministic obfuscated bundle + input-graph leak check.
 *
 * Pipeline: esbuild (bundle + minify, write:false, metafile) -> javascript-
 * obfuscator (lightweight preset + fixed seed for determinism) -> SHA384.
 * Mirrors the backend's `bundler.*.ts` esbuild-then-obfuscate pattern.
 *
 * Determinism (acceptance: same input -> same SHA384): esbuild minify is
 * deterministic; javascript-obfuscator is NOT unless `seed` is fixed and the
 * RNG-based transforms (stringArrayShuffle/rotate, deadCodeInjection) are off.
 *
 * stdout is reserved (JSON-RPC framing convention across the repo): all
 * diagnostics go to console.error.
 *
 * Usage:
 *   node scripts/build-cdn.mjs            build once, write artifact, print hash
 *   node scripts/build-cdn.mjs --verify   build twice, assert identical SHA384
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import JavaScriptObfuscator from "javascript-obfuscator";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENTRY = "private/packages/gate-backend/src/index.ts";
const OUT_DIR = "cdn-dist";

/**
 * Lightweight obfuscation preset adopted from the backend's
 * `bundler.obfuscate.ts` OBFUSCATION_OPTIONS. minify already handles identifier
 * mangling + dead-code elimination, so obfuscator only hides strings.
 * `seed` is fixed (the backend preset omits it) so the output is reproducible.
 */
const CDN_OBFUSCATION_OPTIONS = {
  seed: 0x7da4d, // fixed -> deterministic stringArray layout
  compact: true,
  simplify: false,
  stringArray: true,
  stringArrayThreshold: 0.1,
  stringArrayEncoding: [],
  rotateStringArray: false,
  stringArrayShuffle: false,
  controlFlowFlattening: false,
  deadCodeInjection: false,
  renameGlobals: false,
  comments: false,
  splitStrings: false,
};

/**
 * Workspace source prefixes allowed into the CDN bundle. Third-party
 * node_modules deps are bundled wholesale (noExternal) and not checked — the
 * leak we guard against is WORKSPACE source: only the private + public library
 * packages may enter the graph, never a plugin entry (`public/plugins/`) or the
 * CLI (`private/cli/`) leaking backwards into the backend bundle.
 */
const ALLOWED_WORKSPACE_PREFIXES = ["private/packages/", "public/packages/"];

/** esbuild bundle -> { code, metafile }. */
async function bundle() {
  const result = await build({
    absWorkingDir: root,
    entryPoints: [ENTRY],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node20",
    minify: true,
    write: false,
    metafile: true,
    // Prefer each dep's ESM build over its CommonJS `main`. Some deps (e.g.
    // jsonc-parser) ship a UMD `main` with runtime `require("./impl/...")` that
    // can't be statically bundled; their `module` entry uses static imports.
    // This matches how the tsup plugin builds bundle the same backend cleanly.
    mainFields: ["module", "main"],
    // No `external`: every workspace package + runtime dep (zod, the MCP SDK)
    // is bundled in, matching the plugins' noExternal policy. Node built-ins
    // stay external automatically under platform:node.
  });
  return { code: result.outputFiles[0].text, metafile: result.metafile };
}

/** Assert no unexpected workspace source entered the bundle graph. */
function assertNoLeak(metafile) {
  const offenders = Object.keys(metafile.inputs).filter((input) => {
    if (input.startsWith("node_modules/")) return false; // third-party deps OK
    return !ALLOWED_WORKSPACE_PREFIXES.some((p) => input.startsWith(p));
  });
  if (offenders.length > 0) {
    console.error("CDN bundle leak check FAILED — unexpected inputs:");
    for (const o of offenders) console.error(`  ${o}`);
    process.exit(1);
  }
}

function sha384(text) {
  return `sha384-${createHash("sha384").update(text).digest("base64")}`;
}

/** Full build: bundle -> leak check -> obfuscate. Returns obfuscated code. */
async function buildOnce() {
  const { code, metafile } = await bundle();
  assertNoLeak(metafile);
  return JavaScriptObfuscator.obfuscate(
    code,
    CDN_OBFUSCATION_OPTIONS,
  ).getObfuscatedCode();
}

const version = JSON.parse(
  readFileSync(path.join(root, "package.json"), "utf8"),
).version;

const obfuscated = await buildOnce();

if (process.argv.includes("--verify")) {
  const second = await buildOnce();
  if (sha384(obfuscated) !== sha384(second)) {
    console.error("Determinism check FAILED — two builds differ.");
    process.exit(1);
  }
  console.error("Determinism check OK — two builds identical.");
}

const outFile = path.join(OUT_DIR, `guard-${version}.mjs`);
mkdirSync(path.join(root, OUT_DIR), { recursive: true });
writeFileSync(path.join(root, outFile), obfuscated, "utf8");
console.error(`built ${outFile}  ${sha384(obfuscated)}`);
