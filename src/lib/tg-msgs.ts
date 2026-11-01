// ─── tg-msgs — Telegram message builders for the auto engine (HTML mode) ─────
// Shared by the browser toasts/relays (auto-panel) AND the backend engine
// scheduler (engine.ts) so open/close/near/veto messages are byte-identical
// no matter who fires them. Pure string builders — no fetch, no storage.

import { fmtPrice } from "./i18n";
import { roeOf, type AutoTradeRow, type ScanRow } from "./autotrade";
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
    ? `Prob ${(p * 100).toFixed(1)}% theo phía LONG 🟢`
    : side === "SHORT"
      ? `Prob ${(p * 100).toFixed(1)}% theo phía SHORT 🔴`
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
  const lines = [
    `🤖 <b>AUTO OPEN (dry-run) · ${r.side === "LONG" ? "LONG 🟢" : "SHORT 🔴"}</b>`,
    `📌 <b>#${r.symbol}</b> · ${r.interval}`,
    HR,
    `🎯 Entry: <b>${fmtPrice(r.entryPrice)}</b>`,
    `🛑 SL: <b>${fmtPrice(slPrice(r.side, r.entryPrice, r.slPct))}</b> · −${r.slPct.toFixed(1)}% giá (ROE ${slRoe.toFixed(1)}% @ ${levTxt(r.leverage)})`,
    `🏁 TP: <b>${fmtPrice(tpPrice(r.side, r.entryPrice, r.tpPct))}</b> · +${r.tpPct.toFixed(1)}% giá (ROE +${tpRoe.toFixed(1)}% @ ${levTxt(r.leverage)})`,
  ];
  if (atrNote) lines.push(atrNote);
  lines.push(
    `⚖️ Leverage ${levTxt(r.leverage)} · R:R 1:${rr.toFixed(2)}`,
    `📦 Stake: <b>${stake.toFixed(2)}</b> USDT · ${r.stakePct ?? 100}% equity · Notional ${notional.toFixed(2)} USDT`,
    `🧠 ${probTxt(r.side, r.prob ?? 0)} · AUC ${(r.auc ?? 0).toFixed(2)} · ACC ${(r.acc ?? 0).toFixed(1)}% · Score ${(r.score ?? 0).toFixed(1)}`,
  );
  return lines.join("\n");
};

const kindTag = (k: string | null): string =>
  k === "tp" ? "TAKE PROFIT ✅" : k === "sl" ? "STOP LOSS 🔻" : k === "flip" ? "LẬT CHIỀU 🔄" : "ĐÓNG THỦ CÔNG ✋";

export const msgClose = (r: AutoTradeRow, closed: number, winRate: number, netPnlPct: number): string =>
  [
    `🤖 <b>AUTO CLOSE · ${kindTag(r.exitKind)}</b>`,
    `📌 <b>#${r.symbol}</b> · ${r.interval} · ${sideTxt(r.side)}`,
    HR,
    `🎯 Entry ${fmtPrice(r.entryPrice)} → 🚪 Exit <b>${fmtPrice(r.exitPrice ?? 0)}</b>`,
    `💵 PnL (ROE): <b>${(r.pnlPct ?? 0) >= 0 ? "+" : ""}${(r.pnlPct ?? 0).toFixed(2)}%</b>`,
    `💰 Equity: ${(r.capitalBefore ?? 0).toFixed(2)} → <b>${(r.capitalAfter ?? 0).toFixed(2)}</b> USDT`,
    `📈 Track record: ${closed} lệnh · Win rate ${winRate.toFixed(0)}% · Net ROE ${netPnlPct >= 0 ? "+" : ""}${netPnlPct.toFixed(1)}%`,
  ].join("\n");

export const msgNear = (r: AutoTradeRow, price: number, kind: "tp" | "sl"): string => {
  const target = kind === "tp" ? tpPrice(r.side, r.entryPrice, r.tpPct) : slPrice(r.side, r.entryPrice, r.slPct);
  const awayPct = price > 0 ? Math.abs((target - price) / price) * 100 : 0;
  const roe = roeOf(r.side, r.entryPrice, price, r.leverage);
  return [
    kind === "tp" ? "⚠️ <b>GIÁ SÁT TAKE PROFIT — SẴN SÀNG CHỐT LỜI</b>" : "⚠️ <b>GIÁ SÁT STOP LOSS — THEO DÕI RỦI RO</b>",
    `📌 <b>#${r.symbol}</b> · ${r.interval} · ${sideTxt(r.side)}`,
    HR,
    `${kind === "tp" ? "🏁" : "🛑"} ${kind === "tp" ? "Take Profit" : "Stop Loss"} ${fmtPrice(target)} · còn <b>${awayPct.toFixed(2)}%</b>`,
    `📈 Giá ${fmtPrice(price)} · ROE <b>${roe >= 0 ? "+" : ""}${roe.toFixed(1)}%</b> · Lev ${levTxt(r.leverage)}`,
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
    `🤖 <b>AUTO DCA (dry-run) · bù lệnh lần ${add}/${max}${trigger === "cross" ? " · ngay tại SL" : ""}</b>`,
    `📌 <b>#${r.symbol}</b> · ${r.interval} · ${sideTxt(r.side)}`,
    HR,
    `🎯 Entry ${fmtPrice(prevEntry)} → thêm <b>${fmtPrice(dcaPrice)}</b> (${movedPct.toFixed(2)}% giá)`,
    `📊 Entry bình quân mới: <b>${fmtPrice(r.entryPrice)}</b>`,
    `🛑 SL mới: <b>${fmtPrice(slPrice(r.side, r.entryPrice, r.slPct))}</b> · −${r.slPct.toFixed(1)}% giá từ avg`,
    `🏁 TP mới: <b>${fmtPrice(tpPrice(r.side, r.entryPrice, r.tpPct))}</b> · +${r.tpPct.toFixed(1)}% giá từ avg`,
    `📦 Stake: <b>${stake.toFixed(2)}</b> USDT · ${r.stakePct ?? 100}% equity · Notional ${notional.toFixed(2)} USDT`,
    `📈 ROE tại giá DCA: ${roe >= 0 ? "+" : ""}${roe.toFixed(1)}% @ ${levTxt(r.leverage)}`,
    `🧠 Model vẫn xác nhận · ${probTxt(r.side, confirm.prob)} · AUC ${confirm.auc.toFixed(2)} · ACC ${confirm.acc.toFixed(1)}%`,
  ].join("\n");
};

/** LLM veto notice — the pending entry was reviewed and rejected by the local model */
export const msgLlmVeto = (r: ScanRow, v: LlmVerdict): string =>
  [
    `🛑 <b>LLM VETO — setup bị chặn trước khi vào lệnh</b>`,
    `📌 <b>#${r.symbol}</b> · ${r.interval} · ${sideTxt(r.bias)}`,
    HR,
    `🧠 ${probTxt(r.bias, r.prob)} · AUC ${r.auc.toFixed(2)} · ACC ${r.acc.toFixed(1)}% · Score ${r.score.toFixed(1)}`,
    `💬 ${escHtml(v.reasons.slice(0, 3).join(" · ")) || "—"}`,
  ].join("\n");

/**
 * Autopsy notice — lệnh ĐÃ ĐÓNG được LLM mổ xẻ (cả thắng lẫn thua): tag chế độ
 * thắng/thua + bài học + các why trích số. Tham số khai báo structural (không
 * import autopsy.ts) để tránh vòng import — đủ hình dạng là ghép được.
 */
export const msgAutopsy = (
  t: { symbol: string; interval: string; side: string; exitKind?: string | null; pnlPct?: number | null },
  a: { outcome: string; tag: string; why: string[]; lesson: string; ev?: { rMultiple?: number; durMin?: number; mfePct?: number; maePct?: number }; ms?: number; model?: string },
): string =>
  [
    `🔬 <b>GIẢI PHẪU LỆNH · ${a.outcome === "win" ? "THẮNG ✅" : "THUA 🔻"}</b>`,
    `📌 <b>#${t.symbol}</b> · ${t.interval} · ${sideTxt(t.side)} · ${kindTag(t.exitKind ?? null)}`,
    HR,
    `💵 Kết quả: <b>${(t.pnlPct ?? 0) >= 0 ? "+" : ""}${(t.pnlPct ?? 0).toFixed(2)}% ROE</b>${a.ev?.rMultiple != null ? ` · R ${a.ev.rMultiple >= 0 ? "+" : ""}${a.ev.rMultiple.toFixed(2)}x` : ""}${a.ev?.durMin != null ? ` · giữ ${a.ev.durMin.toFixed(0)}p` : ""}`,
    `🏷️ tag: <b>${escHtml(a.tag)}</b>`,
    ...(a.why.length > 0 ? [`📝 ${a.why.map((w) => escHtml(w)).join("<br/>• ")}`] : []),
    `💡 <b>Bài học:</b> ${escHtml(a.lesson)}`,
    `🧠 ${escHtml(a.model ?? "llm")}${a.ms ? ` · ${(a.ms / 1000).toFixed(1)}s` : ""} — bài học sẽ được nạp vào lần duyệt lệnh sau của cặp này`,
  ].join("\n");
