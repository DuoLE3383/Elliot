// Smoke in — dựng lại ĐÚNG tin hourly + universe của user (03/11 03:00) dạng mới
import { statLines } from "../src/lib/autotrade.ts";
import { universeBroadcastText, type UniverseRow } from "../src/lib/universe.ts";
import type { AutoState } from "../src/lib/autotrade.ts";

const mk = (sym: string, tf: string, side: string, pnl: number, kind: string, exitMinAgo: number): unknown => ({
  symbol: sym, interval: tf, side, status: "closed",
  entryTime: new Date(Date.now() - exitMinAgo * 60_000 - 3600_000).toISOString(),
  exitTime: new Date(Date.now() - exitMinAgo * 60_000).toISOString(),
  pnlPct: pnl, exitKind: kind, entryPrice: 1, exitPrice: 1,
});
// 28 lệnh như tin gốc — vài lệnh gần nhất nằm TRONG cửa sổ 24h để xem bảng + nhóm ngày
const trades: unknown[] = [
  mk("DOGEUSDT", "5m", "SHORT", 4.04, "tp", 180),
  mk("XPLUSDT", "5m", "SHORT", 20.83, "tp", 399),
  mk("TIAUSDT", "5m", "LONG", -4.0, "sl", 564),
  mk("AAVEUSDT", "5m", "LONG", -10.49, "sl", 725),
  mk("TRXUSDT", "5m", "LONG", -9.66, "sl", 921),
  mk("FILUSDT", "5m", "SHORT", 12.0, "tp", 3483),
  mk("FILUSDT", "5m", "LONG", 8.8, "tp", 3773),
  mk("XRPUSDT", "5m", "SHORT", 7.96, "tp", 3794),
  mk("ATOMUSDT", "15m", "LONG", -23.16, "sl", 6991),
  mk("ATOMUSDT", "5m", "LONG", -10.87, "sl", 10547),
  mk("HBARUSDT", "15m", "LONG", -6.39, "sl", 10680),
  mk("LINKUSDT", "15m", "SHORT", -24.45, "sl", 12020),
  mk("LINKUSDT", "15m", "SHORT", 40.0, "tp", 15263),
  mk("LINKUSDT", "15m", "LONG", 1.74, "tp", 19214),
  mk("APTUSDT", "15m", "LONG", 34.91, "manual", 22445),
  mk("OPUSDT", "5m", "LONG", -58.14, "sl", 28807),
  mk("HBARUSDT", "1m", "LONG", -8.0, "sl", 33813),
  mk("QNTUSDT", "1m", "LONG", 12.57, "tp", 34079),
  mk("QNTUSDT", "1m", "LONG", 11.68, "tp", 34089),
  mk("ETHUSDT", "1m", "SHORT", -6.38, "sl", 34095),
  mk("UNIUSDT", "30m", "SHORT", -31.65, "sl", 34918),
  mk("HBARUSDT", "5m", "SHORT", 8.63, "tp", 41417),
  mk("HBARUSDT", "5m", "SHORT", -7.0, "sl", 41436),
  mk("HBARUSDT", "5m", "SHORT", -6.46, "sl", 41452),
  mk("HBARUSDT", "5m", "SHORT", 9.24, "tp", 41465),
  mk("HBARUSDT", "5m", "SHORT", -9.0, "sl", 41473),
  mk("BTCUSDT", "1m", "LONG", -12.14, "sl", 42047),
  mk("HBARUSDT", "5m", "SHORT", 15.09, "tp", 42277),
];
const st = {
  capital: 77368.51,
  stats: { closed: 28, wins: 13, winRate: 46, netPnlPct: -66 },
  open: null,
  trades,
  byCombo: [{ symbol: "LINKUSDT", interval: "15m", closed: 3, winRate: 67 }],
} as unknown as AutoState;

console.log("════════ HOURLY (quiet hour — như tin của user) ════════");
console.log(statLines(st, Date.now() - 3_600_000, "⏰ <b>HOURLY REPORT · 03:00</b>", "last 1h").join("\n"));

console.log("\n════════ DAILY (24h tape) ════════");
console.log(statLines(st, Date.now() - 86_400_000, "📅 <b>DAILY REPORT · 03/11</b>", "last 24h").join("\n"));

// universe — đúng top-10 của user
const rows: UniverseRow[] = [
  { symbol: "RUNEUSDT", atrPct: 3.96, trend: 0.42, ret24h: 0.131, ret10d: 0.02, score: 0.9 },
  { symbol: "XMRUSDT", atrPct: 1.09, trend: 0.3, ret24h: 0.043, ret10d: 0.047, score: 0.8 },
  { symbol: "TRXUSDT", atrPct: 0.31, trend: 0.25, ret24h: 0.022, ret10d: -0.014, score: 0.75 },
  { symbol: "UNIUSDT", atrPct: 1.47, trend: 0.2, ret24h: 0.026, ret10d: 0.064, score: 0.7 },
  { symbol: "SUIUSDT", atrPct: 0.93, trend: 0.15, ret24h: 0.027, ret10d: -0.036, score: 0.65 },
  { symbol: "XRPUSDT", atrPct: 0.7, trend: 0.12, ret24h: 0.022, ret10d: -0.011, score: 0.6 },
  { symbol: "INJUSDT", atrPct: 1.47, trend: 0.1, ret24h: 0.034, ret10d: -0.049, score: 0.55 },
  { symbol: "VIRTUALUSDT", atrPct: 0.86, trend: 0.09, ret24h: 0.025, ret10d: -0.051, score: 0.5 },
  { symbol: "SEIUSDT", atrPct: 1.06, trend: 0.08, ret24h: 0.023, ret10d: -0.114, score: 0.45 },
  { symbol: "ETCUSDT", atrPct: 0.65, trend: 0.07, ret24h: 0.016, ret10d: -0.081, score: 0.4 },
];
const full = [...rows, ...Array.from({ length: 20 }, (_, i) => ({ symbol: `FILL${i}USDT`, atrPct: 0.5, trend: 0, ret24h: 0, ret10d: 0, score: 0.3 - i * 0.01 }))];

console.log("\n════════ UNIVERSE (có prev: ETC mới vào, ETH rớt) ════════");
console.log(universeBroadcastText(full, { prevSyms: ["XMR", "TRX", "RUNE", "UNI", "XRP", "INJ", "SUI", "SEI", "VIRTUAL", "ETH"], at: Date.parse("2025-11-03T20:05:00Z") }));

console.log("\n════════ UNIVERSE (cold start — không prev) ════════");
console.log(universeBroadcastText(full, { at: Date.parse("2025-11-03T20:05:00Z") }));
