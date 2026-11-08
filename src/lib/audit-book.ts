// ─── Audit-book — RÀ LẠI SỔ DRY-RUN, tính lại ROE từng lệnh đã đóng ───────────
//
// Bối cảnh (0.2.87): lịch sử dry-run là TÍCH của nhiều phiên bản công thức —
// trước 0.2.77 ROE gross (không phí), thanh lý có lúc không ép −100, DCA ghi
// entry bằng trung bình cộng (sai — bù cùng notional phải là trung bình điều
// hoà, sửa cùng bản này). Sổ vì thế trộn lẫn các lệnh tính theo "luật cũ" với
// lệnh tính theo "luật mới": thống kê win rate — nhất là phía SHORT, vốn hay
// đi kèm bù DCA — không còn phản ánh đúng hiệu quả thật.
//
// Công cụ này KHÔNG đổi luật: nó áp ĐÚNG công thức chốt hiện hành (0.2.77+,
// một nguồn với closeTradeDirect + PATCH /api/autotrade close) lên cặp
// (entryPrice, exitPrice, leverage, exitKind) ĐÃ LƯU của từng lệnh, rồi:
//   • audit  — liệt kê mọi dòng lệch (stored ≠ recomputed) + thống kê
//              LONG/SHORT tách biệt trước & sau khi chuẩn hoá;
//   • repair — ghi ROE đúng + TÍNH LẠI CHUỖI VỐN (capitalBefore/After chạy
//              lại theo thời gian, stake% × ROE) — sửa một dòng mà không
//              tái lập chuỗi vốn là sổ vẫn sai về equity.
//
// Thuần (không IO) — API route đọc DB rồi truyền vào; test chạy trực tiếp.

import { feeRoe } from "./params";

// ─── Kiểu đầu vào — struct tối thiểu, ăn khớp với AutoTradeRow ────────────────

export interface AuditTradeRow {
  id: string;
  side: string;
  status: string;
  entryPrice: number;
  exitPrice: number | null;
  leverage: number;
  stakePct: number | null;
  exitKind: string | null;
  pnlPct: number | null;
  capitalBefore: number | null;
  capitalAfter: number | null;
  createdAt: string | Date;
}

export interface AuditRowIssue {
  id: string;
  side: string;
  symbol?: string;
  interval?: string;
  exitKind: string | null;
  stored: number;
  expected: number;
  diff: number;
}

export interface AuditSideStat {
  side: "LONG" | "SHORT";
  closed: number;
  wins: number;
  winRate: number;
  netPnl: number;
  /** số lệnh của phía này bị tính sai theo công thức hiện hành */
  mismatched: number;
}

export interface AuditReport {
  total: number;
  closed: number;
  checked: number;
  ok: number;
  issues: AuditRowIssue[];
  /** thống kê theo phía — trước (sổ lưu) và sau (chuẩn hoá công thức hiện hành) */
  sides: { before: AuditSideStat[]; after: AuditSideStat[] };
  /** tổng ROE toàn sổ: trước vs sau chuẩn hoá */
  netBefore: number;
  netAfter: number;
}

// ─── Công thức chốt HIỆN HÀNH — một nguồn với closeTradeDirect / PATCH close ──
// (entry/exit lấy TỪ DÒNG ĐÃ LƯU — audit không đoán lại giá vào/ra, chỉ tính
// lại ROE đúng luật từ cùng cặp giá mà sổ ghi.)

/** ROE % kỳ vọng của một lệnh đã đóng theo công thức hiện hành (0.2.77+):
 *  move% × đòn bẩy − phí round-trip; thanh lý (di chuyển bất lợi chạm
 *  100/lev %) ép −100; không bao giờ dưới −100.
 *  0.2.88 — VÁ BUG ĐẢO DẤU: trước đây `adverse = -movePct` cho SHORT khiến
 *  điều kiện `adverse <= -(100/lev)` bắn vào lệnh SHORT THẮNG lớn (move ≥
 *  100/lev %) thay vì lệnh THUA đến hạn thanh lý — một SHORT ×5 thắng ≥20%
 *  giá bị ghi −100 liều mạng. Giờ dùng thẳng movePct ≤ −(100/lev), một nguồn
 *  với liquidationHit() của engine (autotrade.ts) — kiểm thử hồi quy ở
 *  scripts/test-audit-book.mts chốt cả 4 góc LONG/SHORT × thắng/thua. */
export function expectedPnlPctOf(row: Pick<AuditTradeRow, "side" | "entryPrice" | "exitPrice" | "leverage" | "exitKind">): number | null {
  const entry = row.entryPrice;
  const exit = row.exitPrice;
  const lev = row.leverage;
  if (!entry || !exit || !(lev > 0)) return null;
  const movePct = row.side === "SHORT" ? ((entry - exit) / entry) * 100 : ((exit - entry) / entry) * 100;
  let pnl = Math.round((movePct * lev - feeRoe(lev)) * 100) / 100;
  if (lev > 1 && movePct <= -(100 / lev)) pnl = -100;
  else if (pnl < -100) pnl = -100;
  return pnl;
}

const round2 = (v: number): number => Math.round(v * 100) / 100;

/** Đợt kiểm tra — trả báo cáo đầy đủ, KHÔNG đụng DB. */
export function auditBook(trades: AuditTradeRow[]): AuditReport {
  const closed = trades.filter((t) => t.status === "closed" && t.exitPrice != null && t.entryPrice > 0);
  const issues: AuditRowIssue[] = [];
  let ok = 0;
  for (const t of closed) {
    const expected = expectedPnlPctOf(t);
    if (expected == null) continue;
    const stored = t.pnlPct ?? 0;
    if (Math.abs(stored - expected) <= 0.005) {
      ok += 1;
      continue;
    }
    issues.push({
      id: t.id,
      side: t.side === "SHORT" ? "SHORT" : "LONG",
      symbol: (t as { symbol?: string }).symbol,
      interval: (t as { interval?: string }).interval,
      exitKind: t.exitKind ?? null,
      stored: round2(stored),
      expected,
      diff: round2(expected - stored),
    });
  }
  return {
    total: trades.length,
    closed: closed.length,
    checked: closed.length,
    ok,
    issues,
    sides: { before: sideStats(trades, false), after: sideStats(trades, true) },
    netBefore: round2(closed.reduce((a, t) => a + (t.pnlPct ?? 0), 0)),
    netAfter: round2(closed.reduce((a, t) => a + (expectedPnlPctOf(t) ?? t.pnlPct ?? 0), 0)),
  };
}

/** Thống kê theo phía — `fixed` = false dùng ROE đang lưu, true dùng ROE chuẩn. */
function sideStats(trades: AuditTradeRow[], fixed: boolean): AuditSideStat[] {
  const out: AuditSideStat[] = [];
  for (const side of ["LONG", "SHORT"] as const) {
    const rows = trades.filter((t) => t.status === "closed" && t.side === side && t.exitPrice != null && t.entryPrice > 0);
    const wins = rows.filter((t) => ((fixed ? expectedPnlPctOf(t) : t.pnlPct) ?? 0) > 0).length;
    const net = rows.reduce((a, t) => a + ((fixed ? expectedPnlPctOf(t) : t.pnlPct) ?? 0), 0);
    const mismatched = rows.filter((t) => {
      const e = expectedPnlPctOf(t);
      return e != null && Math.abs((t.pnlPct ?? 0) - e) > 0.005;
    }).length;
    out.push({
      side,
      closed: rows.length,
      wins,
      winRate: rows.length ? Math.round((wins / rows.length) * 1000) / 10 : 0,
      netPnl: round2(net),
      mismatched,
    });
  }
  return out;
}

// ─── Repair — sửa ROE + tái lập CHUỖI VỐN theo thời gian ─────────────────────

export interface RepairUpdate {
  id: string;
  /** ROE đã chuẩn hoá (chỉ xuất hiện khi khác số đang lưu) */
  pnlPct?: number;
  capitalBefore?: number;
  capitalAfter?: number;
}

export interface RepairPlan {
  updates: RepairUpdate[];
  /** số dòng thực sự thay đổi ROE */
  pnlFixed: number;
  /** số dòng bị dán lại mốc vốn (chuỗi vốn chạy lại) */
  capitalRefixed: number;
  /** vốn cuối chuỗi sau repair */
  finalCapital: number | null;
}

/**
 * Lập kế hoạch sửa toàn sổ: ROE closed → công thức hiện hành, rồi chuỗi vốn
 * chạy lại theo createdAt tăng dần — capitalBefore kế thừa capitalAfter trước,
 * delta = capitalBefore × stake% × ROE% (đúng luật settlement), đáy 0.
 * Lệnh ĐANG MỞ giữ nguyên mọi thứ trừ capitalBefore (mốc vốn lúc mở = vốn
 * sau lệnh close liền trước). Lệnh đầu chuỗi dùng capitalBefore đang lưu làm
 * mốc neo (không đoán lại gốc).
 */
export function repairBook(trades: AuditTradeRow[]): RepairPlan {
  const chron = [...trades].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
  const updates = new Map<string, RepairUpdate>();
  let capital: number | null = null; // mốc neo — null = chưa gặp lệnh close nào
  let pnlFixed = 0;
  let capitalRefixed = 0;
  let finalCapital: number | null = null;

  for (const t of chron) {
    const u: RepairUpdate = { id: t.id };
    if (t.status === "closed" && t.exitPrice != null && t.entryPrice > 0) {
      const expected = expectedPnlPctOf(t);
      if (expected != null && Math.abs((t.pnlPct ?? 0) - expected) > 0.005) {
        u.pnlPct = expected;
        pnlFixed += 1;
      }
      const before = capital ?? t.capitalBefore ?? 1000;
      if (t.capitalBefore == null || Math.abs((t.capitalBefore ?? 0) - before) > 0.005) {
        u.capitalBefore = round2(before);
        capitalRefixed += 1;
      }
      const stake = t.stakePct ?? 100;
      const pnl = u.pnlPct ?? t.pnlPct ?? 0;
      const delta = round2(before * (stake / 100) * (pnl / 100));
      const after = Math.max(0, round2(before + delta));
      if (t.capitalAfter == null || Math.abs((t.capitalAfter ?? 0) - after) > 0.005) {
        u.capitalAfter = after;
      }
      capital = after;
      finalCapital = after;
    } else {
      // lệnh mở (hoặc closed thiếu exitPrice — bỏ ROE, chỉ giữ chuỗi vốn)
      if (capital != null && (t.capitalBefore == null || Math.abs((t.capitalBefore ?? 0) - capital) > 0.005)) {
        u.capitalBefore = round2(capital);
        capitalRefixed += 1;
      }
    }
    if (Object.keys(u).length > 1) updates.set(t.id, u);
  }
  return { updates: [...updates.values()], pnlFixed, capitalRefixed, finalCapital };
}
