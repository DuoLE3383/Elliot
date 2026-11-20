// ─── TUNE-2 — "NÂNG CẤP CẤP 2" (0.3.0): RR + Quality floor cho cả 3 sổ ───────
// Yêu cầu của user: "dùng nâng cấp 'cấp2' — chỉ chỉnh tham số RR và Quality
// floor cho tất cả các sổ A B C và lưu đề xuất ở một ô cạnh ô setting ở phần
// dry-run, nêu rõ lý do".
//
// Thiết kế:
//   • CẤP 2 = bậc tinh chỉnh NHẸ — ĐÚNG 2 nhóm núm mỗi sổ, không đụng gì khác:
//       sổ A Vulcan  — RR: VUL_ATR_STOP_MULT (độ rộng stop ATR) · floor: VUL_VOL_FACTOR
//       sổ B Elliott — RR: RR_TP_RATIO (TP = SL × ratio, trước đây cứng 1.4)
//                      floor: bộ ba minScore/minAuc/minAcc (Auto panel)
//       sổ C Wyckoff — RR: WYC_EXIT_SL_PCT (stop cấu trúc −x%) · floor:
//                      WYC_RPS50_MIN / WYC_RPS120_MIN
//   • Đề xuất sinh từ SỐ THẬT của từng sổ (bảng VulcanBook / AutoTrade /
//     WyckoffBook, cùng nguồn với /api/arena) bằng LUẬT SỐ thuần (không LLM,
//     cùng phong cách decidePatch của self-improve) — mỗi đề xuất có lý do kèm
//     số: WR, payoff (lãi TB / lỗ TB), expectancy, net, phí round-trip.
//   • LƯU ĐỀ XUẤT vào db/tune2-proposal.json (DATA_DIR) — sống qua restart;
//     áp = setOverride (runtime, hiệu lực tick kế tiếp) + syncEngine cho floor
//     sổ B; trạng thái pending/applied/dismissed giữ trong cùng file.
//
// Ma trận luật (n = số lệnh đóng, cần ≥ TUNE2_MIN_N):
//   RR SIẾT (A: stop hẹp lại / B: ratio↑ / C: stop hẹp lại)
//     khi WR ≥ 55% nhưng payoff < 1.15 — người thắng nhiều mà lãi TB không đủ
//     bù lỗ TB → nâng tỉ lệ lãi/lỗ hiệu quả.
//   RR NỚI (A: stop rộng ra / B: ratio↓ / C: stop rộng ra)
//     khi WR ≤ 40% nhưng payoff ≥ 1.6 — mỗi lệnh thắng to nhưng quá hiếm → hạ
//    _REQ RR để TP gần hơn, đánh đổi WR lên.
//   FLOOR NÂNG khi expectancy < 0 — sổ đang chảy máu → lọc tín hiệu yếu hơn.
//   FLOOR HẠ NHẸ (về hướng mặc định, không xuống dưới default) khi sổ khỏe
//     (exp ≥ 0.3 · WR ≥ 48% · n ≥ 20) — đừng bỏ lỡ tín hiệu đủ ăn.
//   Còn lại → giữ nguyên (không item).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { db } from "./db";
import { dataFile } from "./data-dir";
import {
  FEE_PCT,
  RR_TP_RATIO,
  VUL_ATR_STOP_MULT,
  VUL_VOL_FACTOR,
  WYC_EXIT_SL_PCT,
  WYC_RPS120_MIN,
  WYC_RPS50_MIN,
  feeRoe,
  pval,
} from "./params";
import { statsFromRoes } from "./arena";
import type { BookId, Tune2Cur, Tune2Extra, Tune2File, Tune2Item, Tune2Stats } from "./tune2-types";

// types + hằng dùng chung client ↔ server — MỘT nguồn ở tune2-types.ts
export type { BookId, Tune2Cur, Tune2Extra, Tune2File, Tune2Item, Tune2Stats };
export { TUNE2_MIN_N } from "./tune2-types";
import { TUNE2_MIN_N } from "./tune2-types";

/** Giá trị HIỆN TẠI của đúng các núm tune-2, đọc runtime pval (server). */
export function tune2Current(): Record<BookId, Tune2Cur> {
  return {
    a: { rr: 1.4, floor: pval("VUL_VOL_FACTOR", VUL_VOL_FACTOR) },
    b: { rr: 1.4, floor: pval("minScore", 60), floor2: pval("minAuc", 0.8), floor3: pval("minAcc", 70) },
    c: { rr: 1.4, floor: pval("WYC_RPS50_MIN", WYC_RPS50_MIN), floor2: pval("WYC_RPS120_MIN", WYC_RPS120_MIN) },
    d: { rr: 1.4, floor: 60 },
  };
}

/**
 * minScore/minAuc/minAcc sổ B không nằm trong params-store (chúng sống trong
 * cfg engine, sync từ Auto panel) — pval("minScore") chỉ đúng khi ai đó đã
 * đặt key trùng tên; NGUỒN THẬT là engine.json. Đọc file trực tiếp (không
 * import engine.ts — nặng + vòng) như arena.ts làm với cờ live.
 */
export function bookBEngineCfg(): { minScore: number; minAuc: number; minAcc: number; leverage: number } | null {
  try {
    const f = dataFile("engine.json");
    if (!existsSync(f)) return null;
    const raw = JSON.parse(readFileSync(f, "utf8")) as {
      cfg?: { minScore?: number; minAuc?: number; minAcc?: number };
      settings?: { leverage?: number };
    };
    const cfg = raw.cfg ?? {};
    return {
      minScore: typeof cfg.minScore === "number" ? cfg.minScore : 60,
      minAuc: typeof cfg.minAuc === "number" ? cfg.minAuc : 0.8,
      minAcc: typeof cfg.minAcc === "number" ? cfg.minAcc : 70,
      leverage: typeof raw.settings?.leverage === "number" && raw.settings.leverage >= 1 ? raw.settings.leverage : 10,
    };
  } catch {
    return null;
  }
}

/** tune2Current() nhưng floor sổ B lấy từ engine.json (nguồn thật của panel). */
export function tune2CurrentWithEngine(): Record<BookId, Tune2Cur> {
  const cur = tune2Current();
  const eng = bookBEngineCfg();
  if (eng) cur.b.floor = eng.minScore;
  if (eng) cur.b.floor2 = eng.minAuc;
  if (eng) cur.b.floor3 = eng.minAcc;
  return cur;
}

// ── Đo từ DB — cùng nguồn số với /api/arena (statsFromRoes thuần) ────────────

function toTune2Stats(s: ReturnType<typeof statsFromRoes>): Tune2Stats {
  return {
    n: s.nClosed,
    wr: s.wr,
    avgWin: s.avgWin,
    avgLoss: s.avgLoss,
    payoff: s.payoff,
    expectancy: s.nClosed ? Math.round((s.netRoe / s.nClosed) * 100) / 100 : 0,
    netRoe: s.netRoe,
  };
}

/** Đo cả ba sổ từ DB. Lỗi DB (kể cả vụ hỏng thật) → stats null cho sổ đó,
 *  KHÔNG ném — trang đề xuất phải luôn render được dù DB đang bệnh. */
export async function measureTune2Books(): Promise<{ books: Record<BookId, Tune2Stats | null>; bLev: number }> {
  const out: Record<BookId, Tune2Stats | null> = { a: null, b: null, c: null, d: null };
  const eng = bookBEngineCfg();
  const bLev = eng?.leverage ?? 10;
  const one = async (fn: () => Promise<Tune2Stats>): Promise<Tune2Stats | null> => {
    try {
      return await fn();
    } catch (e) {
      console.warn(`[tune2] measure failed: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  };
  out.a = await one(async () => {
    const rows = await db.vulcanBook.findMany({ where: { status: "closed" }, select: { side: true, roePct: true, capitalBefore: true, capitalAfter: true } });
    return toTune2Stats(statsFromRoes(rows.map((r) => ({ side: r.side, roe: r.roePct, capitalBefore: r.capitalBefore, capitalAfter: r.capitalAfter }))));
  });
  out.b = await one(async () => {
    const rows = await db.autoTrade.findMany({ where: { status: "closed" }, select: { side: true, pnlPct: true, capitalBefore: true, capitalAfter: true } });
    return toTune2Stats(statsFromRoes(rows.map((r) => ({ side: r.side, roe: r.pnlPct, capitalBefore: r.capitalBefore, capitalAfter: r.capitalAfter }))));
  });
  out.c = await one(async () => {
    const rows = await db.wyckoffBook.findMany({ where: { status: "closed" }, select: { side: true, pnlPct: true, capitalBefore: true, capitalAfter: true } });
    return toTune2Stats(statsFromRoes(rows.map((r) => ({ side: r.side, roe: r.pnlPct, capitalBefore: r.capitalBefore, capitalAfter: r.capitalAfter }))));
  });
  return { books: out, bLev };
}

// ── LUẬT SỐ THUẦN — exported cho test ────────────────────────────────────────

const r1 = (v: number): number => Math.round(v * 10) / 10;
const r2 = (v: number): number => Math.round(v * 100) / 100;

interface BookRule {
  /** nâng RR hiệu quả = siết leg rủi ro (A/C: stop hẹp → mult↓) hay nới leg thưởng (B: ratio↑) */
  rrUp: (from: number) => number | null; // null = đã ở biên
  rrDown: (from: number) => number | null;
  floorUp: (cur: Tune2Cur) => { to: number; extras: Tune2Extra[] } | null;
  floorRestore: (cur: Tune2Cur) => { to: number; extras: Tune2Extra[] } | null;
  rrUpKey: string;
  rrDownKey: string;
  floorUpKey: string;
  floorRestoreKey: string;
}

const clampStep = (from: number, delta: number, lo: number, hi: number, round: (v: number) => number): number | null => {
  const to = round(from + delta);
  if (to === round(from) || to < lo || to > hi) return null;
  return to;
};

const RULES: Record<BookId, BookRule> = {
  a: {
    // stop ATR: hẹp lại −0.3 (biên 1.2) / rộng ra +0.3 (biên 2.8)
    rrUp: (f) => clampStep(f, -0.3, 1.2, 2.8, r1),
    rrDown: (f) => clampStep(f, +0.3, 1.2, 2.8, r1),
    floorUp: (cur) => {
      const to = clampStep(cur.floor, +0.2, 1.0, 2.5, r1);
      return to == null ? null : { to, extras: [] };
    },
    floorRestore: (cur) => {
      if (cur.floor <= 1.5) return null;
      const to = clampStep(cur.floor, -0.1, 1.5, 2.5, r1);
      return to == null ? null : { to, extras: [] };
    },
    rrUpKey: "tune2.rr.up.a",
    rrDownKey: "tune2.rr.down.a",
    floorUpKey: "tune2.floor.up.a",
    floorRestoreKey: "tune2.floor.restore.a",
  },
  b: {
    // ratio thưởng: +0.2 (biên 1.0–2.2) / −0.2
    rrUp: (f) => clampStep(f, +0.2, 1.0, 2.2, r1),
    rrDown: (f) => clampStep(f, -0.2, 1.0, 2.2, r1),
    floorUp: (cur) => {
      const to = clampStep(cur.floor, +5, 0, 85, (v) => Math.round(v));
      const f2 = cur.floor2 != null ? clampStep(cur.floor2, +0.02, 0.5, 0.9, r2) : null;
      const f3 = cur.floor3 != null ? clampStep(cur.floor3, +2, 50, 85, (v) => Math.round(v)) : null;
      if (to == null && f2 == null && f3 == null) return null;
      return {
        to: to ?? cur.floor,
        extras: [
          ...(f2 != null && cur.floor2 != null ? [{ param: "minAuc", from: cur.floor2, to: f2 }] : []),
          ...(f3 != null && cur.floor3 != null ? [{ param: "minAcc", from: cur.floor3, to: f3 }] : []),
        ],
      };
    },
    floorRestore: (cur) => {
      // default Auto panel: 60 / 0.8 / 70 — chỉ HẠ về hướng default, không thấp hơn
      if (cur.floor <= 60 && (cur.floor2 ?? 0.8) <= 0.8 && (cur.floor3 ?? 70) <= 70) return null;
      const to = cur.floor > 60 ? clampStep(cur.floor, -5, 60, 85, (v) => Math.round(v)) : null;
      const f2 = cur.floor2 != null && cur.floor2 > 0.8 ? clampStep(cur.floor2, -0.01, 0.8, 0.9, r2) : null;
      const f3 = cur.floor3 != null && cur.floor3 > 70 ? clampStep(cur.floor3, -1, 70, 85, (v) => Math.round(v)) : null;
      if (to == null && f2 == null && f3 == null) return null;
      return {
        to: to ?? cur.floor,
        extras: [
          ...(f2 != null && cur.floor2 != null ? [{ param: "minAuc", from: cur.floor2, to: f2 }] : []),
          ...(f3 != null && cur.floor3 != null ? [{ param: "minAcc", from: cur.floor3, to: f3 }] : []),
        ],
      };
    },
    rrUpKey: "tune2.rr.up.b",
    rrDownKey: "tune2.rr.down.b",
    floorUpKey: "tune2.floor.up.b",
    floorRestoreKey: "tune2.floor.restore.b",
  },
  c: {
    // stop cấu trúc: hẹp lại −1.5 (biên 4.5) / rộng ra +1.5 (biên 10)
    rrUp: (f) => clampStep(f, -1.5, 4.5, 10, r1),
    rrDown: (f) => clampStep(f, +1.5, 4.5, 10, r1),
    floorUp: (cur) => {
      const to = clampStep(cur.floor, +5, 50, 80, (v) => Math.round(v));
      const f2 = cur.floor2 != null ? clampStep(cur.floor2, +5, 55, 85, (v) => Math.round(v)) : null;
      if (to == null && f2 == null) return null;
      return {
        to: to ?? cur.floor,
        extras: f2 != null && cur.floor2 != null ? [{ param: "WYC_RPS120_MIN", from: cur.floor2, to: f2 }] : [],
      };
    },
    floorRestore: (cur) => {
      if (cur.floor <= 65 && (cur.floor2 ?? 70) <= 70) return null;
      const to = cur.floor > 65 ? clampStep(cur.floor, -5, 65, 80, (v) => Math.round(v)) : null;
      const f2 = cur.floor2 != null && cur.floor2 > 70 ? clampStep(cur.floor2, -5, 70, 85, (v) => Math.round(v)) : null;
      if (to == null && f2 == null) return null;
      return {
        to: to ?? cur.floor,
        extras: f2 != null && cur.floor2 != null ? [{ param: "WYC_RPS120_MIN", from: cur.floor2, to: f2 }] : [],
      };
    },
    rrUpKey: "tune2.rr.up.c",
    rrDownKey: "tune2.rr.down.c",
    floorUpKey: "tune2.floor.up.c",
    floorRestoreKey: "tune2.floor.restore.c",
  },
    d: {
      rrUp: (f) => clampStep(f, +0.2, 1.4, 3.0, r1),
      rrDown: (f) => clampStep(f, -0.2, 1.4, 3.0, r1),
      floorUp: (cur) => {
        const to = clampStep(cur.floor, +5, 0, 85, (v) => Math.round(v));
        if (to == null || to === cur.floor) return null;
        return { to, extras: [] };
      },
      floorRestore: (cur) => {
        if (cur.floor <= 60) return null;
        const to = clampStep(cur.floor, -5, 60, 85, (v) => Math.round(v));
        if (to == null || to === cur.floor) return null;
        return { to, extras: [] };
      },
      rrUpKey: "tune2.rr.up.d",
      rrDownKey: "tune2.rr.down.d",
      floorUpKey: "tune2.floor.up.d",
      floorRestoreKey: "tune2.floor.restore.d",
    },
};

const PARAM_OF: Record<BookId, { rr: string; floor: string }> = {
  a: { rr: "VUL_ATR_STOP_MULT", floor: "VUL_VOL_FACTOR" },
  b: { rr: "RR_TP_RATIO", floor: "minScore" },
  c: { rr: "WYC_EXIT_SL_PCT", floor: "WYC_RPS50_MIN" },
    d: { rr: "LIQ_RR", floor: "LIQ_FLOOR" },
};

function argsOf(s: Tune2Stats, fee: number, from: number, to: number, extras: Tune2Extra[]): Record<string, string | number> {
  const args: Record<string, string | number> = {
    wr: r1(s.wr),
    pay: r2(s.payoff),
    aw: r2(s.avgWin),
    al: r2(Math.abs(s.avgLoss)),
    n: s.n,
    net: r2(s.netRoe),
    exp: r2(s.expectancy),
    fee: r2(fee),
    from,
    to,
  };
  extras.forEach((e, i) => {
    args[`f${i + 2}param`] = e.param;
    args[`f${i + 2}from`] = e.from;
    args[`f${i + 2}to`] = e.to;
  });
  return args;
}

/**
 * Sinh đề xuất cho MỘT sổ theo ma trận luật — THUẦN (không DB/fs) để test.
 * fee = % ROE phí round-trip mỗi lệnh (feeRoe(lev)) — chỉ để trích vào lý do.
 */
export function tune2ItemsForBook(book: BookId, s: Tune2Stats | null, cur: Tune2Cur, fee: number): Tune2Item[] {
  if (!s || s.n < TUNE2_MIN_N) return []; // chưa đủ dữ liệu → không phát ngôn
  const rule = RULES[book];
  const items: Tune2Item[] = [];

  // ── RR — độc lập với floor ──────────────────────────────────────────────────
  const rrUp =
    s.wr >= 55 && s.payoff < 1.15 && s.expectancy <= 0.3
      ? rule.rrUp(cur.rr)
      : null;
  const rrDown =
    rrUp == null && s.wr <= 40 && s.payoff >= 1.6 && s.expectancy <= 0.3
      ? rule.rrDown(cur.rr)
      : null;
  if (rrUp != null) {
    items.push({
      book,
      kind: "rr",
      param: PARAM_OF[book].rr,
      extras: [],
      from: cur.rr,
      to: rrUp,
      reasonKey: rule.rrUpKey,
      args: argsOf(s, fee, cur.rr, rrUp, []),
      status: "pending",
      appliedAt: null,
    });
  } else if (rrDown != null) {
    items.push({
      book,
      kind: "rr",
      param: PARAM_OF[book].rr,
      extras: [],
      from: cur.rr,
      to: rrDown,
      reasonKey: rule.rrDownKey,
      args: argsOf(s, fee, cur.rr, rrDown, []),
      status: "pending",
      appliedAt: null,
    });
  }

  // ── floor — độc lập với RR ──────────────────────────────────────────────────
  const up = s.expectancy < 0 ? rule.floorUp(cur) : null;
  const restore =
    up == null && s.expectancy >= 0.3 && s.wr >= 48 && s.n >= 20 ? rule.floorRestore(cur) : null;
  const floor = up ?? restore;
  if (floor) {
    items.push({
      book,
      kind: "floor",
      param: PARAM_OF[book].floor,
      extras: floor.extras,
      from: cur.floor,
      to: floor.to,
      reasonKey: up ? rule.floorUpKey : rule.floorRestoreKey,
      args: argsOf(s, fee, cur.floor, floor.to, floor.extras),
      status: "pending",
      appliedAt: null,
    });
  }

  return items;
}

// ── Persist (db/tune2-proposal.json — DATA_DIR, sống qua restart) ────────────

const TUNE2_FILE = "tune2-proposal.json";

export function loadTune2File(): Tune2File | null {
  try {
    const f = dataFile(TUNE2_FILE);
    if (!existsSync(f)) return null;
    const raw = JSON.parse(readFileSync(f, "utf8")) as Tune2File;
    if (!raw || !Array.isArray(raw.items)) return null;
    return raw;
  } catch {
    return null;
  }
}

export function saveTune2File(f: Tune2File): void {
  try {
    const file = dataFile(TUNE2_FILE);
    mkdirSync(dataFile("."), { recursive: true });
    writeFileSync(file, JSON.stringify(f, null, 2) + "\n", "utf8");
  } catch (e) {
    console.warn(`[tune2] save failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Đo + sinh đề xuất cho cả 3 sổ, trạng thái pending, LƯU file. */
export async function computeTune2File(): Promise<Tune2File> {
  const { books, bLev } = await measureTune2Books();
  const cur = tune2CurrentWithEngine();
  const fee = (lev: number): number => r2(feeRoe(lev)); // % ROE round-trip
  const fees: Record<BookId, number> = { a: fee(5), b: fee(bLev), c: fee(1), d: fee(3) }; // A lev5 · C lev1
  const items = ([ "a", "b", "c" ] as BookId[]).flatMap((book) => tune2ItemsForBook(book, books[book], cur[book], fees[book]));
  const file: Tune2File = { computedAt: new Date().toISOString(), books, items };
  saveTune2File(file);
  return file;
}

/** GET: file có → trả file (không đụng DB); chưa có → tính + lưu. */
export async function ensureTune2File(): Promise<Tune2File> {
  const existing = loadTune2File();
  if (existing) return existing;
  return computeTune2File();
}

/** Giá trị FEE_PCT mặc định cho test/tài liệu — re-export để route khỏi import thêm. */
export const TUNE2_FEE_PCT = FEE_PCT;
