// ─── UT strategy (bản gốc) — pure helpers cho chế độ strategy="ut" ───────────
//
// 0.2.69 — dry run quay lại CHIẾN THUẬT GỐC trước khi fine-tune: engine vào
// lệnh bằng đúng luật mà papers.ts (bộ mô phỏng "mirrors the Pine strategy")
// đã dịch từ Pine gốc của UT Bot Alerts:
//
//   • TÍN HIỆU  — utTrail (ATR trailing-stop lật chiều, a=atrKey, c=atrPeriod):
//     trend −1 → +1 là BUY, +1 → −1 là SELL. Tín hiệu xác nhận lúc ĐÓNG nến.
//   • VÀO LỆNH  — ở giá mở của nến NGAY SAU nến tín hiệu (live: giá thị trường
//     tại lúc engine thấy tín hiệu). Lệnh MỚI từ chỗ không có vị thế có thể bị
//     SMA gate chặn (nếu smaFilter bật — mặc định của bản gốc là TẮT).
//   • TP/SL     — % CỐ ĐỊNH trên giá (settings.slPct/tpPct — Pine gốc 1.5/3,
//     mặc định app 6/3.2), đối chiếu từng nến, SL ưu tiên khi cả hai cùng chạm.
//   • LẬT CHIỀU — tín hiệu NGƯỢC phía lệnh đang mở là reversal: LUÔN đóng lệnh
//     cũ và mở lệnh ngược chiều, SMA gate không bao giờ chặn flip.
//   • KHÁC      — pyramiding 0 (tín hiệu cùng hướng bị bỏ qua); đòn bẩy > 1 có
//     thanh lý cách nhau 100%/đòn % giá bất lợi.
//
// File này THUẦN (không fs/db/fetch) — engine.ts dùng nó cho vòng live, test
// dùng nó để đối chiếu 1-1 với papersFrom trên nến thật.

import type { EngineSettings, Kline, Signal } from "./types";

export type UtSide = "LONG" | "SHORT";

/** "BUY" → LONG, "SELL" → SHORT (đúng sideOf của papers.ts). */
export const utSideOf = (dir: "BUY" | "SELL"): UtSide => (dir === "BUY" ? "LONG" : "SHORT");

/**
 * Tín hiệu đã xác nhận MỚI NHẤT — chỉ tính nến ĐÃ ĐÓNG (papers.ts bỏ tín hiệu
 * trên nến đang hình thành: `if (!sig || i >= last) continue`).
 * `formingIndex` = index nến đang hình thành (klines.length − 1).
 */
export function latestConfirmedSignal(signals: Signal[], formingIndex: number): Signal | null {
  for (let i = signals.length - 1; i >= 0; i--) {
    if (signals[i].i < formingIndex) return signals[i];
  }
  return null;
}

/**
 * SMA gate cho MỘT nến đã đóng — mirror gateOkAt của papers.ts:
 *  • smaFilter tắt → mọi lệnh qua.
 *  • SMA chưa đủ dữ liệu (đầu cửa sổ) → KHÔNG chặn (Pine tính SMA trên full
 *    history — null ở đây là artifact của cửa sổ 500 nến, không phải tín hiệu).
 *  • LONG cần close > SMA, SHORT cần close < SMA.
 */
export function utGateOk(side: UtSide, close: number, smaVal: number | null, smaFilter: boolean): boolean {
  if (!smaFilter) return true;
  if (smaVal == null) return true;
  return side === "LONG" ? close > smaVal : close < smaVal;
}

/** SL/TP (%) chế độ ut giao dịch — luôn từ EngineSettings của trang chính
 *  (một nguồn với biểu đồ: những gì user thấy trên chart là những gì bot đánh). */
export function utLevels(s: EngineSettings): { slPct: number; tpPct: number } {
  return { slPct: Math.abs(s.slPct), tpPct: Math.abs(s.tpPct) };
}

// ─── Readout của MỘT combo (symbol × khung) ──────────────────────────────────

export interface UtReadout {
  /** `SYM|TF` — khoá state utSeen/utPending */
  key: string;
  symbol: string;
  interval: string;
  /** tín hiệu đã xác nhận mới nhất (bất kể mới/cũ) — null nếu cửa sổ không có */
  latest: Signal | null;
  /** thời điểm mở nến đang hình thành — mốc ARM cho combo mới nhìn thấy lần đầu */
  formingTime: number;
  /** giá đóng của nến ĐÃ ĐÓNG cuối cùng — đầu vào của gate chờ (pending) */
  lastClose: number;
  /** SMA tại nến đã đóng cuối cùng */
  smaVal: number | null;
}

export function utReadoutOf(symbol: string, interval: string, klines: Kline[], signals: Signal[], sma: (number | null)[]): UtReadout {
  const formingIndex = klines.length - 1; // nến cuối vẫn đang hình thành
  const closedIndex = formingIndex - 1;
  return {
    key: `${symbol}|${interval}`,
    symbol,
    interval,
    latest: latestConfirmedSignal(signals, formingIndex),
    formingTime: klines[formingIndex]?.t ?? 0,
    lastClose: closedIndex >= 0 ? klines[closedIndex].c : 0,
    smaVal: closedIndex >= 0 ? (sma[closedIndex] ?? null) : null,
  };
}

// ─── Quyết định flip cho lệnh đang mở (pure) ────────────────────────────────

export type UtFlipAction =
  | { action: "none" } // không có tín hiệu mới → giữ lệnh
  | { action: "ignore" } // tín hiệu cùng hướng → pyramiding 0, bỏ qua
  | { action: "flip"; side: UtSide }; // tín hiệu ngược → ĐÓNG + MỞ NGƯỢC

/** Bản gốc: tín hiệu ngược phía lệnh đang mở = reversal LUÔN (không gate,
 *  không model, không LLM). `seen` = thời điểm mở nến tín hiệu ĐÃ xử lý gần
 *  nhất của combo; tín hiệu chỉ "mới" khi `t > seen`. */
export function utFlipDecision(openSide: UtSide, sig: Signal | null, seen: number): UtFlipAction {
  if (!sig || sig.t <= seen) return { action: "none" };
  const side = utSideOf(sig.dir);
  return side === openSide ? { action: "ignore" } : { action: "flip", side };
}
