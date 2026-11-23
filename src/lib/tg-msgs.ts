// ─── tg-msgs — Telegram message builders for the auto engine (HTML mode) ─────
// Shared by the browser toasts/relays (auto-panel) AND the backend engine
// scheduler (engine.ts) so open/close/near/veto messages are byte-identical
// no matter who fires them. Pure string builders — no fetch, no storage.

import { fmtPrice } from "./i18n";
import { feeRoi, roiOf, type AutoTradeRow, type ScanRow } from "./autotrade";
import type { LlmVerdict } from "./llm";

const HR = "━━━━━━━━━━━━━━━━━━";

/** Book code + emoji — same colours as the position cards (A amber, B cyan, C violet, D emerald). */
const BOOK_ICON: Record<string, string> = { A: "🟧", B: "🟦", C: "🟪", D: "🟩" };
export const bookCode = (r: { book?: string | null }): string => (r.book ?? "B").toUpperCase();

/** Header shared by every trade message: icon + event, then symbol · book · timeframe · side. */
export const buildTradeHeader = (
  icon: string,
  event: string,
  r: { symbol: string; interval: string; side: string; book?: string | null },
): string[] => [
  `${icon} <b>${event}</b>`,
  `${BOOK_ICON[bookCode(r)] ?? "🟦"} <b>#${r.symbol}</b> · ${bookCode(r)} · ${r.interval} · ${sideTxt(r.side)}`,
  HR,
];

/** Balance line: before → after with signed delta, USDT two decimals. */
export const balanceLine = (before: number, after: number): string => {
  const d = after - before;
  return `Balance ${before.toFixed(2)} → <b>${after.toFixed(2)}</b> USDT (${d >= 0 ? "+" : ""}${d.toFixed(2)})`;
};
const levTxt = (x: number): string => `×${x % 1 === 0 ? x : x.toFixed(2)}`;
const sideTxt = (side: string): string => (side === "LONG" ? "LONG 🟢" : side === "SHORT" ? "SHORT 🔴" : "NEUTRAL ⚪");

/** prob HIỂN THỊ THEO PHÍA model nghiêng về (cùng chuẩn PHE của §6c reliability).
 *  prob gốc LUÔN là P(giá đi lên) — SHORT P(up)=20.1% thật ra là tin 79.9% giá
 *  giảm. In thô "Prob 20.1%" cạnh chữ SHORT khiến người đọc tưởng model chỉ
 *  tin 20% mà vẫn mở lệnh. Flip về phía nghiêng về, kèm nhãn phía cho khỏi
 *  phải tự đảo trong đầu. NEUTRAL giữ prob thô (không có phía để đảo). */
const probTxt = (side: string, prob: number): string => {
  const p = side === "SHORT" ? 1 - prob : prob;
  return side === "LONG"
    ? `Prob ${(p * 100).toFixed(2)}% toward LONG 🟢`
    : side === "SHORT"
      ? `Prob ${(p * 100).toFixed(2)}% toward SHORT 🔴`
      : `Prob ${(p * 100).toFixed(2)}%`;
};

/** absolute SL price level for a side (price-move %, before leverage) */
export const slPrice = (side: string, entry: number, slPct: number): number =>
  side === "SHORT" ? entry * (1 + Math.abs(slPct) / 100) : entry * (1 - Math.abs(slPct) / 100);
/** absolute TP price level for a side */
export const tpPrice = (side: string, entry: number, tpPct: number): number =>
  side === "SHORT" ? entry * (1 - Math.abs(tpPct) / 100) : entry * (1 + Math.abs(tpPct) / 100);

export const msgOpen = (r: AutoTradeRow, equity: number, atrNote?: string): string => {
  const stake = (equity * (r.stakePct ?? 100)) / 100;
  const notional = stake * r.leverage;
  const rr = r.slPct > 0 ? r.tpPct / r.slPct : 0;
  const feeRt = feeRoi(r.leverage, 2);
  const slNow = slPrice(r.side, r.entryPrice, r.slPct);
  const tpNow = tpPrice(r.side, r.entryPrice, r.tpPct);
  const lines = [
    ...buildTradeHeader("🟢", "OPEN", r),
    `Entry <b>${fmtPrice(r.entryPrice)}</b>`,
    `SL <b>${fmtPrice(slNow)}</b> (−${r.slPct.toFixed(2)}% price · ROI ${(-(r.slPct * r.leverage)).toFixed(2)}%)`,
    `TP <b>${fmtPrice(tpNow)}</b> (+${r.tpPct.toFixed(2)}% price · ROI +${(r.tpPct * r.leverage).toFixed(2)}%)`,
    `Lev ${levTxt(r.leverage)} · Stake ${r.stakePct ?? 100}% · R:R 1:${rr.toFixed(2)}`,
    `Margin <b>${stake.toFixed(2)}</b> USDT · Size ${notional.toFixed(2)} USDT`,
  ];
  if (feeRt > 0) lines.push(`Fees round-trip −${feeRt.toFixed(2)}% ROI (net in realized ROI)`);
  if (atrNote) lines.push(atrNote);
  lines.push(`${probTxt(r.side, r.prob ?? 0)} · AUC ${(r.auc ?? 0).toFixed(2)} · ACC ${(r.acc ?? 0).toFixed(2)}% · Score ${(r.score ?? 0).toFixed(2)}`);
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

export const msgClose = (r: AutoTradeRow, closed: number, winRate: number, netPnlPct: number): string => {
  // pnlPct từ settlement đã SAU PHÍ (0.2.77) — dòng phụ cho thấy phí đã trừ
  // bao nhiêu để đọc msg không thắc mắc "ROI thấp hơn bảng SL/TP".
  const feeRt = feeRoi(r.leverage, 2);
  const share = r.p1Share ?? 0;
  const banked = r.p1Pct ?? null;
  const runner = share > 0 && share < 1 && banked != null ? ((r.pnlPct ?? 0) - share * banked) / (1 - share) : null;
  const slP = slPrice(r.side, r.entryPrice, r.slPct);
  const exP = r.exitPrice ?? 0;
  const slip = exP > 0 ? (r.side === "SHORT" ? ((exP - slP) / r.entryPrice) * 100 : ((slP - exP) / r.entryPrice) * 100) : 0;
  const deltaUsdt = (r.capitalAfter ?? 0) - (r.capitalBefore ?? 0);
  return [
    `🤖 <b>AUTO CLOSE · ${kindTag(r.exitKind)}</b>`,
    `📌 <b>#${r.symbol}</b> · ${r.interval} · ${sideTxt(r.side)}`,
    HR,
    `🎯 Entry ${fmtPrice(r.entryPrice)} → 🚪 Exit <b>${fmtPrice(r.exitPrice ?? 0)}</b>`,
    `📐 SL ${r.slPct.toFixed(2)}% · TP ${r.tpPct.toFixed(2)}% · Lev ${levTxt(r.leverage)} · Score ${(r.score ?? 0).toFixed(2)} · AUC ${(r.auc ?? 0).toFixed(2)} · ACC ${(r.acc ?? 0).toFixed(2)}%`,
    banked != null && runner != null
      ? `💵 PnL: Banked ${banked >= 0 ? "+" : ""}${banked.toFixed(2)}% × ${(share * 100).toFixed(2)}% + Runner ${runner >= 0 ? "+" : ""}${runner.toFixed(2)}% × ${((1 - share) * 100).toFixed(2)}% = <b>${(r.pnlPct ?? 0) >= 0 ? "+" : ""}${(r.pnlPct ?? 0).toFixed(2)}% ROI tổng</b>`
      : `💵 PnL (ROI): <b>${(r.pnlPct ?? 0) >= 0 ? "+" : ""}${(r.pnlPct ?? 0).toFixed(2)}%</b>${feeRt > 0 ? ` · fees −${feeRt.toFixed(2)}%` : ""}`,
    `💰 Equity: ${(r.capitalBefore ?? 0).toFixed(2)} → <b>${(r.capitalAfter ?? 0).toFixed(2)}</b> USDT (${deltaUsdt >= 0 ? "+" : ""}${deltaUsdt.toFixed(2)})`,
    ...(slip > 0 ? [`⚠️ Slippage +${slip.toFixed(2)}% giá (exit ${fmtPrice(exP)} vượt SL ${fmtPrice(slP)})`] : []),
    `📈 Track record: ${closed} trades · Win rate ${winRate.toFixed(2)}% · Net vốn ${netPnlPct >= 0 ? "+" : ""}${netPnlPct.toFixed(2)}%`,
  ].join("\n");
}

export const msgNear = (r: AutoTradeRow, price: number, kind: "tp" | "sl"): string => {
  const target = kind === "tp" ? tpPrice(r.side, r.entryPrice, r.tpPct) : slPrice(r.side, r.entryPrice, r.slPct);
  const awayPct = price > 0 ? Math.abs((target - price) / price) * 100 : 0;
  const roi = roiOf(r.side, r.entryPrice, price, r.leverage);
  return [
    kind === "tp" ? "⚠️ <b>NEAR TAKE PROFIT — READY TO LOCK GAINS</b>" : "⚠️ <b>NEAR STOP LOSS — RISK WATCH</b>",
    `📌 <b>#${r.symbol}</b> · ${r.interval} · ${sideTxt(r.side)}`,
    HR,
    `${kind === "tp" ? "🏁" : "🛑"} ${kind === "tp" ? "Take Profit" : "Stop Loss"} ${fmtPrice(target)} · <b>${awayPct.toFixed(2)}%</b> away`,
    `📊 SL ${r.slPct.toFixed(2)}% · TP ${r.tpPct.toFixed(2)}% · Lev ${levTxt(r.leverage)} · Score ${(r.score ?? 0).toFixed(2)} · AUC ${(r.auc ?? 0).toFixed(2)}
📈 Price ${fmtPrice(price)} · ROI <b>${roi >= 0 ? "+" : ""}${roi.toFixed(2)}%</b> · Lev ${levTxt(r.leverage)}`,
  ].join("\n");
};

const escHtml = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

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
    `🤖 <b>AUTO DCA (dry-run) · add ${add}/${max}${trigger === "cross" ? " · at SL" : ""}</b>`,
    `📌 <b>#${r.symbol}</b> · ${r.interval} · ${sideTxt(r.side)}`,
    HR,
    `🎯 Entry ${fmtPrice(prevEntry)} → add <b>${fmtPrice(dcaPrice)}</b> (${movedPct.toFixed(2)}% price)`,
    `📊 New average entry: <b>${fmtPrice(r.entryPrice)}</b>`,
    `🛑 New SL: <b>${fmtPrice(slPrice(r.side, r.entryPrice, r.slPct))}</b> · −${r.slPct.toFixed(2)}% from avg`,
    `🏁 New TP: <b>${fmtPrice(tpPrice(r.side, r.entryPrice, r.tpPct))}</b> · +${r.tpPct.toFixed(2)}% from avg`,
    `📦 Margin: <b>${stake.toFixed(2)}</b> USDT · ${r.stakePct ?? 100}% equity · Kích thước ${notional.toFixed(2)} USDT · PnL SL -${((r.slPct ?? 0) * r.leverage * stake / 100).toFixed(2)} / TP +${((r.tpPct ?? 0) * r.leverage * stake / 100).toFixed(2)} USDT`,
    `📈 ROI at DCA price: ${roi >= 0 ? "+" : ""}${roi.toFixed(2)}% @ ${levTxt(r.leverage)}`,
    `🧠 Model still confirms · ${probTxt(r.side, confirm.prob)} · AUC ${confirm.auc.toFixed(2)} · ACC ${confirm.acc.toFixed(2)}%`,
  ].join("\n");
};

/** LLM veto notice — the pending entry was reviewed and rejected by the local model */
export const msgLlmVeto = (r: ScanRow, v: LlmVerdict): string =>
  [
    `🛑 <b>LLM VETO — setup blocked before entry</b>`,
    `📌 <b>#${r.symbol}</b> · ${r.interval} · ${sideTxt(r.bias)}`,
    HR,
    `🧠 ${probTxt(r.bias, r.prob)} · AUC ${r.auc.toFixed(2)} · ACC ${r.acc.toFixed(2)}% · Score ${r.score.toFixed(2)}`,
    `💬 ${escHtml(v.reasons.slice(0, 3).join(" · ")) || "—"}`,
  ].join("\n");

/** 0.3.3 — TP1 PARTIAL → RUNNER: chạm TP lần đầu, chốt một phần (SAU PHÍ — cùng
 *  settlement 0.2.77 với closeTradeDirect), phần còn lại chuyển runner (SL về
 *  breakeven, TP mở rộng, trail ratchet khoá lời). Tham số khai báo structural
 *  (AutoTradeRow subset) để tránh vòng import. */
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
    `🪙 <b>TP1 PARTIAL — RUNNER ARMED</b>`,
    `📌 <b>#${r.symbol}</b> · ${r.interval} · ${sideTxt(r.side)}`,
    HR,
    `✅ Banked <b>${(share * 100).toFixed(2)}%</b> stake ${src === "trail" ? "(TRAIL)" : "(TP1)"} (+${bank.toFixed(2)}% ROI phần banked, sau phí)` ,
    src === "trail"
      ? `🛡 Runner: SL dời lên <b>giá trail</b> — khóa lời đã bank`
      : `🛡 Runner: SL khoá tại <b>giá TP1</b> — lời runner có sàn`,
    `🏁 Runner: để lời chạy — trail đuổi theo (khoá 50% quãng đi) tới khi hết position, không chốt cứng TP2`,
    `📈 Price ${fmtPrice(price)} · ROI ${roi >= 0 ? "+" : ""}${roi.toFixed(2)}% · SL floor ${r.tpPct.toFixed(2)}% giá (TP1)`,
  ].join("\n");
};

/**
 * Autopsy notice — lệnh ĐÃ ĐÓNG được LLM phân tích chuyên sâu (cả thắng lẫn thua): tag chế độ
 * thắng/thua + bài học + các why trích số. Tham số khai báo structural (không
 * import autopsy.ts) để tránh vòng import — đủ hình dạng là ghép được.
 */
export const msgAutopsy = (
  t: { symbol: string; interval: string; side: string; exitKind?: string | null; pnlPct?: number | null },
  a: { outcome: string; tag: string; why: string[]; lesson: string; ev?: { rMultiple?: number; durMin?: number; mfePct?: number; maePct?: number }; ms?: number; model?: string },
): string =>
  [
    `🔬 <b>TRADE AUTOPSY · ${a.outcome === "win" ? "WIN ✅" : "LOSS 🔻"}</b>`,
    `📌 <b>#${t.symbol}</b> · ${t.interval} · ${sideTxt(t.side)} · ${kindTag(t.exitKind ?? null)}`,
    HR,
    `💵 Result: <b>${(t.pnlPct ?? 0) >= 0 ? "+" : ""}${(t.pnlPct ?? 0).toFixed(2)}% ROI</b>${a.ev?.rMultiple != null ? ` · R ${a.ev.rMultiple >= 0 ? "+" : ""}${a.ev.rMultiple.toFixed(2)}x` : ""}${a.ev?.durMin != null ? ` · held ${a.ev.durMin.toFixed(2)}m` : ""}`,
    `🏷️ tag: <b>${escHtml(a.tag)}</b>`,
    ...(a.why.length > 0 ? [`📝 ${a.why.map((w) => escHtml(w)).join("<br/>• ")}`] : []),
    `💡 <b>Lesson:</b> ${escHtml(a.lesson)}`,
    `🧠 ${escHtml(a.model ?? "llm")}${a.ms ? ` · ${(a.ms / 1000).toFixed(2)}s` : ""} — lesson feeds the next review for this pair`,
  ].join("\n");

// ─── ALERT builders (0.2.71) — tier-1 notify, KHÔNG BAO GIỜ bị TG_MUTE ───────

const eqTxt = (x: number): string => x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * 🔴 LOSS STREAK — chuỗi thua liên tiếp chạm bội TG_STREAK_ALERT (4, 8, 12…).
 * `chain` = chính các lệnh thua trong chuỗi, mới nhất trước (đã cắt sẵn).
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
    `📉 Chain (newest first): ${shown.join(" · ")}`,
    `💰 Equity: <b>${equity != null ? eqTxt(equity) : "—"}</b> USDT · chain ROI <b>${net >= 0 ? "+" : ""}${net.toFixed(2)}%</b>`,
    `🧠 Regime mismatch? Check /ai — entry gates, flip cooldown, or pause auto.`,
  ].join("\n");
};

/**
 * 🔴 DRAWDOWN — vốn vừa cắt XUỐNG mức (đỉnh 24h × (1 − dd%)). Chỉ bắn đúng
 * lần chạm ngưỡng; hồi phục rồi phá tiếp mới bắn lại (crossing logic ở
 * tg-alerts.ddCrossOf).
 */
export const msgDrawdown = (
  x: { peak: number; level: number; nowEq: number; ddPct: number },
  crossedOn: { symbol: string; interval: string; pnlPct?: number | null },
): string =>
  [
    `🔴 <b>ALERT · DRAWDOWN — equity ${x.ddPct.toFixed(2)}% under the 24h peak</b>`,
    HR,
    `💰 Equity <b>${eqTxt(x.nowEq)}</b> USDT · 24h peak ${eqTxt(x.peak)} → alert level ${eqTxt(x.level)}`,
    `🚪 Crossed on: <b>#${crossedOn.symbol}</b> ${crossedOn.interval} closed ${(crossedOn.pnlPct ?? 0) >= 0 ? "+" : ""}${(crossedOn.pnlPct ?? 0).toFixed(2)}%`,
    `🧠 Risk check: consecutive losses + DCA usage on /ai — consider pausing auto.`,
  ].join("\n");
