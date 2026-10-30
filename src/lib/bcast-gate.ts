// ─── Bcast gate — MỘT thuật toán chấm chất lượng dùng chung ──────────────────
// "phải dùng chung thuật toán và chung 1 database tại backend chứ!!"
//
// Trước đây panel hiển thị mọi combo quét còn Telegram tự chấm theo cổng riêng
// → hai bên nói hai thứ tiếng. Giờ đây mọi combo quét đều được chấm ĐÚNG MỘT
// LẦN bằng gateRow() dưới đây — phán quyết upsert vào bảng BcastVerdict của
// custom.db; Telegram chỉ đăng combo "pass", panel đọc cùng bảng đó qua
// GET /api/engine → "bcast". Không thể lệch nhau vì không có thuật toán thứ hai.

import type { ScanRow } from "./autotrade";

// ── cổng chất lượng (bản user setpoint 31/10: 70 / 0.8 / 80) ─────────────────
export const BCAST_VOL_MIN = 7e6; // $7M 24h quote volume
export const BCAST_PL1_MIN = 5; // TP1 ≥ +5% từ entry
export const BCAST_TOP_N = 2; // coins mỗi tin
/** Điểm tối thiểu để đăng broadcast — scoreOf = (AUC−0.5)×100 + (ACC−50) + tin cậy×15.
 *  User siết 70: chỉ AUC ≥ .8 · ACC ≥ 80 mới đạt sàn dưới (30+30), nên điểm 70
 *  còn yêu cầu tin cậy ≥ ~2/3. Kênh gần như chắc chắn im lặng — im lặng vẫn hơn rác. */
export const BCAST_SCORE_MIN = 70;
/** Sàn AUC của model — 0.8 nghĩa là model phải xếp hạng thật sự giỏi trên tập
 *  validation (out-of-sample), chỉ hơn tung đồng xu là không đủ tin. */
export const BCAST_AUC_MIN = 0.8;
/** Sàn ACC của model — dưới 80% không đủ tin theo ngưỡng user đặt. */
export const BCAST_ACC_MIN = 80;
/** Chống lặp: 1 coin (mọi khung giờ) chỉ được broadcast lại sau mỗi 3 giờ.
 *  RUNE 30m xuất hiện 4 lần trong 15 phút (4:11/4:15/4:21/4:25) vì `seen` cũ
 *  chỉ dùng để tag ⚡NEW chứ không chặn re-pick — đây là bản vá. */
export const BCAST_REPEAT_MS = 3 * 60 * 60_000;
/** Chống tín hiệu tự mâu thuẫn: EMA stack mạnh ngược hướng lệnh (kéo dao rơi /
 *  đuổi trần) và áp lực mua bán lệch hẳn phía bên kia đều bị loại. */
export const PRESSURE_FLOOR_LONG = 42; // BUY bị chặn khi áp lực mua ≤ 42%
export const PRESSURE_CAP_SHORT = 58; // SELL bị chặn khi áp lực mua ≥ 58%

/** Ms còn lại trước khi một coin được broadcast lại (0 = được ngay). */
export function bcastRepeatLeftMs(lastMs: number | undefined, now = Date.now()): number {
  if (!lastMs || lastMs <= 0) return 0;
  return Math.max(0, lastMs + BCAST_REPEAT_MS - now);
}

export interface GateCtx {
  now: number;
  /** symbol → epoch-ms lần broadcast cuối (state scan-bcast.json) */
  lastB: Record<string, number>;
  /** top-30 universe 8h — ngoài tập này là loại */
  uniSyms?: Set<string>;
  /** quoteVolume 24h từ ticker (khi có — pre-filter trước khi trả tiền fetch kline) */
  tickerVol?: number;
}

export interface GateVerdict {
  pass: boolean;
  /** lý do loại, tiếng Việt ngắn — hiện thẳng trên panel + pm2 log */
  reason: string;
}

/**
 * Cổng DUY NHẤT cho broadcast. Thứ tự kiểm tra từ rẻ tới đắt:
 * universe → AUC → ACC → điểm → PL1 → volume → cooldown.
 * (Coherence EMA/MACD/áp lực nằm ở bước enrich có kline — passesCoherence()
 * cũng nằm trong module này nên vẫn là một nguồn.)
 */
export function gateRow(r: ScanRow, ctx: GateCtx): GateVerdict {
  if (ctx.uniSyms && !ctx.uniSyms.has(r.symbol)) {
    return { pass: false, reason: "ngoài top-30 universe 8h" };
  }
  if (r.auc < BCAST_AUC_MIN) return { pass: false, reason: `AUC ${r.auc.toFixed(2)} < ${BCAST_AUC_MIN}` };
  if (r.acc < BCAST_ACC_MIN) return { pass: false, reason: `ACC ${r.acc.toFixed(0)}% < ${BCAST_ACC_MIN}%` };
  if (r.score < BCAST_SCORE_MIN) return { pass: false, reason: `điểm ${r.score.toFixed(1)} < ${BCAST_SCORE_MIN}` };
  if (r.tpPct < BCAST_PL1_MIN) return { pass: false, reason: `PL1 ${r.tpPct.toFixed(1)}% < ${BCAST_PL1_MIN}%` };
  if (ctx.tickerVol != null && ctx.tickerVol > 0 && ctx.tickerVol < BCAST_VOL_MIN) {
    return { pass: false, reason: `vol24h $${(ctx.tickerVol / 1e6).toFixed(1)}M < $${(BCAST_VOL_MIN / 1e6).toFixed(0)}M` };
  }
  const left = bcastRepeatLeftMs(ctx.lastB[r.symbol], ctx.now);
  if (left > 0) return { pass: false, reason: `cooldown còn ${(left / 60_000).toFixed(0)}p` };
  return { pass: true, reason: "" };
}

export interface CoherenceInput {
  long: boolean;
  emaKind: "up" | "down" | "flat";
  emaStrong: boolean;
  macdDir: "buy" | "sell" | "flat";
  buyPressure: number;
}

/**
 * Bộ lọc tín hiệu tự mâu thuẫn — trả về lý do loại, hoặc null khi đạt.
 *
 * 1) "Kéo dao rơi": BUY khi EMA stack downtrend MẠNH (9<21<50), hay SELL khi
 *    uptrend MẠNH — lệnh đâm thẳng vào trend đã thiết lập. Model có thể tìm
 *    edge mean-reversion, nhưng broadcast cho người đọc thì message khoe
 *    "Downtrend mạnh" cạnh gợi ý BUY chỉ đáng mất niềm tin (PEPE 15m 4:11,
 *    PEPE 1h 4:21 — hai chiều ngược nhau trong 10 phút).
 * 2) Áp lực mua bán nghịch cực đoan: BUY khi taker-bản chiếm ≥58% (pressure
 *    ≤42%) hay SELL khi taker-mua chiếm ≥58% — phe kia đang áp đảo hoàn toàn.
 */
export function passesCoherence(i: CoherenceInput): string | null {
  if (i.long && i.emaKind === "down" && i.emaStrong) return "EMA downtrend mạnh mà gợi BUY (kéo dao rơi)";
  if (!i.long && i.emaKind === "up" && i.emaStrong) return "EMA uptrend mạnh mà gợi SELL (đuổi trần)";
  if (i.long && i.buyPressure <= PRESSURE_FLOOR_LONG)
    return `áp lực mua chỉ ${i.buyPressure.toFixed(1)}% mà gợi BUY`;
  if (!i.long && i.buyPressure >= PRESSURE_CAP_SHORT)
    return `áp lực mua tới ${i.buyPressure.toFixed(1)}% mà gợi SELL`;
  return null;
}
