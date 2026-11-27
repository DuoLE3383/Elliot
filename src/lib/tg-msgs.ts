// ─── tg-msgs — Telegram message builders for the auto engine (HTML mode) ─────
// Shared by the browser toasts/relays (auto-panel) AND the backend engine
// scheduler (engine.ts) so open/close/near/veto messages are byte-identical
// no matter who fires them. Pure string builders — no fetch, no storage.

import { fmtPrice } from "./i18n";
import { feeRoi, roiOf, type AutoTradeRow, type ScanRow } from "./autotrade";
import type { LlmVerdict } from "./llm";

const HR = "━━━━━━━━━━━━━━━━━━";

/** Book code + emoji — same colours as the position cards (A amber, B cyan, C violet, D emerald). */
const BOOK_ICON: Record<string, string> = { A: "⚛️", B: "☯️", C: "♒️", D: "☪️" };
export const bookCode = (r: { book?: string | null }): string => (r.book ?? "B").toUpperCase();

/**
 * Header shared by every trade message: icon + event, then symbol · book · timeframe · side.
 * Ends with a blank line so the header block stands apart from the body.
 */
export const buildTradeHeader = (
  icon: string,
  event: string,
  r: { symbol: string; interval: string; side: string; book?: string | null },
): string[] => [
  `${icon} <b>${event}</b>`,
  `${BOOK_ICON[bookCode(r)] ?? "☯️"} <b>#${escHtml(r.symbol)}</b> · ${bookCode(r)} · ${r.interval} · ${sideTxt(r.side)}`,
  HR,
  "",
];

/** Balance line: before → after with signed delta, USDT two decimals. */
export const balanceLine = (before: number, after: number): string => {
  const d = after - before;
  return `Balance ${before.toFixed(2)} → <b>${after.toFixed(2)}</b> USDT (${d >= 0 ? "+" : ""}${d.toFixed(2)})`;
};
const levTxt = (x: number): string => `×${x % 1 === 0 ? x : x.toFixed(2)}`;
const sideTxt = (side: string): string => (side === "LONG" ? "LONG 📈" : side === "SHORT" ? "SHORT 📉" : "NEUTRAL ⚪");
const escHtml = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Display prob FLIPPED toward the side the model leans to (same SIDE convention as §6c reliability).
 *  Raw prob is ALWAYS P(price goes up) — a SHORT with P(up)=20.1% is really 79.9%
 *  confidence price falls. Printing raw "Prob 20.1%" next to SHORT makes it look
 *  like the model only believes 20% yet still opened. Flip toward the leaned
 *  side and label the side so the reader doesn't have to invert it mentally.
 *  NEUTRAL keeps raw prob (no side to flip to). */
const probTxt = (side: string, prob: number): string => {
  const p = side === "SHORT" ? 1 - prob : prob;
  return side === "LONG"
    ? `Prob ${(p * 100).toFixed(2)}% toward LONG 📈`
    : side === "SHORT"
      ? `Prob ${(p * 100).toFixed(2)}% toward SHORT 📉`
      : `Prob ${(p * 100).toFixed(2)}%`;
};

/** absolute SL price level for a side (price-move %, before leverage) */
export const slPrice = (side: string, entry: number, slPct: number): number =>
  side === "SHORT" ? entry * (1 + Math.abs(slPct) / 100) : entry * (1 - Math.abs(slPct) / 100);
/** absolute TP price level for a side */
export const tpPrice = (side: string, entry: number, tpPct: number): number =>
  side === "SHORT" ? entry * (1 - Math.abs(tpPct) / 100) : entry * (1 + Math.abs(tpPct) / 100);

export const msgOpen = (r: AutoTradeRow, equity: number, atrNote?: string, displayBalance?: number, walletInfo?: { locked: number; available: number }): string => {
  const x = r as any;
  const forced = x.methodId === "force";
  const noModel = (r.auc ?? 0) <= 0.5 && (r.acc ?? 0) <= 0;
  // MARGIN BASE: the stake was sized from the trade's own capitalBefore, so show that,
  // not the caller's equity snapshot (which can differ from the balance used at entry).
  const base = r.capitalBefore && r.capitalBefore > 0 ? r.capitalBefore : equity;
  const stake = (base * (r.stakePct ?? 100)) / 100;
  const notional = stake * r.leverage;
  const rr = r.slPct > 0 ? r.tpPct / r.slPct : 0;
  const feeRt = feeRoi(r.leverage, 2);
  const slNow = slPrice(r.side, r.entryPrice, r.slPct);
  const tpNow = tpPrice(r.side, r.entryPrice, r.tpPct);
  const llm = forced
    ? "LLM Risk Officer: not reviewed (forced entry)"
    : x.llmVerdict
      ? `LLM Risk Officer: ${x.llmVerdict}${x.llmReason ? ` — ${escHtml(String(x.llmReason))}` : ""}`
      : "LLM Risk Officer: not reviewed";
  const lines = [
    ...buildTradeHeader("📡", forced ? "OPEN · FORCE" : "OPEN", r),
    `🎯 Entry <b>${fmtPrice(r.entryPrice)}</b>`,
    `🛑 Stop Loss <b>${fmtPrice(slNow)}</b> (−${r.slPct.toFixed(2)}% price · ROI ${(-(r.slPct * r.leverage)).toFixed(2)}% if hit)`,
    `🏁 Take Profit <b>${fmtPrice(tpNow)}</b> (+${r.tpPct.toFixed(2)}% price · ROI +${(r.tpPct * r.leverage).toFixed(2)}% if hit)`,
    "",
    `⚖️ Leverage ${levTxt(r.leverage)} · Stake ${r.stakePct ?? 100}% of Balance · Reward : Risk 1 : ${rr.toFixed(2)}`,
    `📦 Margin <b>${stake.toFixed(2)}</b> USDT · Position size ${notional.toFixed(2)} USDT`,
    "",
  ];
  if (forced) lines.push("🔓 Gate: bypassed (forced start from BEST)");
  if (feeRt > 0) lines.push(`🧾 Fees (round-trip) −${feeRt.toFixed(2)}% ROI — already counted in realized ROI`);
  if (atrNote) lines.push(escHtml(atrNote));
  lines.push(`🧠 ${llm}`);
  lines.push(
    noModel
      ? "📊 Model: pending (no score yet)"
      : `📊 Model: ${probTxt(r.side, r.prob ?? 0)} · AUC ${(r.auc ?? 0).toFixed(2)} · ACC ${(r.acc ?? 0).toFixed(2)}% · Score ${(r.score ?? 0).toFixed(2)}`,
  );
  lines.push("");
  lines.push(`💰 Balance <b>${(displayBalance ?? base).toFixed(2)}</b> USDT`);
  if (walletInfo) lines.push(`🔒 Locked <b>${walletInfo.locked.toFixed(2)}</b> USDT · Available <b>${walletInfo.available.toFixed(2)}</b> USDT`);
  return lines.join("\n");
};

const kindTag = (k: string | null): string =>
  k === "tp"
    ? "TAKE PROFIT ✅"
    : k === "sl"
      ? "STOP LOSS 🔻"
      : k === "trail"
        ? "TRAILING STOP 🚉"
        : k === "flip"
          ? "FLIP 🔄"
          : "MANUAL CLOSE ✋";

export const msgClose = (r: AutoTradeRow, closed: number, winRate: number, netPnlPct: number, balanceAfter?: number): string => {
  // pnlPct from settlement is AFTER FEES (0.2.77) — the sub-line shows how much
  // fee was deducted so the reader doesn't wonder why ROI is lower than the SL/TP table.
  const feeRt = feeRoi(r.leverage, 2);
  const share = r.p1Share ?? 0;
  const banked = r.p1Pct ?? null;
  const runner = share > 0 && share < 1 && banked != null ? ((r.pnlPct ?? 0) - share * banked) / (1 - share) : null;
  const slP = slPrice(r.side, r.entryPrice, r.slPct);
  const exP = r.exitPrice ?? 0;
  const slip = exP > 0 ? (r.side === "SHORT" ? ((exP - slP) / r.entryPrice) * 100 : ((slP - exP) / r.entryPrice) * 100) : 0;
  const deltaUsdt = (r.capitalAfter ?? 0) - (r.capitalBefore ?? 0);
  // Unified dry-run Balance AFTER this close (caller passes readUnifiedSettled).
  // Balance before = after - this trade's own delta, so the chain stays correct
  // with concurrent opens. Fallback = per-trade capitalAfter (legacy).
  const balAfter = balanceAfter ?? (r.capitalAfter ?? 0);
  const balBefore = balAfter - deltaUsdt;
  return [
    ...buildTradeHeader("🤖", `AUTO #CLOSE · ${kindTag(r.exitKind).replace("TRAILING STOP", "#TRAIL STOP")}`, r),
    `🎯 Entry ${fmtPrice(r.entryPrice)} → 🚪 Exit <b>${fmtPrice(r.exitPrice ?? 0)}</b>`,
    `📐 Plan: SL ${r.slPct.toFixed(2)}% · TP ${r.tpPct.toFixed(2)}% · Lev ${levTxt(r.leverage)} · Score ${(r.score ?? 0).toFixed(2)} · AUC ${(r.auc ?? 0).toFixed(2)} · ACC ${(r.acc ?? 0).toFixed(2)}%`,
    "",
    banked != null && runner != null
      ? `💵 PnL: Banked ${banked >= 0 ? "+" : ""}${banked.toFixed(2)}% × ${(share * 100).toFixed(2)}% stake + Runner ${runner >= 0 ? "+" : ""}${runner.toFixed(2)}% × ${((1 - share) * 100).toFixed(2)}% stake = <b>${(r.pnlPct ?? 0) >= 0 ? "+" : ""}${(r.pnlPct ?? 0).toFixed(2)}% total ROI</b>`
      : `💵 PnL (ROI): <b>${(r.pnlPct ?? 0) >= 0 ? "+" : ""}${(r.pnlPct ?? 0).toFixed(2)}%</b>${feeRt > 0 ? ` · fees −${feeRt.toFixed(2)}%` : ""}`,
    `💰 ${balanceLine(balBefore, balAfter)}`,
    "",
    ...(slip > 0 ? [`⚠ Slippage +${slip.toFixed(2)}% price — exit ${fmtPrice(exP)} went past SL ${fmtPrice(slP)}`, ""] : []),
    `📈 Track record (all books): ${closed} trades · Win rate ${winRate.toFixed(2)}% · Net ROI ${netPnlPct >= 0 ? "+" : ""}${netPnlPct.toFixed(2)}%`,
  ].join("\n");
}

export const msgNear = (r: AutoTradeRow, price: number, kind: "tp" | "sl"): string => {
  const target = kind === "tp" ? tpPrice(r.side, r.entryPrice, r.tpPct) : slPrice(r.side, r.entryPrice, r.slPct);
  const awayPct = price > 0 ? Math.abs((target - price) / price) * 100 : 0;
  const roi = roiOf(r.side, r.entryPrice, price, r.leverage);
  return [
    ...buildTradeHeader(kind === "tp" ? "✅" : "⚠", kind === "tp" ? "#ALMOST TP — READY TO LOCK GAINS" : "#ALMOST SL — RISK WATCH", r),
    `${kind === "tp" ? "🏁" : "🛑"} ${kind === "tp" ? "Take Profit" : "Stop Loss"} ${fmtPrice(target)} · <b>${awayPct.toFixed(2)}%</b> away`,
    "",
    `📊 Plan: SL ${r.slPct.toFixed(2)}% · TP ${r.tpPct.toFixed(2)}% · Lev ${levTxt(r.leverage)} · Score ${(r.score ?? 0).toFixed(2)} · AUC ${(r.auc ?? 0).toFixed(2)} · ACC ${(r.acc ?? 0).toFixed(2)}%`,
    `📈 Now: Price ${fmtPrice(price)} · ROI <b>${roi >= 0 ? "+" : ""}${roi.toFixed(2)}%</b> · Lev ${levTxt(r.leverage)}`,
  ].join("\n");
};

/**
 * DCA notice — price pushed against the position but the model still backs the
 * original side, so the engine added one tranche: entry averaged, SL/TP
 * re-anchored on the new average (levels below are computed from it).
 */
export const msgDca = (
  r: AutoTradeRow,
  dcaPrice: number,
  prevEntry: number,
  confirm: { prob: number; auc: number; acc: number },
  add: number,
  max: number,
  trigger: "near" | "cross",
): string => {
  const equity = r.capitalBefore ?? 0;
  const stake = (equity * (r.stakePct ?? 100)) / 100;
  const notional = stake * r.leverage;
  const roi = roiOf(r.side, r.entryPrice, dcaPrice, r.leverage);
  const movedPct = prevEntry > 0 ? Math.abs((dcaPrice - prevEntry) / prevEntry) * 100 : 0;
  return [
    ...buildTradeHeader("🤖", `AUTO DCA (dry-run) · add ${add}/${max}${trigger === "cross" ? " · at SL" : ""}`, r),
    `🎯 Entry ${fmtPrice(prevEntry)} → ➕ Add <b>${fmtPrice(dcaPrice)}</b> (${movedPct.toFixed(2)}% price move)`,
    `📊 New average entry: <b>${fmtPrice(r.entryPrice)}</b>`,
    "",
    `🛑 New SL: <b>${fmtPrice(slPrice(r.side, r.entryPrice, r.slPct))}</b> · −${r.slPct.toFixed(2)}% from average`,
    `🏁 New TP: <b>${fmtPrice(tpPrice(r.side, r.entryPrice, r.tpPct))}</b> · +${r.tpPct.toFixed(2)}% from average`,
    "",
    `📦 Margin: <b>${stake.toFixed(2)}</b> USDT · ${r.stakePct ?? 100}% of Balance · Position size ${notional.toFixed(2)} USDT · PnL if SL -${((r.slPct ?? 0) * r.leverage * stake / 100).toFixed(2)} / if TP +${((r.tpPct ?? 0) * r.leverage * stake / 100).toFixed(2)} USDT`,
    `📈 ROI at DCA price: ${roi >= 0 ? "+" : ""}${roi.toFixed(2)}% @ ${levTxt(r.leverage)}`,
    `🧠 Model still confirms · ${probTxt(r.side, confirm.prob)} · AUC ${confirm.auc.toFixed(2)} · ACC ${confirm.acc.toFixed(2)}%`,
  ].join("\n");
};

/** LLM veto notice — the pending entry was reviewed and rejected by the local model */
export const msgLlmVeto = (r: ScanRow, v: LlmVerdict): string =>
  [
    ...buildTradeHeader("🛑", "LLM VETO — setup blocked before entry", { symbol: r.symbol, interval: r.interval, side: r.bias, book: (r as any).book ?? "B" }),
    `🧠 Model: ${probTxt(r.bias, r.prob)} · AUC ${r.auc.toFixed(2)} · ACC ${r.acc.toFixed(2)}% · Score ${r.score.toFixed(2)}`,
    `💬 Reason: ${escHtml(v.reasons.slice(0, 3).join(" · ")) || "—"}`,
  ].join("\n");

/** 0.3.3 — TP1 PARTIAL → RUNNER: first TP touch, bank part of the stake (AFTER FEES —
 *  same settlement 0.2.77 as closeTradeDirect), the rest becomes a runner (SL to
 *  breakeven, TP widened, trail ratchet locks profit). Params are structural
 *  (AutoTradeRow subset) to avoid an import cycle. */
export const msgTp1 = (
  r: { symbol: string; interval: string; side: string; entryPrice: number; tpPct: number; leverage: number; stakePct?: number | null },
  price: number,
  share: number,
  tp2Pct: number,
  bankRoi?: number,
  src?: "tp" | "trail",
): string => {
  const roi = roiOf(r.side, r.entryPrice, price, r.leverage);
  const bank = bankRoi ?? Math.round((r.tpPct * r.leverage - feeRoi(r.leverage)) * 100) / 100;
  return [
    ...buildTradeHeader("🪙", "TP1 PARTIAL — RUNNER ARMED", { symbol: r.symbol, interval: r.interval, side: r.side, book: (r as any).book ?? "B" }),
    `✅ Banked <b>${(share * 100).toFixed(2)}%</b> of stake ${src === "trail" ? "on TRAIL" : "at TP1"} (+${bank.toFixed(2)}% ROI on the banked part, after fees)`,
    "",
    src === "trail"
      ? `🛡 Runner: Stop Loss moved up to <b>trail price</b> — banked profit locked`
      : `🛡 Runner: Stop Loss moved to <b>TP1 price</b> — the runner's profit now has a floor`,
    `🏁 Runner: letting profit run — trailing stop follows (locks 50% of the move) until the position ends. No hard TP2 close.`,
    `📈 Now: Price ${fmtPrice(price)} · ROI ${roi >= 0 ? "+" : ""}${roi.toFixed(2)}% · SL floor ${r.tpPct.toFixed(2)}% price (TP1)`,
  ].join("\n");
};

/**
 * Autopsy notice — a CLOSED trade analyzed in depth by the LLM (wins and losses):
 * win/loss mode tag + lesson + why bullets with numbers. Params are structural
 * (no autopsy.ts import) to avoid an import cycle — any matching shape works.
 */
export const msgAutopsy = (
  t: { symbol: string; interval: string; side: string; exitKind?: string | null; pnlPct?: number | null },
  a: { outcome: string; tag: string; why: string[]; lesson: string; ev?: { rMultiple?: number; durMin?: number; mfePct?: number; maePct?: number }; ms?: number; model?: string },
): string =>
  [
    ...buildTradeHeader("🔬", `ELLIOTT #DOCTOR · ${a.outcome === "win" ? "#WIN ✅" : "#LOSS 🔻"}`, { symbol: t.symbol, interval: t.interval, side: t.side, book: (t as any).book ?? "B" }),
    `💵 Result: <b>${(t.pnlPct ?? 0) >= 0 ? "+" : ""}${(t.pnlPct ?? 0).toFixed(2)}% ROI</b>${a.ev?.rMultiple != null ? ` · R ${a.ev.rMultiple >= 0 ? "+" : ""}${a.ev.rMultiple.toFixed(2)}x` : ""}${a.ev?.durMin != null ? ` · Held ${a.ev.durMin.toFixed(2)}m` : ""}`,
    `🏷 Tag: <b>${escHtml(a.tag)}</b>`,
    ...(a.why.length > 0 ? ["", `📝 What happened:`, ...a.why.map((w) => `• ${escHtml(w)}`)] : []),
    "",
    `💡 Lesson: ${escHtml(a.lesson)}`,
    `🧠 Model: ${escHtml(a.model ?? "llm")}${a.ms ? ` · ${(a.ms / 1000).toFixed(2)}s` : ""} — this lesson feeds the next review for this pair`,
  ].join("\n");

// ─── ALERT builders (0.2.71) — tier-1 notify, NEVER muted by TG_MUTE ───────

const eqTxt = (x: number): string => x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * 🔴 LOSS STREAK — consecutive losses hit a TG_STREAK_ALERT multiple (4, 8, 12…).
 * `chain` = the losing trades in the streak, newest first (already sliced).
 */
export const msgLossStreak = (
  streak: number,
  chain: { symbol: string; interval: string; pnlPct?: number | null }[],
  equity: number | null,
): string => {
  const CAP = 6;
  const shown = chain.slice(0, CAP).map((t) => `#${t.symbol} ${t.interval} ${(t.pnlPct ?? 0) >= 0 ? "+" : ""}${(t.pnlPct ?? 0).toFixed(2)}%`);
  if (chain.length > CAP) shown.push(`+${chain.length - CAP} more`);
  const net = chain.reduce((a, t) => a + (t.pnlPct ?? 0), 0);
  return [
    `🔴 <b>ALERT · LOSS STREAK — ${streak} losses in a row</b>`,
    HR,
    "",
    `📉 Recent losses (newest first): ${shown.join(" · ")}`,
    `💰 Balance: <b>${equity != null ? eqTxt(equity) : "—"}</b> USDT · Streak ROI <b>${net >= 0 ? "+" : ""}${net.toFixed(2)}%</b>`,
    "",
    `🧠 Action: regime mismatch? Check /ai — entry gates, flip cooldown, or pause auto.`,
  ].join("\n");
};

/**
 * 🔴 DRAWDOWN — equity just cut DOWN through (24h peak × (1 − dd%)). Fires only on
 * the crossing touch; it must recover and break again to fire again (crossing
 * logic in tg-alerts.ddCrossOf).
 */
export const msgDrawdown = (
  x: { peak: number; level: number; nowEq: number; ddPct: number },
  crossedOn: { symbol: string; interval: string; pnlPct?: number | null },
): string =>
  [
    `🔴 <b>ALERT · DRAWDOWN — Balance ${x.ddPct.toFixed(2)}% under the 24h peak</b>`,
    HR,
    "",
    `💰 Balance <b>${eqTxt(x.nowEq)}</b> USDT · 24h peak ${eqTxt(x.peak)} → alert level ${eqTxt(x.level)}`,
    `🚪 Triggered by: <b>#${crossedOn.symbol}</b> ${crossedOn.interval} closed ${(crossedOn.pnlPct ?? 0) >= 0 ? "+" : ""}${(crossedOn.pnlPct ?? 0).toFixed(2)}%`,
    "",
    `🧠 Action: risk check — consecutive losses + DCA usage on /ai — consider pausing auto.`,
  ].join("\n");
