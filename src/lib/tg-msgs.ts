// ─── tg-msgs — Telegram message builders for the auto engine (HTML mode) ─────
// Shared by the browser toasts/relays (auto-panel) AND the backend engine
// scheduler (engine.ts) so open/close/near/veto messages are byte-identical
// no matter who fires them. Pure string builders — no fetch, no storage.

import { fmtPrice } from "./i18n";
import { feeRoe, roeOf, type AutoTradeRow, type ScanRow } from "./autotrade";
import type { LlmVerdict } from "./llm";

const HR = "━━━━━━━━━━━━━━━━━━";
const levTxt = (x: number): string => `×${x % 1 === 0 ? x : x.toFixed(1)}`;
const sideTxt = (side: string): string => (side === "LONG" ? "LONG 🟢" : side === "SHORT" ? "SHORT 🔴" : "NEUTRAL ⚪");

/** prob HIỂN THỊ THEO PHÍA model nghiêng về (cùng chuẩn PHE của §6c reliability).
 *  prob gốc LUÔN là P(giá đi lên) — SHORT P(up)=20.1% thật ra là tin 79.9% giá
 *  giảm. In thô "Prob 20.1%" cạnh chữ SHORT khiến người đọc tưởng model chỉ
 *  tin 20% mà vẫn mở lệnh. Flip về phía nghiêng về, kèm nhãn phía cho khỏi
 *  phải tự đảo trong đầu. NEUTRAL giữ prob thô (không có phía để đảo). */
const probTxt = (side: string, prob: number): string => {
  const p = side === "SHORT" ? 1 - prob : prob;
  return side === "LONG"
    ? `Prob ${(p * 100).toFixed(1)}% toward LONG 🟢`
    : side === "SHORT"
      ? `Prob ${(p * 100).toFixed(1)}% toward SHORT 🔴`
      : `Prob ${(p * 100).toFixed(1)}%`;
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
  const slRoe = -(r.slPct * r.leverage);
  const tpRoe = r.tpPct * r.leverage;
  // Phí round-trip (0.2.77) — ROE ở SL/TP trên là hình học giá; lệnh chốt còn
  // gánh thêm đúng chừng này (2 × FEE_PCT × lev % ROE). In rõ để nhìn msg là
  // biết ngay VÌ SAO ROE realised thấp hơn mức bảng SL/TP.
  const feeRt = feeRoe(r.leverage, 2);
  const feeSide = feeRoe(r.leverage, 1);
  const lines = [
    `🤖 <b>AUTO OPEN (dry-run) · ${r.side === "LONG" ? "LONG 🟢" : "SHORT 🔴"}</b>`,
    `📌 <b>#${r.symbol}</b> · ${r.interval}`,
    HR,
    `🎯 Entry: <b>${fmtPrice(r.entryPrice)}</b>`,
    `🛑 SL: <b>${fmtPrice(slPrice(r.side, r.entryPrice, r.slPct))}</b> · −${r.slPct.toFixed(1)}% price (ROE ${slRoe.toFixed(1)}% @ ${levTxt(r.leverage)})`,
    `🏁 TP: <b>${fmtPrice(tpPrice(r.side, r.entryPrice, r.tpPct))}</b> · +${r.tpPct.toFixed(1)}% price (ROE +${tpRoe.toFixed(1)}% @ ${levTxt(r.leverage)})`,
  ];
  if (feeRt > 0) {
    lines.push(`🧾 Fees round-trip: <b>−${feeRt.toFixed(2)}% ROE</b> (2 × ${feeSide.toFixed(2)}%/side @ ${levTxt(r.leverage)}) — realized ROE is net of fees`);
  }
  if (atrNote) lines.push(atrNote);
  lines.push(
    `⚖️ Leverage ${levTxt(r.leverage)} · R:R 1:${rr.toFixed(2)}`,
    `📦 Margin: <b>${stake.toFixed(2)}</b> USDT · ${r.stakePct ?? 100}% equity · Kích thước ${notional.toFixed(2)} USDT · PnL SL -${((r.slPct ?? 0) * r.leverage * stake / 100).toFixed(2)} / TP +${((r.tpPct ?? 0) * r.leverage * stake / 100).toFixed(2)} USDT`,
    `🧠 ${probTxt(r.side, r.prob ?? 0)} · AUC ${(r.auc ?? 0).toFixed(2)} · ACC ${(r.acc ?? 0).toFixed(1)}% · Score ${(r.score ?? 0).toFixed(1)}`,
  );
  return lines.join("\n");
};

const kindTag = (k: string | null): string =>
  k === "tp"
    ? "TAKE PROFIT ✅"
    : k === "sl"
      ? "STOP LOSS 🔻"
      : k === "trail"
        ? "TRAILING STOP 🪢"
        : k === "flip"
          ? "FLIP 🔄"
          : "MANUAL CLOSE ✋";

export const msgClose = (r: AutoTradeRow, closed: number, winRate: number, netPnlPct: number): string => {
  // pnlPct từ settlement đã SAU PHÍ (0.2.77) — dòng phụ cho thấy phí đã trừ
  // bao nhiêu để đọc msg không thắc mắc "ROE thấp hơn bảng SL/TP".
  const feeRt = feeRoe(r.leverage, 2);
  return [
    `🤖 <b>AUTO CLOSE · ${kindTag(r.exitKind)}</b>`,
    `📌 <b>#${r.symbol}</b> · ${r.interval} · ${sideTxt(r.side)}`,
    HR,
    `🎯 Entry ${fmtPrice(r.entryPrice)} → 🚪 Exit <b>${fmtPrice(r.exitPrice ?? 0)}</b>`,
    `📐 SL ${r.slPct.toFixed(2)}% · TP ${r.tpPct.toFixed(2)}% · Lev ${levTxt(r.leverage)} · Score ${(r.score ?? 0).toFixed(1)} · AUC ${(r.auc ?? 0).toFixed(2)} · ACC ${(r.acc ?? 0).toFixed(1)}%
💵 PnL (ROE): <b>${(r.pnlPct ?? 0) >= 0 ? "+" : ""}${(r.pnlPct ?? 0).toFixed(2)}%</b>${feeRt > 0 ? ` · fees −${feeRt.toFixed(2)}%` : ""}`,
    `💰 Equity: ${(r.capitalBefore ?? 0).toFixed(2)} → <b>${(r.capitalAfter ?? 0).toFixed(2)}</b> USDT`,
    `📈 Track record: ${closed} trades · Win rate ${winRate.toFixed(0)}% · Net ROE ${netPnlPct >= 0 ? "+" : ""}${netPnlPct.toFixed(1)}%`,
  ].join("\n");
}

export const msgNear = (r: AutoTradeRow, price: number, kind: "tp" | "sl"): string => {
  const target = kind === "tp" ? tpPrice(r.side, r.entryPrice, r.tpPct) : slPrice(r.side, r.entryPrice, r.slPct);
  const awayPct = price > 0 ? Math.abs((target - price) / price) * 100 : 0;
  const roe = roeOf(r.side, r.entryPrice, price, r.leverage);
  return [
    kind === "tp" ? "⚠️ <b>NEAR TAKE PROFIT — READY TO LOCK GAINS</b>" : "⚠️ <b>NEAR STOP LOSS — RISK WATCH</b>",
    `📌 <b>#${r.symbol}</b> · ${r.interval} · ${sideTxt(r.side)}`,
    HR,
    `${kind === "tp" ? "🏁" : "🛑"} ${kind === "tp" ? "Take Profit" : "Stop Loss"} ${fmtPrice(target)} · <b>${awayPct.toFixed(2)}%</b> away`,
    `📊 SL ${r.slPct.toFixed(2)}% · TP ${r.tpPct.toFixed(2)}% · Lev ${levTxt(r.leverage)} · Score ${(r.score ?? 0).toFixed(1)} · AUC ${(r.auc ?? 0).toFixed(2)}
📈 Price ${fmtPrice(price)} · ROE <b>${roe >= 0 ? "+" : ""}${roe.toFixed(1)}%</b> · Lev ${levTxt(r.leverage)}`,
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
  const roe = roeOf(r.side, r.entryPrice, dcaPrice, r.leverage);
  const movedPct = prevEntry > 0 ? Math.abs((dcaPrice - prevEntry) / prevEntry) * 100 : 0;
  return [
    `🤖 <b>AUTO DCA (dry-run) · add ${add}/${max}${trigger === "cross" ? " · at SL" : ""}</b>`,
    `📌 <b>#${r.symbol}</b> · ${r.interval} · ${sideTxt(r.side)}`,
    HR,
    `🎯 Entry ${fmtPrice(prevEntry)} → add <b>${fmtPrice(dcaPrice)}</b> (${movedPct.toFixed(2)}% price)`,
    `📊 New average entry: <b>${fmtPrice(r.entryPrice)}</b>`,
    `🛑 New SL: <b>${fmtPrice(slPrice(r.side, r.entryPrice, r.slPct))}</b> · −${r.slPct.toFixed(1)}% from avg`,
    `🏁 New TP: <b>${fmtPrice(tpPrice(r.side, r.entryPrice, r.tpPct))}</b> · +${r.tpPct.toFixed(1)}% from avg`,
    `📦 Margin: <b>${stake.toFixed(2)}</b> USDT · ${r.stakePct ?? 100}% equity · Kích thước ${notional.toFixed(2)} USDT · PnL SL -${((r.slPct ?? 0) * r.leverage * stake / 100).toFixed(2)} / TP +${((r.tpPct ?? 0) * r.leverage * stake / 100).toFixed(2)} USDT`,
    `📈 ROE at DCA price: ${roe >= 0 ? "+" : ""}${roe.toFixed(1)}% @ ${levTxt(r.leverage)}`,
    `🧠 Model still confirms · ${probTxt(r.side, confirm.prob)} · AUC ${confirm.auc.toFixed(2)} · ACC ${confirm.acc.toFixed(1)}%`,
  ].join("\n");
};

/** LLM veto notice — the pending entry was reviewed and rejected by the local model */
export const msgLlmVeto = (r: ScanRow, v: LlmVerdict): string =>
  [
    `🛑 <b>LLM VETO — setup blocked before entry</b>`,
    `📌 <b>#${r.symbol}</b> · ${r.interval} · ${sideTxt(r.bias)}`,
    HR,
    `🧠 ${probTxt(r.bias, r.prob)} · AUC ${r.auc.toFixed(2)} · ACC ${r.acc.toFixed(1)}% · Score ${r.score.toFixed(1)}`,
    `💬 ${escHtml(v.reasons.slice(0, 3).join(" · ")) || "—"}`,
  ].join("\n");

/** 0.3.3 — TP1 PARTIAL → RUNNER: chạm TP lần đầu, chốt một phần (SAU PHÍ — cùng
 *  settlement 0.2.77 với closeTradeDirect), phần còn lại chuyển runner (SL về
 *  hoà vô, TP mở rộng, trail ratchet khoá lời). Tham số khai báo structural
 *  (AutoTradeRow subset) để tránh vòng import. */
export const msgTp1 = (
  r: { symbol: string; interval: string; side: string; entryPrice: number; tpPct: number; leverage: number; stakePct?: number | null },
  price: number,
  share: number,
  tp2Pct: number,
): string => {
  const roe = roeOf(r.side, r.entryPrice, price, r.leverage);
  const bankRoe = Math.round((r.tpPct * r.leverage - feeRoe(r.leverage)) * 100) / 100;
  return [
    `🪙 <b>TP1 PARTIAL — RUNNER ARMED</b>`,
    `📌 <b>#${r.symbol}</b> · ${r.interval} · ${sideTxt(r.side)}`,
    HR,
    `✅ Banked <b>${(share * 100).toFixed(0)}%</b> stake tại TP1 (+${bankRoe.toFixed(1)}% ROE phần banked, sau phí)`,
    `🛡️ Phần còn lại: SL về <b>HOÀ VÔ</b> (breakeven) — rủi ro = 0`,
    `🏁 TP mở rộng: <b>+${tp2Pct.toFixed(2)}%</b> giá (từ ${r.tpPct.toFixed(2)}%) — để lời chạy`,
    `📈 Price ${fmtPrice(price)} · ROE ${roe >= 0 ? "+" : ""}${roe.toFixed(1)}% · trail khoá 50% quãng đi`,
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
    `💵 Result: <b>${(t.pnlPct ?? 0) >= 0 ? "+" : ""}${(t.pnlPct ?? 0).toFixed(2)}% ROE</b>${a.ev?.rMultiple != null ? ` · R ${a.ev.rMultiple >= 0 ? "+" : ""}${a.ev.rMultiple.toFixed(2)}x` : ""}${a.ev?.durMin != null ? ` · held ${a.ev.durMin.toFixed(0)}m` : ""}`,
    `🏷️ tag: <b>${escHtml(a.tag)}</b>`,
    ...(a.why.length > 0 ? [`📝 ${a.why.map((w) => escHtml(w)).join("<br/>• ")}`] : []),
    `💡 <b>Lesson:</b> ${escHtml(a.lesson)}`,
    `🧠 ${escHtml(a.model ?? "llm")}${a.ms ? ` · ${(a.ms / 1000).toFixed(1)}s` : ""} — lesson feeds the next review for this pair`,
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
  const shown = chain.slice(0, CAP).map((t) => `#${t.symbol} ${t.interval} ${(t.pnlPct ?? 0) >= 0 ? "+" : ""}${(t.pnlPct ?? 0).toFixed(1)}%`);
  if (chain.length > CAP) shown.push(`+${chain.length - CAP} more`);
  const net = chain.reduce((a, t) => a + (t.pnlPct ?? 0), 0);
  return [
    `🔴 <b>ALERT · LOSS STREAK — ${streak} losses in a row</b>`,
    HR,
    `📉 Chain (newest first): ${shown.join(" · ")}`,
    `💰 Equity: <b>${equity != null ? eqTxt(equity) : "—"}</b> USDT · chain ROE <b>${net >= 0 ? "+" : ""}${net.toFixed(1)}%</b>`,
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
    `🔴 <b>ALERT · DRAWDOWN — equity ${x.ddPct.toFixed(1)}% under the 24h peak</b>`,
    HR,
    `💰 Equity <b>${eqTxt(x.nowEq)}</b> USDT · 24h peak ${eqTxt(x.peak)} → alert level ${eqTxt(x.level)}`,
    `🚪 Crossed on: <b>#${crossedOn.symbol}</b> ${crossedOn.interval} closed ${(crossedOn.pnlPct ?? 0) >= 0 ? "+" : ""}${(crossedOn.pnlPct ?? 0).toFixed(2)}%`,
    `🧠 Risk check: consecutive losses + DCA usage on /ai — consider pausing auto.`,
  ].join("\n");
