// ─── scripts/write-build-id.mjs — stamp every build with a visible id ────────
// Runs via the npm `prebuild` hook (both `npm run build` and `bun run build`
// honour pre/post scripts). Writes public/build-id.txt =
//   v{version}-{gitShortSha}-{YYYYMMDDHHMM utc}
// src/app/layout.tsx bakes this id into the prerendered HTML at build time
// (<meta name="elliott-build">) and /api/build-id serves the SAME file at
// runtime. The client BuildReload component compares the two: when the server
// announces a different id, the open tab reloads itself — so template/code
// edits always reach the running page without a manual F5. This kills the
// stale-tab class of bugs ("đã sửa template mà Telegram vẫn báo bản cũ" —
// the TOP-coin broadcast lives in the open tab, not in the pm2 process).
import { execSync } from "child_process";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";

const ROOT = process.cwd();

let version = "0.0.0";
try {
  version = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")).version ?? version;
} catch {
  // no package.json? impossible — keep the fallback
}

let sha = "nogit";
try {
  sha = execSync("git rev-parse --short HEAD", { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] })
    .toString()
    .trim() || sha;
} catch {
  // not a git checkout (CI tarball, docker copy) — version+time still identifies the build
}

const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12); // YYYYMMDDHHMM
const id = `v${version}-${sha}-${stamp}`;

mkdirSync(path.join(ROOT, "public"), { recursive: true });
writeFileSync(path.join(ROOT, "public", "build-id.txt"), `${id}\n`);
console.log(`[build-id] ${id}`);
