// ─── trade-mgmt — quản lý thoát lệnh sau khi vào (0.3.2) ─────────────────────
// Trả lời phản hồi thật của user: "các lệnh bị chốt sớm và SL non… tăng RR thì
// không bắt được lệnh nữa". Ba cơ chế, tất cả PURE (không IO, test được độc lập):
//
//   1. SL CONFIRM — SL không còn đóng ngay lần chạm đầu tiên: giá phải vượt SL
//      trong ≥ slConfirmTicks lần đo liên tiếp (watcher 20s/lần) HOẶC vượt sâu
//      ≥ SL_DEEP_FRAC × slPct thì mới chốt. Wick quét SL rồi quay đầu → lệnh sống
//      ("SL non" hết). Liquidation vẫn tức thời như cũ.
//
//   2. TP1 PARTIAL → RUNNER — chạm TP lần đầu KHÔNG đóng toàn bộ: chốt phần
//      share (mặc định 50%), phần còn lại thành runner với:
//        • SL dời về HOÀ VÃN (breakeven, trailPct = 0) — rủi ro = 0,
//        • TP mở rộng tpPct × runnerTpMult (mặc định ×2 → RR thật 1:2.8+),
//        • trail khoá lợi nhuận: mỗi lần giá chạy thuận hơn, khoá
//          move × runnerTrailLock (mặc định khoá 50% quãng đi), chỉ tăng dần.
//      → "chốt sớm" hết vì một nửa vẫn chạy tiếp; muốn RR cao không cần siết
//      cổng vào lệnh — runner chạy ra RR. Banked ROI nằm trên lệnh (p1Pct/
//      p1Share) và hợp nhất lúc đóng (combineClosePnl) — một lệnh vẫn một dòng
//      sổ, chuỗi vốn capitalBefore/After không phá vỡ.
//
//   3. COMBINE CLOSE — đóng giữa runner phase: ROI tổng = p1Share × p1Pct +
//      (1−p1Share) × phần còn lại. DCA đã xong trước TP1 thì stakePct giữ
//      nguyên trong runner phase (engine không DCA sau TP1) nên delta vốn tính
//      trực tiếp trên stakePct như cũ.
//
// Engine (engine.ts) là nơi duy nhất gọi DB/fetch — module này không import gì
// ngoài chuẩn, giữ thuần để `npx tsx scripts/test-trade-mgmt.ts` chạy nổi.

/** exitKind mới của runner đóng bởi trail/BE — thêm vào whitelist route +
 *  DIGEST_KIND + hist kinds (đã làm ở autotrade.ts / route.ts / stats.ts). */
export const TRAIL_KIND = "trail";

/** Chạm SL phải vượt sâu ≥ 15% bề rộng stop mới đóng NGAY không chờ confirm. */
export const SL_DEEP_FRAC = 0.15;

/** Trail ROI (B) — arm: đỉnh ROI vượt mức này (%) mới bắt đầu dời trail. */
export const TRAIL_ROI_ARM = 4;
/** Trail ROI (B) — đuổi theo: stop bám đỉnh, nhường lại đúng số % ROI này
 *  (spec user 0.3.40: "ROI > 3% dời trail tới 2% rồi đuổi theo ROI"). */
export const TRAIL_ROI_GIVEBACK = 1;

// ─── 1 · SL confirm — wick một nhịp không còn quét sạch stop ─────────────────

export interface SlPending {
  id: string;
  since: number;
  /** giá lần đo đầu tiên thấy vượt SL — chỉ để log */
  price: number;
}

export interface SlConfirmStep {
  /** true = đủ bằng chứng chạm THẬT (giữ liên tục hoặc vượt sâu) → đóng */
  close: boolean;
  /** state mới cần lưu (null = xoá) */
  next: SlPending | null;
}

/**
 * Một bước máy trạng thái confirm SL — gọi mỗi nhịp watcher (mặc định 20s).
 *  • crossNow = giá ĐANG nằm ngoài SL phía bất lợi.
 *  • deepBreach = vượt sâu hơn SL_DEEP_FRAC × slPct — lỗ thật, không chờ.
 *  • confirmTicks ≤ 0 → tắt confirm: hành vi cũ, chạm là đóng ngay.
 *  • pending của LỆNH KHÁC (đổi vị thế) → đếm lại từ đầu.
 * Wick 1 nhịp (crossNow rồi hết) → next=null, không đóng — đúng mục tiêu.
 */
export function slConfirmStep(
  pending: SlPending | null,
  tradeId: string,
  now: number,
  crossNow: boolean,
  deepBreach: boolean,
  confirmTicks: number,
  tickMs = 20_000,
): SlConfirmStep {
  if (!crossNow) return { close: false, next: null };
  if (deepBreach) return { close: true, next: null };
  if (confirmTicks <= 0) return { close: true, next: null };
  if (confirmTicks === 1) return { close: true, next: null }; // 1 nhịp = chạm là đóng (hành vi cũ)
  const fresh: SlPending = { id: tradeId, since: now, price: 0 };
  const p = pending && pending.id === tradeId ? pending : fresh;
  // confirmTicks = số lần đo LIÊN TIẾP thấy vượt (lần đầu ghi pending là lần 1):
  // lần thứ N xảy ra khi elapsed ≥ (N−1)×tickMs — N=2 → lần đo thứ 2 (20s sau) đóng
  if (now - p.since >= (confirmTicks - 1) * tickMs) return { close: true, next: null };
  return { close: false, next: p };
}

// ─── 2 · Runner — BE/trail hit, ratchet khoá lời, TP2 ────────────────────────

/** Phía thuận hiện tại của lệnh, % GIÁ (không nhân đòn bẩy). */
export function movePct1x(side: string, entry: number, price: number): number {
  if (!entry || !price) return 0;
  return side === "SHORT" ? ((entry - price) / entry) * 100 : ((price - entry) / entry) * 100;
}

/**
 * Trail/BE stop hit — dùng trong runner phase (SAU TP1): stop không còn là
 * slPct dưới entry mà là mức KHOÁ LỜI trên entry (trailPct ≥ 0):
 *   LONG : hit khi price ≤ entry × (1 + trailPct/100)
 *   SHORT: hit khi price ≥ entry × (1 − trailPct/100)
 * trailPct = 0 chính là breakeven. Đóng với exitKind "trail".
 */
export function trailHit(side: string, price: number, entry: number, trailPct: number): boolean {
  if (!entry || !price) return false;
  const t = Math.max(0, trailPct);
  return side === "SHORT" ? price >= entry * (1 - t / 100) : price <= entry * (1 + t / 100);
}

/**
 * Ratchet khoá lời — CHỈ TĂNG: candidate = quãng đi thuận lần này × lock
 * (mặc định khoá 50% excursion). Giá tụt → giữ nguyên mức đã khoá. Round 3 số
 * lẻ (0.001% giá ≈ đủ mịn cho mọi cặp).
 */
export function trailRatchet(cur: number, move1x: number, lock: number): number {
  const candidate = Math.max(0, move1x) * Math.min(1, Math.max(0, lock));
  return Math.round(Math.max(cur, candidate) * 1000) / 1000;
}

/** TP2 — TP mở rộng của runner (price move %): tpPct × runnerTpMult, min = tp1. */
export function runnerTp2(tpPct: number, tpMult: number): number {
  return Math.round(Math.max(tpPct, tpPct * Math.max(1, tpMult)) * 1000) / 1000;
}

export interface Tp1Plan {
  /** phần CHỐT tại TP1, 0..1 (runnerSharePct/100) */
  share: number;
  /** ROI% banked lúc TP1 (= tpPct × leverage) */
  p1Pct: number;
  /** TP mở rộng của runner (price move %) */
  tp2Pct: number;
}

/**
 * Quyết định TP1 có chuyển runner không:
 *  • runnerOn bật + share hợp lệ (0 < share < 1)
 *  • KHÔNG chạy khi đã DCA (dcaCount > 0): avg đã dời, stake đã nhân đôi —
 *    ưu tiên chốt toàn bộ như cũ, không phức tạp thêm.
 * p1Pct tính từ mức TP HIỆN TẠI của lệnh (slTpHit đã xác nhận chạm).
 */
export function tp1Plan(cfg: { runnerOn: boolean; runnerSharePct: number; runnerTpMult: number }, tpPct: number, leverage: number, dcaCount: number): Tp1Plan | null {
  if (!cfg.runnerOn || dcaCount > 0) return null;
  const share = cfg.runnerSharePct / 100;
  if (!(share > 0 && share < 1)) return null;
  return { share, p1Pct: Math.round(tpPct * leverage * 100) / 100, tp2Pct: runnerTp2(tpPct, cfg.runnerTpMult) };
}

// ─── 3 · Combine close — hợp nhất phần đã bank với phần runner khi đóng ──────

/**
 * ROI tổng của lệnh có TP1 partial:
 *   total = share × p1Pct + (1 − share) × remPnl
 * share/p1Pct null → trả nguyên remPnl (lệnh thường). Round 2 số lẻ.
 */
export function combineClosePnl(p1Pct: number | null | undefined, p1Share: number | null | undefined, remPnl: number): number {
  if (p1Pct == null || p1Share == null || p1Share <= 0) return Math.round(remPnl * 100) / 100;
  const share = p1Share > 1 ? Math.min(1, p1Share / 100) : Math.min(1, Math.max(0, p1Share)); // chuan hoa: DB 0..1, cu 0..100
  const total = share * p1Pct + (1 - share) * remPnl;
  return Math.round(total * 100) / 100;
}
