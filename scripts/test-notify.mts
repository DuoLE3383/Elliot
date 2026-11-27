// QA 0.2.71 — 3 tầng thông báo Telegram: ALERT (loss streak / drawdown, không
// mute được) + MUTE theo loại (TG_MUTE: near/veto/autopsy/scan/close) +
// DIGEST rollup (bài học autopsy gọn 1 dòng trong hourly/daily statLines).
import { readFileSync } from "fs";
import { tgMuted, lossStreakOf, losingStreakTrades, ddCrossOf } from "../src/lib/tg-alerts.ts";
import { msgLossStreak, msgDrawdown } from "../src/lib/tg-msgs.ts";
import { statLines } from "../src/lib/autotrade.ts";
import type { AutoState, AutoTradeRow } from "../src/lib/autotrade.ts";
import { setOverride } from "../src/lib/params-store.ts";

let fail = 0;
const check = (name: string, ok: boolean) => {
  console.log(`${ok ? "✅" : "❌"} ${name}`);
  if (!ok) fail++;
};

const MIN = 60_000;
const NOW = Date.now();

// ── fixtures ─────────────────────────────────────────────────────────────────
const closed = (i: number, o: { pnl?: number; sym?: string; at?: number; before?: number; after?: number; autopsy?: string } = {}) =>
  ({
    id: `t${i}`,
    symbol: o.sym ?? "BTCUSDT",
    interval: "15m",
    side: "LONG",
    status: "closed",
    entryTime: new Date((o.at ?? NOW) - 30 * MIN).toISOString(),
    exitTime: new Date(o.at ?? NOW).toISOString(),
    entryPrice: 100,
    exitPrice: 101,
    pnlPct: o.pnl ?? -1,
    exitKind: "sl",
    capitalBefore: o.before ?? 100_000,
    capitalAfter: o.after ?? 99_000,
    autopsy: o.autopsy ?? null,
    stakePct: 25,
    leverage: 5,
    prob: 0.6,
    auc: 0.8,
    acc: 75,
    score: 61,
  }) as unknown as AutoTradeRow;

const stOf = (trades: AutoTradeRow[], capital: number | null = 100_000): AutoState =>
  ({ trades, open: null, capital, stats: { closed: trades.length, wins: 0, winRate: 50, netPnlPct: 1.2 } }) as unknown as AutoState;

// ── 1 · TG_MUTE parsing (runtime override qua params-store) ─────────────────
console.log("1. TG_MUTE — mặc định \"near,veto\": near/veto bị tắt, phần còn lại bật");
setOverride("TG_MUTE", null); // về mặc định params.ts
check("near muted (default)", tgMuted("near") === true);
check("veto muted (default)", tgMuted("veto") === true);
check("autopsy NOT muted (default)", tgMuted("autopsy") === false);
check("scan NOT muted (default)", tgMuted("scan") === false);
check("close NOT muted (default)", tgMuted("close") === false);

console.log("2. TG_MUTE — override từng loại / rỗng / giá trị sai bị từ chối");
check('override "scan" được nhận', setOverride("TG_MUTE", "scan").ok === true);
check("override \"scan\" → chỉ scan muted", tgMuted("scan") === true && tgMuted("near") === false && tgMuted("veto") === false);
check("giá trị sai (chữ hoa/token lạ) BỊ TỪ CHỐI, override cũ giữ nguyên", setOverride("TG_MUTE", "NEAR, veto ,bogus").ok === false && tgMuted("scan") === true && tgMuted("near") === false);
check('override "" (bật lại tất cả) được nhận', setOverride("TG_MUTE", "").ok === true);
check("override \"\" → không gì bị muted", !tgMuted("near") && !tgMuted("veto") && !tgMuted("scan") && !tgMuted("autopsy") && !tgMuted("close"));
setOverride("TG_MUTE", null);

// ── 2 · losing streak ────────────────────────────────────────────────────────
console.log("3. losingStreakTrades / lossStreakOf — chuỗi thua tính từ mới nhất");
const tWin = closed(1, { pnl: 2.5, at: NOW - 5 * MIN });
const tL1 = closed(2, { pnl: -1.5, sym: "ETHUSDT", at: NOW - 4 * MIN });
const tL2 = closed(3, { pnl: -2, sym: "SOLUSDT", at: NOW - 3 * MIN });
const tL3 = closed(4, { pnl: -0.5, sym: "XRPUSDT", at: NOW - 2 * MIN });
check("[win,l1,l2,l3] → streak 3", lossStreakOf([tWin, tL1, tL2, tL3]) === 3);
check("thứ tự input xáo trộn vẫn ra 3 (sort theo exitTime)", lossStreakOf([tL2, tWin, tL3, tL1]) === 3);
const tWinNew = closed(9, { pnl: 1.2, at: NOW }); // thắng là lệnh MỚI NHẤT
check("thắng mới nhất → streak 0", lossStreakOf([tL1, tL2, tWinNew]) === 0);
check("rỗng → 0", lossStreakOf([]) === 0);
check("lệnh đang mở không tính", lossStreakOf([{ ...tL1, status: "open", exitTime: null } as unknown as AutoTradeRow]) === 0);
check("pnl=0 (hoà) KHÔNG reset chuỗi", lossStreakOf([closed(5, { pnl: 0, at: NOW - MIN }), tL1]) === 2);
const chain = losingStreakTrades([tWin, tL1, tL2, tL3]);
check("chain mang symbol/interval cho msgLossStreak", chain.length === 3 && chain[0].symbol === "XRPUSDT" && chain[0].interval === "15m");

console.log("4. ngưỡng báo động chuỗi — bắn tại bội N (4, 8…), không bắn ở giữa");
const n = 4;
const fires = (len: number): boolean => len >= n && len % n === 0;
check("streak 4 → bắn", fires(4) === true);
check("streak 5 → im", fires(5) === false);
check("streak 8 → bắn lại", fires(8) === true);
check("streak 3 → im (chưa tới ngưỡng)", fires(3) === false);

// ── 3 · drawdown crossing ────────────────────────────────────────────────────
console.log("5. ddCrossOf — đỉnh 24h, bắn ĐÚNG lần cắt xuống mức ngưỡng");
const DAY = 86_400_000;
const peakTrade = closed(10, { pnl: 1, at: NOW - 6 * 60 * MIN, before: 100_000, after: 101_000 });
const midTrade = closed(11, { pnl: -1.4, at: NOW - 3 * 60 * MIN, before: 101_000, after: 99_600 });
const trades = [peakTrade, midTrade];
// peak 101_000 → level 5% = 95_950
const x1 = ddCrossOf(trades, 96_500, 95_000, 5, DAY, NOW);
check("cắt xuống qua level → bắn, peak=101k, level=95_950", !!x1 && x1.peak === 101_000 && Math.abs(x1.level - 95_950) < 0.01);
check("đã ở dưới rồi (prev < level) → im (không bắn lại)", ddCrossOf(trades, 95_500, 94_000, 5, DAY, NOW) === null);
check("cả hai trên level → im", ddCrossOf(trades, 99_000, 98_000, 5, DAY, NOW) === null);
check("ddPct=0 → tắt hẳn", ddCrossOf(trades, 96_500, 95_000, 0, DAY, NOW) === null);
const oldPeak = closed(12, { pnl: 1, at: NOW - 3 * DAY, before: 200_000, after: 200_000 });
check("giao dịch ngoài cửa sổ 24h không kéo đỉnh vào", ddCrossOf([oldPeak], 199_000, 100_000, 5, DAY, NOW) === null);
check("cold start (chưa có lệnh trong cửa sổ) → null, không đoán", ddCrossOf([], 96_500, 95_000, 5, DAY, NOW) === null);
const beforePeak = closed(13, { pnl: 0, at: NOW - 60 * MIN, before: 105_000, after: 105_000 });
const x2 = ddCrossOf([beforePeak, midTrade], 100_000, 96_000, 5, DAY, NOW);
check("peak tính cả capitalBefore (đỉnh giữa 2 lần chốt)", !!x2 && x2.peak === 105_000);

// ── 4 · alert builders ───────────────────────────────────────────────────────
console.log("6. msgLossStreak / msgDrawdown — nội dung tin báo động");
const m1 = msgLossStreak(4, [tL3, tL2, tL1, closed(6, { pnl: -3, sym: "DOGEUSDT" })], 77_368.51);
check("streak: tiêu đề số + HTML bold", m1.includes("LOSS STREAK — 4 losses in a row") && m1.includes("<b>"));
check("streak: chuỗi lệnh mới nhất trước + ROI chuỗi", m1.includes("#XRPUSDT 15m -0.50%") && m1.includes("Streak ROI"));
check("streak: equity định dạng EN", m1.includes("77,368.51"));
const long8 = Array.from({ length: 8 }, (_, i) => closed(20 + i, { pnl: -1, sym: `S${i}USDT`, at: NOW - (8 - i) * MIN }));
const m2 = msgLossStreak(8, long8, 75_000);
check("streak: trên 6 lệnh → cắt + \"+N more\"", m2.includes("+2 more") && !m2.includes("#S7USDT"));
const m3 = msgDrawdown({ peak: 101_000, level: 95_950, nowEq: 95_400, ddPct: 5 }, tL1);
check("dd: tiêu đề % dưới đỉnh + mức", m3.includes("under the 24h peak") && m3.includes("95,950") && m3.includes("95,400.00"));
check("dd: lệnh gây cắt mức", m3.includes("#ETHUSDT") && m3.includes("closed -1.50%"));

// ── 5 · statLines lesson rollup ──────────────────────────────────────────────
console.log("7. statLines — 💡 lesson rollup khi autopsy bị mute (0.4.x: gate ≥10 lệnh đóng)");
const withLesson = closed(30, { pnl: -1, at: NOW - 10 * MIN, autopsy: JSON.stringify({ outcome: "loss", tag: "chase", why: [], lesson: "Don't enter right after a whale bar." }) });
const noLesson = closed(31, { pnl: -1, at: NOW - 5 * MIN, autopsy: JSON.stringify({ outcome: "loss", tag: "ok", why: [], lesson: "" }) }); // loss — nhánh lesson chỉ chạy khi 3 lệnh mới nhất đều lỗ
const badJson = closed(32, { pnl: -1, at: NOW - 4 * MIN, autopsy: "{not json" });
// 0.4.x: lesson rollup cần ≥10 lệnh đóng (MIN_TRADES) — dưới ngưỡng chỉ in dòng gate
const gateLines = statLines(stOf([withLesson, noLesson, badJson]), NOW - 60 * MIN, "⏰ <b>HOURLY</b>", "last 1h");
check("dưới 10 lệnh → dòng gate 'Chưa đủ mẫu (n=3/10)', không lesson per-trade", gateLines.some((l) => l.startsWith("💡 Lesson: Chưa đủ mẫu (n=3/10)")) && gateLines.every((l) => !l.startsWith("💡 Lesson (#")));
const fill9 = Array.from({ length: 9 }, (_, i) => closed(100 + i, { pnl: -1, at: NOW - (40 + i) * MIN }));
let lines = statLines(stOf([badJson, withLesson, noLesson, ...fill9]), NOW - 60 * MIN, "⏰ <b>HOURLY</b>", "last 1h");
check("có dòng 💡 Lesson với symbol của lệnh có autopsy hợp lệ (đủ 12 lệnh đóng)", lines.some((l) => l.startsWith("💡 Lesson (#BTC 15m):") && l.includes("whale bar")));
check("lesson rỗng/JSON hỏng bị bỏ qua (không crash)", !lines.some((l) => l.includes("not json")) && lines.filter((l) => l.startsWith("💡 Lesson")).length === 1);
const escLesson = closed(33, { pnl: -1, at: NOW - 2 * MIN, autopsy: JSON.stringify({ lesson: "avoid <b>fakeout</b> & chase" }) });
lines = statLines(stOf([escLesson, ...Array.from({ length: 10 }, (_, i) => closed(200 + i, { pnl: -1, at: NOW - (30 + i) * MIN }))]), NOW - 60 * MIN, "⏰ <b>HOURLY</b>", "last 1h");
check("lesson escape HTML (& < >)", lines.some((l) => l.includes("&lt;b&gt;fakeout&lt;/b&gt; &amp; chase")));
const longLesson = closed(34, { pnl: -1, at: NOW - MIN, autopsy: JSON.stringify({ lesson: "x".repeat(200) }) });
lines = statLines(stOf([longLesson, ...Array.from({ length: 10 }, (_, i) => closed(300 + i, { pnl: -1, at: NOW - (30 + i) * MIN }))]), NOW - 60 * MIN, "⏰ <b>HOURLY</b>", "last 1h");
const lessonLine = lines.find((l) => l.startsWith("💡 Lesson"));
check("lesson dài cắt tại 130 + …", !!lessonLine && lessonLine.includes("…") && lessonLine.length <= "💡 Lesson (#BTC 15m): ".length + 131);
const newest = closed(35, { pnl: -1, sym: "NEWUSDT", at: NOW - MIN, autopsy: JSON.stringify({ lesson: "newest lesson wins" }) });
lines = statLines(stOf([withLesson, newest, ...Array.from({ length: 8 }, (_, i) => closed(400 + i, { pnl: -1, at: NOW - (30 + i) * MIN }))]), NOW - 60 * MIN, "⏰ <b>HOURLY</b>", "last 1h");
check("chỉ 1 lesson MỚI NHẤT mỗi digest", lines.filter((l) => l.startsWith("💡 Lesson")).length === 1 && lines.some((l) => l.includes("newest lesson wins")));
lines = statLines(stOf([closed(36, { pnl: -1, at: NOW - MIN }), ...Array.from({ length: 10 }, (_, i) => closed(500 + i, { pnl: -1, at: NOW - (30 + i) * MIN }))]), NOW - 60 * MIN, "⏰ <b>HOURLY</b>", "last 1h");
check("đủ mẫu nhưng không autopsy có lesson → không dòng 💡 per-trade", !lines.some((l) => l.startsWith("💡 Lesson (#")));

// ── 6 · wiring — 5 điểm đóng lệnh dồn qua notifyClosed + các cổng mute ──────
console.log("8. wiring engine.ts / autopsy.ts");
const eng = readFileSync("src/lib/engine.ts", "utf8");
const aut = readFileSync("src/lib/autopsy.ts", "utf8");
check("engine: 3 chỗ đóng lệnh đều qua notifyClosed (closeTradeDirect gộp)", (eng.match(/void notifyClosed\(/g) ?? []).length === 3);
check("engine: không còn cụm msgClose trực tiếp", !eng.includes("msgClose(closed"));
check("engine: cổng mute veto", eng.includes('tgMuted("veto")'));
check("engine: cổng mute near", eng.includes('tgMuted("near")'));
check("engine: cổng mute scan (bookkeep vẫn chạy)", eng.includes('tgMuted("scan")'));
check("autopsy: cổng mute autopsy", aut.includes('tgMuted("autopsy")'));
const alerts = readFileSync("src/lib/tg-alerts.ts", "utf8");
check("chỉ close push được gate — alert tier-1 gửi thẳng không mute", alerts.includes('if (!tgMuted("close"))') && alerts.includes("msgLossStreak(chain.length, chain, balAfter)") && alerts.includes("msgDrawdown(x, closed)"));

console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
