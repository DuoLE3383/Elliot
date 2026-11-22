// ─── tf-stats — lệnh đóng theo KHUNG GIỜ + calibration prob↔thật (0.2.79) ────
// Audit 04/11 yêu cầu: "Break your results down by timeframe, with fees and
// funding separated out" + "Compare the live hit rate to predicted probability
// bucket by bucket (calibration)". Thư viện THUẦN (không DB, không fs) để test
// đối chứng tay được; scripts/stats-tf.mts nạp DB thật rồi gọi.
//
// QUAN TRỌNG — ROI GROSS TÍNH LẠI TỪ GIÁ, không đọc pnlPct lưu trong DB:
// lệnh đóng TRƯỚC 0.2.77 lưu pnlPct GROSS (chưa trừ phí), từ 0.2.77 là NET —
// trộn hai đời số trong một bảng là tự hoa mắt. Gross = biến động giá × lev
// tính từ entryPrice/exitPrice/side (đồng nhất mọi phiên bản); phí =
// feeRoi(lev, 2) — ĐÚNG công thức settlement engine đang chạy (FEE_PCT đọc
// runtime pval); net = max(−100, gross − fee) — thanh lý chốt −100 (margin
// sạch, phí không còn gì để ăn). Funding CHƯA được mô hình hoá — output ghi
// rõ, không giả vờ có số.

import { INTERVALS } from "./types";
import { feeRoi } from "./params";

/** Đầu vào tối giản của MỘT lệnh đã đóng — map thẳng từ AutoTrade DB row. */
export interface TfTradeRow {
  symbol: string;
  interval: string;
  side: string;
  entryPrice: number;
  exitPrice: number | null;
  leverage: number;
  stakePct: number | null;
  prob: number | null;
  /** pnlPct lưu trong DB (phiên bản-dependent — CHỈ để đối chiếu chéo) */
  pnlPct: number | null;
  exitKind: string | null;
  entryTime: Date;
  exitTime: Date | null;
}

/** ROI phân rã của một lệnh: gross (giá) / fee (2 bên taker) / net. */
export interface TfRowRoi {
  /** biến động giá × leverage, % ROI (thanh lý kẹp −100) */
  gross: number;
  /** phí round-trip 2 bên, % ROI (dương — số bị trừ) */
  fee: number;
  /** gross − fee, sàn −100 */
  net: number;
  /** true = margin bị quét (biến động ngược chiều chạm 100/lev) */
  isLiq: boolean;
}

const r2 = (x: number): number => Math.round(x * 100) / 100;

/** Phân rã ROI một lệnh từ GIÁ (version-independent) — xem header file. */
export function rowRoi(r: Pick<TfTradeRow, "side" | "entryPrice" | "exitPrice" | "leverage">): TfRowRoi {
  const lev = r.leverage > 0 ? r.leverage : 1;
  if (!(r.entryPrice > 0) || r.exitPrice == null || !(r.exitPrice > 0)) {
    return { gross: 0, fee: 0, net: 0, isLiq: false }; // thiếu giá — không đoán mò
  }
  const move =
    r.side === "SHORT"
      ? ((r.entryPrice - r.exitPrice) / r.entryPrice) * 100
      : ((r.exitPrice - r.entryPrice) / r.entryPrice) * 100;
  // thanh lý: biến động NGƯỢC chiều chạm 100/lev % (đúng ngưỡng closeTradeDirect)
  const adverse = -move;
  const isLiq = lev > 1 && adverse >= 100 / lev - 1e-9;
  const gross = isLiq ? -100 : move * lev;
  const fee = feeRoi(lev, 2);
  const net = Math.max(-100, gross - fee);
  return { gross: r2(gross), fee: r2(fee), net: r2(net), isLiq };
}

/** Thống kê một khung giờ (mọi lệnh đóng trên mọi symbol của khung đó). */
export interface TfStat {
  interval: string;
  /** số lệnh đóng */
  n: number;
  /** số lệnh net > 0 (sau phí) */
  wins: number;
  winRate: number;
  /** Σ gross ROI % */
  grossRoi: number;
  /** Σ phí ROI % (dương) */
  feeRoi: number;
  /** Σ net ROI % */
  netRoi: number;
  /** net ROI trung bình mỗi lệnh */
  avgNet: number;
  /** đòn bẩy trung bình */
  avgLev: number;
  /** stake % trung bình */
  avgStake: number;
  /** thời gian giữ lệnh trung bình, phút (null khi thiếu exitTime) */
  avgHoldMin: number | null;
  /** đếm theo exitKind (tp | sl | flip | trail | manual) */
  exits: Record<string, number>;
  /** Σ net ROI riêng lệnh FLIP — theo dõi chỗ chảy máu */
  flipNet: number;
  /** equity chain (nếu muốn quy ROI → % vốn: mỗi lệnh × stakePct) */
  netEquityPct: number;
}

/** Gộp MỘT danh sách lệnh thành 1 dòng thống kê (dùng cho cả per-TF và ALL). */
function aggregate(interval: string, list: TfTradeRow[]): TfStat {
  let wins = 0;
  let gross = 0;
  let fee = 0;
  let net = 0;
  let levSum = 0;
  let stakeSum = 0;
  let stakeN = 0;
  let holdSum = 0;
  let holdN = 0;
  const exits: Record<string, number> = {};
  let flipNet = 0;
  let equity = 0;
  for (const r of list) {
    const roi = rowRoi(r);
    gross += roi.gross;
    fee += roi.fee;
    net += roi.net;
    if (roi.net > 0) wins++;
    levSum += r.leverage > 0 ? r.leverage : 1;
    if (r.stakePct != null) {
      stakeSum += r.stakePct;
      stakeN++;
    }
    if (r.exitTime && r.entryTime) {
      const mins = (r.exitTime.getTime() - r.entryTime.getTime()) / 60_000;
      if (mins >= 0) {
        holdSum += mins;
        holdN++;
      }
    }
    const k = r.exitKind ?? "other";
    exits[k] = (exits[k] ?? 0) + 1;
    if (k === "flip") flipNet += roi.net;
    equity += (roi.net * (r.stakePct ?? 0)) / 100;
  }
  const n = list.length;
  return {
    interval,
    n,
    wins,
    winRate: Math.round((wins / n) * 1000) / 10,
    grossRoi: r2(gross),
    feeRoi: r2(fee),
    netRoi: r2(net),
    avgNet: r2(net / n),
    avgLev: r2(levSum / n),
    avgStake: stakeN > 0 ? r2(stakeSum / stakeN) : 0,
    avgHoldMin: holdN > 0 ? Math.round(holdSum / holdN) : null,
    exits,
    flipNet: r2(flipNet),
    netEquityPct: r2(equity),
  };
}

/** Phân tích theo khung giờ — trả về theo thứ tự INTERVALS, khung lạ đứng cuối. */
export function tfBreakdown(rows: TfTradeRow[]): TfStat[] {
  const byTf = new Map<string, TfTradeRow[]>();
  for (const r of rows) {
    const l = byTf.get(r.interval);
    if (l) l.push(r);
    else byTf.set(r.interval, [r]);
  }
  const order = [...INTERVALS, ...[...byTf.keys()].filter((i) => !(INTERVALS as readonly string[]).includes(i)).sort()];
  const out: TfStat[] = [];
  for (const interval of order) {
    const list = byTf.get(interval);
    if (!list || list.length === 0) continue;
    out.push(aggregate(interval, list));
  }
  return out;
}

/** Một bucket calibration — model TỪNG nói tự tin cỡ nào vs thắng THẬT cỡ nào. */
export interface CalBucket {
  /** cận dưới bucket (inclusive) */
  lo: number;
  /** cận trên bucket (exclusive; bucket cuối là catch-all) */
  hi: number;
  n: number;
  /** pWin trung bình model tuyên bố, % */
  avgPred: number;
  /** tỉ lệ thắng thật (net > 0), % */
  winRate: number;
  /** winRate − avgPred, điểm % (âm = model NÓI THÁI) */
  gap: number;
}

/** Ranh giới bucket pWin (trailing catch-all ở cuối) — bước 0.05 từ 0.55. */
export const CAL_EDGES = [0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 1.01] as const;

/** Calibration: bucket pWin lúc vào lệnh (LONG: prob, SHORT: 1−prob — prob là
 *  P(lên)) đối chiếu tỉ lệ thắng thật SAU PHÍ. Bảng gap âm đồng loạt = model
 *  over-confident (hoặc leakage/label-mismatch — đúng chẩn đoán cần kiểm tra). */
export function calibrationBuckets(rows: TfTradeRow[]): CalBucket[] {
  const pts = rows
    .filter((r) => r.prob != null && r.exitPrice != null)
    .map((r) => ({ p: r.side === "SHORT" ? 1 - (r.prob as number) : (r.prob as number), win: rowRoi(r).net > 0 }))
    .filter((x) => x.p > 0.5); // dưới 0.5 = model tự nói ngược phía — không bucket
  const out: CalBucket[] = [];
  for (let i = 0; i < CAL_EDGES.length - 1; i++) {
    const lo = CAL_EDGES[i];
    const hi = CAL_EDGES[i + 1];
    const b = pts.filter((x) => x.p >= lo && x.p < hi);
    if (b.length === 0) continue;
    const avg = b.reduce((a, x) => a + x.p, 0) / b.length;
    const wr = (b.filter((x) => x.win).length / b.length) * 100;
    out.push({
      lo,
      hi,
      n: b.length,
      avgPred: Math.round(avg * 1000) / 10,
      winRate: Math.round(wr * 10) / 10,
      gap: Math.round((wr - avg * 100) * 10) / 10,
    });
  }
  return out;
}

/** Tổng toàn bộ lệnh (dòng "ALL") — cùng phép gộp, không lấy trung bình của
 *  các trung bình (hold/stake tính trực tiếp từ từng lệnh). */
export function tfTotal(rows: TfTradeRow[]): TfStat {
  if (rows.length === 0) {
    return {
      interval: "ALL",
      n: 0,
      wins: 0,
      winRate: 0,
      grossRoi: 0,
      feeRoi: 0,
      netRoi: 0,
      avgNet: 0,
      avgLev: 0,
      avgStake: 0,
      avgHoldMin: null,
      exits: {},
      flipNet: 0,
      netEquityPct: 0,
    };
  }
  return aggregate("ALL", rows);
}
