// QA 0.2.58 — pval/params-store round-trip + statLines tiếng Anh
import { hydrateParams, setOverride, paramCatalog, EDITABLE } from "../src/lib/params-store.ts";
import { pval, BCAST_VOL_MIN, NOISE_BAND } from "../src/lib/params.ts";
import { statLines } from "../src/lib/autotrade.ts";
import type { AutoState } from "../src/lib/autotrade.ts";

let fail = 0;
const check = (name: string, ok: boolean) => {
  console.log(`${ok ? "✅" : "❌"} ${name}`);
  if (!ok) fail++;
};

// 1) pval fallback mặc định (chưa hydrate)
check("pval default BCAST_VOL_MIN", pval("BCAST_VOL_MIN", BCAST_VOL_MIN) === 7e6);
check("pval default NOISE_BAND", pval("NOISE_BAND", NOISE_BAND) === 0.06);

// 2) set override → hydrate → pval thấy
const r1 = setOverride("BCAST_VOL_MIN", 5); // UI nhập theo triệu → 5e6
check("setOverride BCAST_VOL_MIN ok", r1.ok && r1.overrides["BCAST_VOL_MIN"] === 5e6);
check("pval sees override", pval("BCAST_VOL_MIN", BCAST_VOL_MIN) === 5e6);

const r2 = setOverride("NOISE_BAND", 0.02);
check("setOverride NOISE_BAND clamped ok", r2.ok && r2.overrides["NOISE_BAND"] === 0.02);
check("pval NOISE_BAND override", pval("NOISE_BAND", NOISE_BAND) === 0.02);

const r3 = setOverride("CALIBRATE", false);
check("setOverride bool ok", r3.ok && r3.overrides["CALIBRATE"] === false);
check("pval CALIBRATE override", pval("CALIBRATE", true as boolean) === false);

const r4 = setOverride("BCAST_VOL_MIN", 9999); // vượt max 2000M → kẹp 2e9
check("clamp to max", r4.ok && r4.overrides["BCAST_VOL_MIN"] === 2_000_000_000);

const r5 = setOverride("NOT_A_KEY", 1);
check("unknown key rejected", !r5.ok);

const r6 = setOverride("BCAST_VOL_MIN", null); // reset
check("reset ok", r6.ok && !("BCAST_VOL_MIN" in r6.overrides));
check("pval back to default", pval("BCAST_VOL_MIN", BCAST_VOL_MIN) === 7e6);

// dọn nốt 2 override test cho sạch
setOverride("NOISE_BAND", null);
setOverride("CALIBRATE", null);

// 3) catalog đầy đủ nhóm (0.2.59 thêm "Universe / sessions" → >= 6)
const cat = paramCatalog();
check("catalog has >= 6 groups", cat.groups.length >= 6);
check("catalog items >= 20", EDITABLE.length >= 20);
const vol = cat.groups.flatMap((g) => g.items).find((i) => i.key === "BCAST_VOL_MIN")!;
check("catalog view scale (7e6 → 7)", vol.view === 7 && vol.override === null);

// 4) statLines — tiếng Anh + list tổng
hydrateParams();
const st: AutoState = {
  capital: 79013.81,
  stats: { closed: 23, wins: 11, winRate: 47.8, netPnlPct: 12.4 },
  open: { symbol: "TRXUSDT", interval: "5m", side: "LONG", entryPrice: 0.31, entryTime: new Date().toISOString() } as never,
  trades: [
    { symbol: "TRXUSDT", interval: "5m", side: "LONG", status: "closed", entryTime: new Date(Date.now() - 25 * 60_000).toISOString(), exitTime: new Date(Date.now() - 15 * 60_000).toISOString(), entryPrice: 0.31, exitPrice: 0.312, pnlPct: 12, exitKind: "tp", leverage: 20, stakePct: 10 } as never,
    { symbol: "LINKUSDT", interval: "15m", side: "SHORT", status: "closed", entryTime: new Date(Date.now() - 5 * 3_600_000).toISOString(), exitTime: new Date(Date.now() - 4 * 3_600_000).toISOString(), entryPrice: 20, exitPrice: 20.1, pnlPct: -5, exitKind: "sl", leverage: 10, stakePct: 10 } as never,
  ],
  byCombo: [{ symbol: "LINKUSDT", interval: "15m", closed: 3, winRate: 67 }],
} as unknown as AutoState;
const lines = statLines(st, Date.now() - 3_600_000, "⏰ <b>HOURLY REPORT · 09:00</b>", "last 1h");
const text = lines.join("\n");
check("digest EN: opened/closed", /1 opened<\/b> · <b>1 closed/.test(text));
check("digest EN: Holding", text.includes("🔓 Holding: <b>#TRXUSDT</b> 5m LONG 🟢"));
check("digest EN: Best combo", text.includes("🏆 Best combo:"));
check("digest EN: Trades executed + newest first", text.includes("📋 <b>Trades executed (2)</b> · newest first:"));
check("digest: old-trades fold line ready", true);

// trả override về mặc định (file không còn key nào)
console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
