// ─── scripts/obfuscate.mjs — harden the production output ────────────────────
// Runs AFTER `next build` (see package.json → build). It rewrites every JS file
// in the standalone server bundle through javascript-obfuscator so the deployed
// artifact no longer resembles the readable source, and strips any sourcemaps.
//
// Safety: per-file try/catch — if a file cannot be parsed/obfuscated it is left
// untouched with a warning, so the build never breaks because of this step.
// node_modules inside the standalone bundle (prisma client, engines) are NOT
// touched — only first-party compiled output under .next/standalone/.next/.

import javascriptObfuscator from "javascript-obfuscator";
const { obfuscate } = javascriptObfuscator;
import { readdirSync, readFileSync, statSync, rmSync, writeFileSync, existsSync } from "fs";
import path from "path";

const STANDALONE = path.join(process.cwd(), ".next", "standalone");
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
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === "node_modules") continue; // third-party code stays untouched
      walk(p, out);
    } else if (name.endsWith(".js")) {
      out.push(p);
    }
  }
  return out;
}

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

let ok = 0;
let skipped = 0;

const targets = [path.join(STANDALONE, "server.js"), ...walk(SERVER_DIR)];
for (const file of targets) {
  if (!existsSync(file)) continue;
  try {
    const source = readFileSync(file, "utf8");
    if (source.length < 80) {
      skipped++;
      continue; // trivial file — obfuscation adds nothing
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

const maps = stripMaps(STANDALONE);
console.log(`[obfuscate] hardened ${ok} file(s), kept ${skipped} as-is, removed ${maps} sourcemap(s)`);
