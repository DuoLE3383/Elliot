// ─── scripts/postbuild.mjs — finish the production bundle safely ─────────────
// Runs AFTER `next build` (package.json → build). Replaces the previous fragile
// chain "cp … && cp … && node scripts/obfuscate.mjs" that could kill CI builds:
//
//   1. Copies .next/static and public/ into .next/standalone (required — without
//      them the standalone server serves no CSS/JS/images).
//   2. OPTIONAL obfuscation: only when OBFUSCATE=1 is set AND the
//      javascript-obfuscator package is installed. Every failure mode degrades
//      to "skip + warn" so a CI host without devDependencies (NODE_ENV=production,
//      npm install --omit=dev, …) can NEVER fail the build at this step.
//
// It also strips any leftover sourcemaps so no original source leaks, and
// removes the source maps of the standalone bundle regardless of OBFUSCATE.

import { cpSync, existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "fs";
import path from "path";

const ROOT = process.cwd();
const STANDALONE = path.join(ROOT, ".next", "standalone");
const STATIC_SRC = path.join(ROOT, ".next", "static");
const STATIC_DST = path.join(STANDALONE, ".next", "static");
const PUBLIC_SRC = path.join(ROOT, "public");
const PUBLIC_DST = path.join(STANDALONE, "public");

// ── 1. static + public into standalone ───────────────────────────────────────
for (const [src, dst] of [
  [STATIC_SRC, STATIC_DST],
  [PUBLIC_SRC, PUBLIC_DST],
]) {
  if (!existsSync(src)) {
    console.warn(`[postbuild] missing ${path.relative(ROOT, src)} — skipped`);
    continue;
  }
  cpSync(src, dst, { recursive: true, force: true });
  console.log(`[postbuild] copied ${path.relative(ROOT, src)} → ${path.relative(ROOT, dst)}`);
}

// ── 2. strip sourcemaps (always — protects the source even unobfuscated) ─────
function stripMaps(dir) {
  let n = 0;
  if (!existsSync(dir)) return n;
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "node_modules") continue;
      n += stripMaps(p);
    } else if (name.endsWith(".map")) {
      rmSync(p);
      n++;
    }
  }
  return n;
}

const maps = stripMaps(STANDALONE) + stripMaps(path.join(ROOT, ".next", "static"));
console.log(`[postbuild] removed ${maps} sourcemap(s)`);

// ── 2b. bundle the BACKEND XGB worker (worker_threads) with esbuild ─────────
// The engine (src/lib/engine.ts) spawns .next/standalone/xgb-node.worker.mjs
// for real multi-thread training on the server. esbuild is a devDependency —
// missing it (NODE_ENV=production installs) only degrades to the in-process
// sequential fallback, NEVER fails the build.
try {
  const { build } = await import("esbuild");
  await build({
    entryPoints: [path.join(ROOT, "src", "workers", "xgb-node.worker.ts")],
    outfile: path.join(STANDALONE, "xgb-node.worker.mjs"),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    minify: true,
    sourcemap: false,
    logLevel: "silent",
    // the worker bundle must stay self-contained — pure libs only (xgb chain +
    // klines-direct), no prisma/next imports reach it by design
    external: ["prisma", "@prisma/client", "next"],
  });
  console.log("[postbuild] bundled xgb-node.worker.mjs (backend XGB pool worker)");
} catch (e) {
  console.warn(
    `[postbuild] worker bundle skipped: ${e instanceof Error ? e.message : e} — engine falls back to sequential in-process training`,
  );
}

// ── 3. optional obfuscation — opt-in, failure-tolerant ───────────────────────
if (process.env.OBFUSCATE !== "1") {
  console.log("[postbuild] obfuscation skipped (set OBFUSCATE=1 to harden the bundle)");
  process.exit(0);
}

let obfuscator;
try {
  obfuscator = (await import("javascript-obfuscator")).default;
} catch {
  console.warn(
    "[postbuild] OBFUSCATE=1 but javascript-obfuscator is not installed (devDependency skipped?) — continuing WITHOUT obfuscation",
  );
  process.exit(0);
}

const { obfuscate } = obfuscator;
const SERVER_DIR = path.join(STANDALONE, ".next", "server");

const OPTIONS = {
  compact: true,
  simplify: true,
  identifierNamesGenerator: "hexadecimal",
  renameGlobals: false,
  selfDefending: false,
  debugProtection: false,
  disableConsoleOutput: false,
  controlFlowFlattening: false,
  deadCodeInjection: false,
  numbersToExpressions: false,
  splitStrings: false,
  transformObjectKeys: false,
  unicodeEscapeSequence: false,
  stringArray: true,
  stringArrayThreshold: 0.75,
  stringArrayEncoding: ["none"],
  stringArrayRotate: true,
  stringArrayShuffle: true,
  target: "node",
};

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "node_modules") continue; // third-party code stays untouched
      walk(p, out);
    } else if (name.endsWith(".js")) {
      out.push(p);
    }
  }
  return out;
}

let ok = 0;
let skipped = 0;

const targets = [path.join(STANDALONE, "server.js"), ...walk(SERVER_DIR)];
for (const file of targets) {
  if (!existsSync(file)) continue;
  try {
    const source = readFileSync(file, "utf8");
    if (source.length < 80 || source.length > 4_000_000) {
      skipped++; // trivial or huge file — obfuscation adds nothing / risks OOM
      continue;
    }
    const result = obfuscate(source, OPTIONS);
    const out = result.getObfuscatedCode();
    if (!out || out.length < source.length * 0.3) throw new Error("suspicious output");
    writeFileSync(file, out);
    ok++;
  } catch (e) {
    skipped++;
    console.warn(`[obfuscate] skipped ${path.relative(STANDALONE, file)}: ${e.message}`);
  }
}
console.log(`[obfuscate] hardened ${ok} file(s), kept ${skipped} as-is`);
