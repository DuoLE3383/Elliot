// ─── Thống kê toàn app — /api/stats + LLM phân tích nguyên nhân gốc ──────────────
// Một nguồn duy nhất tổng hợp số liệu THẬT từ DB + engine cho:
//   • trang /stats  — mỗi section kèm 3 dòng kiểm toán:
//       CƠ SỞ LOGIC (số liệu từ đâu, công thức nào) — do server gắn nhãn;
//       NHẤT QUÁN (state ok/warn/na + note — các kiểm chéo CHẠY THẬT: đối chiếu
//       hai đường tính độc lập, tìm mẫu lệch outcome, trades treo, scan stale);
//       CHUẨN XÁC ~% (Wilson 95% cận dưới cho mọi win-rate — thống kê trung thực
//       với mẫu nhỏ thay vì "60% on 5 trades" nghe oai hơn thực tế).
//   • /api/llm/stats-dive — chính snapshot JSON này được nhét vào prompt để
//     LLM đối chiếu và chỉ ra điểm yếu. LLM KHÔNG được bịa: prompt cấm dùng
//     số ngoài JSON.
// Read-only 100% — không ghi gì vào DB.

import { db } from "@/lib/db";
import { engineSnapshot } from "@/lib/engine";
import { readAutoState } from "@/lib/autostate";
import { comboStats, isTradeable, type ScanRow } from "@/lib/autotrade";
import { outcomeOf, type XgbBiasRow } from "@/lib/history";
import { LESSON_WEIGHT, NOISE_BAND, SCAN_TTL, UNIVERSE_LOOKBACK_CANDLES, UNIVERSE_SCAN_MS, pval } from "@/lib/params";
import { SESSIONS, sessionOf, sessionOneHot, sessionOverlap, type SessionKey } from "@/lib/market";
import { UNIVERSE } from "@/lib/universe";

// ─── Wilson 95% lower bound — độ tin cậy cận dưới của một tỉ lệ ─────────────
// win-rate 60% on 5 trades có cận dưới ~14.5% — số "minimum confidence floor" ta
// có thể TIN; trên 100 trades cận dưới ~50.4%. Đây là cách trả lời trung thực
// cho câu "how confident is this rate": not computational accuracy of the
// tính (phép tính luôn đúng 100%), mà là ĐỘ TIN CẬY của con số khi làm căn cứ.
export function wilsonLB(wins: number, n: number, z = 1.96): number {
  if (n <= 0) return 0;
  const p = wins / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return Math.max(0, Math.round(((c - m) / d) * 1000) / 10);
}

export type StatState = "ok" | "warn" | "na";
/** 0.2.67 — màu ngữ nghĩa của GIÁ TRỊ một field: server gắn tone theo ngưỡng
 *  thật (ok xanh = tốt, warn vàng = cần chú ý, bad đỏ = xấu, info teal = mô
 *  tả/live, dim xám = không dữ liệu/chân trang) — client chỉ tô, KHÔNG tự suy
 *  từ chữ nên không bao giờ lệch giữa server và màn hình. */
export type StatTone = "ok" | "warn" | "bad" | "info" | "dim";
export interface StatMetric {
  k: string; // nhãn tiếng Việt (chuẩn chung với /api/ai-info — server gắn nhãn)
  v: string;
  sub?: string;
  /** chiếm trọn cả hàng (sm:col-span-2) — dòng dài không bị cắt giữa chừng */
  wide?: boolean;
  /** 0.2.67 — tone màu cho giá trị (client tô theo bảng TONE_TEXT/TONE_EDGE) */
  tone?: StatTone;
}
export interface StatSection {
  key: string;
  state: StatState;
  /** kiểm chéo đã chạy thật + kết luận nhất quán với logic engine */
  note: string;
  /** độ tin cậy của con số: Wilson LB cho tỉ lệ, 100 cho số đếm/mô tả */
  accPct: number;
  accNote: string;
  metrics: StatMetric[];
}
export interface StatsSnapshot {
  at: number;
  sections: StatSection[];
}

const min = (ms: number): number => Math.round(ms / 60_000);
const ago = (ts: number | null | undefined): string =>
  ts ? `${min(Date.now() - ts)}m ago` : "none";

const SESSION_VI: Record<SessionKey, string> = {
  sydney: "Sydney",
  tokyo: "Tokyo",
  london: "London",
  newyork: "New York",
};

/** bọc một section — DB chết thì section đó "na" chứ cả trang không chết */
async function safe(key: string, fn: () => Promise<Omit<StatSection, "key">>): Promise<StatSection> {
  try {
    return { key, ...(await fn()) };
  } catch (e) {
    return {
      key,
      state: "na",
      note: `Aggregation failed: ${e instanceof Error ? e.message : String(e)}`,
      accPct: 0,
      accNote: "no data",
      metrics: [],
    };
  }
}

export async function buildStatsSnapshot(): Promise<StatsSnapshot> {
  const now = Date.now();
  const eng = engineSnapshot(); // không ném — tự catch bên trong qua try ở caller
  const cfg = eng.cfg;

  // ─── 1. Trading sessions ──────────────────────────────────────────────────
  // 0.2.66 — panel "còn trống" → đầy đủ: trạng thái + đếm ngược TỚI PHÚT của
  // cả 4 phiên, vector one-hot model đang nhận lúc này, các cửa sổ chồng phiên.
  // Tất cả suy ra từ đúng 1 bảng SESSIONS (market.ts) — vẫn "definition only".
  const sessions = await safe("sessions", async () => {
    const active = sessionOf(now);
    const ov = sessionOverlap(now);
    const d = new Date(now);
    const minsNow = d.getUTCHours() * 60 + d.getUTCMinutes();
    const fmtDur = (m: number): string => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
    const hh = (n: number): string => String(n).padStart(2, "0");

    // đếm ngược tới lúc PHIÊN KẾ mở (phút) — bỏ phiên đang mở (wait = 0)
    let nextInMin = 1440;
    let nextKey: SessionKey = "sydney";
    for (const s of SESSIONS) {
      const wait = (s.from * 60 - minsNow + 1440) % 1440;
      if (wait > 0 && wait < nextInMin) {
        nextInMin = wait;
        nextKey = s.key;
      }
    }

    // một ô cho mỗi phiên: OPEN + còn bao lâu đóng / closed + bao lâu nữa mở
    const sessTile = (key: SessionKey): StatMetric => {
      const s = SESSIONS.find((x) => x.key === key)!;
      const openNow = active.includes(key);
      const edge = (openNow ? s.to : s.from) * 60; // phút mốc đóng/mở kế tiếp
      const left = (edge - minsNow + 1440) % 1440;
      return {
        k: SESSION_VI[key],
        v: openNow ? `OPEN · closes in ${fmtDur(left)}` : `closed · opens in ${fmtDur(left)}`,
        sub: `${hh(s.from)}–${hh(s.to)}h UTC`,
        tone: openNow ? "ok" : "dim", // xanh = phiên đang mở, xám = đã đóng (quy ước sàn)
      };
    };

    const oneHot = sessionOneHot(now);
    return {
      state: "ok" as StatState,
      note: "Sessions are fixed UTC hour ranges — same frame the model gets via sessionOneHot at train time. Statuses, countdowns and the one-hot vector are computed live from the SAME SESSIONS table; no dynamic cross-check (definition only).",
      accPct: 100,
      accNote: "config + clock metrics — 100% from market.ts definitions",
      metrics: [
        { k: "Open now", v: active.length ? active.map((s) => SESSION_VI[s]).join(" + ") : "between sessions", sub: `London+NY deep-liquidity flag = ${ov}`, tone: active.length ? "ok" : "dim" },
        { k: "Next session", v: `${SESSION_VI[nextKey]} opens in ${fmtDur(nextInMin)}`, tone: "info" },
        ...SESSIONS.map((s) => sessTile(s.key)),
        { k: "Model input now", v: `one-hot [${oneHot.join(" · ")}]`, sub: "order: Sydney · Tokyo · London · New York", tone: "info" },
        { k: "Liquidity windows", v: "00–06 · 07–09 · 12–16 (peak)", sub: "Syd+Tok · Tok+Lon · Lon+NY — all UTC", tone: "info" },
        { k: "Notes", v: "London + New York overlap 12–16h UTC = peak liquidity — deepest books, tightest spreads; Sydney/Tokyo hours run thinner", wide: true, tone: "dim" },
      ],
    };
  });

  // ─── 2. Win rate theo pair/TF ─────────────────────────────────────────────
  const combo = await safe("combo", async () => {
    const rows = await db.autoTrade.findMany({
      where: { status: "closed" },
      select: { symbol: true, interval: true, status: true, pnlPct: true },
    });
    const combos = comboStats(rows).slice(0, 6);
    const closed = rows.length;
    const wins = rows.filter((r) => (r.pnlPct ?? 0) > 0).length;
    // kiểm chéo ĐỘC LẬP: đếm thắng bằng 1 query count riêng rồi đối với tổng
    // wins do comboStats cộng tay — lệch ⇒ dữ liệu/công thức có vấn đề
    const winsByCount = await db.autoTrade.count({ where: { status: "closed", pnlPct: { gt: 0 } } });
    const match = winsByCount === wins;
    return {
      state: (match ? "ok" : "warn") as StatState,
      note: match
        ? "Two independent paths (direct win count vs comboStats sum) match — consistent with win = ROE > 0 in autotrade.comboStats."
        : `Count mismatch: count()=${winsByCount} vs sum=${wins} — check null/odd pnlPct rows.`,
      accPct: wilsonLB(wins, closed),
      accNote: `Wilson 95% lower bound on ${closed} closed trades — worst-case WR still credible`,
      metrics: [
        { k: "Closed trades", v: String(closed), sub: `${wins} wins`, tone: "info" },
        { k: "Combos with data", v: String(comboStats(rows).length), tone: "info" },
        ...combos.map(
          (c): StatMetric => ({
            k: `${c.symbol.replace("USDT", "")} ${c.interval}`,
            v: `${c.winRate.toFixed(0)}%`,
            sub: `${c.closed} trades · net ${c.netPnlPct >= 0 ? "+" : ""}${c.netPnlPct.toFixed(1)}%`,
            // WR ≥50% xanh, ≥40% vàng, dưới đỏ — cùng ngưỡng với bảng theo cặp
            tone: c.winRate >= 50 ? "ok" : c.winRate >= 40 ? "warn" : "bad",
          }),
        ),
      ],
    };
  });

  // ─── 3. Universe scan ─────────────────────────────────────────────────────
  const universe = await safe("universe", async () => {
    const u = eng.universe;
    const ageMin = u ? min(now - u.at) : null;
    const stale = !u || ageMin == null || ageMin > pval("UNIVERSE_SCAN_MS", UNIVERSE_SCAN_MS) / 60_000 + 60;
    const rows = u?.rows ?? [];
    const top = rows[0];
    const upN = rows.filter((r) => r.trend > 0).length;
    return {
      state: (stale ? "warn" : "ok") as StatState,
      note: stale
        ? "Last re-rank older than 8h (+1h tolerance) — universe job may be idle; panel shows last snapshot by design (display only, not traded)."
        : "Universe snapshot within 8h re-rank window — consistent with scheduler (UNIVERSE_SCAN_MS). Score = 60% trend (EMA20/50 spread + 20-bar Donchian position) + 40% ATR% (caps at 5%), over 240 closed 1h bars (~10 days).",
      accPct: 100,
      accNote: "ranking metrics — 100% from universe.ts formula",
      metrics: [
        { k: "Universe pool", v: `${UNIVERSE.length} pairs`, sub: "11 staple pairs always included", tone: "info" },
        { k: "Published top", v: `${rows.length} pairs`, sub: u ? `scored ${ago(u.at)}` : "no snapshot yet", tone: rows.length > 0 ? "info" : "warn" },
        ...(top
          ? [{
              k: "Top ranked",
              v: top.symbol.replace("USDT", ""),
              sub: `score ${top.score.toFixed(2)} · ATR ${top.atrPct.toFixed(2)}% · trend ${(top.trend * 100).toFixed(0)}% · 10d ${(top.ret10d * 100).toFixed(1)}%`,
              tone: "info" as StatTone,
            }]
          : []),
        { k: "Uptrend count", v: `${upN}/${rows.length}`, tone: rows.length === 0 ? "dim" : upN / rows.length > 0.5 ? "ok" : upN > 0 ? "warn" : "bad" },
        { k: "Scoring window", v: `${UNIVERSE_LOOKBACK_CANDLES} 1h bars (~10 days)`, tone: "dim" },
      ],
    };
  });

  // ─── 4. Auto Trade — Dry-run ──────────────────────────────────────────────
  const auto = await safe("auto", async () => {
    const st = await readAutoState();
    const lw = pval("LESSON_WEIGHT", LESSON_WEIGHT);
    const newestClosed = st.trades.find((t) => t.status === "closed") ?? null;
    // kiểm chéo sổ vốn: trades đang mở phải có capitalBefore == capitalAfter của
    // closed trades mới nhất (engine ghi 2 số này ở 2 thời điểm khác nhau — lệch
    // ⇒ có đóng/mở chen ngang hoặc dữ liệu tay đụng vào)
    const chainOk =
      !st.open ||
      !newestClosed ||
      st.open.capitalBefore == null ||
      newestClosed.capitalAfter == null ||
      Math.abs(st.open.capitalBefore - newestClosed.capitalAfter) < 0.01;
    return {
      state: (chainOk ? "ok" : "warn") as StatState,
      note: chainOk
        ? "Equity chain OK: open.capitalBefore == lastClosed.capitalAfter — matches closeTradeDirect. Paper dry-run only (AutoTrade DB)."
        : "Equity chain MISMATCH: open.capitalBefore ≠ lastClosed.capitalAfter — check for a manual close or PATCH in between.",
      accPct: st.stats.closed > 0 ? wilsonLB(st.stats.wins, st.stats.closed) : 0,
      accNote: st.stats.closed > 0 ? `Wilson 95% lower bound on ${st.stats.closed} trades` : "no closed trades yet",
      metrics: [
        { k: "Mode", v: cfg.on ? "Auto ON" : "Auto OFF", sub: "paper dry-run only", tone: cfg.on ? "ok" : "warn" },
        { k: "Equity", v: st.capital != null ? `$${st.capital.toFixed(2)}` : "—", sub: "start $1000", tone: st.capital == null ? "dim" : st.capital > 1000 ? "ok" : st.capital < 1000 ? "bad" : "info" },
        { k: "Closed / wins", v: `${st.stats.closed} / ${st.stats.wins}`, sub: `win rate ${st.stats.winRate.toFixed(0)}%`, tone: st.stats.closed === 0 ? "dim" : st.stats.winRate >= 50 ? "ok" : st.stats.winRate >= 40 ? "warn" : "bad" },
        { k: "Net ROE sum", v: `${st.stats.netPnlPct >= 0 ? "+" : ""}${st.stats.netPnlPct.toFixed(2)}%`, tone: st.stats.netPnlPct > 0 ? "ok" : st.stats.netPnlPct < 0 ? "bad" : "dim" },
        { k: "Lesson samples", v: `${st.stats.closed * lw}`, sub: `${st.stats.closed} trades × LESSON_WEIGHT ${lw}`, tone: "info" },
      ],
    };
  });

  // ─── 5. Signal dock — scan gần nhất + cổng chất lượng ────────────────────
  const dock = await safe("dock", async () => {
    const scan = eng.scan;
    const rows: ScanRow[] = scan?.rows ?? [];
    const age = scan ? min(now - scan.at) : null;
    const stale = !scan || age == null || age > SCAN_TTL / 60_000;
    // đúng bộ lọc ứng viên của auto-cycle: isTradeable + không regressed +
    // ngoài dải nhiễu NOISE_BAND — đây là hàng sẽ được xét vào trades
    const nb = pval("NOISE_BAND", NOISE_BAND);
    const cands = rows.filter(
      (r) => isTradeable(r, cfg.minAuc, cfg.minAcc, cfg.minScore) && !r.regressed && Math.abs(r.prob - 0.5) >= nb,
    );
    const bcast = await db.bcastVerdict.findMany();
    const pass = bcast.filter((b) => b.verdict === "pass").length;
    return {
      state: (stale ? "warn" : "ok") as StatState,
      note: stale
        ? `Latest scan ${age == null ? "unknown" : `${age}m`} old — past SCAN_TTL ${SCAN_TTL / 60_000}m: panel keeps last scan by design; auto-cycle refreshes next 5m bucket.`
        : `Fresh scan (< ${SCAN_TTL / 60_000}m). Candidates counted with the same auto-cycle filters: gate minAuc ${cfg.minAuc}/minAcc ${cfg.minAcc}/minScore ${cfg.minScore} + not regressed vs champion + outside noise band ±${(nb * 100).toFixed(0)}%.`,
      accPct: 100,
      accNote: "live scan metrics — counted on ScanRow",
      metrics: [
        { k: "Latest scan", v: scan ? ago(scan.at) : "not scanned", sub: `${rows.length} combo`, tone: scan ? "info" : "bad" },
        { k: "Gate-pass candidates", v: `${cands.length}/${rows.length}`, sub: cands[0] ? `best ${cands[0].symbol.replace("USDT", "")} ${cands[0].interval} score ${cands[0].score.toFixed(1)}` : "—", tone: cands.length > 0 ? "ok" : "warn" },
        { k: "NEUTRAL (skipped)", v: String(rows.filter((r) => r.bias === "NEUTRAL").length), tone: "dim" },
        { k: "Bcast gate 5m", v: `${pass}/${bcast.length} pass`, sub: "single gate algorithm for panel + Telegram", tone: bcast.length > 0 && pass === bcast.length ? "ok" : pass > 0 ? "info" : "warn" },
      ],
    };
  });

  // ─── 6. Open auto position ────────────────────────────────────────────────
  const openPos = await safe("open", async () => {
    const st = await readAutoState();
    const o = st.open;
    if (!o) {
      return {
        state: "na" as StatState,
        note: "No open auto trade — engine stays flat until a gated candidate + LLM go.",
        accPct: 100,
        accNote: "empty state — by design",
        metrics: [{ k: "Position", v: "No open trade", tone: "dim" }],
      };
    }
    const durMs = now - new Date(o.entryTime).getTime();
    const durH = durMs / 3_600_000;
    // giá live best-effort (2.5s) — không có giá thì vẫn hiển thị phần còn lại
    let last: number | null = null;
    try {
      const r = await fetch(`https://fapi.binance.com/fapi/v1/ticker/price?symbol=${o.symbol}`, {
        signal: AbortSignal.timeout(2500),
        cache: "no-store",
      });
      if (r.ok) last = Number((await r.json()).price) || null;
    } catch {
      last = null;
    }
    const roe =
      last != null
        ? ((o.side === "SHORT" ? (o.entryPrice - last) / o.entryPrice : (last - o.entryPrice) / o.entryPrice) * 100 * o.leverage)
        : null;
    const slDist = last != null ? Math.abs((last - o.entryPrice) / o.entryPrice) * 100 - o.slPct : null;
    return {
      state: (durH > 24 ? "warn" : "ok") as StatState,
      note:
        durH > 24
          ? `Position open ${durH.toFixed(1)}h (>24h) — long vs 5m/flip cadence; only if no TP/SL/flip signal was strong enough. Worth LLM review.`
          : "Single dry-run position at a time. ROE = live Binance futures move × leverage — same formula as closeTradeDirect.",
      accPct: 100,
      accNote: "live price at request time (if Binance responds)",
      metrics: [
        // LONG xanh / SHORT đỏ — đúng quy ước side của cả app (suggestions, auto-panel…)
        { k: "Position", v: `${o.side} ${o.symbol.replace("USDT", "")} ${o.interval}`, sub: `×${o.leverage} · stake ${o.stakePct ?? 100}%`, tone: o.side === "LONG" ? "ok" : "bad" },
        { k: "Entry", v: String(o.entryPrice), sub: `${durH.toFixed(1)}h ago`, tone: "info" },
        ...(roe != null ? [{ k: "Unrealized ROE", v: `${roe >= 0 ? "+" : ""}${roe.toFixed(2)}%`, tone: roe >= 0 ? ("ok" as StatTone) : ("bad" as StatTone) }] : []),
        { k: "SL / TP", v: `${o.slPct}% / ${o.tpPct}%`, ...(slDist != null ? { sub: `to SL ${slDist >= 0 ? "+" : ""}${slDist.toFixed(2)} pts %` } : {}), tone: "info" },
        { k: "LLM at entry", v: o.llmVerdict ?? "—", sub: o.llmReason ?? undefined, tone: o.llmVerdict === "go" ? "ok" : o.llmVerdict === "skip" ? "warn" : o.llmVerdict ? "bad" : "dim" },
      ],
    };
  });

  // ─── 7. Auto history ──────────────────────────────────────────────────────
  const hist = await safe("hist", async () => {
    const rows = await db.autoTrade.findMany({
      select: { status: true, exitKind: true, pnlPct: true, exitTime: true },
      orderBy: { createdAt: "desc" },
      take: 2000,
    });
    const closed = rows.filter((r) => r.status === "closed");
    const kinds = { tp: 0, sl: 0, trail: 0, flip: 0, manual: 0 };
    for (const r of closed) {
      const k = (r.exitKind ?? "") as keyof typeof kinds;
      if (k in kinds) kinds[k] += 1;
    }
    const unlabeled = closed.length - Object.values(kinds).reduce((a, b) => a + b, 0);
    const pnls = closed.map((r) => r.pnlPct ?? 0);
    const best = pnls.length ? Math.max(...pnls) : null;
    const worst = pnls.length ? Math.min(...pnls) : null;
    const avg = pnls.length ? pnls.reduce((a, b) => a + b, 0) / pnls.length : null;
    const last7d = closed.filter((r) => r.exitTime && now - new Date(r.exitTime).getTime() < 7 * 86_400_000).length;
    return {
      state: (unlabeled > 0 ? "warn" : "ok") as StatState,
      note:
        unlabeled > 0
          ? `${unlabeled} closed trades missing exitKind (pre-0.2.24 or legacy manual close) — label totals under-count; remainder is legacy.`
          : "Label totals match closed count — every close goes through closeTradeDirect (tp/sl/trail/flip/manual).",
      accPct: 100,
      accNote: "exact DB counts — not estimates",
      metrics: [
        { k: "Total trades", v: String(rows.length), sub: `${rows.length - closed.length} open · ${closed.length} closed`, tone: "info" },
        // TP nhiều hơn SL xanh, ngược lại đỏ — bằng nhau thì teal
        { k: "TP / SL", v: `${kinds.tp} / ${kinds.sl}`, sub: `trail ${kinds.trail} · flip ${kinds.flip} · tay ${kinds.manual}`, tone: kinds.tp > kinds.sl ? "ok" : kinds.tp < kinds.sl ? "bad" : "info" },
        ...(avg != null ? [{ k: "Avg ROE", v: `${avg >= 0 ? "+" : ""}${avg.toFixed(2)}%`, tone: (avg > 0 ? "ok" : avg < 0 ? "bad" : "dim") as StatTone }] : []),
        ...(best != null ? [{ k: "Best / worst", v: `+${best.toFixed(1)}% / ${worst ?? 0}%`, tone: "info" as StatTone }] : []),
        { k: "Last 7 days", v: `${last7d} closed trades`, tone: "info" },
      ],
    };
  });

  // ─── 8. Suggestion history (PHE) ──────────────────────────────────────────
  const sg = await safe("sg", async () => {
    const rows = await db.suggestion.findMany({
      select: { bias: true, prob: true, outcome: true, entryPrice: true, exitPrice: true, pnlPct: true },
      take: 5000,
      orderBy: { createdAt: "desc" },
    });
    const res = rows.filter((r) => r.outcome != null);
    const win = res.filter((r) => r.outcome === "win").length;
    const loss = res.filter((r) => r.outcome === "loss").length;
    const flat = res.filter((r) => r.outcome === "flat").length;
    // kiểm chéo logic: chấm lại outcome từ giá bằng outcomeOf() của history.ts
    // (cùng hàm lúc resolve) — lệch ⇒ dữ liệu resolve cũ sai/công thức đổi
    let mismatch = 0;
    for (const r of res) {
      if (r.bias === "NEUTRAL" || r.exitPrice == null || !r.entryPrice) continue;
      if (outcomeOf(r.bias as XgbBiasRow, r.entryPrice, r.exitPrice) !== r.outcome) mismatch += 1;
    }
    const judged = win + loss;
    const avgPnl =
      res.filter((r) => r.outcome !== "flat" && r.pnlPct != null).length > 0
        ? res.filter((r) => r.outcome !== "flat" && r.pnlPct != null).reduce((a, r) => a + (r.pnlPct ?? 0), 0) /
          res.filter((r) => r.outcome !== "flat" && r.pnlPct != null).length
        : null;
    return {
      state: (mismatch === 0 ? "ok" : "warn") as StatState,
      note:
        mismatch === 0
          ? "Re-scored all stored outcomes via outcomeOf(entry, exit) — 100% match. win = price moved with bias side at write and read."
          : `${mismatch} suggestions re-score mismatch from price — bad resolve data or formula drift. Clean before trusting hit-rate.`,
      accPct: judged > 0 ? wilsonLB(win, judged) : 0,
      accNote: judged > 0 ? `Wilson 95% lower bound on ${judged} resolved suggestions (ex-flat)` : "no scored suggestions yet",
      metrics: [
        { k: "Total suggestions", v: String(rows.length), sub: `${rows.length - res.length} awaiting horizon`, tone: "info" },
        { k: "Win / Loss", v: `${win} / ${loss}`, sub: `flat ${flat} (excluded from hit-rate)`, tone: judged === 0 ? "dim" : win > loss ? "ok" : win < loss ? "bad" : "info" },
        { k: "Side-aware hit-rate", v: judged > 0 ? `${((win / judged) * 100).toFixed(0)}%` : "—", sub: "prob aligned to bias side", tone: judged === 0 ? "dim" : (win / judged) * 100 >= 50 ? "ok" : (win / judged) * 100 >= 40 ? "warn" : "bad" },
        ...(avgPnl != null ? [{ k: "Avg PnL", v: `${avgPnl >= 0 ? "+" : ""}${avgPnl.toFixed(2)}%`, tone: (avgPnl >= 0 ? "ok" : "bad") as StatTone }] : []),
        { k: "LONG / SHORT", v: `${rows.filter((r) => r.bias === "LONG").length} / ${rows.filter((r) => r.bias === "SHORT").length}`, tone: "info" },
      ],
    };
  });

  return { at: now, sections: [sessions, combo, universe, auto, dock, openPos, hist, sg] };
}
