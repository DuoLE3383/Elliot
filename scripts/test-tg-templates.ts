// scripts/test-tg-templates.ts — preview / send every Telegram trade template.
// Usage (from repo root):
//   npx tsx scripts/test-tg-templates.ts                 # dry-run: print only, no send
//   npx tsx scripts/test-tg-templates.ts --send          # actually send to the configured chat
//   npx tsx scripts/test-tg-templates.ts --send --only=close,open
// Every message goes through the same builders the engine uses (tg-msgs), so
// what you see here is exactly what production sends — no duplicated format.
// A/C/D OPEN previews use the same buildTradeHeader + body lines as the engines.

import { effectiveChatId, effectiveToken, tgSendMessage } from "../src/lib/telegram-store";

// Standalone run: tsx does NOT load .env (Next.js does). Load it here as a fallback;
// prefer running with --env-file=.env so DATABASE_URL is set before Prisma boots.
process.loadEnvFile();
import {
  buildTradeHeader,
  msgAutopsy,
  msgClose,
  msgDca,
  msgDrawdown,
  msgLlmVeto,
  msgLossStreak,
  msgNear,
  msgOpen,
  msgTp1,
} from "../src/lib/tg-msgs";
import type { AutoTradeRow } from "../src/lib/autotrade";

const SEND = process.argv.includes("--send");
const onlyArg = process.argv.find((a) => a.startsWith("--only="));
const ONLY = onlyArg ? new Set(onlyArg.slice("--only=".length).split(",").map((s) => s.trim()).filter(Boolean)) : null;

const BAL = 1121.05;

function baseTrade(over: any = {}): AutoTradeRow {
  return {
    id: "test-1",
    symbol: "BTC",
    interval: "15m",
    side: "LONG",
    entryPrice: 65000,
    entryTime: new Date(Date.now() - 3600_000).toISOString(),
    slPct: 1.2,
    tpPct: 2.4,
    leverage: 10,
    stakePct: 5,
    status: "open",
    exitPrice: null,
    exitTime: null,
    pnlPct: null,
    exitKind: null,
    prob: 0.62,
    acc: 68,
    auc: 0.71,
    score: 12.5,
    capitalBefore: 1118.4,
    capitalAfter: null,
    llmVerdict: "go",
    llmReason: "Trend + momentum align; risk within envelope",
    autopsy: null,
    methodId: "test",
    p1Pct: null,
    p1Share: null,
    tp2Pct: null,
    trailPct: null,
    createdAt: new Date().toISOString(),
    ...over,
  } as AutoTradeRow;
}

const openLong = baseTrade();
const openShort = baseTrade({
  id: "test-2",
  symbol: "ETH",
  interval: "1h",
  side: "SHORT",
  entryPrice: 3500,
  slPct: 1.5,
  tpPct: 3.0,
  leverage: 10,
  stakePct: 5,
  prob: 0.58,
  acc: 64,
  auc: 0.68,
  score: 9.8,
  capitalBefore: 1118.4,
});

const closedTp = baseTrade({
  id: "test-3",
  status: "closed",
  exitPrice: 66500,
  exitTime: new Date().toISOString(),
  pnlPct: 7.99,
  exitKind: "tp",
  capitalBefore: 1118.4,
  capitalAfter: 1121.05,
});

const closedSl = baseTrade({
  id: "test-4",
  status: "closed",
  exitPrice: 64000,
  exitTime: new Date().toISOString(),
  pnlPct: -8.5,
  exitKind: "sl",
  capitalBefore: 1121.05,
  capitalAfter: 1115.2,
});

const closedBanked = baseTrade({
  id: "test-5",
  status: "closed",
  exitPrice: 66800,
  exitTime: new Date().toISOString(),
  pnlPct: 5.2,
  exitKind: "tp",
  capitalBefore: 1115.2,
  capitalAfter: 1118.4,
  p1Pct: 3.5,
  p1Share: 0.5,
});

const vetoRow: any = {
  symbol: "SOL",
  interval: "15m",
  bias: "LONG",
  prob: 0.55,
  acc: 52,
  auc: 0.58,
  score: 4.2,
  llmVerdict: "veto",
  llmReason: "Weak confluence — volume fading at resistance",
};

const streakChain = [
  { symbol: "BTC", interval: "15m", pnlPct: -2.1 },
  { symbol: "ETH", interval: "1h", pnlPct: -3.4 },
  { symbol: "SOL", interval: "15m", pnlPct: -1.8 },
];

const msgs: Array<{ key: string; label: string; text: string }> = [
  { key: "open", label: "OPEN · LONG", text: msgOpen(openLong, 1118.4, "📏 SL/TP liq-capped @ ×10: 1.5/3.0% → 1.2/2.4%", BAL) },
  { key: "open", label: "OPEN · SHORT", text: msgOpen(openShort, 1118.4, undefined, BAL) },
  { key: "close", label: "CLOSE · TP win", text: msgClose(closedTp, 174, 74.71, 12.11, BAL) },
  { key: "close", label: "CLOSE · SL loss + slippage", text: msgClose(closedSl, 175, 74.29, 11.52, 1115.2) },
  { key: "close", label: "CLOSE · TP1 banked + runner", text: msgClose(closedBanked, 176, 74.43, 11.84, 1118.4) },
  { key: "near", label: "NEAR · TP", text: msgNear(openLong, 66200, "tp") },
  { key: "near", label: "NEAR · SL", text: msgNear(openLong, 64500, "sl") },
  { key: "dca", label: "DCA · add 2/3 at SL", text: msgDca(openLong, 64250, 65000, { prob: 0.62, auc: 0.71, acc: 68 }, 2, 3, "cross") },
  { key: "veto", label: "LLM VETO", text: msgLlmVeto(vetoRow, { verdict: "veto", reasons: ["Weak confluence — volume fading at resistance", "No fresh catalyst"] } as any) },
  { key: "tp1", label: "TP1 · banked, runner SL at TP1", text: msgTp1(openLong, 65800, 0.5, 4.8, 3.2, "tp") },
  { key: "tp1", label: "TP1 · trail armed", text: msgTp1(openLong, 66000, 0.5, 4.8, 3.2, "trail") },
  { key: "autopsy", label: "AUTOPSY · WIN", text: msgAutopsy(closedTp, { outcome: "win", tag: "trend-follow", why: ["Followed plan", "TP1 banked"], lesson: "Let the runner work", ev: { rMultiple: 1.8, durMin: 45, mfePct: 3.1, maePct: -0.4 }, ms: 1200, model: "llm" }) },
  { key: "autopsy", label: "AUTOPSY · LOSS", text: msgAutopsy(closedSl, { outcome: "loss", tag: "fomo", why: ["Chased entry", "No retest"], lesson: "Wait for retest", ev: { rMultiple: -1.2, durMin: 20, mfePct: 0.5, maePct: -2.1 }, ms: 900, model: "llm" }) },
  { key: "streak", label: "LOSS STREAK x3", text: msgLossStreak(3, streakChain, BAL) },
  { key: "drawdown", label: "DRAWDOWN -2%", text: msgDrawdown({ peak: 1150, level: 1127, nowEq: 1120, ddPct: 2 }, closedSl) },
  { key: "open-a", label: "OPEN · Book A Vulcan", text: [...buildTradeHeader("🟢", "OPEN", { symbol: "ETH", interval: "15m", side: "LONG", book: "A" }), `🎯 Entry <b>3500</b>`, `📐 SL <b>3420.50</b> · Trail Donchian`, `Lev ×5 · Stake 10%`, `💰 Balance <b>${BAL.toFixed(2)}</b> USDT`].join("\n") },
  { key: "open-c", label: "OPEN · Book C Wyckoff", text: [...buildTradeHeader("🟢", "OPEN", { symbol: "SOL", interval: "1d", side: "LONG", book: "C" }), `🎯 Entry <b>180.25</b>`, `📐 SL <b>165.400000</b> · Trigger accum · Score 0.82`, `Lev ×1 · Stake 10%`, `💰 Balance <b>${BAL.toFixed(2)}</b> USDT`].join("\n") },
  { key: "open-d", label: "OPEN · Book D Liquid", text: [...buildTradeHeader("🟢", "OPEN", { symbol: "DOGE", interval: "4h", side: "SHORT", book: "D" }), `🎯 Entry <b>0.1800</b>`, `📐 SL <b>0.1850</b> · TP <b>0.1720</b>`, `Lev ×3 · Stake 10%`, `💰 Balance <b>${BAL.toFixed(2)}</b> USDT`].join("\n") },
];

async function main(): Promise<void> {
  let cfgOk = false;
  try {
    const tok: any = await (effectiveToken as any)();
    const chat: any = await (effectiveChatId as any)();
    cfgOk = Boolean(tok && chat);
  } catch {
    cfgOk = false;
  }
  console.log(`Telegram configured: ${cfgOk ? "yes" : "NO — set TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID in .env or link Telegram in the app"}`);
  if (SEND && !cfgOk) {
    console.log("Aborting: nothing sent.");
    return;
  }
  for (const m of msgs) {
    if (ONLY && !ONLY.has(m.key)) continue;
    console.log(`\n===== ${m.label} [${m.key}] =====\n${m.text}\n`);
    if (SEND) {
      const r: any = await tgSendMessage(m.text, "HTML");
      console.log(`→ send ${m.label}: ${r?.ok ? "OK" : `FAIL ${r?.detail ?? "unknown"}`}`);
      await new Promise((res) => setTimeout(res, 400));
    }
  }
  if (!SEND) console.log("\nDry-run only — nothing sent. Re-run with --send to deliver to Telegram.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
