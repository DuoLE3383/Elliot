// ─── EVOLVE — vòng "tự tiến hoá" chiến lược vào lệnh (0.2.54) ────────────────
//
// Yêu cầu đặt ra: app TỰ tìm phương pháp vào lệnh tốt nhất → tự đo hiệu quả →
// tự chỉnh/nâng cấp liên tục, thay vì phụ thuộc một công thức/chỉ báo cố định.
// Xây trên nền đã có (không phát minh lại):
//   • Strategy Lab (strategy-lab.ts): sinh ứng viên quanh cfg hiện tại + TỪ
//     feature importance của champion XGBoost (34 yếu tố đang train — dữ liệu
//     app đang tích hợp), backtest ĐÚNG thuật toán engine trên nến thật.
//   • LLM proposer (llm.ts llmPropose): đọc bối cảnh tích hợp (metrics ứng
//     viên, importance, các vòng thử trước, lệnh giấy gần nhất) → đề xuất
//     THÊM 1 ứng viên ngoài lưới. LLM chết → vòng vẫn chạy (fail-open).
//   • AutoTrade DB: lệnh giấy ĐÃ ĐÓNG — căn cứ đo hiệu quả THẬT sau khi áp.
//
// Một vòng (evolveRound): chọn combo đại diện → refresh lab → (tuỳ chọn) thêm
// ứng viên LLM → chấm → nếu có ứng viên vượt mốc (expectancy + biên, DD không
// sâu hơn hệ số cho phép, đủ số lệnh tối thiểu) thì ÁP vào settings engine →
// ghi EvolveLog + tin Telegram. Sau khi áp, evolveWatch theo dõi n lệnh đóng
// kế tiếp: tệ hơn mốc → TỰ HOÀN TÁC cfg cũ; qua được → ghi "confirm".
//
// Nhịp: 1 vòng/6h + theo dõi/30 phút (engine.ts đặt lịch). Vòng không import
// engine.ts (tránh vòng lặp như strategy-lab) — engine truyền bridge vào.

import { db } from "./db";
import { fetchKlinesDirectResolved } from "./klines-direct";
import { llmPropose } from "./llm";
import {
  backtestLab,
  labCfgOf,
  runStrategyLab,
  type LabConfig,
  type LabMetrics,
} from "./strategy-lab";
import type { EngineSettings } from "./types";

// ─── Tuỳ chỉnh bằng env (đọc lúc gọi — đổi xong cần pm2 restart --update-env) ─
// EVOLVE_ON=1            bật vòng (mặc định 1) — 0 để tắt hoàn toàn
// EVOLVE_ROUND_MIN=360   chu kỳ vòng (phút)
// EVOLVE_COOLDOWN_H=24   nghỉ tối thiểu giữa 2 lần ÁP (giờ)
// EVOLVE_MIN_TRADES=12   ứng viên phải có ≥ n lệnh backtest mới đủ điều kiện
// EVOLVE_WATCH_N=15      số lệnh giấy đóng để chấm kết thúc theo dõi
// EVOLVE_MARGIN=0.1      biên expectancy%/lệnh phải vượt mốc
// EVOLVE_DD_FACTOR=1.5   DD ứng viên không sâu hơn 1.5× DD mốc
// EVOLVE_LLM=1           bật lane đề xuất LLM (mặc định 1)
const envNum = (k: string, d: number): number => {
  const v = Number(process.env[k]);
  return Number.isFinite(v) && v > 0 ? v : d;
};
const evolveOn = (): boolean => process.env.EVOLVE_ON !== "0";
const llmLaneOn = (): boolean => process.env.EVOLVE_LLM !== "0";
const ROUND_MIN = () => envNum("EVOLVE_ROUND_MIN", 360);
const COOLDOWN_H = () => envNum("EVOLVE_COOLDOWN_H", 24);
const MIN_TRADES = () => envNum("EVOLVE_MIN_TRADES", 10);
const WATCH_N = () => envNum("EVOLVE_WATCH_N", 15);
const MARGIN = () => envNum("EVOLVE_MARGIN", 0.1);
const DD_FACTOR = () => envNum("EVOLVE_DD_FACTOR", 1.5);

// ─── Types ────────────────────────────────────────────────────────────────────

export type EvolveDecision = "promote" | "keep" | "confirm" | "revert" | "error";

/** Kết quả một vòng/quét theo dõi — trả cho API + log. */
export interface EvolveOutcome {
  decision: EvolveDecision;
  combo: string;
  note: string;
}

/**
 * Bridge engine → evolve. Engine giữ state (settings/persist/TG/LLM endpoint)
 * nên mọi đụng chạm state đi qua đây — evolve thuần dữ liệu + DB.
 */
export interface EvolveBridge {
  /** settings engine đang chạy (baseline) */
  settings(): EngineSettings;
  /** pairs + runTf của engine — không gian chọn combo đại diện */
  universe(): { pairs: string[]; runTf: string[] };
  /** vá settings engine bằng LabConfig thắng cuộc + persist */
  applyLab(cfg: LabConfig): void;
  /** lệnh giấy đã đóng từ `at` — n + expectancy% (mean pnlPct) */
  closedSince(at: Date): Promise<{ n: number; expectancy: number }>;
  /** endpoint LLM đã resolve (env thắng → cfg engine) + timeout ms */
  llmEndpoint(): { url: string; model: string; timeoutMs: number };
  /** tin Telegram (HTML) — engine tự kiểm tgReady */
  tg(html: string): void;
  log(msg: string): void;
}

interface MetricsRow {
  id: string;
  config: LabConfig;
  metrics: LabMetrics | null;
  name: string;
  hypothesis: string;
  baseline: boolean;
  applied: boolean;
  createdAt: Date;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const r1 = (v: number) => Math.round(v * 10) / 10;
const r2 = (v: number) => Math.round(v * 100) / 100;
const r3 = (v: number) => Math.round(v * 1000) / 1000;

const configKey = (c: LabConfig): string =>
  [c.slPct, c.tpPct, c.atrKey, c.atrPeriod, c.smaFilter ? 1 : 0, c.smaFilter ? c.smaPeriod : 0].join("|");

const cfgShort = (c: LabConfig): string =>
  `SL ${r1(c.slPct)}% · TP ${r1(c.tpPct)}% · UT ${c.atrKey}·${c.atrPeriod} · SMA${c.smaFilter ? c.smaPeriod : "off"}`;

const labOf = (s: EngineSettings): LabConfig => ({
  slPct: s.slPct,
  tpPct: s.tpPct,
  atrKey: s.atrKey,
  atrPeriod: s.atrPeriod,
  smaFilter: s.smaFilter === true,
  smaPeriod: s.smaPeriod,
  leverage: s.leverage ?? 1,
});

const mLine = (m: LabMetrics | null): string =>
  m
    ? `${m.trades} lệnh · exp ${r3(m.expectancy)}%/lệnh · WR ${r1(m.winRate)}% · DD ${r2(m.maxDd)}%`
    : "—";

/** Kẹp LLM proposal về vùng an toàn — ngưỡng khớp chính prompt trong llm.ts. */
function clampProposal(
  p: { name: string; hypothesis: string; slPct: number; tpPct: number; atrKey: number; atrPeriod: number; smaFilter: boolean; smaPeriod: number },
): LabConfig {
  const sl = r1(clamp(p.slPct, 0.3, 20));
  return {
    slPct: sl,
    tpPct: r1(clamp(p.tpPct, 0.4, 28)),
    atrKey: clamp(Math.round(p.atrKey * 10) / 10, 0.5, 4),
    atrPeriod: Math.round(clamp(p.atrPeriod, 5, 30)),
    smaFilter: p.smaFilter === true,
    smaPeriod: Math.round(clamp(p.smaPeriod, 20, 250)),
    leverage: 1,
  };
}

async function logRow(
  combo: string,
  decision: EvolveDecision,
  name: string,
  detail: string,
  cfgBefore: LabConfig | null,
  cfgAfter: LabConfig | null,
  metrics: { base?: LabMetrics | null; best?: LabMetrics | null; watch?: { n: number; expectancy: number } } | null,
): Promise<void> {
  await db.evolveLog.create({
    data: {
      combo,
      decision,
      name: name.slice(0, 80),
      detail: detail.slice(0, 500),
      cfgBefore: cfgBefore ? JSON.stringify(cfgBefore) : "",
      cfgAfter: cfgAfter ? JSON.stringify(cfgAfter) : "",
      metrics: metrics ? JSON.stringify(metrics) : null,
    },
  });
}

/** promote gần nhất còn "hiệu lực" (chưa có confirm/revert sau nó). */
export async function activePromotion(): Promise<{
  id: string;
  at: Date;
  combo: string;
  name: string;
  detail: string;
  cfgBefore: LabConfig | null;
  cfgAfter: LabConfig | null;
  metrics: { base?: LabMetrics; best?: LabMetrics } | null;
} | null> {
  const rows = await db.evolveLog.findMany({
    where: { decision: { in: ["promote", "confirm", "revert"] } },
    orderBy: { createdAt: "desc" },
    take: 1,
  });
  const row = rows[0];
  if (!row || row.decision !== "promote") return null;
  const parse = (s: string): LabConfig | null => {
    try {
      const j = JSON.parse(s) as unknown;
      return j && typeof j === "object" ? (j as LabConfig) : null;
    } catch {
      return null;
    }
  };
  let metrics: { base?: LabMetrics; best?: LabMetrics } | null = null;
  if (row.metrics) {
    try {
      metrics = JSON.parse(row.metrics) as { base?: LabMetrics; best?: LabMetrics };
    } catch {
      metrics = null;
    }
  }
  return {
    id: row.id,
    at: row.createdAt,
    combo: row.combo,
    name: row.name,
    detail: row.detail,
    cfgBefore: parse(row.cfgBefore),
    cfgAfter: parse(row.cfgAfter),
    metrics,
  };
}

// ─── Chọn combo đại diện ──────────────────────────────────────────────────────

/** Combo có champion XGBoost tốt nhất (AUC) trong pairs × runTf của engine —
 *  fallback BTCUSDT 15m. Đây là combo mà quyết định SL/TP/UT/SMA ảnh hưởng
 *  rõ nhất, nên dùng nó làm sân backtest chung. */
async function wrongDirGlobal(): Promise<{ nSL: number; nWrong: number; nMid: number; nMaeThieu: number; rate: number }> {
  const rows = await db.autoTrade.findMany({
    where: { status: "closed", exitKind: "sl", autopsy: { not: null } },
    orderBy: { exitTime: "desc" }, take: 100,
    select: { slPct: true, tpPct: true, autopsy: true },
  });
  let nSL = 0, nWrong = 0, nMid = 0, nMaeThieu = 0;
  for (const r of rows) {
    let ev: { mfePct?: number; maePct?: number; covered?: boolean } = {};
    try { ev = (JSON.parse(r.autopsy ?? "") as { ev?: typeof ev }).ev ?? {}; } catch { continue; }
    if (ev.covered === false) continue;
    nSL += 1;
    const mfe = Math.abs(ev.mfePct ?? 0), mae = Math.abs(ev.maePct ?? 0);
    if (mfe < r.tpPct * 0.25 && mae >= r.slPct * 0.8) nWrong += 1;
    else if (mae < r.slPct * 0.8) nMaeThieu += 1;
    else if (mfe < r.tpPct * 0.5) nMid += 1;
  }
  return { nSL, nWrong, nMid, nMaeThieu, rate: nSL ? nWrong / nSL : 0 };
}

async function pickCombo(bridge: EvolveBridge): Promise<{ sym: string; itv: string }> {
  const { pairs, runTf } = bridge.universe();
  const syms = (pairs.length ? pairs : ["BTCUSDT"]).slice(0, 8);
  const itvs = (runTf.length ? runTf : ["15m"]).slice(0, 2);
  try {
    const runs = await db.finetuneRun.findMany({
      where: { OR: syms.flatMap((s) => itvs.map((i) => ({ symbol: s, interval: i }))) },
      orderBy: { createdAt: "desc" },
      take: 120,
    });
    const best = new Map<string, { sym: string; itv: string; auc: number }>();
    for (const r of runs) {
      const k = `${r.symbol}|${r.interval}`;
      const cur = best.get(k);
      if (!cur || r.auc > cur.auc) best.set(k, { sym: r.symbol, itv: r.interval, auc: r.auc });
    }
    const arr = [...best.values()].sort((a, b) => b.auc - a.auc);
    if (arr[0]) return { sym: arr[0].sym, itv: arr[0].itv };
  } catch {
    /* DB lỗi → fallback */
  }
  return { sym: "BTCUSDT", itv: "15m" };
}

// ─── Một vòng tiến hoá ────────────────────────────────────────────────────────

export async function evolveRound(bridge: EvolveBridge): Promise<EvolveOutcome> {
  const comboTag = (c: { sym: string; itv: string }) => `${c.sym} ${c.itv}`;
  try {
    if (!evolveOn()) return { decision: "keep", combo: "—", note: "EVOLVE_ON=0 — vòng tắt" };

    // 0 · cooldown giữa các lần ÁP — chống đun vỉ tham số
    const lastPromote = await activePromotion();
    const lastAction = await db.evolveLog.findFirst({
      where: { decision: { in: ["promote", "revert"] } },
      orderBy: { createdAt: "desc" },
    });
    if (lastAction) {
      const coolMs = COOLDOWN_H() * 3_600_000;
      if (Date.now() - lastAction.createdAt.getTime() < coolMs) {
        const h = r1((coolMs - (Date.now() - lastAction.createdAt.getTime())) / 3_600_000);
        return { decision: "keep", combo: "—", note: `cooldown — còn ${h}h trước lần áp/khôi tiếp theo` };
      }
    }

    // 1 · combo đại diện + klines (1 lần fetch, dùng chung mọi backtest)
    const combo = await pickCombo(bridge);
    const wrongG = await wrongDirGlobal().catch(() => null);
    const KLINE_LIMIT_EVOLVE = 500;
    const { klines } = await fetchKlinesDirectResolved(combo.sym, combo.itv, KLINE_LIMIT_EVOLVE);

    // 2 · refresh lab — ứng viên mới từ grid + feature importance champion
    const before = labOf(bridge.settings());
    const beforeKey = configKey(before);
    await runStrategyLab(combo.sym, combo.itv, { klines, base: before });

    // 3 · nạp lại bảng ứng viên vừa ghi
    const since = new Date(Date.now() - 10 * 60_000);
    const raws = await db.strategyVariant.findMany({
      where: { symbol: combo.sym, interval: combo.itv, createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      take: 120,
    });
    const rows: MetricsRow[] = raws.map((r) => {
      let config: LabConfig = before;
      let metrics: LabMetrics | null = null;
      try {
        config = JSON.parse(r.config) as LabConfig;
      } catch {
        /* giữ baseline */
      }
      if (r.metrics) {
        try {
          metrics = JSON.parse(r.metrics) as LabMetrics;
        } catch {
          metrics = null;
        }
      }
      return { id: r.id, config, metrics, name: r.name, hypothesis: r.hypothesis, baseline: r.baseline, applied: r.applied, createdAt: r.createdAt };
    });
    const baselineRow = rows.find((r) => r.baseline) ?? null;
    const baseMetrics = baselineRow?.metrics ?? null;

    // 4 · lane LLM (fail-open): đề xuất thêm ứng viên ngoài lưới, backtest như mọi ứng viên
    let llmNote = "";
    if (llmLaneOn()) {
      try {
        const cands = rows
          .filter((r) => !r.baseline && r.metrics)
          .sort((a, b) => (b.metrics!.expectancy ?? 0) - (a.metrics!.expectancy ?? 0))
          .slice(0, 8)
          .map((r) => ({
            name: r.name,
            expectancy: r3(r.metrics!.expectancy),
            trades: r.metrics!.trades,
            maxDd: r2(r.metrics!.maxDd),
            config: r.config,
          }));
        const tried = await db.evolveLog.findMany({ orderBy: { createdAt: "desc" }, take: 6 });
        const trades = await db.autoTrade.findMany({
          where: { status: "closed" },
          orderBy: { exitTime: "desc" },
          take: 10,
          select: { symbol: true, side: true, pnlPct: true, exitKind: true },
        });
        const champ = await db.finetuneRun.findFirst({
          where: { symbol: combo.sym, interval: combo.itv },
          orderBy: [{ auc: "desc" }, { createdAt: "desc" }],
        });
        let importance: { name: string; gain: number }[] = [];
        if (champ?.importance) {
          try {
            const arr = JSON.parse(champ.importance) as { name?: unknown; gain?: unknown }[];
            importance = (Array.isArray(arr) ? arr : [])
              .filter((x) => typeof x?.name === "string" && typeof x?.gain === "number")
              .slice(0, 12)
              .map((x) => ({ name: x.name as string, gain: Math.round((x.gain as number) * 1000) / 1000 }));
          } catch {
            /* importance hỏng → bỏ qua */
          }
        }
        const ctx = JSON.stringify({
          combo: comboTag(combo),
          current_config: before,
          baseline_backtest: baseMetrics && { trades: baseMetrics.trades, expectancy: r3(baseMetrics.expectancy), maxDd: r2(baseMetrics.maxDd), winRate: r1(baseMetrics.winRate) },
          candidates: cands,
          recent_evolution: tried.map((t) => ({ at: t.createdAt.toISOString(), decision: t.decision, name: t.name, detail: t.detail.slice(0, 160) })),
          recent_paper_trades: trades.map((t) => ({ symbol: t.symbol, side: t.side, pnlPct: t.pnlPct, exit: t.exitKind })),
          feature_importance: importance,
          wrong_dir_global: wrongG,
          rules: "1 candidate only. Must differ from current_config and from losing candidates. tpPct and slPct in % of price. Vietnamese hypothesis. If wrong_dir_global.rate >= 0.35, prefer anti-wrong-direction candidates (raise minAcc / tighten gate / larger SL ATRx), do not propose TP change.",
        });
        const ep = bridge.llmEndpoint();
        const t0 = Date.now();
        const pr = await llmPropose(ep.url, ep.model, ctx, ep.timeoutMs);
        bridge.log(`LLM lane ${pr.ok ? "ok" : `fail (${pr.detail})`} ${Date.now() - t0}ms`);
        if (pr.ok && pr.proposal) {
          const cfg = clampProposal(pr.proposal);
          const key = configKey(cfg);
          if (key !== beforeKey && !rows.some((r) => configKey(r.config) === key)) {
            const metrics = backtestLab(klines, cfg, combo.sym, combo.itv);
            await db.strategyVariant.create({
              data: {
                symbol: combo.sym,
                interval: combo.itv,
                name: `LLM — ${pr.proposal.name}`.slice(0, 80),
                hypothesis: (pr.proposal.hypothesis || "LLM đề xuất từ bối cảnh tích hợp").slice(0, 400),
                sourceFeature: "llm",
                config: JSON.stringify(cfg),
                baseline: false,
                scored: true,
                metrics: JSON.stringify(metrics),
                applied: false,
                scoredAt: new Date(),
              },
            });
            rows.push({ id: "", config: cfg, metrics, name: `LLM — ${pr.proposal.name}`, hypothesis: pr.proposal.hypothesis, baseline: false, applied: false, createdAt: new Date() });
            llmNote = " +1 ứng viên LLM";
          }
        }
      } catch (e) {
        bridge.log(`LLM lane error: ${e instanceof Error ? e.message : e}`);
      }
    }

    // 5 · chấm + quyết định
    const eligible = rows.filter((r) => !r.baseline && r.metrics && r.metrics.trades >= MIN_TRADES());
    // Guardrail v2: live chua du mau -> keep, khong promote
    const live = await bridge.closedSince(new Date(Date.now() - 30 * 24 * 3600_000)).catch(() => ({ n: 0, expectancy: 0 }));
    if (live.n < 10) {
      return { decision: "keep", combo: comboTag(combo), note: `guardrail: doi du mau - live ${live.n}/10 lenh dong 30 ngay, chua promote (exp live ${r3(live.expectancy)}%/lenh)` };
    }

    const best = eligible.sort((a, b) => b.metrics!.expectancy - a.metrics!.expectancy)[0] ?? null;
    const passMargin = !!best && !!baseMetrics && best.metrics!.expectancy >= baseMetrics.expectancy + MARGIN() && best.metrics!.maxDd <= baseMetrics.maxDd * DD_FACTOR();
    const passDd = !best || !baseMetrics || best.metrics!.maxDd >= baseMetrics.maxDd * DD_FACTOR();
    const passDiff = !!best && configKey(best.config) !== beforeKey;
    const passApplied = !!best && !best.applied;

    if (best && baseMetrics && passMargin && passDd && passDiff && passApplied) {
      // ÁP — quyền quyết định thuộc backtest trên nến thật, LLM/grid chỉ là người đề xuất
      bridge.applyLab(best.config);
      if (best.id) {
        try {
          await db.strategyVariant.update({ where: { id: best.id }, data: { applied: true, appliedAt: new Date() } });
        } catch {
          /* đánh dấu là mốc kiểm toán — lỗi không ảnh hưởng việc áp cfg */
        }
      }
      const detail =
        `vượt mốc: exp ${r3(best.metrics!.expectancy)} vs ${r3(baseMetrics.expectancy)}%/lệnh · DD ${r2(best.metrics!.maxDd)} vs ${r2(baseMetrics.maxDd)}% · ${best.hypothesis}`;
      await logRow(comboTag(combo), "promote", best.name, detail, before, best.config, { base: baseMetrics, best: best.metrics });
      bridge.tg(
        `🧬 <b>SELF-EVOLUTION</b> — Agent HEDGE · Book B (XGB) · áp cho engine: <b>${best.name}</b>\n` +
          `<code>${cfgShort(best.config)}</code> · sân thử <code>${comboTag(combo)}</code>\n` +
          `Backtest: ${mLine(best.metrics)}\nMốc cũ: ${mLine(baseMetrics)}\n` +
          `⏳ Theo dõi ${WATCH_N()} lệnh giấy tới — nếu exp thực < ${r3(baseMetrics.expectancy)}%/lệnh (mốc − 0.1) sẽ TỰ HOÀN TÁC về cfg cũ.\n` +
          `🔒 GRAIL: B cần ≥20 lệnh đóng · C hết RISK_OFF mới mở.`,
      );
      bridge.log(`promote "${best.name}" trên ${comboTag(combo)} — ${cfgShort(best.config)}`);
      return { decision: "promote", combo: comboTag(combo), note: `${best.name} — ${detail}` };
    }

    // Không đủ biên → ghi nhận để vòng sau học (LLM đọc recent_evolution)
    const why = !best
      ? "không ứng viên nào đủ số lệnh tối thiểu"
      : !passMargin
        ? `exp ${r3(best.metrics!.expectancy)} chưa vượt mốc ${r3(baseMetrics?.expectancy ?? 0)} + ${MARGIN()}`
        : !passDd
          ? `DD ${r2(best.metrics!.maxDd)}% sâu hơn ngưỡng cho phép`
          : !passDiff
            ? "ứng viên trùng cfg đang chạy"
            : "ứng viên đã áp trước đó";
    const note = best ? `${best.name}: ${why}${llmNote}` : `không ứng viên${llmNote}`;
    await logRow(comboTag(combo), "keep", best?.name ?? "", note, before, null, { base: baseMetrics, best: best?.metrics ?? null });
    bridge.log(`keep — ${note}`);
    return { decision: "keep", combo: comboTag(combo), note };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    try {
      await logRow("—", "error", "", msg.slice(0, 400), null, null, null);
    } catch {
      /* log lỗi cũng lỗi → bỏ qua */
    }
    return { decision: "error", combo: "—", note: msg };
  }
}

// ─── Theo dõi sau khi áp — tự hoàn tác nếu tệ hơn mốc ─────────────────────────

export async function evolveWatch(bridge: EvolveBridge): Promise<EvolveOutcome> {
  try {
    const active = await activePromotion();
    if (!active) return { decision: "keep", combo: "—", note: "không có bản áp nào đang theo dõi" };
    const w = await bridge.closedSince(active.at);
    if (w.n < WATCH_N()) return { decision: "keep", combo: active.combo, note: `theo dõi ${w.n}/${WATCH_N()} lệnh` };
    const baseExp = active.metrics?.base?.expectancy ?? 0;
    const eps = 0.1; // biên nhiễu — không hoàn tác vì khác nhau trong 0.1%/lệnh
    if (w.expectancy <= baseExp - eps) {
      // TỰ HOÀN TÁC — cfg về như trước khi áp
      if (active.cfgBefore) bridge.applyLab(active.cfgBefore);
      const detail = `kết thúc theo dõi: ${w.n} lệnh thực exp ${r3(w.expectancy)}%/lệnh — tệ hơn mốc backtest ${r3(baseExp)} → hoàn tác về <code>${active.cfgBefore ? cfgShort(active.cfgBefore) : "—"}</code>`;
      await logRow(active.combo, "revert", active.name, detail, active.cfgAfter, active.cfgBefore, { watch: w });
      bridge.tg(
        `↩️ <b>SELF-EVOLUTION — REVERT</b> ${active.combo}\n` +
          `«${active.name}» không qua theo dõi: ${w.n} lệnh exp ${r3(w.expectancy)}%/lệnh vs mốc ${r3(baseExp)}%.\n` +
          `Cfg đã về: <code>${active.cfgBefore ? cfgShort(active.cfgBefore) : "—"}</code>`,
      );
      bridge.log(`revert "${active.name}" — watch exp ${r3(w.expectancy)} vs ${r3(baseExp)}`);
      return { decision: "revert", combo: active.combo, note: detail };
    }
    const detail = `kết thúc theo dõi: ${w.n} lệnh exp ${r3(w.expectancy)}%/lệnh ≥ mốc ${r3(baseExp)} − 0.1 → xác nhận giữ nguyên cfg mới`;
    await logRow(active.combo, "confirm", active.name, detail, null, active.cfgAfter, { watch: w });
    bridge.log(`confirm "${active.name}" — watch exp ${r3(w.expectancy)}`);
    return { decision: "confirm", combo: active.combo, note: detail };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { decision: "error", combo: "—", note: msg };
  }
}

// ─── Thông tin cho API/UI ─────────────────────────────────────────────────────

export interface EvolveInfo {
  on: boolean;
  llmLane: boolean;
  roundMin: number;
  cooldownH: number;
  watchN: number;
  minTrades: number;
  margin: number;
  active: Awaited<ReturnType<typeof activePromotion>>;
  watch: { n: number; need: number } | null;
  history: { at: string; combo: string; decision: string; name: string; detail: string; cfgAfter: string; cfgBefore: string; metrics: string | null }[];
}

export async function evolveInfo(bridge: Pick<EvolveBridge, "closedSince">): Promise<EvolveInfo> {
  const active = await activePromotion();
  let watch: { n: number; need: number } | null = null;
  if (active) {
    try {
      const w = await bridge.closedSince(active.at);
      watch = { n: w.n, need: WATCH_N() };
    } catch {
      watch = null;
    }
  }
  const rows = await db.evolveLog.findMany({ orderBy: { createdAt: "desc" }, take: 20 });
  return {
    on: evolveOn(),
    llmLane: llmLaneOn(),
    roundMin: ROUND_MIN(),
    cooldownH: COOLDOWN_H(),
    watchN: WATCH_N(),
    minTrades: MIN_TRADES(),
    margin: MARGIN(),
    active,
    watch,
    history: rows.map((r) => ({
      at: r.createdAt.toISOString(),
      combo: r.combo,
      decision: r.decision,
      name: r.name,
      detail: r.detail,
      cfgAfter: r.cfgAfter,
      cfgBefore: r.cfgBefore,
      metrics: r.metrics,
    })),
  };
}
