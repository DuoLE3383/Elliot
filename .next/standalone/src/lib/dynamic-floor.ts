// ─── dynamic-floor — bộ ba ngưỡng AUC/ACC/score TỰ HỌC & TIẾN HOÁ (0.3.2) ────
// Yêu cầu gốc: "floor động AUC/ACC/score — tự học & tiến hoá từ toàn bộ Elliott
// session, ghi nhận lý do tiến hoá và hiển thị rõ trong mục Stats".
// Cộng thêm phản hồi thật: "tăng RR thì không bắt được lệnh nữa" — nhiệm vụ train
// khó hơn (TP xa hơn / RR cao hơn) kéo expectancy và tỉ lệ đạt cổng sập xuống,
// floor TĨNH thì đứng cứng chặn sạch → phễu cạn. Floor động tự hạ để GIỮ DÒNG.
//
// Thuật toán (pure ở computeFloors — test được, IO gom lại ở runFloorRound):
//   1. Gom mẫu có trọng số từ TOÀN BỘ lịch sử:
//        • AutoTrade closed  (auc/acc/score/pnlPct lúc vào)  — trọng số 3
//          (mẫu đã qua quản lý thật: gate + LLM + DCA + flip)
//        • Suggestion resolved ex-flat (chấm lại score từ prob/confidence) —
//          trọng số 1 (tín hiệu thô PHE, nhiều hơn gấp nhiều lần)
//   2. Lưới ứng viên = quantile của CHÍNH phân phối quan sát được (auc/acc/
//      score từng cột × 8×7×8 tổ hợp).
//   3. Chấm từng ứng viên: n (trọng số), flow = n/totalN, expectancy (ROE trung
//      bình có trọng số), winRate, objective = expectancy × √n — chất lượng nhân
//      tần suất: siết quá thì n sập, nới quá thì expectancy sập.
//   4. RÀNG BUỘC DÒNG LỆNH: ứng viên giữ lại < FLOW_MIN tổng mẫu → loại (không
//      bao giờ học ra một cổng làm phễu cạn kiệt).
//   5. Giới hạn BƯỚC so với floor hiện tại (FLOOR_STEP) + sàn CỨNG
//      (FLOOR_HARD_MIN) + trần của sanitizeFloors → floor tiến hoá từng bước,
//      không nhảy loạn theo một lượt dữ liệu xấu.
//   6. Mỗi lượt (áp hay giữ) ghi 1 dòng FloorLog: trước/sau + LÝ DO + số liệu
//      nền — /stats đọc bảng này hiển thị "lý do tiến hoá".

import { db } from "./db";
import {
  FLOOR_HARD_MIN,
  FLOOR_MIN_SAMPLES,
  FLOOR_STEP,
  FLOW_MIN,
  pval,
} from "./params";
import { sanitizeFloors } from "./autotrade";

// ─── mẫu ─────────────────────────────────────────────────────────────────────

export interface FloorSample {
  auc: number;
  acc: number;
  score: number;
  /** ROE % thực tế sau khi đóng (âm/lamb dương) */
  pnlPct: number;
  /** trọng số: 3 = lệnh quản lý thật, 1 = tín hiệu PHE resolved */
  w: number;
}

/** Trọng số mẫu — lệnh thật đáng tin hơn tín hiệu thô 3 lần. */
export const W_TRADE = 3;
export const W_SUG = 1;
/** Giới hạn mỗi nguồn khi gom (mới nhất trước) — đủ rộng, không quét cả DB. */
const TAKE_TRADES = 3000;
const TAKE_SUGS = 3000;

// ─── pure: quantile + lưới ứng viên ──────────────────────────────────────────

/** Quantile tuyến tính (phần trăm 0..1) của mảng số — rỗng trả về null từng vị trí. */
export function quantile(sorted: number[], q: number): number | null {
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0];
  const pos = Math.min(sorted.length - 1, Math.max(0, q * (sorted.length - 1)));
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const t = pos - lo;
  return sorted[lo] + (sorted[hi] - sorted[lo]) * t;
}

export interface Floors {
  minAuc: number;
  minAcc: number;
  minScore: number;
}

export interface FloorEval extends Floors {
  /** tổng trọng số mẫu đạt */
  n: number;
  /** tỉ lệ mẫu đạt trên tổng (0..1) — ràng buộc dòng lệnh */
  flow: number;
  /** ROE % trung bình có trọng số của mẫu đạt */
  expectancy: number;
  /** win rate % có trọng số của mẫu đạt */
  winRate: number;
  /** expectancy × √n — mục tiêu tối đa hoá */
  objective: number;
}

const Q_AUC = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7];
const Q_ACC = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6];
const Q_SCORE = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7];

/**
 * Chấm MỘT bộ ba floor trên toàn mẫu — xuất ra để test đếm tay được.
 * Mẫu đạt: auc ≥ minAuc && acc ≥ minAcc && score ≥ minScore (đúng ngữ nghĩa
 * isTradeable — minScore ≤ 0 nghĩa là không chấm điểm).
 */
export function evalFloors(samples: FloorSample[], f: Floors): FloorEval {
  let n = 0;
  let total = 0;
  let sumPnl = 0;
  let wins = 0;
  for (const s of samples) {
    total += s.w;
    if (s.auc >= f.minAuc && s.acc >= f.minAcc && (f.minScore <= 0 || s.score >= f.minScore)) {
      n += s.w;
      sumPnl += s.w * s.pnlPct;
      if (s.pnlPct > 0) wins += s.w;
    }
  }
  const expectancy = n > 0 ? sumPnl / n : 0;
  const winRate = n > 0 ? (wins / n) * 100 : 0;
  return {
    ...f,
    n,
    flow: total > 0 ? n / total : 0,
    expectancy: Math.round(expectancy * 100) / 100,
    winRate: Math.round(winRate * 10) / 10,
    objective: Math.round(expectancy * Math.sqrt(n) * 100) / 100,
  };
}

export interface ComputeFloorsOut {
  /** ứng viên thắng SAU ràng buộc (null = không đủ mẫu/không ứng viên hợp lệ) */
  pick: FloorEval | null;
  /** ứng viên thắng TRƯỚC bước-clamp — để reason nói rõ bị bậc thang cắt */
  rawBest: FloorEval | null;
  candidates: number;
  totalW: number;
  enough: boolean;
}

/**
 * Tìm bộ ba floor tốt nhất trên lưới quantile.
 *  • đủ mẫu mới trả pick != null (FLOOR_MIN_SAMPLES tổng trọng số)
 *  • flow < FLOW_MIN → ứng viên bị loại (ràng buộc dòng lệnh)
 *  • bước + sàn cứng + trần sanitizeFloors clamp quanh `prev`
 */
export function computeFloors(samples: FloorSample[], prev: Floors): ComputeFloorsOut {
  const totalW = samples.reduce((a, s) => a + s.w, 0);
  const enough = totalW >= pval("FLOOR_MIN_SAMPLES", FLOOR_MIN_SAMPLES);
  if (!enough || samples.length === 0) {
    return { pick: null, rawBest: null, candidates: 0, totalW, enough };
  }
  const aucVals = [...samples.map((s) => s.auc)].sort((a, b) => a - b);
  const accVals = [...samples.map((s) => s.acc)].sort((a, b) => a - b);
  const scoreVals = [...samples.map((s) => s.score)].sort((a, b) => a - b);
  const gridA = Q_AUC.map((q) => quantile(aucVals, q)).filter((x): x is number => x != null);
  const gridC = Q_ACC.map((q) => quantile(accVals, q)).filter((x): x is number => x != null);
  const gridS = Q_SCORE.map((q) => quantile(scoreVals, q)).filter((x): x is number => x != null);

  let rawBest: FloorEval | null = null;
  let candidates = 0;
  for (const a of gridA) {
    for (const c of gridC) {
      for (const s of gridS) {
        const ev = evalFloors(samples, { minAuc: Math.round(a * 1000) / 1000, minAcc: Math.round(c * 10) / 10, minScore: Math.round(s * 10) / 10 });
        candidates += 1;
        if (ev.flow < pval("FLOW_MIN", FLOW_MIN)) continue; // ràng buộc dòng lệnh
        if (
          !rawBest ||
          ev.objective > rawBest.objective ||
          (ev.objective === rawBest.objective && ev.n > rawBest.n)
        ) {
          rawBest = ev;
        }
      }
    }
  }
  if (!rawBest) return { pick: null, rawBest: null, candidates, totalW, enough };
  const pick = clampStep(rawBest, prev);
  return { pick: evalFloors(samples, pick), rawBest, candidates, totalW, enough };
}

/** Kẹp bộ ba mục tiêu về ±FLOOR_STEP quanh `prev`, trong [sàn cứng, trần]. */
export function clampStep(target: Floors, prev: Floors): Floors {
  const step = pval("FLOOR_STEP", FLOOR_STEP) as typeof FLOOR_STEP;
  const caps = sanitizeFloors(0.95, 90, 95); // trần = đúng vùng hợp lệ của panel
  const clampNum = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
  const hard = pval("FLOOR_HARD_MIN", FLOOR_HARD_MIN) as typeof FLOOR_HARD_MIN;
  return {
    minAuc: clampNum(target.minAuc, Math.max(hard.auc, prev.minAuc - step.auc), Math.min(caps.minAuc, prev.minAuc + step.auc)),
    minAcc: clampNum(Math.round(target.minAcc), Math.max(hard.acc, Math.round(prev.minAcc - step.acc)), Math.min(caps.minAcc, Math.round(prev.minAcc + step.acc))),
    minScore: clampNum(Math.round(target.minScore), Math.max(hard.score, Math.round(prev.minScore - step.score)), Math.min(caps.minScore, Math.round(prev.minScore + step.score))),
  };
}

// ─── pure: lý do tiến hoá ────────────────────────────────────────────────────

const signPct = (x: number): string => `${x >= 0 ? "+" : ""}${x.toFixed(2)}%`;

/** Chuỗi lý do tiếng Việt ghi vào FloorLog + log + Stats. */
export function floorReason(out: ComputeFloorsOut, prev: Floors, action: "apply" | "keep"): string {
  if (!out.enough) {
    return `chưa đủ mẫu để học: ${out.totalW}/${pval("FLOOR_MIN_SAMPLES", FLOOR_MIN_SAMPLES)} trọng số (lệnh ×3 + PHE ×1) — giữ floor ${prev.minAuc.toFixed(2)}/${prev.minAcc}/${prev.minScore}`;
  }
  const pick = out.pick;
  const raw = out.rawBest;
  if (!pick || !raw) {
    return `không có ứng viên nào giữ dòng lệnh ≥ ${(pval("FLOW_MIN", FLOW_MIN) * 100).toFixed(0)}% trên ${out.candidates} bộ ba — giữ floor ${prev.minAuc.toFixed(2)}/${prev.minAcc}/${prev.minScore}`;
  }
  const moved = pick.minAuc !== prev.minAuc || pick.minAcc !== prev.minAcc || pick.minScore !== prev.minScore;
  const basis = `exp ${signPct(pick.expectancy)} × √n ${Math.sqrt(pick.n).toFixed(1)} → obj ${pick.objective.toFixed(2)} · flow ${(pick.flow * 100).toFixed(0)}% · WR ${pick.winRate.toFixed(0)}% (${out.totalW} mẫu, ${out.candidates} ứng viên)`;
  if (action === "keep" || !moved) {
    return `tối ưu trùng floor hiện tại ${prev.minAuc.toFixed(2)}/${prev.minAcc}/${prev.minScore} — giữ nguyên · ${basis}`;
  }
  const rawSame = raw.minAuc === pick.minAuc && raw.minAcc === pick.minAcc && raw.minScore === pick.minScore;
  const stepNote = rawSame ? "" : " (bị FLOOR_STEP/sàn cứng bậc thang — mục tiêu gần hơn: " + `${raw.minAuc.toFixed(2)}/${raw.minAcc}/${raw.minScore})`;
  return `tiến hoá ${prev.minAuc.toFixed(2)}/${prev.minAcc}/${prev.minScore} → ${pick.minAuc.toFixed(2)}/${pick.minAcc}/${pick.minScore}${stepNote} · ${basis}`;
}

// ─── IO: gom mẫu từ DB + một lượt học ────────────────────────────────────────

/** Gom mẫu học từ TOÀN BỘ lịch sử — AutoTrade (×3) + Suggestion resolved (×1). */
export async function collectFloorSamples(): Promise<FloorSample[]> {
  const out: FloorSample[] = [];
  try {
    const trades = await db.autoTrade.findMany({
      where: { status: "closed", pnlPct: { not: null }, auc: { not: null }, acc: { not: null } },
      orderBy: { exitTime: "desc" },
      take: TAKE_TRADES,
      select: { auc: true, acc: true, score: true, pnlPct: true },
    });
    for (const t of trades) {
      out.push({
        auc: t.auc ?? 0,
        acc: t.acc ?? 0,
        score: t.score ?? 0,
        pnlPct: t.pnlPct ?? 0,
        w: W_TRADE,
      });
    }
  } catch {
    // bảng chớp — vẫn học phần còn lại
  }
  try {
    const sugs = await db.suggestion.findMany({
      where: { outcome: { not: null }, pnlPct: { not: null }, bias: { not: "NEUTRAL" } },
      orderBy: { createdAt: "desc" },
      take: TAKE_SUGS,
      select: { auc: true, acc: true, prob: true, confidence: true, pnlPct: true },
    });
    for (const s of sugs) {
      // chấm lại score ĐÚNG công thức scoreFrom (auc/acc/confidence) — Suggestion
      // không lưu score nên dùng lại đúng một nguồn công thức
      const score = Math.round(((s.auc - 0.5) * 100 + (s.acc - 50) + Math.abs(2 * s.prob - 1) * 15) * 10) / 10;
      out.push({ auc: s.auc, acc: s.acc, score, pnlPct: s.pnlPct ?? 0, w: W_SUG });
    }
  } catch {
    // PHE chưa có — chỉ học từ lệnh
  }
  return out;
}

export interface FloorRoundResult {
  action: "apply" | "keep";
  from: Floors;
  to: Floors;
  note: string;
  basis: { totalW: number; candidates: number; enough: boolean };
}

/**
 * MỘT LƯỢT học floor. `prev` = floor đang chạy; `apply` = engine tự cài
 * (callback đặt p.cfg.minAuc/minAcc/minScore + persist + Telegram) — module
 * này KHÔNG đụng engine state (tránh vòng import). Mọi lượt đều ghi FloorLog.
 */
export async function runFloorRound(
  prev: Floors,
  apply: (f: Floors) => void,
): Promise<FloorRoundResult> {
  const samples = await collectFloorSamples();
  const out = computeFloors(samples, prev);
  let action: "apply" | "keep" = "keep";
  let to: Floors = prev;
  if (out.enough && out.pick) {
    const moved = out.pick.minAuc !== prev.minAuc || out.pick.minAcc !== prev.minAcc || out.pick.minScore !== prev.minScore;
    if (moved) {
      action = "apply";
      to = { minAuc: out.pick.minAuc, minAcc: out.pick.minAcc, minScore: out.pick.minScore };
      apply(to);
    }
  }
  const note = floorReason(out, prev, action);
  try {
    await db.floorLog.create({
      data: {
        kind: action,
        floorsBefore: JSON.stringify(prev),
        floorsAfter: JSON.stringify(to),
        basis: JSON.stringify({ totalW: out.totalW, candidates: out.candidates, enough: out.enough, ...(out.pick ?? {}) }),
        note: note.slice(0, 500),
      },
    });
  } catch (e) {
    console.warn(`[floor] FloorLog ghi thất bại: ${e instanceof Error ? e.message : e}`);
  }
  console.log(`[floor] ${action.toUpperCase()} — ${note}`);
  return { action, from: prev, to, note, basis: { totalW: out.totalW, candidates: out.candidates, enough: out.enough } };
}

/** Lịch sử lượt học gần nhất cho /stats (mới nhất trước) — kèm bộ ba trước/sau. */
export async function recentFloorLogs(
  take = 6,
): Promise<{ kind: string; note: string; at: string; before: Floors; after: Floors }[]> {
  const fallback: Floors = { minAuc: 0, minAcc: 0, minScore: 0 };
  const parseFloors = (s: string): Floors => {
    try {
      const j = JSON.parse(s) as Partial<Floors>;
      return { minAuc: j.minAuc ?? 0, minAcc: j.minAcc ?? 0, minScore: j.minScore ?? 0 };
    } catch {
      return fallback;
    }
  };
  try {
    const rows = await db.floorLog.findMany({ orderBy: { createdAt: "desc" }, take });
    return rows.map((r) => ({
      kind: r.kind,
      note: r.note,
      at: new Date(r.createdAt).toISOString(),
      before: parseFloors(r.floorsBefore),
      after: parseFloors(r.floorsAfter),
    }));
  } catch {
    return [];
  }
}
