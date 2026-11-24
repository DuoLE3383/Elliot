// ─── Auto trade (dry-run) — scan engine, ranking, position book, Telegram ────
//
// The auto engine answers two questions every cycle:
//   1. WHICH pair × timeframe looks best right now?  → scanAll() trains an
//      XGBoost model for EVERY watched pair on EVERY timeframe and ranks the
//      results by a composite quality score.
//   2. SHOULD a dry-run position be opened/closed?   → the best tradeable row
//      (bias ≠ NEUTRAL, auc/acc above thresholds) is traded with a virtual
//      capital; open positions are checked against SL/TP each cycle.
//
// Scan runs use difficulty 0 so every combo faces the SAME task — a fair
// ranking. Manual "Train" still persists + bumps difficulty per pair.

import type { EngineSettings, Kline } from "./types";
import { INTERVALS } from "./types";
import { biasFrom, runXgb, type WhaleReadout, type WhaleTag, type XgbBias, type XgbResult } from "./xgb";
import { LLM_MODEL_DEFAULT, LLM_URL_DEFAULT, type LlmSetup } from "./llm";
import { TRAIL_ROI_ARM, TRAIL_ROI_GIVEBACK } from "./trade-mgmt";
import {
  CONF_W,
  FLIP_PROB_MIN,
  FLIP_SCORE_EXTRA,
  NEAR_FRAC,
  NOISE_BAND,
  PROB_CAP,
  REGRESS_EPS,
  SIBLING_DISCOUNT,
  SHORT_PROB_MIN,
  SL_ROI_MAX,
  EV_GATE_MIN,
  TP_LEV_MODE,
  TP_LEV_REF,
  TP_LIQ_SAFE,
  clampStake,
  feeRoi,
  pval,
} from "./params";
import { agentGateTuple, agentIconOf, agentPresetOf } from "./agent-presets";

// Knob sống ở ./params — MỘT nguồn config; re-export cho chỗ cũ không đổi path.
// feeRoi định nghĩa ở ./params từ 0.2.78 (llm.ts cần chính công thức đó mà không
// được import autotrade — autotrade đã import llm → vòng); re-export để
// engine/tg-msgs/route giữ nguyên import cũ.
export { CONF_W, NEAR_FRAC, REGRESS_EPS, feeRoi } from "./params";
import { fmtPrice } from "./i18n";

// ─── Scan rows ────────────────────────────────────────────────────────────────

export interface ScanRow {
  symbol: string;
  interval: string;
  acc: number;
  auc: number;
  prob: number;
  confidence: number;
  bias: XgbBias;
  slPct: number;
  tpPct: number;
  /** ATR multiplier retrained for this coin — live "dyn" entries re-apply it at entry time */
  atrCoef: number;
  score: number;
  samples: number;
  valSamples: number;
  horizon: number;
  trainedAt: number;
  /** whale footprint at the last closed candle — auto-entry skips "whale" */
  whale: WhaleReadout;
  /** best-ever run of this combo (from the FinetuneRun history) — 0 = no history */
  champAuc: number;
  champAcc: number;
  /** this retrain rolled measurably worse than the combo's best-ever model —
   *  auto-entry skips it until a train matches the champion again */
  regressed: boolean;
}

/**
 * Composite quality score — "how much do we trust this model's edge":
 *   (auc − 0.5) × 100   rank quality beyond a coin flip
 * + (acc − 50)          validation accuracy beyond a coin flip
 * + confidence × CONF_W how decisively the model leans at the last candle
 * (CONF_W = 15 trong params.ts §7 — prob đầu vào đã qua calibration §6c,
 *  nên "confidence" là số trung thực, không còn kiểu 86% chỉ để rồi thắng 60%.)
 */
export const scoreFrom = (auc: number, acc: number, confidence: number): number =>
  Math.round(((auc - 0.5) * 100 + (acc - 50) + confidence * pval("CONF_W", CONF_W)) * 10) / 10;

export function scoreOf(res: XgbResult): number {
  return scoreFrom(res.auc, res.acc, res.suggestion.confidence);
}

export function rowOf(res: XgbResult, symbol: string, interval: string): ScanRow {
  return {
    symbol,
    interval,
    acc: res.acc,
    auc: res.auc,
    prob: res.suggestion.prob,
    confidence: res.suggestion.confidence,
    bias: res.suggestion.bias,
    slPct: res.suggestion.slPct,
    tpPct: res.suggestion.tpPct,
    atrCoef: res.suggestion.atrCoef ?? 1.5,
    score: scoreOf(res),
    samples: res.samples,
    valSamples: res.valSamples,
    horizon: res.horizon,
    trainedAt: Date.now(),
    whale: res.whale ?? { volZ: 0, risk: 0, tag: "calm" as WhaleTag },
    champAuc: 0,
    champAcc: 0,
    regressed: false,
  };
}

/** Cổng tradeable dùng chung MỌI tầng: mở lệnh, bù DCA, best-pick. minScore = 0
 *  nghĩa là không chấm điểm (giữ backward-compat cho test); engine luôn truyền
 *  ngưỡng chung cfg.minScore. Model dưới ngưỡng nào trong ba (AUC/ACC/Điểm) thì đứng
 *  ngoài — một setpoint duy nhất, không có ngưỡng riêng thứ hai. */
export const isTradeable = (r: ScanRow, minAuc: number, minAcc: number, minScore = 0): boolean =>
  r.bias !== "NEUTRAL" && r.auc >= minAuc && r.acc >= minAcc && (minScore <= 0 || r.score >= minScore);

export const rankRows = (rows: ScanRow[]): ScanRow[] => [...rows].sort((a, b) => b.score - a.score);

export const bestTradeable = (rows: ScanRow[], minAuc: number, minAcc: number, minScore = 0): ScanRow | null =>
  rankRows(rows.filter((r) => isTradeable(r, minAuc, minAcc, minScore)))[0] ?? null;

/**
 * Chọn setup THẬT cho nút "Duyệt thử" (test LLM) thay vì setup giả mid-strength:
 * ứng viên tốt nhất hiện có trong scan gần nhất của engine, lọc ĐÚNG như
 * auto-cycle (gate minAuc/minAcc/minScore + không regressed + noise band).
 * Không ứng viên nào đạt gate → rơi về top scan có hướng LONG/SHORT, kèm nhãn
 * "CHƯA đạt gate" để user biết engine thực tế sẽ KHÔNG gửi combo này đi.
 * Scan rỗng/toàn NEUTRAL → null (caller dùng setup giả mẫu làm phương án cuối).
 */
export function llmTestSetup(
  rows: ScanRow[],
  cfg: Pick<AutoConfig, "minAuc" | "minAcc" | "minScore" | "tpMode" | "slPct" | "tpPct" | "riskPct">,
  leverage: number,
): { setup: LlmSetup; source: string } | null {
  const cands = rows.filter(
    (r) => isTradeable(r, cfg.minAuc, cfg.minAcc, cfg.minScore) && !r.regressed && Math.abs(r.prob - 0.5) >= pval("NOISE_BAND", NOISE_BAND),
  );
  const pick = rankRows(cands)[0] ?? rankRows(rows.filter((r) => r.bias !== "NEUTRAL"))[0] ?? null;
  if (!pick) return null;
  const gated = cands.includes(pick);
  const setup: LlmSetup = {
    symbol: pick.symbol,
    interval: pick.interval,
    side: pick.bias as "LONG" | "SHORT",
    prob: pick.prob,
    confidence: pick.confidence,
    auc: pick.auc,
    acc: pick.acc,
    slPct: cfg.tpMode === "manual" ? cfg.slPct : pick.slPct,
    tpPct: cfg.tpMode === "manual" ? cfg.tpPct : pick.tpPct,
    leverage,
    // RISK ENVELOPE — “Duyệt thử” thấy stake engine THỰC SỰ sẽ cam (sau kẹp
    // trần RISK_MAX_STAKE), cùng con số prompt Risk Officer đang duyệt.
    stakePct: clampStake(cfg.riskPct),
    horizon: pick.horizon,
    samples: pick.samples,
    score: pick.score,
    gatePassed: gated,
    // champion–challenger — "Duyệt thử" nhìn thấy Y HỆT những gì engine gửi:
    // kể cả khoảng cách tới đỉnh best-ever của cặp này (champ_check)
    ...(pick.champAuc ? { champAuc: pick.champAuc, champAcc: pick.champAcc } : {}),
  };
  const id = `${pick.symbol} ${pick.interval}`;
  return {
    setup,
    source: gated
      ? `REAL setup — the engine's best current candidate: ${id} · score ${pick.score.toFixed(2)} · gate passed`
      : `REAL setup — top of scan: ${id} · score ${pick.score.toFixed(2)} · gate NOT passed (no candidate above the gate yet)`,
  };
}

// ─── Confluence pooling — các model train riêng của CÙNG symbol vote chung ───
// Trước đây mỗi combo (symbol × khung) là một hòn đảo: BTC 15m và BTC 1h train
// riêng, chấm riêng, không biết nhau tồn tại. Nhưng chúng là những bằng chứng
// về CÙNG chiều giá — ghép lại bằng log-odds pooling (Naive-Bayes):
//
//   p_pool = sigmoid( ( w_self·logit(p_self) + Σ λ·wⱼ·logit(pⱼ) ) / ( w_self + Σ λ·wⱼ ) )
//   wᵢ = max(0.2, (aucᵢ − 0.5) × 4)    model yếu → phiếu nhẹ
//   phiếu từ khung KHÁC × λ = 0.5       các khung correlate, không độc lập hoàn toàn
//
// prob LUÔN là P(giá đi lên) nên dấu logit tự mã hóa hướng — pool thô trong
// một hệ quy chiếu duy nhất, KHÔNG map theo phía từng row. Các khung cùng
// hướng → |logit| cộng dồn → Prob tổng đội lên thật sự; lệch hướng → các
// logit triệt tiêu nhau → xả về 0.5 → bias NEUTRAL → không trade. Model
// NEUTRAL (prob ≈ 0.5) tự động bỏ phiếu trắng vì logit(0.5) = 0. An toàn:
// bất đồng quá mức có thể kéo prob vắt qua 0.5 → kẹp về đúng 0.5 (KHÔNG lật
// chiều call của model gốc — hội đồng bất đồng thì đứng ngoài), và prob cuối
// kẹp [0.05, 0.95] — bỏ phiếu correlate không được biến thành tuyệt đối.
// prob/confidence/bias/score sau ghép dùng ĐÚNG công thức gốc (biasFrom,
// |p−0.5|×2, scoreFrom) — vẫn chỉ một thuật toán. SIBLING_DISCOUNT + PROB_CAP
// sống ở ./params (nhóm CONFLUENCE) để finetune một chỗ.

const logitC = (p: number): number => {
  const q = Math.min(0.98, Math.max(0.02, p)); // chống ±∞ ở đầu mút
  return Math.log(q / (1 - q));
};
const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x));

export function confluenceBlend(rows: ScanRow[]): ScanRow[] {
  const bySym = new Map<string, ScanRow[]>();
  for (const r of rows) {
    const l = bySym.get(r.symbol);
    if (l) l.push(r);
    else bySym.set(r.symbol, [r]);
  }
  const out = rows.map((r) => ({ ...r }));
  const outByKey = new Map(out.map((r) => [`${r.symbol}|${r.interval}`, r]));
  for (const group of bySym.values()) {
    if (group.length < 2) continue; // không có anh em cùng symbol → giữ nguyên
    for (const r of group) {
      const dev = r.prob - 0.5;
      const band = pval("NOISE_BAND", NOISE_BAND);
      if (Math.abs(dev) < band) continue; // row tự thân coin-flip → không mượn phiếu
      const side = dev > 0 ? 1 : -1;
      const wSelf = Math.max(0.2, (r.auc - 0.5) * 4);
      let num = wSelf * logitC(r.prob);
      let den = wSelf;
      for (const s of group) {
        if (s === r) continue;
        const w = Math.max(0.2, (s.auc - 0.5) * 4) * pval("SIBLING_DISCOUNT", SIBLING_DISCOUNT);
        num += w * logitC(s.prob); // dấu logit tự mã hóa hướng — pool thô
        den += w;
      }
      const pooled = sigmoid(num / den);
      // bất đồng quá mức có thể kéo prob vắt qua 0.5 — không bao giờ lật chiều
      // call của model gốc: kẹp về đúng 0.5 → bias NEUTRAL → đứng ngoài cuộc
      const kept = side > 0 ? Math.max(pooled, 0.5) : Math.min(pooled, 0.5);
      const cap = pval("PROB_CAP", PROB_CAP);
      const row = outByKey.get(`${r.symbol}|${r.interval}`)!;
      row.prob = Math.round(Math.min(cap, Math.max(1 - cap, kept)) * 10_000) / 10_000;
      row.confidence = Math.abs(row.prob - 0.5) * 2; // công thức gốc xgb.ts
      row.bias = biasFrom(row.prob); // ngưỡng chết gốc 0.56/0.44
      row.score = scoreFrom(row.auc, row.acc, row.confidence);
    }
  }
  return out;
}

// ─── CONFLUENCE TABLE — Multi-TF đồng thuận / xung đột ───
// Đọc từ ScanRow[] đã blend. Không đổi prob/score, chỉ tổng hợp để hiển thị.
// Verdict: STRONG (4/4) · LEAN (3/4, khung lệch là khung nhỏ) · CONFLICT (2/2 hoặc khung lớn lệch)
export function confluenceTable(rows: ScanRow[]): Array<{
  symbol: string; tfs: Record<string, { side: string; score: number; prob: number }>;
  longW: number; shortW: number; agree: string; verdict: "STRONG" | "LEAN" | "CONFLICT"; action: string;
}> {
  const TF_W: Record<string, number> = { "1h": 3, "4h": 3, "15m": 2, "5m": 1, "1m": 1, "30m": 1, "1d": 3, "1w": 3 };
  const bySym = new Map<string, ScanRow[]>();
  for (const r of rows) {
    const l = bySym.get(r.symbol);
    if (l) l.push(r); else bySym.set(r.symbol, [r]);
  }
  const out: ReturnType<typeof confluenceTable> = [];
  for (const [symbol, group] of bySym) {
    const tfs: Record<string, { side: string; score: number; prob: number }> = {};
    let longW = 0, shortW = 0, nLong = 0, nShort = 0;
    for (const r of group) {
      const side = r.prob > 0.56 ? "LONG" : r.prob < 0.44 ? "SHORT" : "FLAT";
      tfs[r.interval] = { side, score: r.score ?? 0, prob: r.prob };
      const w = TF_W[r.interval] ?? 1;
      if (side === "LONG") { longW += w; shortW += 0; nLong++; }
      else if (side === "SHORT") { shortW += w; nShort++; }
    }
    const total = nLong + nShort;
    let verdict: "STRONG" | "LEAN" | "CONFLICT" = "CONFLICT";
    let agree = `${Math.max(nLong, nShort)}/${total || 1}`;
    let action = "Đứng ngoài — xung đột";
    if (total >= 3 && (nLong === total || nShort === total)) { verdict = "STRONG"; action = nLong ? "Ưu tiên LONG" : "Ưu tiên SHORT"; }
    else if (total >= 3 && Math.max(nLong, nShort) === total - 1) {
      // 3/4 — chỉ LEAN nếu khung lệch là khung nhỏ (5m/1m), khung lớn lệch → CONFLICT
      const minority = group.find((r) => (r.prob > 0.56 ? "LONG" : r.prob < 0.44 ? "SHORT" : "FLAT") !== (nLong > nShort ? "LONG" : "SHORT") && (r.prob > 0.56 || r.prob < 0.44));
      if (!minority || (TF_W[minority.interval] ?? 1) <= 1) { verdict = "LEAN"; action = nLong > nShort ? "Nghiêng LONG" : "Nghiêng SHORT"; }
    }
    out.push({ symbol, tfs, longW, shortW, agree, verdict, action });
  }
  const rank = { STRONG: 0, LEAN: 1, CONFLICT: 2 };
  return out.sort((a, b) => rank[a.verdict] - rank[b.verdict] || b.longW + b.shortW - (a.longW + a.shortW));
}

/**
 * Pick the best tradeable row whose combo is NOT in an SL cooldown. A combo
 * that just stopped out tends to stay hostile — re-entering it immediately is
 * how dry-run books bleed. Cooldown 0 disables the check entirely.
 * trades must be newest-first (as /api/autotrade returns them).
 */
export function slCooldownLeft(
  trades: AutoTradeRow[],
  symbol: string,
  interval: string,
  cooldownMin: number,
  now = Date.now(),
): number {
  if (cooldownMin <= 0) return 0;
  const last = trades.find(
    (t) => t.status === "closed" && t.exitKind === "sl" && t.symbol === symbol && t.interval === interval,
  );
  if (!last?.exitTime) return 0;
  const end = new Date(last.exitTime).getTime() + cooldownMin * 60_000;
  return Math.max(0, Math.ceil((end - now) / 60_000));
}

/** The newest SL-closed trade of a combo (newest-first trades), if any. */
export function lastSlExit(
  trades: AutoTradeRow[],
  symbol: string,
  interval: string,
): AutoTradeRow | null {
  return trades.find(
    (t) => t.status === "closed" && t.exitKind === "sl" && t.symbol === symbol && t.interval === interval,
  ) ?? null;
}

/**
 * FLIP cooldown — phút còn lại trước khi cho phép lật chiều lại trên cùng combo.
 * Anti-churn: model đảo chiều liên tục trong thị trường nhiễu có thể lật lệnh
 * mỗi 5 phút (mỗi cycle), mỗi lần trả spread + reset SL/TP. Cooldown chặn nhịp
 * lật dày quá — flip là luận điểm MỚI nên phải đợi đủ thời gian để luận điểm cũ
 * thực sự thanh lý. 0 = tắt (giữ hành vi cũ). trades phải newest-first.
 *
 * Pha 1 (control-plane fix): knob tĩnh + self-improve agent (src/lib/self-improve)
 * sẽ nắn `flipCooldownMin` theo flip-expectancy thật sau đủ mẫu.
 */
export function flipCooldownLeft(
  trades: AutoTradeRow[],
  symbol: string,
  interval: string,
  cooldownMin: number,
  now = Date.now(),
): number {
  if (cooldownMin <= 0) return 0;
  const last = trades.find(
    (t) => t.status === "closed" && t.exitKind === "flip" && t.symbol === symbol && t.interval === interval,
  );
  if (!last?.exitTime) return 0;
  const end = new Date(last.exitTime).getTime() + cooldownMin * 60_000;
  return Math.max(0, Math.ceil((end - now) / 60_000));
}

/**
 * Chase guard — the "SL xong vào lại giá cao hơn" blocker.
 * After an SL exit on the SAME combo, a same-side re-entry is only allowed
 * once the price has reversed back through the exit level (SHORT: price is
 * back BELOW the level that stopped us; LONG: back ABOVE it). Re-entering a
 * SHORT at/above the stop that just fired is fighting the move that broke the
 * thesis — bleed by a thousand cuts. An OPPOSITE-side entry is a fresh thesis
 * and always passes.
 */
export function passesChaseGuard(
  trades: AutoTradeRow[],
  symbol: string,
  interval: string,
  side: string,
  price: number,
): boolean {
  const last = lastSlExit(trades, symbol, interval);
  if (!last?.exitPrice || !price) return true;
  if (side !== last.side) return true; // bias flipped → fresh thesis
  const eps = last.exitPrice * 1e-6;
  return side === "SHORT" ? price < last.exitPrice - eps : price > last.exitPrice + eps;
}

/** AUC drop vs the combo's champion that marks a retrain as a regression —
 *  giá trị sống ở ./params (re-export đầu file). */

/** Attach the combo's champion metrics to a fresh scan row (+ regression flag). */
export function withChampion(r: ScanRow, champAuc: number, champAcc: number): ScanRow {
  return {
    ...r,
    champAuc,
    champAcc,
    regressed: champAuc > 0 && r.auc < champAuc - pval("REGRESS_EPS", REGRESS_EPS),
  };
}

/** 0.3.1 — funnel vào lệnh phải NÓI RA lý do: đếm số dòng scan bị TỪNG cổng
 *  chặn (phân loại theo cổng trượt ĐẦU TIÊN — một dòng chỉ đếm một lần, đúng
 *  thứ tự engine kiểm tra). Client vẽ tooltip từng dòng, server ghép vào status
 *  "no tradeable combo (…)" — hết cảnh bảng có signal mà không hiểu vì sao
 *  dry-run đứng yên. */
export interface GateBlocked {
  /** sàn chất lượng: bias NEUTRAL hoặc AUC/ACC/Điểm dưới cfg.minAuc/minAcc/minScore */
  floor: number;
  /** train mới AUC tụt dưới champion (champion–challenger) */
  regress: number;
  /** whale filter: nến khối lượng cuối ≥4σ */
  whale: number;
  /** noise band XGBoost: |P−0.5| < NOISE_BAND (model chưa dứt khoát) */
  band: number;
  /** sàn SHORT: 1−prob < SHORT_PROB_MIN */
  shortMin: number;
  /** EV gate: kỳ vọng ROI (prob·tp − (1−prob)·sl)·lev − phí < EV_GATE_MIN */
  ev: number;
}

export function bestTradeableAvoid(
  rows: ScanRow[],
  minAuc: number,
  minAcc: number,
  trades: AutoTradeRow[],
  cooldownMin: number,
  whaleFilter = true,
  /** XGBoost noise band — skip coin-flip probs (|P−0.5| < band); 0 = off */
  noiseBand = pval("NOISE_BAND", NOISE_BAND),
  /** ngưỡng điểm của cùng bộ setpoint chung — 0 = không chấm điểm */
  minScore = 0,
  /** đòn bẩy cấu hình cho EV gate (0.2.89) — 0 = tắt gate (test cũ dùng 0) */
  lev = 0,
): { best: ScanRow | null; allInCooldown: boolean; cands: ScanRow[]; regressedCount: number; blocked: GateBlocked } {
  // whaleFilter (default on) skips combos whose last closed candle is a full
  // whale bar (≥4σ volume) — entries opened into those get wicked out.
  // noiseBand skips model probs with no decisive lean (0.5 ± band) — the
  // XGBoost denoiser: an undecided model is statistical noise, not a signal.
  // regressed combos (this retrain measurably worse than the combo's champion)
  // never trade — no gambling on a bad roll.
  // 0.2.87 — SHORT_CHỌN LỌC: vào lệnh SHORT MỚI phải chắc chắn theo phía ngắn
  // tối thiểu SHORT_PROB_MIN (1−prob ≥ ngưỡng; 0.6 = prob ≤ 0.40). Sổ dry-run
  // chứng minh SHORT "vừa đủ gate" là phần thua lớn nhất — LONG giữ nguyên
  // noise band. Chỉ áp vào-lệnh-thường; flip có FLIP_PROB_MIN riêng đã chặt hơn.
  const shortMin = pval("SHORT_PROB_MIN", SHORT_PROB_MIN);
  // 0.2.89 — EV GATE: kỳ vọng ROI của chính candidate (prob/tp/sl của nó ×
  // đòn bẩy cấu hình − phí round-trip) phải ≥ EV_GATE_MIN. Lệnh cấu trúc âm
  // chết ở cổng thay vì đợi sổ phán — audit 08/11: LONG payoff 0.48 với prob
  // "tự tin" 0.72–0.79 vẫn thua ⇒ prob không bảo vệ được lệnh EV âm. Lưu ý:
  // dùng sl/tp dòng scan (train-time); mode "dyn" thay mức live lúc vào nên
  // gate là xấp xỉ — chấp nhận được vì cùng gốc ATR. lev ≤ 0 hoặc knob
  // ≤ −100 → tắt (tương thích cũ, test cũ không đổi).
  const evMin = pval("EV_GATE_MIN", EV_GATE_MIN);
  // prob của ScanRow là xác suất chiều LÊN (P_UP): LONG thắng với prob, SHORT
  // thắng với 1−prob — gate phải dùng xác suất thắng của chính phía lệnh.
  const evOf = (r: ScanRow, lev: number): number => {
    const pWin = r.bias === "SHORT" ? 1 - r.prob : r.prob;
    return pWin * r.tpPct * lev - (1 - pWin) * r.slPct * lev - feeRoi(lev);
  };
  // 0.3.1 — phân loại cổng trượt ĐẦU TIÊN của từng dòng (đúng thứ tự điều kiện
  // dưới) — tổng blocked = số dòng bị loại, đối chiếu 1-1 với bảng scan UI.
  const blocked: GateBlocked = { floor: 0, regress: 0, whale: 0, band: 0, shortMin: 0, ev: 0 };
  // HOT/WARM Combo (Fast Evolve) — tiến hóa sau mỗi lệnh, không chờ vòng evolveRound
  // HOT: closed>=3 + WR>=60% + net>0 + không thua 2 liên tiếp -> gate riêng -5 / -0.02 / -3
  // WARM: closed>=1 + WR>=50% -> gate riêng -2 score, không giảm AUC/ACC
  // Vẫn phải qua regress / whale / noise / SHORT / EV như mọi row khác — HOT chỉ nới sàn, không miễn kiểm
  const hotMap = new Map(comboStats(trades).map((c) => [`${c.symbol}|${c.interval}`, c]));
  const last2Lost = (sym: string, itv: string): boolean => {
    const closed = trades.filter((t) => t.symbol === sym && t.interval === itv && t.status === "closed");
    return closed.length >= 2 && (closed[0].pnlPct ?? 0) <= 0 && (closed[1].pnlPct ?? 0) <= 0;
  };
  const effGate = (r: ScanRow): { auc: number; acc: number; score: number; tag: string } => {
    const c = hotMap.get(`${r.symbol}|${r.interval}`);
    if (!c) return { auc: minAuc, acc: minAcc, score: minScore, tag: "" };
    if (c.closed >= 3 && c.winRate >= 60 && c.netPnlPct > 0 && !last2Lost(r.symbol, r.interval))
      return { auc: minAuc - 0.02, acc: minAcc - 3, score: minScore - 5, tag: "HOT" };
    if (c.closed >= 1 && c.winRate >= 50)
      return { auc: minAuc, acc: minAcc, score: minScore - 2, tag: "WARM" };
    return { auc: minAuc, acc: minAcc, score: minScore, tag: "" };
  };
  const cands = rankRows(
    rows.filter((r) => {
      const eff = effGate(r);
      if (!isTradeable(r, eff.auc, eff.acc, eff.score)) {
        blocked.floor++;
        return false;
      }
      if (r.regressed) {
        blocked.regress++;
        return false;
      }
      if (whaleFilter && r.whale?.tag === "whale") {
        blocked.whale++;
        return false;
      }
      if (noiseBand > 0 && Math.abs(r.prob - 0.5) < noiseBand) {
        blocked.band++;
        return false;
      }
      if (r.bias === "SHORT" && shortMin > 0.5 && 1 - r.prob < shortMin) {
        blocked.shortMin++;
        return false;
      }
      if (lev > 0 && evMin > -100 && evOf(r, lev) < evMin) {
        blocked.ev++;
        return false;
      }
      return true;
    }),
  );
  const hotCount = cands.filter((r) => effGate(r).tag === "HOT").length;
  const warmCount = cands.filter((r) => effGate(r).tag === "WARM").length;
  if (hotCount > 0 || warmCount > 0) console.log(`[engine] HOT/WARM — ${hotCount} HOT / ${warmCount} WARM combo qua gate nới (HOT -5/-0.02/-3, WARM -2)`);
  const regressedCount = blocked.regress; // cùng ngữ nghĩa: đạt sàn nhưng tụt vs champion
  const free = cands.find((r) => slCooldownLeft(trades, r.symbol, r.interval, cooldownMin) === 0) ?? null;
  return { best: free, allInCooldown: free == null && cands.length > 0, cands, regressedCount, blocked };
}

// ─── Auto-flip — thị trường luôn biến động, dự báo chỉ là dự báo ─────────────
// Khi lệnh đang mở mà scan mới của CÙNG cặp/khung đảo chiều với tín hiệu ĐỦ
// TIN CẬY (cùng ngưỡng chất lượng với vào lệnh + noise band + không regressed +
// sạch nến whale), engine lật lệnh NGAY thay vì ôm chiều cũ đến SL/TP. Hàm
// này là bộ LOẠI thuần (không IO) — engine gọi rồi tự đóng/mở; test chạy thẳng.

export interface FlipDecision {
  /** true = đủ điều kiện lật chiều */
  ok: boolean;
  /** lý do KHÔNG lật (khi ok=false) — log + status line, không âm thầm */
  why: string;
}

/**
 * Đủ tin cậy để lật chiều lệnh `open` theo scan row `row` (CÙNG symbol+interval)?
 *  • row phải có bias NGƯỢC phía lệnh (NEUTRAL = model bỏ cuộc → không lật theo nhiễu)
 *  • cùng NGƯỠNG CHẤT LƯỢNG với vào lệnh: minAuc/minAcc/minScore (isTradeable)
 *  • không regressed vs champion (mỗi lần lật phải tín hiệu thật, không phải model hỏng)
 *  • ngoài noise band |P−0.5| ≥ NOISE_BAND — model dứt khoát, không coin-flip
 *  • whale filter (nếu bật): nến khối lượng ≥4σ là bẫy wick, không lật vào đó
 */
export function flipDecision(
  open: Pick<AutoTradeRow, "symbol" | "interval" | "side">,
  row: ScanRow | undefined,
  cfg: Pick<AutoConfig, "minAuc" | "minAcc" | "minScore" | "whaleFilter">,
): FlipDecision {
  if (!row) return { ok: false, why: "scan has no such combo" };
  if (row.bias === "NEUTRAL") return { ok: false, why: "model is NEUTRAL on the open combo" };
  if (row.bias === open.side) return { ok: false, why: "model still confirms the held side" };
  if (!isTradeable(row, cfg.minAuc, cfg.minAcc, cfg.minScore))
    return {
      ok: false,
      why: `opposite signal below the quality gate (AUC ${row.auc.toFixed(2)} / ACC ${row.acc.toFixed(2)}% / score ${row.score.toFixed(2)})`,
    };
  if (row.regressed) return { ok: false, why: "this combo's model is regressed vs its champion" };
  if (Math.abs(row.prob - 0.5) < pval("NOISE_BAND", NOISE_BAND)) return { ok: false, why: "signal inside the coin-flip noise band" };
  if (cfg.whaleFilter && row.whale?.tag === "whale") return { ok: false, why: "last candle is a whale bar — not flipping into a wick trap" };
  // ── FLIP BẤT ĐỐI XỨNG (0.2.72) — lật chiều phải chắc chắn HƠN mở lệnh ──
  // Data: ~75 flip net −105% ROI trong khi TP:SL 16:6 dương — flip theo tín
  // hiệu “vừa vượt sàn” là chảy máu. Một flip tốn exit + entry mới + reset
  // SL/TP nên ngưỡng PHẢI bất đối xứng với vào lệnh thường:
  //   (a) prob THEO PHÍA MỚI ≥ FLIP_PROB_MIN (vào lệnh chỉ cần vượt noise band)
  //   (b) score ≥ sàn vào lệnh + FLIP_SCORE_EXTRA
  // Hai nút chỉnh runtime /ai; hạ 0.5 / 0 = tắt (về hành vi đối xứng cũ).
  const fpMin = pval("FLIP_PROB_MIN", FLIP_PROB_MIN);
  if (fpMin > 0.5) {
    const toward = row.bias === "LONG" ? row.prob : 1 - row.prob;
    if (toward < fpMin)
      return { ok: false, why: `flip cần prob ≥ ${(fpMin * 100).toFixed(2)}% theo phía mới (đang ${(toward * 100).toFixed(2)}%) — dưới mức ổn cho vào lệnh thường` };
  }
  const sx = pval("FLIP_SCORE_EXTRA", FLIP_SCORE_EXTRA);
  if (sx > 0 && row.score < cfg.minScore + sx) {
    return { ok: false, why: `flip cần score ≥ ${cfg.minScore + sx} (sàn vào lệnh +${sx}; đang ${row.score.toFixed(2)})` };
  }
  return { ok: true, why: "" };
}

// ─── Kline fetch + full scan ──────────────────────────────────────────────────

const sleep = (ms = 0) => new Promise((r) => globalThis.setTimeout(r, ms));

/** `limit` optional — universe scan passes 240 (10 ngày × nến 1h). */
export async function fetchKlines(symbol: string, interval: string, limit?: number): Promise<Kline[]> {
  const q = limit && limit > 0 ? `&limit=${limit}` : "";
  const res = await fetch(`/api/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}${q}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = (await res.json()) as { klines: Kline[] };
  return json.klines;
}

export interface ScanProgress {
  done: number;
  total: number;
  current: string;
}

/**
 * Train a model for EVERY pair × interval combo (sequential so the UI stays
 * alive) and return the ranked scan. Difficulty is pinned to 0 — a fair race.
 * Combos that fail (bad pair, starved dataset) are skipped silently.
 */
export async function scanAll(opts: {
  pairs: string[];
  intervals?: readonly string[];
  settings: EngineSettings;
  onProgress?: (p: ScanProgress) => void;
  shouldAbort?: () => boolean;
}): Promise<ScanRow[]> {
  const intervals = opts.intervals ?? INTERVALS;
  const total = opts.pairs.length * intervals.length;
  const rows: ScanRow[] = [];
  let done = 0;
  for (const symbol of opts.pairs) {
    for (const interval of intervals) {
      if (opts.shouldAbort?.()) return rankRows(rows);
      const label = `${symbol} ${interval}`;
      opts.onProgress?.({ done, total, current: label });
      try {
        const klines = await fetchKlines(symbol, interval);
        // below ~260 candles the model starves (WARMUP 110 + labels) — skip
        if (klines.length >= 260) {
          const res = await runXgb(klines, opts.settings, `${symbol}-${interval}`, interval, undefined, 0);
          rows.push(rowOf(res, symbol, interval));
        }
      } catch {
        // unreachable pair / not enough data → leave this combo out
      }
      done++;
      opts.onProgress?.({ done, total, current: label });
      await sleep(); // yield between combos
    }
  }
  return rankRows(rows);
}

// ─── Position math ────────────────────────────────────────────────────────────

/** Signed ROI % of a position at `price` (leverage applied). */
export function roiOf(side: string, entry: number, price: number, leverage: number): number {
  if (!entry || !price) return 0;
  const move = side === "SHORT" ? ((entry - price) / entry) * 100 : ((price - entry) / entry) * 100;
  return Math.round(move * leverage * 100) / 100;
}

/** "sl" | "tp" | null — has the LIVE price crossed the SL/TP of the position? */
export function slTpHit(side: string, price: number, entry: number, slPct: number, tpPct: number): "sl" | "tp" | null {
  if (!entry || !price) return null;
  const roi = roiOf(side, entry, price, 1); // price-move % (no leverage)
  if (roi <= -Math.abs(slPct)) return "sl";
  if (roi >= Math.abs(tpPct)) return "tp";
  return null;
}

/** Liquidation guard — adverse price move of 100/leverage % wipes the margin. */
export function liquidationHit(side: string, price: number, entry: number, leverage: number): boolean {
  if (leverage <= 1 || !entry || !price) return false;
  const move = side === "SHORT" ? ((entry - price) / entry) * 100 : ((price - entry) / entry) * 100;
  return move <= -(100 / leverage);
}

// ─── SL/TP × LEVERAGE (0.2.72) — độc lập rủi ro ROI theo đòn bẩy ──────────────

/**
 * Hệ số chuẩn hoá khoảng cách SL/TP theo leverage (TP_LEV_MODE):
 *   off → 1 (legacy) · sqrt → √(ref/lev) · lin → ref/lev (độc lập hoàn toàn)
 * Chỉ THU HẸP khi lev > ref (min 1 với cả hai mode — lev ≤ ref giữ nguyên:
 * rủi ro ROI-at-SL chỉ NHỎ HƠN baseline, không bao giờ TO hơn). Giá trị lạ /
 * lev ≤ 0 → 1 (an toàn). ROI-at-SL = slPct × lev ≈ hằng số bằng baseline.
 */
export function levNormScale(lev: number): number {
  const mode = String(pval("TP_LEV_MODE", TP_LEV_MODE) ?? "off").trim().toLowerCase();
  if (mode !== "lin" && mode !== "sqrt") return 1;
  const ref = pval("TP_LEV_REF", TP_LEV_REF);
  if (!(lev > 0) || !(ref > 0)) return 1;
  const r = ref / lev;
  return Math.min(1, mode === "lin" ? r : Math.sqrt(r));
}

/**
 * Máy tính SL/TP độc lập leverage — áp lên CẶP khoảng cách (theo % giá) trước
 * khi ghi vào lệnh:
 *  1. nhân `scale` (levNormScale; caller truyền 1 cho tpMode "manual");
 *  2. mui an toàn thanh khoản: SL không vượt TP_LIQ_SAFE% quãng đường tới giá
 *     thanh lý (100/lev %) — áp MỌI mode, manual cũng không đặt SL ngoài liq;
 *  3. sàn 0.15% — scale không đẩy SL vào vùng spread-noise (khi mui cho phép);
 *  mọi lần co giãn đều kéo TP theo CÙNG hệ số → R:R giữ nguyên. SL làm tròn
 *  XUỐNG 2 chữ số (không bao giờ xa hơn tính toán — ROI-at-SL không vượt
 *  baseline vì làm tròn); TP làm tròn thường (chỉ lạc ≤ 0.01% khoảng cách).
 */
export function levAdjSlTp(sl: number, tp: number, scale: number, lev: number): { slPct: number; tpPct: number } {
  const safe = pval("TP_LIQ_SAFE", TP_LIQ_SAFE);
  // Kẹp đầu vào — SL/TP âm / 0 / NaN không bao giờ được vào lệnh (XLM cũ sl -0.32% là từ đây)
  // Fallback an toàn: SL 0.8% / TP 1.2% (đúng floor 5m), giữ R:R 1.5
  if (!isFinite(sl) || sl <= 0) sl = lev > 0 ? Math.max(0.2, 4 / lev) : 0.8;
  if (!isFinite(tp) || tp <= 0) tp = sl * 1.5;
  if (!isFinite(scale) || scale <= 0) scale = 1;
  let s = sl * scale;
  let t = tp * scale;
  const cap = lev > 0 ? (safe / 100) * (100 / lev) : 0; // = safe/lev (% giá)
  if (cap > 0 && s > cap) {
    const k = cap / s;
    s *= k;
    t *= k;
  }
  // MUI TRẦN LỖ ROI (0.2.89) — audit sổ 08/11: OP −60 ROI ở ×20 là hợp lệ
  // theo mui thanh khoản (SL 2.9% giá). TB thua −17.76 ROI trong khi TB thắng
  // chỉ +8.49 — payoff 0.48 là nguồn chảy máu chính của LONG. Trần ROI-at-SL:
  // s × lev không vượt SL_ROI_MAX, vượt thì co SL+TP cùng hệ số (R:R giữ
  // nguyên, cùng kiểu mui liq phía trên). 0 = tắt.
  const roiCap = pval("SL_ROI_MAX", SL_ROI_MAX);
  if (roiCap > 0 && lev > 0 && s * lev > roiCap) {
    const k = roiCap / (s * lev);
    s *= k;
    t *= k;
  }
  if (s > 0 && s < 0.15 && cap >= 0.15) {
    const k = 0.15 / s;
    s *= k;
    t *= k;
  }
  // Kẹp đầu ra — không bao giờ trả SL/TP <= 0 dù cap/roiCap có co tới đâu
  if (!isFinite(s) || s <= 0) s = 0.15;
  if (!isFinite(t) || t <= 0) t = s * 1.5;
  return { slPct: Math.floor(s * 100) / 100, tpPct: Math.round(t * 100) / 100 };
}

/** Warn once the price has covered this share of the way to TP/SL (0..1) —
 *  giá trị sống ở ./params (re-export đầu file). */

/** "tp" | "sl" | null — giá đang NẰM TRONG dải sắp chạm TP/SL nhưng CHƯA vượt. */
export function nearHit(side: string, price: number, entry: number, slPct: number, tpPct: number): "tp" | "sl" | null {
  if (!entry || !price) return null;
  const roi = roiOf(side, entry, price, 1); // price-move % (no leverage)
  const tp = Math.abs(tpPct);
  const sl = Math.abs(slPct);
  if (roi >= tp * NEAR_FRAC && roi < tp) return "tp";
  if (roi <= -sl * NEAR_FRAC && roi > -sl) return "sl";
  return null;
}

// ─── Trailing stop — dừng lệnh di động bảo vệ lợi nhuận ───────────────────────

/** Đỉnh/gáy mới cho trailing: LONG giữ giá cao nhất seen, SHORT giữ đáy thấp nhất.
 *  prevPeak = 0 (mới mở) → lấy giá hiện tại; caller khởi tạo peak = entry. */
export function trailNextPeak(side: string, prevPeak: number, price: number): number {
  if (!price) return prevPeak;
  if (!prevPeak) return price;
  return side === "SHORT" ? Math.min(prevPeak, price) : Math.max(prevPeak, price);
}

/** Lời hiện có của đỉnh so với entry — % DI CHUYỂN GIÁ (chưa nhân đòn bẩy,
 *  cùng đơn vị slPct/tpPct; ROI = số này × leverage). */
export function trailMovePct(side: string, entry: number, peak: number): number {
  if (!entry || !peak) return 0;
  return side === "SHORT" ? ((entry - peak) / entry) * 100 : ((peak - entry) / entry) * 100;
}

/** Giá stop trailing hiện hành — null = CHƯA armed (đỉnh chưa đạt mức kích hoạt).
 *  LONG: stop = đỉnh × (1 − dist%); SHORT: stop = đáy × (1 + dist%).
 *  Khi vừa armed, stop ≈ hoà vốn hoặc tốt hơn nếu dist ≤ act — đúng tinh thần
 *  "khoá lời"; trước đó SL tĩnh gốc vẫn là lưới an toàn duy nhất. */

/** Trail ROI (B) — peakROI > TRAIL_ROI_ARM (3%) => stopROI = peakROI - TRAIL_ROI_GIVEBACK (2%).
 *  Tra ve gia stop tuong ung: LONG entry*(1+(stopROI)/lev/100),
 *  SHORT entry*(1-(stopROI)/lev/100). ROI o day la % (vd 8.91 = +8.91%). */
export function trailRoiStopPrice(side: string, entry: number, peakRoi: number, leverage: number): number | null {
  if (!entry || !leverage || peakRoi < TRAIL_ROI_ARM) return null;
  // spec #2+#3: lock tối thiểu 2% ROI, gap 1% từ peak (chỉ tăng nhờ peak monotonic)
  const stopRoi = Math.max(peakRoi - TRAIL_ROI_GIVEBACK, 2);
  const m = stopRoi / leverage / 100;
  return side === "SHORT" ? entry * (1 - m) : entry * (1 + m);
}

export function trailStopPrice(side: string, entry: number, peak: number, actPct: number, distPct: number): number | null {
  if (!entry || !peak) return null;
  if (trailMovePct(side, entry, peak) < Math.abs(actPct)) return null;
  const d = Math.abs(distPct) / 100;
  return side === "SHORT" ? peak * (1 + d) : peak * (1 - d);
}

/** TỰ ĐỀ XUẤT thông số trailing RIÊNG cho từng lệnh theo 3 yếu tố (0.2.63):
 *  • pair × khung giờ — atrPct = ATR(14) nến đã đóng / giá đóng × 100 đo trên
 *    chính khung giao dịch của lệnh: cặp nóng (PEPE, DOGE…) hay khung lớn
 *    (4h/1d) có ATR% lớn → đề xuất rộng hơn; cặp êm/khung nhỏ → sát hơn.
 *  • đòn bẩy — levScale = √(10/leverage) kẹp [0.5, 2]: đòn cao hơn tham chiếu
 *    ×10 → siết khoá lời chặt hơn (bảo vệ ROI), đòn thấp → nới room cho giá chạy.
 *  • công thức: act = atrPct × 1.2 × levScale (đi được ~1.2 ATR mới coi là xu
 *    hướng có thịt để khoá), dist = atrPct × 0.9 × levScale (nhường ~0.9 ATR
 *    đường về; vừa armed stop ≈ hoà vốn/lãi nhẹ).
 *  Ví dụ: BTC 15m êm (ATR 0.3%, lev 10) → act 0.36 / dist 0.27; PEPE 15m nóng
 *  (ATR 1.5%) → act 1.8 / dist 1.35; cùng cặp lev 20 → siết còn ×0.71. */
export function trailAutoLevels(atrPct: number, leverage: number): { actPct: number; distPct: number; levScale: number } {
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const levScale = Math.min(2, Math.max(0.5, Math.sqrt(10 / Math.max(1, leverage))));
  const cl = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, r2(v)));
  return {
    actPct: cl(atrPct * 1.2 * levScale, 0.2, 6),
    distPct: cl(atrPct * 0.9 * levScale, 0.15, 5),
    levScale: r2(levScale),
  };
}

// ─── Per-combo win-rate stats ────────────────────────────────────────────────

export interface ComboStat {
  symbol: string;
  interval: string;
  closed: number;
  wins: number;
  /** wins / closed, % (1 decimal) */
  winRate: number;
  /** sum of ROI % over closed trades */
  netPnlPct: number;
  /** netPnlPct / closed */
  avgPnlPct: number;
}

/** Aggregate closed trades into per (pair × timeframe) win-rate rows. */
export function comboStats(rows: Pick<AutoTradeRow, "symbol" | "interval" | "status" | "pnlPct">[]): ComboStat[] {
  const map = new Map<string, ComboStat>();
  for (const r of rows) {
    if (r.status !== "closed") continue;
    const key = `${r.symbol}|${r.interval}`;
    const s = map.get(key) ?? { symbol: r.symbol, interval: r.interval, closed: 0, wins: 0, winRate: 0, netPnlPct: 0, avgPnlPct: 0 };
    s.closed += 1;
    if ((r.pnlPct ?? 0) > 0) s.wins += 1;
    s.netPnlPct += r.pnlPct ?? 0;
    map.set(key, s);
  }
  const out = [...map.values()];
  for (const s of out) {
    s.netPnlPct = Math.round(s.netPnlPct * 100) / 100;
    s.winRate = s.closed > 0 ? Math.round((s.wins / s.closed) * 1000) / 10 : 0;
    s.avgPnlPct = s.closed > 0 ? Math.round((s.netPnlPct / s.closed) * 100) / 100 : 0;
  }
  return out.sort((a, b) => b.closed - a.closed || b.winRate - a.winRate);
}

// ─── Combo memory — phản hồi THẬT từ sổ dry-run (0.2.86) ─────────────────────
// AUC/ACC của model không đo được hiệu quả LIVE của combo; sổ dry-run mới là
// sự thật. Hàm thuần (không IO) đọc danh sách lệnh NEWEST-FIRST (đúng thứ tự
// AutoState.trades trả về) và trả về:
//   • streak — số lệnh LỖ liên tiếp mới nhất của combo (0 = lệnh mới nhất thắng)
//   • net / n — tổng ROI % và số lệnh trong cửa sổ `lookback` lệnh đóng gần nhất
// engine dùng comboMemoryReason() để tạm loại combo đang chảy máu khỏi vòng
// chọn lệnh — tự học khép kín, không cần đợi ai train lại.

export interface ComboMemory {
  /** consecutive newest-first losses (0 = newest closed trade won / none) */
  streak: number;
  /** sum of ROI % over the last `lookback` closed trades of the combo */
  net: number;
  /** how many closed trades fell inside the window */
  n: number;
}

export function comboMemoryOf(
  trades: Pick<AutoTradeRow, "symbol" | "interval" | "status" | "pnlPct">[],
  symbol: string,
  interval: string,
  lookback = 8,
): ComboMemory {
  let streak = 0;
  let streakDone = false;
  let net = 0;
  let n = 0;
  for (const t of trades) {
    if (t.status !== "closed" || t.symbol !== symbol || t.interval !== interval) continue;
    const pnl = t.pnlPct ?? 0;
    if (!streakDone) {
      if (pnl < 0) streak += 1;
      else streakDone = true; // first non-loss breaks the streak (0-pnl counts as non-loss)
    }
    if (n < Math.max(0, lookback)) {
      net += pnl;
      n += 1;
    }
    if (streakDone && n >= Math.max(0, lookback)) break;
  }
  return { streak, net: Math.round(net * 100) / 100, n };
}

/**
 * Gate "ghi nhớ combo" — null = combo được phép vào lệnh; string = lý do bị
 * tạm loại (hiện ở status line + pm2 log, không âm thầm). loseStreak/netFloor
 * = 0 → tắt tầng tương ứng.
 */
export function comboMemoryReason(
  mem: ComboMemory,
  loseStreak: number,
  netFloor: number,
): string | null {
  if (loseStreak > 0 && mem.streak >= loseStreak)
    return `streak ${mem.streak} lỗ liên tiếp (gate ${loseStreak})`;
  if (netFloor < 0 && mem.n >= 3 && mem.net <= netFloor)
    return `net ${mem.net.toFixed(2)}% ${mem.n} lệnh gần nhất ≤ ${netFloor}%`;
  return null;
}

// ─── Rolling champion — champion CÔNG BẰNG theo cửa sổ (0.2.86) ──────────────
// Champion cũ là best-ever SUỐT ĐỜI mọi run: một lần train "trúng số" (đặc
// biệt train tay difficulty cao — dead-zone/horizon khác hẳn quét) nâng thanh
// ngang vĩnh viễn, mọi lần quét sau bị gắn regressed → combo không bao giờ
// được trade lại. Champion mới:
//   • chỉ đếm run difficulty 0 (quét so quét — cùng thang đo, công bằng);
//   • chỉ nhìn N run gần nhất mỗi combo (CHAMP_WINDOW) — đỉnh cũ xạt xuống
//     theo thời gian, combo tự thoát ân hạn khi quét trở lại mức tốt của nó.
// `runs` phải NEWEST-FIRST (đúng thứ tự orderBy createdAt desc của DB).
// window ≤ 0 → giữ hành vi legacy (all-time, mọi difficulty).

export interface ChampRun {
  symbol: string;
  interval: string;
  acc: number;
  auc: number;
  /** difficulty của run — chỉ run lv 0 (quét) đủ tư cách làm champion */
  lv: number;
}

export function rollingChampions(
  runs: ChampRun[],
  window: number,
): Map<string, { auc: number; acc: number }> {
  const seen = new Map<string, number>(); // per-combo run counter (newest-first)
  const champ = new Map<string, { auc: number; acc: number }>();
  const win = Math.max(0, Math.round(window));
  for (const r of runs) {
    const k = `${r.symbol}|${r.interval}`;
    if (win > 0) {
      const c = seen.get(k) ?? 0;
      if (c >= win) continue; // ngoài cửa sổ N run gần nhất
      seen.set(k, c + 1);
      if (r.lv !== 0) continue; // train tay difficulty cao — khác thang đo quét
    }
    // legacy (window 0): all-time, MỌI difficulty đủ tư cách — đúng hành vi cũ
    const cur = champ.get(k);
    if (!cur || r.auc > cur.auc || (r.auc === cur.auc && r.acc > cur.acc)) champ.set(k, { auc: r.auc, acc: r.acc });
  }
  return champ;
}

/** Parse difficulty `lv` từ cột params (JSON) của FinetuneRun — hỏng/thiếu → 0. */
export function lvOfRunParams(params: string | null | undefined): number {
  try {
    const n = Number((JSON.parse(params ?? "{}") as { lv?: unknown }).lv);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
  } catch {
    return 0;
  }
}

// ─── Position book (SQLite via /api/autotrade) ────────────────────────────────

export interface AutoTradeRow {
  id: string;
  symbol: string;
  interval: string;
  side: string;
  entryPrice: number;
  entryTime: string;
  slPct: number;
  tpPct: number;
  leverage: number;
  /** share of equity staked on this trade, % (100 = all-in) */
  stakePct: number | null;
  status: string;
  exitPrice: number | null;
  exitTime: string | null;
  pnlPct: number | null;
  exitKind: string | null;
  prob: number | null;
  acc: number | null;
  auc: number | null;
  score: number | null;
  capitalBefore: number | null;
  capitalAfter: number | null;
  /** verdict LLM lúc vào lệnh — go | skip | unreachable (null = trước 0.2.28) */
  llmVerdict: string | null;
  /** lý do đầu tiên của verdict lúc vào lệnh */
  llmReason: string | null;
  /** JSON giải phẫu lệnh (autopsy) sau khi đóng — xem src/lib/autopsy.ts */
  autopsy: string | null;
  /** entry-policy fingerprint for self-improve agent */
  methodId: string | null;
  // ── 0.3.3 · TP1 partial → runner (trade-mgmt.ts) ──
  /** ROI % SAU PHÍ đã bank tại TP1 (null = lệnh thường chưa qua TP1) */
  p1Pct: number | null;
  /** phần stake đã bank tại TP1, 0..1 */
  p1Share: number | null;
  /** TP mở rộng của runner (price move %) — null = chưa vào runner phase */
  tp2Pct: number | null;
  /** mức khoá lời hiện tại của trail runner (price move %, ≥0; 0 = breakeven) */
  trailPct: number | null;
  createdAt: string;
}

export interface AutoStats {
  closed: number;
  wins: number;
  winRate: number;
  netPnlPct: number;
}

// ── ANALYTICS CHI TIẾT (0.2.97) — dịch từ lịch sử đóng, tính 1 nguồn ở
// autostate.readAutoState (server) → /api/autotrade GET → bảng Analytics /auto.
export type BookKey = 'ALL' | 'A' | 'B' | 'C' | 'D';

export interface BookRecent {
  id: string;
  symbol: string;
  interval: string;
  side: string;
  pnlPct: number | null;
  exitKind: string | null;
  exitTime: string | null;
  entryTime: string;
  entryPrice: number;
}

export interface AutoAnalytics {
  /** tổng % ROI trừ phí, trung bình trên lệnh đóng — điểm kỳ vọng mỗi lệnh */
  expectancy: number;
  /** sum(pnl>0) / |sum(pnl<=0)| — ≥1 = hệ thống có lãi */
  profitFactor: number;
  /** độ sâu sụt vốn lớn nhất (% từ đỉnh vốn, theo chuỗi capitalAfter) */
  maxDrawdownPct: number;
  /** phút giữ trung bình (exitTime − entryTime) */
  avgHoldMin: number;
  /** chuỗi thắng/thua hiện tại + kỷ lục */
  streak: { current: number; currentKind: "win" | "loss" | "none"; maxWin: number; maxLoss: number };
  /** net + n + WR theo lý do thoát (tp/sl/manual/flip/trail…) */
  byExitKind: Array<{ kind: string; n: number; net: number; wr: number }>;
  /** net + n theo symbol (top 8 theo số lệnh) */
  bySymbol: Array<{ symbol: string; n: number; net: number; wr: number }>;
  /** net + n theo khung thời gian */
  byInterval: Array<{ interval: string; n: number; net: number; wr: number }>;
  /** net + n theo chiều */
  bySide: Array<{ side: string; n: number; net: number; wr: number }>;
  /** đường vốn từ chuỗi capitalAfter (cũ → mới) */
  equity: Array<{ t: string; capital: number }>;
  closed: number;
  wins: number;
  winRate: number;
  netPnlPct: number;
}

export interface AutoState {
  trades: AutoTradeRow[];
  open: AutoTradeRow | null;
  /** multi-position: tat ca lenh dang mo (open = opens[0] de tuong thich cu) */
  opens?: AutoTradeRow[];
  capital: number | null;
  /** thời điểm lần "Reset vốn" gần nhất (null = chưa từng reset qua ví DryRunState) */
  resetAt?: string | null;
  /** vốn gốc sau lần reset gần nhất — hiển thị cạnh vốn hiện tại (0.2.86) */
  walletCapital?: number | null;
  stats: AutoStats;
  /** win-rate table grouped by pair × timeframe (all closed history) */
  byCombo?: ComboStat[];
  /** 0.2.97 — phân tích chi tiết theo lý do thoát / symbol / khung / streak */
  analytics?: AutoAnalytics;
  analyticsByBook?: Record<BookKey, AutoAnalytics>;
  recentByBook?: Record<BookKey, Array<BookRecent>>;
}

const jsonHeaders = { "Content-Type": "application/json" };

export async function fetchAutoState(): Promise<AutoState> {
  const res = await fetch("/api/autotrade");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as AutoState;
}

export async function openAutoTrade(payload: {
  symbol: string;
  interval: string;
  side: string;
  entryPrice: number;
  slPct: number;
  tpPct: number;
  leverage: number;
  /** equity share staked on this trade, % */
  stakePct: number;
  prob: number;
  acc: number;
  auc: number;
  score: number;
  capitalBefore: number;
}): Promise<AutoTradeRow | null> {
  try {
    const res = await fetch("/api/autotrade", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ action: "open", ...payload }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { trade: AutoTradeRow };
    return json.trade;
  } catch {
    return null;
  }
}

export async function closeAutoTrade(id: string, exitPrice: number, exitKind: string): Promise<AutoTradeRow | null> {
  try {
    const res = await fetch("/api/autotrade", {
      method: "PATCH",
      headers: jsonHeaders,
      body: JSON.stringify({ action: "close", id, exitPrice, exitKind }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { trade: AutoTradeRow };
    return json.trade;
  } catch {
    return null;
  }
}

export async function resetAutoTrades(): Promise<boolean> {
  try {
    const res = await fetch("/api/autotrade", {
      method: "PATCH",
      headers: jsonHeaders,
      body: JSON.stringify({ action: "reset" }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * LỆNH RESET VỐN DRY-RUN (0.2.86) — xoá sạch sổ lệnh + đặt vốn về `capital`
 * (thiếu → giữ vốn ví hiện có / 1000). Vốn ghi vào ví DryRunState nên UI thấy
 * NGAY sau reset, sống qua restart; lệnh kế mở với capitalBefore đúng con số đó.
 */
export async function resetAutoCapital(
  capital?: number,
  note?: string,
): Promise<{ ok: boolean; capital?: number; error?: string }> {
  try {
    const res = await fetch("/api/autotrade", {
      method: "PATCH",
      headers: jsonHeaders,
      body: JSON.stringify({ action: "reset_capital", ...(capital != null ? { capital } : {}), ...(note ? { note } : {}) }),
    });
    const json = (await res.json().catch(() => null)) as
      | { ok?: boolean; capital?: number; error?: string; message?: string }
      | null;
    // 0.2.92 — db_corrupt trả 503 kèm `message` (hint .recover) — ưu tiên hiện nó
    if (!res.ok) return { ok: false, error: json?.message ?? json?.error ?? `HTTP ${res.status}` };
    return { ok: json?.ok === true, capital: json?.capital };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "fetch failed" };
  }
}

// ─── RÀ SỔ DRY-RUN (0.2.87) — client helper cho panel Auto ────────────────────

/** Kết quả audit UI cần — gọn hơn AuditReport đầy đủ (issues chỉ lấy top N). */
export interface AutoAuditResult {
  ok: boolean;
  repaired: boolean;
  pnlFixed?: number;
  capitalRefixed?: number;
  finalCapital?: number | null;
  report?: {
    total: number;
    closed: number;
    ok: number;
    issues: { id: string; side: string; symbol?: string; interval?: string; exitKind: string | null; stored: number; expected: number; diff: number }[];
    sides: {
      before: { side: string; closed: number; wins: number; winRate: number; netPnl: number; mismatched: number }[];
      after: { side: string; closed: number; wins: number; winRate: number; netPnl: number; mismatched: number }[];
    };
    netBefore: number;
    netAfter: number;
  };
  error?: string;
}

/** Rà lại toàn bộ sổ dry-run: repair=false → chỉ báo cáo; true → sửa ROI +
 *  chạy lại chuỗi vốn (PATCH /api/autotrade action "audit"). */
export async function auditAutoBook(repair: boolean): Promise<AutoAuditResult> {
  try {
    const res = await fetch("/api/autotrade", {
      method: "PATCH",
      headers: jsonHeaders,
      body: JSON.stringify({ action: "audit", repair }),
    });
    const json = (await res.json().catch(() => null)) as AutoAuditResult | null;
    if (!res.ok) return { ok: false, repaired: false, error: json?.error ?? `HTTP ${res.status}` };
    return json ?? { ok: false, repaired: false, error: "empty response" };
  } catch (e) {
    return { ok: false, repaired: false, error: e instanceof Error ? e.message : "fetch failed" };
  }
}

// ─── Telegram relay ───────────────────────────────────────────────────────────

export async function telegramConfigured(): Promise<boolean> {
  try {
    const res = await fetch("/api/telegram");
    if (!res.ok) return false;
    const json = (await res.json()) as { configured: boolean };
    return json.configured;
  } catch {
    return false;
  }
}

export interface TgStatus {
  configured: boolean;
  chatId: string | null;
  /** where the config came from — always "env" (or null when unset) */
  source: "env" | null;
}

/** Current telegram wiring (effective chat id included). */
export async function telegramStatus(): Promise<TgStatus> {
  try {
    const res = await fetch("/api/telegram");
    if (!res.ok) return { configured: false, chatId: null, source: null };
    return (await res.json()) as TgStatus;
  } catch {
    return { configured: false, chatId: null, source: null };
  }
}

/** Consume a one-time ?tg=<secret> connect link (POST /api/telegram/link/connect) —
 *  installs the bound bot token server-side; the link burns after one use. */
export async function telegramLinkConnect(
  secret: string,
): Promise<{ ok: boolean; bot?: string | null; detail?: string }> {
  try {
    const res = await fetch("/api/telegram/link/connect", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ secret }),
    });
    const json = (await res.json().catch(() => null)) as { ok?: boolean; bot?: string | null; error?: string } | null;
    if (!res.ok) return { ok: false, detail: json?.error ?? `HTTP ${res.status}` };
    return { ok: json?.ok === true, bot: json?.bot ?? null };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : "fetch failed" };
  }
}

/**
 * Fire-and-forget notification — resolves {ok:false, detail} instead of throwing.
 * `html: true` (default) sends with parse_mode HTML — templates must escape
 * raw < > & themselves (pair names / numbers never contain them).
 * `key` — semantic dedupe id (open:<tradeId>, near:<id>:tp, top:<5min-bucket>, …):
 * many tabs/devices share one Telegram channel, the SERVER suppresses repeats
 * of the same event (TG_DEDUPE_MS window) — 20 sessions → one message.
 * `dedupe: false` — bypass for manual sends (the "Kiểm tra" test button).
 */
export async function sendTelegram(
  text: string,
  opts?: { html?: boolean; key?: string; dedupe?: boolean },
): Promise<{ ok: boolean; detail?: string }> {
  try {
    const res = await fetch("/api/telegram", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({
        text,
        parse_mode: opts?.html === false ? undefined : "HTML",
        key: opts?.key,
        dedupe: opts?.dedupe,
      }),
    });
    if (!res.ok) {
      const json = (await res.json().catch(() => null)) as { detail?: string } | null;
      return { ok: false, detail: json?.detail ?? `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : "fetch failed" };
  }
}

// ─── Periodic stats digest (hourly / daily Telegram reports) ────────────────

const DIGEST_HR = "━━━━━━━━━━━━━━━━━━";
const sideTag = (side: string): string => (side === "LONG" ? "LONG 🟢" : side === "SHORT" ? "SHORT 🔴" : "NEUTRAL ⚪");
/** Số dòng tối đa của bảng lệnh — giữ digest dưới trần 4096 ký tự Telegram */
const DIGEST_LIST_MAX = 40;
/** exitKind → icon kết quả đứng ĐẦU dòng bảng (mỗi dòng đúng 1 icon → cột thẳng) */
const DIGEST_KIND: Record<string, string> = { tp: "✅", sl: "❌", flip: "🔄", manual: "✋", trail: "🚉" };
/** exitKind → mã 2 ký tự trong bảng monospace */
const DIGEST_KIND_CODE: Record<string, string> = { tp: "TP", sl: "SL", flip: "FL", manual: "MN", trail: "TL" };
/** bỏ đuôi USDT cho gọn bảng (DOGEUSDT → DOGE) */
const baseSym = (s: string): string => s.replace(/USDT$/, "");

/**
 * Digest body — 0.2.70 redesign đọc nhanh:
 *  - khối trạng thái gọn: window stats → equity → best combo → position đang giữ
 *  - bảng lệnh monospace CÓ CỘT: icon kết quả đầu dòng, PnL thẳng cột, side L/S,
 *    mã exit (TP/SL/FL/MN), nhóm theo ngày
 *  - CHỈ liệt kê lệnh đóng TRONG CỬA SỔ báo cáo (hourly = 1h, daily = 24h) —
 *    hết kiểu hourly đổ cả lịch sử 28 lệnh cũ ra mỗi giờ; cửa sổ trống → 1 dòng 😴
 * Vẫn đếm OPENS trong cửa sổ (báo "0 lệnh" ngay sau khi vừa mở lệnh đọc như
 * hỏng) và hiện "—" thay vì 0% win-rate giả khi chưa có lệnh nào chốt.
 */
export function statLines(st: AutoState, sinceMs: number, title: string, periodLabel: string, floor?: { minScore: number; minAuc: number; minAcc: number; src: string }): string[] {
  const recent = st.trades
    .filter((x) => x.status === "closed" && x.exitTime && new Date(x.exitTime).getTime() >= sinceMs)
    .sort((a, b) => new Date(b.exitTime ?? b.entryTime).getTime() - new Date(a.exitTime ?? a.entryTime).getTime());
  const opened = st.trades.filter((x) => new Date(x.entryTime).getTime() >= sinceMs);
  const wins = recent.filter((x) => (x.pnlPct ?? 0) > 0).length;
  const net = recent.reduce((a, x) => a + (x.pnlPct ?? 0), 0); // tong ROI-margin, KHONG phai Equity ROI
  const pnlParts = recent.map((x) => { const b = Number((x as any).capitalBefore); const e = Number((x as any).capitalAfter); return Number.isFinite(b) && Number.isFinite(e) ? e - b : null; });
  const pnlUsd: number = pnlParts.reduce((a: number, v) => a + (v ?? 0), 0);
  const pnlTxt = pnlParts.some((v) => v != null) ? `PnL <b>${pnlUsd >= 0 ? "+" : ""}${pnlUsd.toFixed(2)} USDT</b>` : "PnL —";
  const wr = recent.length ? `${Math.round((wins / recent.length) * 100)}%` : "—";
  const oldest = recent[recent.length - 1] as any;
  const newest = recent[0] as any;
  const eqStart = Number(oldest?.capitalBefore ?? NaN);
  const eqEnd = Number(newest?.capitalAfter ?? st.capital ?? NaN);
  const eqDelta = Number.isFinite(eqStart) && eqStart > 0 && Number.isFinite(eqEnd) ? ((eqEnd - eqStart) / eqStart) * 100 : null;
  const roi = recent.length ? `ΣROI ${net >= 0 ? "+" : ""}${net.toFixed(2)}%` : "—";
  const eqTxt2 = eqDelta != null ? ` · Balance Δ ${eqDelta >= 0 ? "+" : ""}${eqDelta.toFixed(2)}%` : "";
  const capLabel = periodLabel.charAt(0).toUpperCase() + periodLabel.slice(1);
  const eq = st.capital != null ? st.capital.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—";
  // TG UPGRADE — Agent header: lấy agent từ state nếu có, fallback HEDGE
  const anySt0 = st as any;
  const agentId = (anySt0.agent || anySt0.cfg?.agent || "HEDGE") as string;
  const ag = agentGateTuple(agentId); // [risk, score, auc, acc] — cùng nguồn engine/UI
  const agentIcon = agentIconOf(agentId);
  const rp = agentPresetOf(agentId);
  const runnerTxt = `${rp.runnerSharePct}/${rp.runnerTpMult}/${rp.runnerTrailLock}`;
  const lines = [
    title,
    `${agentIcon} Agent: <b>${agentId}</b> · Risk ${ag[0]}% · ${floor ? `Gate ${floor.src}: Score ${floor.minScore} / AUC ${floor.minAuc.toFixed(2)} / ACC ${floor.minAcc}%` : "Gate: see /ai"} · Runner ${runnerTxt}`,
    DIGEST_HR,
    `📊 <b>${capLabel}</b>: ${opened.length} opened · ${recent.length} closed · WR <b>${wr}</b>${eqTxt2} · ${roi} · ${pnlTxt}`,
    `💰 Book B balance <b>${eq}</b> USDT · ${st.stats.closed} closed all-time${st.open ? " · 1 open" : ""} · WR ${st.stats.closed ? `${st.stats.winRate.toFixed(2)}%` : "—"}`,
  ];
  const best = (st.byCombo ?? []).filter((c) => c.closed >= 3).sort((a, b) => b.winRate - a.winRate)[0];
  if (best && recent.length > 0) lines.push(`🏆 Best: <b>#${baseSym(best.symbol)}</b> ${best.interval} · WR ${best.winRate.toFixed(2)}% (${best.closed} trades)`);
  if (st.open)
    lines.push(`🔓 Holding: <b>#${baseSym(st.open.symbol)}</b> ${st.open.interval} ${sideTag(st.open.side)} @ ${fmtPrice(st.open.entryPrice)}`);

  lines.push("");
  if (recent.length === 0) {
    // HOURLY 0 lenh: chi 1 dong ly do — khong nhoi Best/Books/Scan/Did/Sleep (filler lap moi gio).
    // Lesson/autopsy KHONG nam o day: chi gui khi autopsy that su xong (tin AUTOPSY rieng).
    // 0.3.35 — không gộp cứng "noise guard": lý do thật nằm ở status engine
    const why = (anySt0.lastCycleStatus || anySt0.cfg?.lastCycleStatus || "").toString().slice(0, 120);
    lines.push(
      why
        ? `❌ 0 lệnh trong cửa sổ — gate Score ${ag[1]} / AUC ${ag[2]} / ACC ${ag[3]}% · ${why}`
        : `❌ 0 lệnh trong cửa sổ — không combo qua gate Score ${ag[1]} / AUC ${ag[2]} / ACC ${ag[3]}% (xem status engine: sàn / regress / whale / nhiễu)`,
    );
    return lines;
  }

  // 📋 Top 5 lãi nhất + Top 5 lỗ nhất — rút gọn, không đổ full 40 lệnh
  const fmtT = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", hour12: false });
  const rowOf = (x: (typeof recent)[number]) => {
    const at = new Date(x.exitTime ?? x.entryTime);
    const pnl = x.pnlPct ?? 0;
    const cell = `${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}%`.padStart(6);
    const side = x.side === "LONG" ? "L" : x.side === "SHORT" ? "S" : "—";
    const code = DIGEST_KIND_CODE[x.exitKind ?? ""] ?? "—";
    return `${DIGEST_KIND[x.exitKind ?? ""] ?? "✋"} ${cell}  ${baseSym(x.symbol).padEnd(9)} ${x.interval.padStart(3)} ${side} ${code}  ${fmtT.format(at)}`;
  };
  const byPnlDesc = [...recent].sort((a, b) => (b.pnlPct ?? 0) - (a.pnlPct ?? 0));
  const winners = byPnlDesc.slice(0, 5);
  const losers = [...recent].sort((a, b) => (a.pnlPct ?? 0) - (b.pnlPct ?? 0)).slice(0, 5).filter((x) => !winners.includes(x));
  lines.push(`📋 Trades closed ${periodLabel} — Top 5 winners / Bottom 5 losers (${recent.length} total):`);
  const winRows = winners.map(rowOf);
  const loseRows = losers.map(rowOf);
  lines.push(`<code>📈 Top 5 winners:\n${winRows.join("\n")}${loseRows.length ? `\n\n📉 Bottom 5 losers:\n${loseRows.join("\n")}` : ""}</code>`);
  if (recent.length > winners.length + losers.length) lines.push(`…+${recent.length - winners.length - losers.length} other trades`);

  // 💡 Lesson rollup (0.2.71) — khi per-trade AUTOPSY bị mute (TG_MUTE), bài
  // học VẪN lọt vào digest: lấy autopsy MỚI NHẤT trong cửa sổ, gọn 1 dòng.
  // JSON hỏng / rỗng → bỏ im lặng; không có lệnh nào → không in gì thêm.
  if ((st.stats?.closed ?? 0) < 10) {
    lines.push("", `💡 Lesson: Chưa đủ mẫu (n=${st.stats?.closed ?? 0}/10) để rút lesson — cần ≥10 lệnh đóng.`);
  } else if (recent.slice(0, 3).every((x) => (x.pnlPct ?? 0) <= 0)) for (const x of recent) {
    if (!x.autopsy) continue;
    try {
      const a = JSON.parse(x.autopsy) as { lesson?: string };
      const raw = (a.lesson ?? "").trim();
      if (!raw) continue;
      const esc = raw.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      lines.push("", `💡 Lesson (#${baseSym(x.symbol)} ${x.interval}): ${esc.length > 130 ? `${esc.slice(0, 130)}…` : esc}`);
      break; // mới nhất trước — chỉ 1 bài học mỗi digest
    } catch {
      continue;
    }
  }
  return lines;
}

/** Trigger the server-side digest sender — dedupe/boundary logic lives there. */
export async function pushAutoStats(body: { hourly?: boolean; daily?: boolean; force?: boolean }): Promise<boolean> {
  try {
    const res = await fetch("/api/autotrade/push", { method: "POST", headers: jsonHeaders, body: JSON.stringify(body) });
    return res.ok;
  } catch {
    return false;
  }
}

// ─── Config (localStorage) ────────────────────────────────────────────────────

export const AUTO_LS_KEY = "utp.auto";

export interface AutoConfig {
  /** Agent — VAULT | HEDGE | ALPHA | GRAIL (GRAIL locked) */
  agent?: "VAULT" | "HEDGE" | "ALPHA" | "GRAIL";
  on: boolean;
  /** dry-run starting equity, USDT */
  capital: number;
  /** share of equity staked per trade, % (100 = all-in) — ĐÂY CHÍNH LÀ
   *  stakePct ghi vào mỗi trade row (MỘT núm, hai tên gọi: riskPct trên
   *  panel = stakePct trong DB/prompt LLM). Engine kẹp bằng trần runtime
   *  RISK_MAX_STAKE (params.ts §4e) lúc vào lệnh/lật chiều; lệnh ghi số đã
   *  kẹp, mọi thống kê sau đó đúng theo số thực cam. */
  riskPct: number;
  /** TP/SL source: "dyn" = dynamic calculator pair × time × volume measured
   *  at entry time (default, 0.2.74 — ATR% × heat(TR 5 nến gần vs ATR) × vol(20
   *  vs 100 nến); degenerates to the legacy ATR mode when the regime is
   *  neutral), "auto" = the scan row's train-time ATR levels, "manual" = fixed */
  tpMode: "dyn" | "auto" | "manual";
  /** manual SL % (price move, before leverage) — used when tpMode = manual */
  slPct: number;
  /** manual TP % (price move, before leverage) — used when tpMode = manual */
  tpPct: number;
  /** ATR × multiplier for live entry levels — used when tpMode is "dyn" and the
   *  scan row carries no retrained coef; 1.5 ≈ the classic ATR stop (the
   *  heat/volume multipliers modulate AROUND this backbone) */
  atrCoef: number;
  /** cycle interval, minutes */
  cycleMin: number;
  /** các khung giờ engine CHẠY (scan + train + vào lệnh) — bật tắt trên panel;
   *  khung tắt bị bỏ hẳn khỏi vòng quét/train kế tiếp */
  runTf: string[];
  /** NGƯỠNG CHẤT LƯỢNG CHUNG — một bộ ba setpoint duy nhất áp cho MỌI tầng: mở
   *  lệnh, bù DCA và đăng broadcast (gateRow). Chỉnh một chỗ trên Auto panel. */
  minAuc: number;
  minAcc: number;
  /** min score (= (AUC−0.5)×100 + (ACC−50) + tin cậy×15) — lọc model đạt ngưỡng
   *  metrics nhưng thiếu tự tin */
  minScore: number;
  /** wait after an SL exit on the same combo, minutes (0 = off) */
  cooldownMin: number;
  /** max DCA adds into a losing position while the model still confirms the
   *  direction — each add averages the entry and re-anchors SL/TP on the new
   *  average (0 = off; the SL then closes the position as before) */
  dcaMax: number;
  /** auto-post a stats digest to Telegram at the top of every hour */
  statHourly: boolean;
  /** auto-post a stats digest to Telegram once a day */
  statDaily: boolean;
  /** base URL of the llama-server endpoint, e.g. http://127.0.0.8:8888 —
   *  the risk officer runs silently in the backend (no UI toggle) */
  llmUrl: string;
  /** model name sent with each request (informational — the server binds one model) */
  llmModel: string;
  /** seconds to wait for one LLM call (10–600). Overrides params LLM_TIMEOUT_MS when set. */
  llmTimeoutSec: number;
  /** true = skip entries when LLM is down; false = fail-OPEN (enter on XGB alone) */
  llmFailClosed: boolean;
  /** skip auto-entries whose last closed candle is a whale bar (≥4σ volume) */
  whaleFilter: boolean;
  /** broadcast the "TOP coin tiềm năng" scan digest to Telegram every 5 min */
  broadcast: boolean;
  /** LẬT CHIỀU TỰ ĐỘNG — khi lệnh đang mở và scan mới của CÙNG cặp/khung đảo
   *  chiều với tín hiệu đạt đủ ngưỡng chất lượng (cùng gate vào lệnh + noise band
   *  + không regressed), engine đóng lệnh cũ (exitKind "flip") và mở lệnh
   *  ngược chiều NGAY trong chu kỳ đó. Thị trường luôn biến động — dự báo chỉ
   *  là dự báo; flip là cách bot theo kịch. false = giữ lệnh tới TP/SL. */
  autoFlip: boolean;
  /** FLIP COOLDOWN — phút chặn lật chiều lại trên cùng combo sau lần flip gần
   *  nhất (exitKind="flip"). Anti-churn: model đảo chiều liên tục trong thị
   *  trường nhiễu có thể lật mỗi cycle (5 phút), mỗi lần trả spread + reset
   *  SL/TP. 0 = tắt (giữ hành vi cũ). Self-improve agent tự nắn theo flip-
   *  expectancy thật. */
  flipCooldownMin: number;
  /** TRAILING STOP — dừng lệnh di động bảo vệ lợi nhuận: khi lời (theo % di
   *  chuyển giá, chưa nhân đòn bẩy) đạt trailActPct thì stop bám theo đỉnh
   *  (LONG) / đáy (SHORT) cách trailDistPct%; giá lùi đủ khoảng cách là chốt
   *  lời tại chỗ (exitKind "trail"). TP/SL tĩnh vẫn hiệu lực như lưới an toàn. */
  trailOn: boolean;
  /** 🤖 TỰ ĐỀ XUẤT thông số trailing theo pair × đòn bẩy × khung giờ (0.2.63):
   *  mỗi lệnh khi mở được đo ATR(14)% trên chính khung giao dịch, nhân hệ số
   *  đòn bẩy √(10/lev) rồi khoá act/dist riêng (xem trailAutoLevels). Khi đang
   *  bật, 2 ô thủ công bên dưới bị bỏ qua. false = dùng 2 số thủ công chung
   *  cho mọi cặp như bản 0.2.62. */
  trailAuto: boolean;
  /** % di chuyển giá (chưa nhân đòn bẩy) cần đạt trước khi stop bắt đầu bám */
  trailActPct: number;
  /** khoảng cách % từ đỉnh/đáy tốt nhất tới stop trailing */
  trailDistPct: number;
  /** 0.3.3 — TP1 PARTIAL → RUNNER: chạm TP lần đầu chỉ chốt runnerSharePct% stake
   *  (sau phí), phần còn lại chạy tiếp với SL về breakeven (BE), TP mở rộng
   *  ×runnerTpMult và trail ratchet khoá lời runnerTrailLock × quãng đi. false =
   *  đóng toàn bộ tại TP như cũ. Trả lời "chốt sớm" — một nửa vẫn chạy tiếp,
   *  muốn RR cao hơn không cần đẩy TP xa tới mức không còn lệnh nào chạm. */
  runnerOn: boolean;
  /** phần chốt tại TP1, % stake (30/50/70 — 50 = nửa chốt, nửa chạy) */
  runnerSharePct: number;
  /** TP runner mở rộng = tpPct × hệ số này (1..5) */
  runnerTpMult: number;
  /** trail runner khoá mỗi lần quãng đi thuận × hệ số này (0..1), CHỈ TĂNG */
  runnerTrailLock: number;
  /** 0.3.3 — SL CONFIRM: SL phải được thấy vượt liên tục N nhịp watcher (20s/nhịp)
   *  HOẶC vượt sâu ≥ 15% bề rộng stop mới chốt — wick quét SL một nhịp rồi quay
   *  đầu không còn quét sạch stop ("SL non"). 0 = tắt, hành vi cũ chạm là đóng. */
  slConfirmTicks: number;
}

export const AUTO_DEFAULTS: AutoConfig = {
  on: false,
  capital: 1000,
  // audit 04/11: 25% vốn/lệnh là nguyên nhân −40% net ROI hoá nhỏ thành
  // swing vốn lớn; khuyến nghị 2-3%/lệnh — mặc định 3, trần RISK_MAX_STAKE
  // (params §4e) kẹp bất kể panel đặt gì. SET CỨNG [10,20,30,50] ở RISK_CHOICES.
  riskPct: 3,
  tpMode: "dyn",
  slPct: 1,
  tpPct: 1.5,
  atrCoef: 1.5,
  cycleMin: 5,
  runTf: [...INTERVALS],
  // ngưỡng chung mặc định = setpoint broadcast 31/10 (60 / 0.8 / 70) — đồng bộ
  // BCAST_* trong bcast-gate.ts; migration từ 0.55/55 thời "no UI" nằm ở
  // loadAutoConfig + engine.loadEngine
  minAuc: 0.8,
  minAcc: 70,
  minScore: 60,
  cooldownMin: 30,
  dcaMax: 1,
  statHourly: true,
  statDaily: true,
  llmUrl: LLM_URL_DEFAULT,
  llmModel: LLM_MODEL_DEFAULT,
  llmTimeoutSec: 90,
  llmFailClosed: false,
  whaleFilter: true,
  broadcast: true,
  autoFlip: true,
  // flip cooldown — tắt mặc định (0) để giữ hành vi cũ; self-improve agent sẽ
  // bật khi flip-expectancy thật âm (xem decidePatch @ self-improve.ts).
  flipCooldownMin: 0,
  // trailing stop — tắt mặc định; bật = bảo vệ lời tự động. trailAuto mặc định
  // BẬT: mỗi lệnh tự đề xuất act/dist theo ATR(cặp×khung)×đòn bẩy (0.2.63);
  // 2 số dưới chỉ còn là phương án thủ công khi trailAuto=false và fallback
  // khi klines lỗi.
  trailOn: false,
  trailAuto: true,
  trailActPct: 1,
  trailDistPct: 0.8,
  // 0.3.3 — TP1→runner + SL confirm: bật sẵn vì sửa đúng hai pain user báo:
  // "các lệnh bị chốt sớm và SL non… tăng RR thì ko bắt lệnh dc nữa" — TP1 bank
  // nửa, runner chạy ra RR cao hơn; SL đợi confirm, wick nông không quét sạch.
  runnerOn: true,
  runnerSharePct: 50,
  runnerTpMult: 2,
  runnerTrailLock: 0.5,
  slConfirmTicks: 2,
};
export const COOLDOWN_CHOICES = [0, 15, 30, 60] as const;
/** phần chốt TP1 cho runner — choices panel (0.3.3) */
export const RUNNER_SHARE_CHOICES = [30, 50, 70] as const;
/** nhịp confirm SL — choices panel, đơn vị nhịp watcher 20s (0.3.3; 0 = tắt) */
export const SL_CONFIRM_CHOICES = [0, 2, 3, 5] as const;
/** FLIP cooldown choices — đồng bộ với COOLDOWN_CHOICES. 0 = tắt. */
export const FLIP_COOLDOWN_CHOICES = [0, 15, 30, 60] as const;
/** DCA adds allowed into a losing position (model still confirming) */
export const DCA_CHOICES = [0, 1, 2] as const;
/** Stake/lệnh chọn trên panel — thêm 2/3/5% (audit khuyến nghị) giữ nguyên
 *  các mức cũ; engine vẫn kẹp bằng RISK_MAX_STAKE cho dù chọn mức nào. */
export const RISK_CHOICES = [10, 20, 30, 50] as const; // SET CỨNG min 10% / max 50%
export const TP_MODES = ["dyn", "auto", "manual"] as const;

/** Chuẩn hoá tpMode — MỘT nguồn cho localStorage (loadAutoConfig), engine.json
 *  (loadEngine) và browser sync (syncEngine). 0.2.74 nâng mode "atr" (ATR thuần,
 *  default chưa từng có UI riêng) thành "dyn" — calculator động pair × time ×
 *  volume; giá trị "atr" cũ trong config/engine.json map thẳng sang "dyn"
 *  (công thức cũ chính là trường hợp suy biến heatMul = volMul = 1). Giá trị lạ
 *  / thiếu cũng rơi về "dyn" — an toàn mặc định. */
export function sanitizeTpMode(v: unknown): "dyn" | "auto" | "manual" {
  return v === "manual" ? "manual" : v === "auto" ? "auto" : "dyn";
}

/** auto-trade rescan cycle choices — minutes + display label ("1w" = 1 tuần) */
export const CYCLE_CHOICES = [
  { m: 5, label: "5" },
  { m: 10, label: "10" },
  { m: 15, label: "15" },
  { m: 30, label: "30" },
  { m: 60, label: "1h" },
  { m: 240, label: "4h" },
  { m: 1440, label: "1d" },
  { m: 10080, label: "1w" },
] as const;

/** Chuẩn hoá danh sách khung giờ chạy: chỉ nhận member hợp lệ của INTERVALS,
 *  sắp theo thứ tự gốc, trùng thì gộp — rỗng/toàn sai thì trả về tất cả
 *  (không bao giờ để engine chạy 0 khung). */
export function sanitizeRunTf(v: unknown): string[] {
  const set = new Set(
    (Array.isArray(v) ? v : []).filter((x): x is string => typeof x === "string" && (INTERVALS as readonly string[]).includes(x)),
  );
  const list = INTERVALS.filter((i) => set.has(i));
  return list.length ? [...list] : [...INTERVALS];
}

/** Kẹp bộ ba NGƯỠNG CHẤT LƯỢNG CHUNG vào vùng hợp lệ — dùng ở MỌI cửa nhận cfg
 *  (localStorage, engine.json, POST /api/engine sync) để không đường nào đánh
 *  lọt giá trị lệch. Migration: bộ 0.55/55 là default thời minAuc/minAcc còn
 *  "no UI" (trước 1/11) — chưa từng được chỉnh tay nên nâng thẳng lên ngưỡng
 *  chung mới thay vì giữ lại. */
export function sanitizeFloors(
  auc: unknown,
  acc: unknown,
  score: unknown,
): { minAuc: number; minAcc: number; minScore: number } {
  const legacy = auc === 0.55 && acc === 55;
  const num = (x: unknown, lo: number, hi: number, dflt: number): number =>
    typeof x === "number" && Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : dflt;
  return {
    minAuc: legacy ? AUTO_DEFAULTS.minAuc : num(auc, 0.5, 0.95, AUTO_DEFAULTS.minAuc),
    minAcc: legacy ? AUTO_DEFAULTS.minAcc : num(acc, 50, 90, AUTO_DEFAULTS.minAcc),
    minScore: num(score, 0, 95, AUTO_DEFAULTS.minScore),
  };
}

export function loadAutoConfig(): AutoConfig {
  try {
    const raw = localStorage.getItem(AUTO_LS_KEY);
    if (!raw) return AUTO_DEFAULTS;
    const p = JSON.parse(raw) as Partial<AutoConfig>;
    return {
      on: p.on === true,
      capital: typeof p.capital === "number" && p.capital > 0 ? p.capital : AUTO_DEFAULTS.capital,
      riskPct: RISK_CHOICES.includes(p.riskPct as (typeof RISK_CHOICES)[number]) ? (p.riskPct as number) : AUTO_DEFAULTS.riskPct,
      tpMode: sanitizeTpMode(p.tpMode),
      slPct: typeof p.slPct === "number" ? Math.min(20, Math.max(0.2, p.slPct)) : AUTO_DEFAULTS.slPct,
      tpPct: typeof p.tpPct === "number" ? Math.min(30, Math.max(0.2, p.tpPct)) : AUTO_DEFAULTS.tpPct,
      atrCoef: typeof p.atrCoef === "number" && p.atrCoef > 0 ? Math.min(5, Math.max(0.5, p.atrCoef)) : AUTO_DEFAULTS.atrCoef,
      cycleMin: CYCLE_CHOICES.some((c) => c.m === p.cycleMin) ? (p.cycleMin as number) : AUTO_DEFAULTS.cycleMin,
      // ngưỡng chung — kẹp + migration legacy trong sanitizeFloors (một nguồn)
      ...sanitizeFloors(p.minAuc, p.minAcc, p.minScore),
      cooldownMin: COOLDOWN_CHOICES.includes(p.cooldownMin as 0 | 15 | 30 | 60)
        ? (p.cooldownMin as number)
        : AUTO_DEFAULTS.cooldownMin,
      dcaMax: DCA_CHOICES.includes(p.dcaMax as 0 | 1 | 2) ? (p.dcaMax as number) : AUTO_DEFAULTS.dcaMax,
      runTf: sanitizeRunTf(p.runTf),
      statHourly: p.statHourly !== false,
      statDaily: p.statDaily !== false,
      llmUrl:
        typeof p.llmUrl === "string" && /^https?:\/\/\S{1,120}$/.test(p.llmUrl.trim()) ? p.llmUrl.trim() : AUTO_DEFAULTS.llmUrl,
      llmModel: typeof p.llmModel === "string" && p.llmModel.length <= 60 ? p.llmModel : AUTO_DEFAULTS.llmModel,
      llmTimeoutSec:
        typeof p.llmTimeoutSec === "number" && p.llmTimeoutSec >= 10 && p.llmTimeoutSec <= 600
          ? Math.round(p.llmTimeoutSec)
          : AUTO_DEFAULTS.llmTimeoutSec,
      llmFailClosed: p.llmFailClosed === true,
      whaleFilter: p.whaleFilter !== false,
      broadcast: p.broadcast !== false,
      autoFlip: p.autoFlip !== false,
      flipCooldownMin: FLIP_COOLDOWN_CHOICES.includes(p.flipCooldownMin as 0 | 15 | 30 | 60)
        ? (p.flipCooldownMin as number)
        : AUTO_DEFAULTS.flipCooldownMin,
      trailOn: p.trailOn === true,
      trailAuto: p.trailAuto !== false,
      trailActPct:
        typeof p.trailActPct === "number" && p.trailActPct > 0 ? Math.min(10, Math.max(0.2, p.trailActPct)) : AUTO_DEFAULTS.trailActPct,
      trailDistPct:
        typeof p.trailDistPct === "number" && p.trailDistPct > 0 ? Math.min(10, Math.max(0.1, p.trailDistPct)) : AUTO_DEFAULTS.trailDistPct,
      // 0.3.3 — TP1→runner + SL confirm: thiếu field (cfg cũ) → mặc định BẬT
      runnerOn: p.runnerOn !== false,
      runnerSharePct: RUNNER_SHARE_CHOICES.includes(p.runnerSharePct as (typeof RUNNER_SHARE_CHOICES)[number])
        ? (p.runnerSharePct as number)
        : AUTO_DEFAULTS.runnerSharePct,
      runnerTpMult:
        typeof p.runnerTpMult === "number" && p.runnerTpMult >= 1 && p.runnerTpMult <= 5 ? p.runnerTpMult : AUTO_DEFAULTS.runnerTpMult,
      runnerTrailLock:
        typeof p.runnerTrailLock === "number" && p.runnerTrailLock > 0 && p.runnerTrailLock <= 1
          ? p.runnerTrailLock
          : AUTO_DEFAULTS.runnerTrailLock,
      slConfirmTicks: SL_CONFIRM_CHOICES.includes(p.slConfirmTicks as (typeof SL_CONFIRM_CHOICES)[number])
        ? (p.slConfirmTicks as number)
        : AUTO_DEFAULTS.slConfirmTicks,
    };
  } catch {
    return AUTO_DEFAULTS;
  }
}

export function saveAutoConfig(cfg: AutoConfig): void {
  try {
    localStorage.setItem(AUTO_LS_KEY, JSON.stringify(cfg));
  } catch {
    // storage blocked — config lives for this session only
  }
}