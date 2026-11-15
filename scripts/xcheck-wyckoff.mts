// ─── Cross-check: TS wyckoff-gate port vs Python verify script ───────────────
// Chạy: node scripts/xcheck-wyckoff.mjs   (bundle qua esbuild trước)
// Đọc scripts/wyckoff-cache/*_1d.csv (đúng data đã walk-forward verify 07/11),
// với mỗi t ∈ [140, n-2]: range trên [t-90..t-1], trigger trên nến t.
// In JSONL {sym,date,trigger,support,quality} để so với phía Python.

import { readFileSync, readdirSync, writeFileSync } from "fs";
import { identifyTradingRange, detectTriggers } from "../src/lib/wyckoff-gate";

interface Row { t: number; o: number; h: number; l: number; c: number; v: number }

const dir = "scripts/wyckoff-cache/";
const files = readdirSync(dir).filter((f) => f.endsWith("_1d.csv"));
const out: string[] = [];

for (const f of files) {
  const sym = f.replace("_1d.csv", "");
  const lines = readFileSync(dir + f, "utf8").trim().split("\n");
  const rows: Row[] = [];
  for (let i = 1; i < lines.length; i++) {
    const [date, o, h, l, c, v] = lines[i].split(",");
    rows.push({ t: Date.parse(`${date}T00:00:00Z`), o: +o, h: +h, l: +l, c: +c, v: +v });
  }
  const n = rows.length;
  for (let t = 140; t <= n - 2; t++) {
    const d = rows.slice(0, t + 1);
    const tr = identifyTradingRange(d, 90);
    if (!tr) continue;
    const det = detectTriggers(d, tr);
    out.push(JSON.stringify({ sym, date: new Date(rows[t].t).toISOString().slice(0, 10), trigger: det.trigger, upthrust: det.upthrust, support: tr.support.toFixed(8), quality: tr.quality.toFixed(6) }));
  }
}
writeFileSync("/tmp/wy-ts.jsonl", out.join("\n") + "\n");
console.log(`TS done — ${out.length} range-valid rows, triggers: spring=${out.filter((x) => x.includes('"trigger":"spring"')).length} sos=${out.filter((x) => x.includes('"trigger":"sos"')).length}`);
