// ─── DQF — SÀN CHẤT LƯỢNG ĐỘNG (0.3.2) — "học & tiến hoá từ toàn bộ Elliott session" ──
// Yêu cầu của user: "AUC ACC và score dynamic và phải học và tiến hoá dựa trên
// toàn bộ elliott session và nêu rõ bên stats".
//
// Thiết kế:
//   • NGUỒN HỌC = bảng AutoTrade (sổ B Elliott) TOÀN BỘ lệnh đã đóng — mỗi lệnh
//     đã lưu auc/acc/score LÚC VÀO LỆNH (engine ghi từ đời đầu) + pnlPct (ROE
//     đòn bẩy, đã trừ phí). Học từ KẾT QUẢ THẬT của chính session, không phải
//     từ setpoint tay.
//   • LUẬT (break-even bands, thuần số không LLM):
//       – Chia lệnh theo băng giá trị lúc vào (Score 60→85 · AUC 0.80→0.90 ·
//         ACC 70→85, bước 2/0.01/1). Với từng ngưỡng F tăng dần, đo expectancy
//         cộng dồn của NHÓM lệnh entry ≥ F.
//       – Mục tiêu từng metric = ngưỡng F NHỎ NHẤT mà nhóm ≥ F có expectancy ≥ 0
//         (và đủ mẫu ≥ DQF_MIN_BAND_N). Không ngưỡng nào dương → trần (85/0.90/
//         85). Mọi nhóm đều dương → mặc định (60/0.80/70). Chưa đủ mẫu → giữ.
//   • TIẾN HOÁ = đi từng BẬC (score ±2 · AUC ±0.01 · ACC ±1) về phía mục tiêu,
//     tối đa 1 lần đổi mỗi DQF_COOLDOWN_MIN phút — mượt, truy vết được, không
//     giật cfg panel. Biên tuyệt đối [60..85]/[0.80..0.90]/[70..85] — KHÔNG BAO
//     GIỜ xuống dưới mặc định (giữ nhất quán luật restore của tune-2 0.3.0).
//   • ÁP = engine đọc sàn hiệu lực lúc funnel vào lệnh + flip (override layer,
//     KHÔNG ghi cfg → hết nỗi lo vòng sync 0.2.99 và không cài thẳng tay
//     self-improve/tune-2). Panel + tooltip 0.3.1 dùng đúng sàn hiệu lực này.
//   • NÊU RÕ = db/dqf-state.json (DATA_DIR, sống qua restart): sàn hiện tại +
//     mục tiêu + lý do kèm số + băng bằng chứng + lịch sử từng lần đổi.
//     /stats trạm "Sàn chất lượng động (Elliott)" đọc FILE (không đụng DB —
//     bài học vụ integrity_check: poll không được quét DB).
//
// Cạnh với self-improve agent (tự +2 minScore vào cfg): khi DQF bật, sàn hiệu
// lực là của DQF — patch cfg của agent vẫn ghi nhưng bị override ở funnel.
// /stats hiển thị "nguồn" để nhìn thấy ai đang giữ quyền.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { db } from "./db";
import { dataFile } from "./data-dir";

// ── Hằng số luật ──────────────────────────────────────────────────────────────

/** sàn mặc định (setpoint broadcast 31/10) — biên DƯỚI tuyệt đối của DQF */
export const DQF_DEFAULT = { minScore: 60, minAuc: 0.8, minAcc: 70 } as const;
/** biên TRÊN tuyệt đối — trùng trần self-improve/tune-2 */
export const DQF_CAP = { minScore: 85, minAuc: 0.9, minAcc: 85 } as const;
/** một bước tiến hoá mỗi lần đổi */
export const DQF_STEP = { minScore: 2, minAuc: 0.01, minAcc: 1 } as const;
/** tối thiểu lệnh đóng của TOÀN BỘ session mới được phát ngôn */
export const DQF_MIN_N = 20;
/** tối thiểu lệnh trong nhóm cộng dồn ≥ F để nhóm đó được tin */
export const DQF_MIN_BAND_N = 10;
/** đo lại session tối đa mỗi 5 phút (engine tick + stats đều đọc cache) */
const DQF_MEASURE_TTL_MS = 5 * 60_000;
/** tối đa 1 lần đổi sàn mỗi 30 phút — tiến hoá mượt, không giật */
export const DQF_COOLDOWN_MIN = 30;

// ── Types (client đọc được qua /api/stats + /api/engine) ─────────────────────

export interface DqfBand {
  /** khoảng [lo, hi) — hi = Infinity với băng cuối */
  lo: number;
  hi: number;
  n: number;
  wr: number;
  exp: number;
}

export interface DqfFloors {
  minScore: number;
  minAuc: number;
  minAcc: number;
}

export interface DqfSession {
  n: number;
  wr: number;
  payoff: number;
  /** expectancy % ROE / lệnh (TB pnlPct) — cùng công thức tune-2 */
  exp: number;
  net: number;
}

export interface DqfDecision {
  at: number;
  on: boolean;
  /** sàn HIỆU LỰC chu kỳ này — "cfg" = chưa đủ mẫu/tắt → passthrough cấu hình panel */
  src: "dqf" | "cfg";
  floors: DqfFloors;
  /** mục tiêu bands chỉ ra — null = chưa đủ mẫu nhóm */
  target: DqfFloors | null;
  /** lý do kèm SỐ — hiện ở /stats + log engine */
  why: string;
  session: DqfSession;
  /** bằng chứng: expectancy cộng dồn theo từng băng entry */
  bands: { score: DqfBand[]; auc: DqfBand[]; acc: DqfBand[] };
}

export interface DqfHistEntry {
  at: number;
  from: DqfFloors;
  to: DqfFloors;
  why: string;
}

export interface DqfFile {
  on: boolean;
  state: DqfDecision | null;
  /** lịch sử TIẾN HOÁ — mỗi lần sàn đổi một bậc ghi 1 dòng (mới nhất đầu) */
  hist: DqfHistEntry[];
  lastChangeAt: number | null;
}

// ── Băng bằng chứng (cố định, phủ mọi thời kỳ — gồm cả era sàn 0.55/55 cũ) ────

const SCORE_BANDS: [number, number][] = [[0, 55], [55, 60], [60, 65], [65, 70], [70, 75], [75, 80], [80, Infinity]];
const AUC_BANDS: [number, number][] = [[0, 0.7], [0.7, 0.75], [0.75, 0.8], [0.8, 0.85], [0.85, Infinity]];
const ACC_BANDS: [number, number][] = [[0, 55], [55, 60], [60, 65], [65, 70], [70, 75], [75, Infinity]];

/** ứng viên sàn tăng dần trong biên [default..cap] — đúng bước tiến hoá */
export const DQF_CANDIDATES = {
  minScore: rangeCandidates(DQF_DEFAULT.minScore, DQF_CAP.minScore, DQF_STEP.minScore),
  minAuc: rangeCandidates(DQF_DEFAULT.minAuc, DQF_CAP.minAuc, DQF_STEP.minAuc, 2),
  minAcc: rangeCandidates(DQF_DEFAULT.minAcc, DQF_CAP.minAcc, DQF_STEP.minAcc),
};

function rangeCandidates(lo: number, hi: number, step: number, round = 0): number[] {
  const out: number[] = [];
  const r = (v: number): number => Math.round(v * 10 ** round) / 10 ** round;
  for (let v = lo; r(v) < hi; v += step) out.push(r(v));
  out.push(hi);
  return out;
}

// ── Đo session từ DB (chỉ engine tick gọi — stats đọc file) ───────────────────

interface TradeRow {
  pnlPct: number | null;
  auc: number | null;
  acc: number | null;
  score: number | null;
}

function sessionStats(rows: TradeRow[]): DqfSession {
  const n = rows.length;
  const wins = rows.filter((r) => (r.pnlPct ?? 0) > 0).length;
  const avgWin = rows.filter((r) => (r.pnlPct ?? 0) > 0).reduce((a, r) => a + (r.pnlPct ?? 0), 0) / Math.max(1, wins);
  const losses = rows.filter((r) => (r.pnlPct ?? 0) <= 0);
  const avgLoss = losses.reduce((a, r) => a + (r.pnlPct ?? 0), 0) / Math.max(1, losses.length);
  const net = rows.reduce((a, r) => a + (r.pnlPct ?? 0), 0);
  const payoff = losses.length > 0 && wins > 0 ? avgWin / Math.abs(avgLoss) : wins > 0 ? Infinity : 0;
  return { n, wr: n ? (wins / n) * 100 : 0, payoff, exp: n ? net / n : 0, net };
}

function bandStats(rows: TradeRow[], pick: (r: TradeRow) => number | null, bands: [number, number][]): DqfBand[] {
  return bands.map(([lo, hi]) => {
    const inBand = rows.filter((r) => {
      const v = pick(r);
      return v != null && v >= lo && v < hi;
    });
    const s = sessionStats(inBand);
    return { lo, hi, n: s.n, wr: s.wr, exp: s.exp };
  });
}

/** expectancy CỘNG DỒN của nhóm entry ≥ F (trong biên candidate) */
function cumExp(rows: TradeRow[], pick: (r: TradeRow) => number | null, f: number): { n: number; exp: number } {
  const cum = rows.filter((r) => {
    const v = pick(r);
    return v != null && v >= f;
  });
  const s = sessionStats(cum);
  return { n: s.n, exp: s.exp };
}

/** Mục tiêu MỘT metric: ngưỡng F NHỎ NHẤT có nhóm ≥ F expectancy ≥ 0 & đủ mẫu.
 *  Trả về: { to, why } · "cap" (không ngưỡng nào dương) · "default" · null (chưa đủ mẫu nhóm). */
export function dqfTargetOne(
  rows: TradeRow[],
  pick: (r: TradeRow) => number | null,
  candidates: number[],
): { kind: "to" | "cap" | "default"; to: number; why: string } | null {
  // băng thấp nhất (entry < default) đã dương → mọi ngưỡng đều dương → default
  const below = rows.filter((r) => {
    const v = pick(r);
    return v != null && v < candidates[0];
  });
  const belowS = sessionStats(below);
  if (below.length >= DQF_MIN_BAND_N && belowS.exp >= 0) {
    return { kind: "default", to: candidates[0], why: `nhóm dưới default cũng dương (exp ${fmt2(belowS.exp)}%, n=${below.length})` };
  }
  for (const f of candidates) {
    const { n, exp } = cumExp(rows, pick, f);
    if (n >= DQF_MIN_BAND_N && exp >= 0) {
      return { kind: "to", to: f, why: `nhóm ≥ ${fmtNum(f, candidates)} đạt hoà vốn (exp ${fmt2(exp)}%, n=${n})` };
    }
  }
  // không ngưỡng nào dương nhưng có ngưỡng nào đủ mẫu → trần (chỉ giữ vùng mạnh nhất)
  const anyN = candidates.some((f) => cumExp(rows, pick, f).n >= DQF_MIN_BAND_N);
  if (anyN) {
    const top = candidates[candidates.length - 1];
    const { n, exp } = cumExp(rows, pick, top);
    return { kind: "cap", to: top, why: `tới ngưỡng cao nhất vẫn âm (nhóm ≥ ${fmtNum(top, candidates)}: exp ${fmt2(exp)}%, n=${n})` };
  }
  return null; // chưa đủ mẫu theo nhóm — giữ nguyên
}

const fmt2 = (v: number): string => `${v >= 0 ? "+" : ""}${v.toFixed(2)}`;
const fmtNum = (v: number, cands: number[]): string => (cands.length && cands[0] < 1 ? v.toFixed(2) : String(Math.round(v)));

const r2 = (v: number): number => Math.round(v * 100) / 100;

// ── LUẬT TIẾN HOÁ — thuần, exported cho test ─────────────────────────────────

const clampFloors = (f: DqfFloors): DqfFloors => ({
  minScore: Math.min(DQF_CAP.minScore, Math.max(DQF_DEFAULT.minScore, Math.round(f.minScore))),
  minAuc: r2(Math.min(DQF_CAP.minAuc, Math.max(DQF_DEFAULT.minAuc, f.minAuc))),
  minAcc: Math.min(DQF_CAP.minAcc, Math.max(DQF_DEFAULT.minAcc, Math.round(f.minAcc))),
});

/** một bước tiến hoá: mỗi metric đi TỐI ĐA 1 bước về phía mục tiêu (clamp biên) */
export function dqfStepToward(current: DqfFloors, target: DqfFloors): { floors: DqfFloors; changed: boolean } {
  const step1 = (cur: number, tgt: number, stp: number): number =>
    Math.abs(tgt - cur) <= stp ? tgt : cur + Math.sign(tgt - cur) * stp;
  const next = clampFloors({
    minScore: step1(current.minScore, target.minScore, DQF_STEP.minScore),
    minAuc: r2(step1(current.minAuc, target.minAuc, DQF_STEP.minAuc)),
    minAcc: step1(current.minAcc, target.minAcc, DQF_STEP.minAcc),
  });
  const changed = next.minScore !== current.minScore || next.minAuc !== current.minAuc || next.minAcc !== current.minAcc;
  return { floors: next, changed };
}

// ── Persist (db/dqf-state.json — DATA_DIR, sống qua restart) ──────────────────

const DQF_FILE = "dqf-state.json";

export function readDqfFile(): DqfFile {
  try {
    const f = dataFile(DQF_FILE);
    if (!existsSync(f)) return { on: true, state: null, hist: [], lastChangeAt: null };
    const raw = JSON.parse(readFileSync(f, "utf8")) as Partial<DqfFile>;
    return { on: raw.on !== false, state: raw.state ?? null, hist: Array.isArray(raw.hist) ? raw.hist : [], lastChangeAt: raw.lastChangeAt ?? null };
  } catch {
    return { on: true, state: null, hist: [], lastChangeAt: null };
  }
}

export function saveDqfFile(f: DqfFile): void {
  try {
    const file = dataFile(DQF_FILE);
    mkdirSync(dataFile("."), { recursive: true });
    writeFileSync(file, JSON.stringify({ ...f, hist: f.hist.slice(0, 50) }, null, 2) + "\n", "utf8");
  } catch (e) {
    console.warn(`[dqf] save failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Công tắc /stats — giữ hist + state, chỉ đổi `on`. */
export function setDqfOn(on: boolean): DqfFile {
  const f = readDqfFile();
  const next: DqfFile = { ...f, on };
  saveDqfFile(next);
  console.log(`[dqf] sàn chất lượng động ${on ? "BẬT" : "TẮT"} — ${on ? "engine sẽ dùng sàn tự học (khi đủ mẫu)" : "engine quay về sàn cfg panel"}`);
  return next;
}

// ── Cache đo (1 query DB / 5 phút tối đa — tick engine + snapshot dùng chung) ─

let measureCache: { at: number; rows: TradeRow[] } | null = null;

async function measureSession(): Promise<TradeRow[]> {
  if (measureCache && Date.now() - measureCache.at < DQF_MEASURE_TTL_MS) return measureCache.rows;
  const rows = await db.autoTrade.findMany({
    where: { status: "closed", pnlPct: { not: null } },
    select: { pnlPct: true, auc: true, acc: true, score: true },
  });
  measureCache = { at: Date.now(), rows };
  return rows;
}

/** quyết định thuần từ rows đã đo — exported cho test (không DB/fs) */
export function dqfDecide(
  rows: TradeRow[],
  cfgFloors: DqfFloors,
  prev: { floors: DqfFloors; lastChangeAt: number | null; on: boolean },
  now = Date.now(),
): { decision: DqfDecision; hist: DqfHistEntry | null } {
  const session = sessionStats(rows);
  const bands = {
    score: bandStats(rows, (r) => r.score, SCORE_BANDS),
    auc: bandStats(rows, (r) => r.auc, AUC_BANDS),
    acc: bandStats(rows, (r) => r.acc, ACC_BANDS),
  };
  const base: DqfDecision = {
    at: now,
    on: prev.on,
    src: "cfg",
    // passthrough cfg panel NGUYÊN VẸN (user có thể chủ động đặt ngoài biên
    // DQF — kẹp chỉ áp cho sàn do DQF tiến hoá)
    floors: { ...cfgFloors },
    target: null,
    why: "",
    session,
    bands,
  };
  if (!prev.on) {
    return { decision: { ...base, why: "công tắc TẮT — passthrough sàn cfg panel" }, hist: null };
  }
  if (session.n < DQF_MIN_N) {
    return {
      decision: { ...base, why: `chưa đủ mẫu học (n=${session.n} < ${DQF_MIN_N} lệnh đóng) — giữ sàn cfg panel` },
      hist: null,
    };
  }
  const tScore = dqfTargetOne(rows, (r) => r.score, DQF_CANDIDATES.minScore);
  const tAuc = dqfTargetOne(rows, (r) => r.auc, DQF_CANDIDATES.minAuc);
  const tAcc = dqfTargetOne(rows, (r) => r.acc, DQF_CANDIDATES.minAcc);
  if (!tScore && !tAuc && !tAcc) {
    return {
      decision: {
        ...base,
        why: `chưa đủ mẫu theo nhóm (n=${session.n}, cần ≥ ${DQF_MIN_BAND_N} lệnh/nhóm) — giữ sàn cfg panel`,
      },
      hist: null,
    };
  }
  const target = clampFloors({
    minScore: tScore ? tScore.to : cfgFloors.minScore,
    minAuc: tAuc ? tAuc.to : cfgFloors.minAuc,
    minAcc: tAcc ? tAcc.to : cfgFloors.minAcc,
  });
  const current = clampFloors(prev.floors);
  const inCooldown = prev.lastChangeAt != null && now - prev.lastChangeAt < DQF_COOLDOWN_MIN * 60_000;
  const { floors, changed } = dqfStepToward(current, target);
  // cooldown đang chạy → GIỮ nguyên sàn hiện tại (không bước ngầm không log);
  // chỉ khi thoát cooldown mà target lệch mới đi 1 bậc và ghi lịch sử
  const eff = changed && !inCooldown ? floors : current;
  const src: "dqf" | "cfg" = "dqf";
  const targetNote = [
    tScore ? `Score→${Math.round(tScore.to)} (${tScore.why})` : null,
    tAuc ? `AUC→${tAuc.to.toFixed(2)} (${tAuc.why})` : null,
    tAcc ? `ACC→${Math.round(tAcc.to)} (${tAcc.why})` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const why = `session ${session.n} lệnh · WR ${session.wr.toFixed(2)}% · exp ${fmt2(session.exp)}%/lệnh — mục tiêu: ${targetNote}${inCooldown ? " · chờ cooldown đổi bậc" : ""}`;
  let hist: DqfHistEntry | null = null;
  if (changed && !inCooldown) {
    hist = { at: now, from: current, to: floors, why: `tiến hoá 1 bậc về mục tiêu bands — exp ${fmt2(session.exp)}% (n=${session.n}, WR ${session.wr.toFixed(2)}%)` };
  }
  return { decision: { ...base, src, floors: eff, target, why }, hist };
}

/** TICK — engine gọi 1 lần mỗi chu kỳ vào-lệnh: đo → quyết → persist → trả sàn hiệu lực */
export async function dqfTick(cfgFloors: DqfFloors): Promise<DqfFloors & { src: "dqf" | "cfg"; why: string; on: boolean }> {
  const f = readDqfFile();
  let rows: TradeRow[];
  try {
    rows = await measureSession();
  } catch (e) {
    console.warn(`[dqf] measure failed: ${e instanceof Error ? e.message : String(e)}`);
    return { ...cfgFloors, src: "cfg", why: "đo session lỗi — passthrough cfg", on: f.on };
  }
  const { decision, hist } = dqfDecide(rows, cfgFloors, {
    floors: f.state?.floors ?? cfgFloors,
    lastChangeAt: f.lastChangeAt,
    on: f.on,
  });
  const nextFile: DqfFile = {
    on: f.on,
    state: decision,
    lastChangeAt: hist ? hist.at : f.lastChangeAt,
    hist: hist ? [hist, ...f.hist] : f.hist,
  };
  saveDqfFile(nextFile);
  if (hist) {
    console.log(
      `[dqf] TIẾN HOÁ sàn: Score ${hist.from.minScore}→${hist.to.minScore} · AUC ${hist.from.minAuc.toFixed(2)}→${hist.to.minAuc.toFixed(2)} · ACC ${hist.from.minAcc}→${hist.to.minAcc} — ${hist.why}`,
    );
  }
  return decision.on
    ? { ...decision.floors, src: decision.src, why: decision.why, on: decision.on }
    : { ...cfgFloors, src: "cfg", why: decision.why, on: decision.on };
}

/** SYNC — cho engineSnapshot/panel (KHÔNG đụng DB): đọc file cache, hết TTL 30s
 *  state cũ vẫn dùng được (chỉ là hiển thị sàn hiệu lực lần tick gần nhất). */
let snapCache: { at: number; floors: DqfFloors & { src: "dqf" | "cfg"; why: string; on: boolean } } | null = null;

export function dqfEffectiveSync(cfgFloors: DqfFloors): DqfFloors & { src: "dqf" | "cfg"; why: string; on: boolean } {
  if (snapCache && Date.now() - snapCache.at < 30_000) return snapCache.floors;
  const f = readDqfFile();
  const out = f.on && f.state && f.state.src === "dqf"
    ? { ...f.state.floors, src: "dqf" as const, why: f.state.why, on: true }
    : // passthrough cfg nguyên vẹn — không kẹp biên DQF
      { ...cfgFloors, src: "cfg" as const, why: f.state?.why ?? "", on: f.on };
  snapCache = { at: Date.now(), floors: out };
  return out;
}
