// ─── scripts/trace-stub.mjs — make `next build` immune to install-mode quirks ─
// Some install modes skip packages that `next build`'s standalone tracer still
// walks (bun --production skips optional peers like zustand's `immer`, and
// platform-optional @img/* / *-musl binaries; next itself declares sharp as an
// optionalDependency). When the tracer meets a DECLARED-but-MISSING package it
// dies with `ENOENT … copyfile`.
//
// This script runs BEFORE `next build` and drops a harmless stub package.json
// (+ README.md) for every declared-optional package that is not installed.
// Stubs are never importable code — platform binaries and optional peers are
// never required at runtime — so the copy step succeeds without polluting the
// bundle with anything functional.
//
// Regular (non-optional) dependencies missing from node_modules are NOT stubbed
// (a stub there would break the server at runtime) — they are reported loudly
// so the root package.json can be fixed instead.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "fs";
import path from "path";

const ROOT = process.cwd();
const NM = path.join(ROOT, "node_modules");
if (!existsSync(NM)) {
  console.warn("[trace-stub] node_modules not found — nothing to do");
  process.exit(0);
}

const readJsonSafe = (file) => {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
};

// every installed top-level package: name → dir (depth 2: pkg + @scope/pkg)
const installed = new Map();
for (const entry of readdirSync(NM, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  if (entry.name.startsWith(".")) continue; // .bin, .cache, …
  if (entry.name.startsWith("@")) {
    const scope = path.join(NM, entry.name);
    for (const sub of readdirSync(scope, { withFileTypes: true })) {
      if (sub.isDirectory()) installed.set(`${entry.name}/${sub.name}`, path.join(scope, sub.name));
    }
  } else {
    installed.set(entry.name, path.join(NM, entry.name));
  }
}

let stubbed = 0;
const missingRegular = [];

for (const [name, dir] of installed) {
  const pkg = readJsonSafe(path.join(dir, "package.json"));
  if (!pkg) continue;

  const declaredOptional = Object.keys(pkg.optionalDependencies ?? {});
  for (const dep of declaredOptional) {
    if (installed.has(dep)) continue;
    const target = path.join(NM, dep);
    mkdirSync(target, { recursive: true });
    const stub = { name: dep, version: "0.0.0-stub", private: true, description: "stub for standalone tracer (optional dependency not installed on this host)" };
    writeFileSync(path.join(target, "package.json"), JSON.stringify(stub, null, 2) + "\n");
    writeFileSync(path.join(target, "README.md"), `# ${dep}\n\nStub created by scripts/trace-stub.mjs — the real package is platform-optional and was not installed on this host.\n`);
    stubbed++;
  }

  // regular deps missing = broken install — surface it, don't hide it
  for (const dep of Object.keys(pkg.dependencies ?? {})) {
    if (!installed.has(dep)) missingRegular.push(`${name} → ${dep}`);
  }
}

console.log(`[trace-stub] ${stubbed} optional package(s) stubbed for the tracer`);
if (missingRegular.length) {
  console.warn(`[trace-stub] ⚠ missing REGULAR dependencies (install is incomplete — do NOT stub):`);
  for (const line of missingRegular.slice(0, 20)) console.warn(`   ${line}`);
}
