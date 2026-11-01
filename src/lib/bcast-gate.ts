// ─── Bcast gate — MỘT thuật toán chấm chất lượng dùng chung ──────────────────
// "phải dùng chung thuật toán và chung 1 database tại backend chứ!!"
//
// Trước đây panel hiển thị mọi combo quét còn Telegram tự chấm theo cổng riêng
// → hai bên nói hai thứ tiếng. Giờ đây mọi combo quét đều được chấm ĐÚNG MỘT
// LẦN bằng gateRow() dưới đây — phán quyết upsert vào bảng BcastVerdict của
// custom.db; Telegram chỉ đăng combo "pass", panel đọc cùng bảng đó qua
// GET /api/engine → "bcast". Không thể lệch nhau vì không có thuật toán thứ hai.

import type { ScanRow } from "./autotrade";
import {
  BCAST_ACC_MIN,
  BCAST_AUC_MIN,
  BCAST_PL1_MIN,
  BCAST_REPEAT_MS,
  BCAST_SCORE_MIN,
  BCAST_VOL_MIN,
  PRESSURE_CAP_SHORT,
  PRESSURE_FLOOR_LONG,
} from "./params";

// ── Tham số config của gate sống ở ./params — MỘT nguồn định nghĩa; re-export
// để scan-broadcast/test import từ đây không đổi path (re-export không tạo
// bản sao nên vẫn là một nguồn).
export {
  BCAST_ACC_MIN,
  BCAST_AUC_MIN,
  BCAST_PL1_MIN,
  BCAST_REPEAT_MS,
  BCAST_SCORE_MIN,
  BCAST_TOP_N,
  BCAST_VOL_MIN,
  PRESSURE_CAP_SHORT,
  PRESSURE_FLOOR_LONG,
} from "./params";

/** Bộ ba setpoint chung (engine truyền từ cfg — panel chỉnh một chỗ) */
export interface QualSp {
  score: number;
  auc: number;
  acc: number;
}

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
  /** ngưỡng chất lượng chung từ cfg — KHÔNG truyền → dùng BCAST_* mặc định.
   *  Cùng bộ ba này còn được isTradeable() dùng lúc mở lệnh/bù DCA. */
  sp?: QualSp;
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
  const sp = ctx.sp ?? { score: BCAST_SCORE_MIN, auc: BCAST_AUC_MIN, acc: BCAST_ACC_MIN };
  if (ctx.uniSyms && !ctx.uniSyms.has(r.symbol)) {
    return { pass: false, reason: "ngoài top-30 universe 8h" };
  }
  if (r.auc < sp.auc) return { pass: false, reason: `AUC ${r.auc.toFixed(2)} < ${sp.auc}` };
  if (r.acc < sp.acc) return { pass: false, reason: `ACC ${r.acc.toFixed(0)}% < ${sp.acc}%` };
  if (r.score < sp.score) return { pass: false, reason: `điểm ${r.score.toFixed(1)} < ${sp.score}` };
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
