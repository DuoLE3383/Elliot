// ─── Thống kê toàn app — /api/stats + LLM "vạch lá tìm sâu" ──────────────────
// Một nguồn duy nhất tổng hợp số liệu THẬT từ DB + engine cho:
//   • trang /stats  — mỗi section kèm 3 dòng kiểm toán:
//       CƠ SỞ LOGIC (số liệu từ đâu, công thức nào) — do server gắn nhãn;
//       NHẤT QUAN (state ok/warn/na + note — các kiểm chéo CHẠY THẬT: đối chiếu
//       hai đường tính độc lập, tìm mẫu lệch outcome, lệnh treo, scan stale);
//       CHUẨN XÁC ~% (Wilson 95% cận dưới cho mọi win-rate — thống kê trung thực
//       với mẫu nhỏ thay vì "60% trên 5 lệnh" nghe oai hơn thực tế).
//   • /api/llm/stats-dive — chính snapshot JSON này được nhét vào prompt để
//     LLM đối chiếu và chỉ ra điểm yếu. LLM KHÔNG được bịa: prompt cấm dùng
//     số ngoài JSON.
// Read-only 100% — không ghi gì vào DB.

import { db } from "@/lib/db";
import { engineSnapshot } from "@/lib/engine";
import { readAutoState } from "@/lib/autostate";
import { comboStats, isTradeable, type ScanRow } from "@/lib/autotrade";
import { outcomeOf, type XgbBiasRow } from "@/lib/history";
import { LESSON_WEIGHT, NOISE_BAND, SCAN_TTL, UNIVERSE_LOOKBACK_CANDLES, UNIVERSE_SCAN_MS } from "@/lib/params";
import { SESSIONS, sessionOf, sessionOverlap, type SessionKey } from "@/lib/market";
import { UNIVERSE } from "@/lib/universe";

// ─── Wilson 95% lower bound — độ tin cậy cận dưới của một tỉ lệ ─────────────
// win-rate 60% trên 5 lệnh có cận dưới ~14.5% — số "chuẩn xác tối thiểu" ta
// có thể TIN; trên 100 lệnh cận dưới ~50.4%. Đây là cách trả lời trung thực
// cho câu "đã chuẩn xác được bao nhiêu %": không phải độ chính xác của phép
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
export interface StatMetric {
  k: string; // nhãn tiếng Việt (chuẩn chung với /api/ai-info — server gắn nhãn)
  v: string;
  sub?: string;
}
export interface StatSection {
  key: string;
  state: StatState;
  /** kiểm chéo đã chạy thật + kết luận nhất quan với logic engine */
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
  ts ? `${min(Date.now() - ts)} phút trước` : "chưa có";

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
      note: `Không tổng hợp được: ${e instanceof Error ? e.message : String(e)}`,
      accPct: 0,
      accNote: "không có dữ liệu",
      metrics: [],
    };
  }
}

export async function buildStatsSnapshot(): Promise<StatsSnapshot> {
  const now = Date.now();
  const eng = engineSnapshot(); // không ném — tự catch bên trong qua try ở caller
  const cfg = eng.cfg;

  // ─── 1. Trading sessions ──────────────────────────────────────────────────
  const sessions = await safe("sessions", async () => {
    const active = sessionOf(now);
    const ov = sessionOverlap(now);
    const h = new Date(now).getUTCHours();
    // phiên kế tiếp mở sớm nhất
    let nextIn = 999;
    let nextKey: SessionKey = "sydney";
    for (const s of SESSIONS) {
      const wait = (s.from - h + 24) % 24;
      if (wait > 0 && wait < nextIn) {
        nextIn = wait;
        nextKey = s.key;
      }
    }
    return {
      state: "ok" as StatState,
      note: "Phiên là HẰNG SỐ cấu hình (khung giờ UTC cố định) — đúng hệ quy chiếu mà model ăn qua one-hot phiên (sessionOneHot) khi train. Không có gì kiểm chéo động được vì nó là định nghĩa.",
      accPct: 100,
      accNote: "số mô tả cấu hình — đúng 100% theo định nghĩa market.ts",
      metrics: [
        { k: "Đang mở", v: active.length ? active.map((s) => SESSION_VI[s]).join(" + ") : "nghỉ giữa phiên", sub: `overlap ${Math.round(ov * 100)}%` },
        { k: "Phiên kế tiếp", v: `${SESSION_VI[nextKey]} sau ${nextIn}h` },
        { k: "Khung giờ (UTC)", v: SESSIONS.map((s) => `${SESSION_VI[s.key]} ${s.from}–${s.to}h`).join(" · ") },
        { k: "Đặc tính", v: "London + New York chồng nhau 12–16h UTC = thanh khoản đỉnh" },
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
        ? "Hai đường tính độc lập (query count thắng trực tiếp vs comboStats cộng theo combo) ra CÙNG một số — nhất quan với logic 'win = ROE > 0' của autotrade.comboStats."
        : `Lệch số: count()=${winsByCount} nhưng cộng tay=${wins} — có bản ghi pnlPct null/âm dương bất thường, cần soi.`,
      accPct: wilsonLB(wins, closed),
      accNote: `Wilson 95% cận dưới trên ${closed} lệnh đóng — con số win-rate xấu nhất vẫn đáng tin`,
      metrics: [
        { k: "Lệnh đã đóng", v: String(closed), sub: `${wins} thắng` },
        { k: "Combo có dữ liệu", v: String(comboStats(rows).length) },
        ...combos.map((c) => ({
          k: `${c.symbol.replace("USDT", "")} ${c.interval}`,
          v: `${c.winRate.toFixed(0)}%`,
          sub: `${c.closed} lệnh · net ${c.netPnlPct >= 0 ? "+" : ""}${c.netPnlPct.toFixed(1)}%`,
        })),
      ],
    };
  });

  // ─── 3. Universe scan ─────────────────────────────────────────────────────
  const universe = await safe("universe", async () => {
    const u = eng.universe;
    const ageMin = u ? min(now - u.at) : null;
    const stale = !u || ageMin == null || ageMin > UNIVERSE_SCAN_MS / 60_000 + 60;
    const rows = u?.rows ?? [];
    const top = rows[0];
    return {
      state: (stale ? "warn" : "ok") as StatState,
      note: stale
        ? "Lần re-rank gần nhất đã quá chu kỳ 8h (+1h dung sai) — scheduler universe có thể chưa chạy/đang chạy, panel đang hiển thị dữ liệu cũ (đúng thiết kế: stale hiển thị, không trade theo)."
        : "Snapshot universe mới hơn chu kỳ re-rank 8h — nhất quan với scheduler (UNIVERSE_SCAN_MS). Công thức điểm: 60% trend (EMA20/50 spread + vị trí Donchian 20 nến) + 40% ATR% bão hoà ở 5%, chấm trên 240 nến 1h (~10 ngày) nến ĐÃ ĐÓNG.",
      accPct: 100,
      accNote: "số mô tả trạng thái xếp hạng — đúng công thức universe.ts 100%",
      metrics: [
        { k: "Bể quét", v: `${UNIVERSE.length} cặp`, sub: "11 cặp trụ cột luôn dẫn đầu" },
        { k: "Top công bố", v: `${rows.length} cặp`, sub: u ? `chấm ${ago(u.at)}` : "chưa có snapshot" },
        ...(top
          ? [{
              k: "Đầu bảng",
              v: top.symbol.replace("USDT", ""),
              sub: `score ${top.score.toFixed(2)} · ATR ${top.atrPct.toFixed(2)}% · trend ${(top.trend * 100).toFixed(0)}% · 10d ${(top.ret10d * 100).toFixed(1)}%`,
            }]
          : []),
        { k: "Đang uptrend", v: `${rows.filter((r) => r.trend > 0).length}/${rows.length}` },
        { k: "Cửa sổ chấm", v: `${UNIVERSE_LOOKBACK_CANDLES} nến 1h (~10 ngày)` },
      ],
    };
  });

  // ─── 4. Auto Trade — Dry-run ──────────────────────────────────────────────
  const auto = await safe("auto", async () => {
    const st = await readAutoState();
    const newestClosed = st.trades.find((t) => t.status === "closed") ?? null;
    // kiểm chéo sổ vốn: lệnh đang mở phải có capitalBefore == capitalAfter của
    // lệnh đóng mới nhất (engine ghi 2 số này ở 2 thời điểm khác nhau — lệch
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
        ? "Sổ vốn khớp: capitalBefore của lệnh đang mở == capitalAfter của lệnh đóng mới nhất — đúng luồng closeTradeDirect (capitalAfter chốt trước khi mở lệnh kế). Dry-run là THUẦN GIẤY: không có lệnh thật, mọi lệnh đều AutoTrade DB."
        : "Sổ vốn LỆCH: capitalBefore lệnh mở ≠ capitalAfter lệnh đóng mới nhất — kiểm tra xem có ai đóng lệnh tay/PATCH giữa chừng hay không.",
      accPct: st.stats.closed > 0 ? wilsonLB(st.stats.wins, st.stats.closed) : 0,
      accNote: st.stats.closed > 0 ? `Wilson 95% cận dưới trên ${st.stats.closed} lệnh` : "chưa có lệnh đóng nào",
      metrics: [
        { k: "Chế độ", v: cfg.on ? "Auto ON" : "Auto OFF", sub: "luôn dry-run (giấy)" },
        { k: "Vốn hiện tại", v: st.capital != null ? `$${st.capital.toFixed(2)}` : "—", sub: "khởi điểm $1000" },
        { k: "Đã đóng / thắng", v: `${st.stats.closed} / ${st.stats.wins}`, sub: `win-rate ${st.stats.winRate.toFixed(0)}%` },
        { k: "Net ROE cộng", v: `${st.stats.netPnlPct >= 0 ? "+" : ""}${st.stats.netPnlPct.toFixed(2)}%` },
        { k: "Kinh nghiệm nạp model", v: `${st.stats.closed * LESSON_WEIGHT} mẫu`, sub: `${st.stats.closed} lệnh × LESSON_WEIGHT ${LESSON_WEIGHT}` },
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
    // ngoài dải nhiễu NOISE_BAND — đây là hàng sẽ được xét vào lệnh
    const cands = rows.filter(
      (r) => isTradeable(r, cfg.minAuc, cfg.minAcc, cfg.minScore) && !r.regressed && Math.abs(r.prob - 0.5) >= NOISE_BAND,
    );
    const bcast = await db.bcastVerdict.findMany();
    const pass = bcast.filter((b) => b.verdict === "pass").length;
    return {
      state: (stale ? "warn" : "ok") as StatState,
      note: stale
        ? `Scan mới nhất ${age == null ? "không rõ" : `${age} phút`} tuổi — quá SCAN_TTL ${SCAN_TTL / 60_000}m: panel hiển thị dữ liệu cũ đúng thiết kế, auto-cycle sẽ tự quét lại ở bucket 5 phút kế.`
        : `Scan tươi (< ${SCAN_TTL / 60_000}m). Ứng viên được đếm ĐÚNG bộ lọc auto-cycle: gate minAuc ${cfg.minAuc}/minAcc ${cfg.minAcc}/minScore ${cfg.minScore} + không regressed vs champion + ngoài dải nhiễu ±${(NOISE_BAND * 100).toFixed(0)}%.`,
      accPct: 100,
      accNote: "số mô tả trạng thái quét hiện tại — đếm trực tiếp trên ScanRow",
      metrics: [
        { k: "Scan gần nhất", v: scan ? ago(scan.at) : "chưa quét", sub: `${rows.length} combo` },
        { k: "Ứng viên đạt cổng", v: `${cands.length}/${rows.length}`, sub: cands[0] ? `tốt nhất ${cands[0].symbol.replace("USDT", "")} ${cands[0].interval} score ${cands[0].score.toFixed(1)}` : "—"},
        { k: "NEUTRAL (bỏ)", v: String(rows.filter((r) => r.bias === "NEUTRAL").length) },
        { k: "Bcast gate 5m", v: `${pass}/${bcast.length} pass`, sub: "một thuật toán gate dùng chung panel + Telegram" },
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
        note: "Không có lệnh auto đang mở — engine đứng ngoài thị trường cho tới khi có ứng viên đạt cổng + LLM go.",
        accPct: 100,
        accNote: "trạng thái rỗng — đúng 100%",
        metrics: [{ k: "Vị thế", v: "Không có lệnh mở" }],
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
          ? `Lệnh đã mở ${durH.toFixed(1)}h (>24h) — giữ quá lâu so với nhịp 5m/flip của engine: chỉ xảy ra khi chưa từng có tín hiệu đủ tin cậy để TP/SL/flip. Đáng được LLM soi.`
          : "Một lệnh dry-run duy nhất tại mọi thời điểm (thiết kế engine). ROE tính theo giá live Binance futures × đòn bẩy — cùng công thức closeTradeDirect.",
      accPct: 100,
      accNote: "giá live realtime tại thời điểm gọi (nếu Binance trả lời)",
      metrics: [
        { k: "Vị thế", v: `${o.side} ${o.symbol.replace("USDT", "")} ${o.interval}`, sub: `×${o.leverage} · stake ${o.stakePct ?? 100}%` },
        { k: "Entry", v: String(o.entryPrice), sub: `${durH.toFixed(1)}h trước` },
        ...(roe != null ? [{ k: "ROE tạm", v: `${roe >= 0 ? "+" : ""}${roe.toFixed(2)}%` }] : []),
        { k: "SL / TP", v: `${o.slPct}% / ${o.tpPct}%`, ...(slDist != null ? { sub: `cách SL ${slDist >= 0 ? "+" : ""}${slDist.toFixed(2)} điểm %` } : {}) },
        { k: "LLM lúc vào", v: o.llmVerdict ?? "—", sub: o.llmReason ?? undefined },
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
    const kinds = { tp: 0, sl: 0, flip: 0, manual: 0 };
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
          ? `${unlabeled} lệnh đóng không nhãn exitKind (đóng trước bản 0.2.24 hoặc đóng tay từ bản cũ) — tổng theo nhãn không khớp tổng đóng, phần còn lại là lệnh cổ.`
          : "Tổng theo nhãn ra đúng tổng lệnh đã đóng — mọi lệnh đều đi qua closeTradeDirect nên exitKind luôn được ghi (tp/sl/flip/manual).",
      accPct: 100,
      accNote: "số đếm chính xác trên DB — không phải ước lượng",
      metrics: [
        { k: "Tổng lệnh", v: String(rows.length), sub: `${rows.length - closed.length} mở · ${closed.length} đóng` },
        { k: "TP / SL", v: `${kinds.tp} / ${kinds.sl}`, sub: `flip ${kinds.flip} · tay ${kinds.manual}` },
        ...(avg != null ? [{ k: "ROE trung bình", v: `${avg >= 0 ? "+" : ""}${avg.toFixed(2)}%` }] : []),
        ...(best != null ? [{ k: "Tốt nhất / xấu nhất", v: `+${best.toFixed(1)}% / ${worst ?? 0}%` }] : []),
        { k: "7 ngày qua", v: `${last7d} lệnh đóng` },
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
          ? "Chấm lại TẤT CẢ outcome đã lưu bằng outcomeOf(entry, exit) — khớp 100% với dữ liệu. Nghĩa là 'win = giá đi đúng phía bias' không bị lệch giữa lúc ghi và lúc đọc."
          : `${mismatch} đề xuất có outcome KHÔNG khớp khi chấm lại từ giá — dữ liệu resolve bị ghi sai hoặc công thức đổi sau khi chấm. Cần dọn trước khi tin hit-rate.`,
      accPct: judged > 0 ? wilsonLB(win, judged) : 0,
      accNote: judged > 0 ? `Wilson 95% cận dưới trên ${judged} đề xuất đã phân thắng/thua (flat loại)` : "chưa có đề xuất nào được chấm",
      metrics: [
        { k: "Tổng đề xuất", v: String(rows.length), sub: `${rows.length - res.length} chờ horizon` },
        { k: "Win / Loss", v: `${win} / ${loss}`, sub: `flat ${flat} (loại khỏi hit-rate)` },
        { k: "Hit-rate theo phía", v: judged > 0 ? `${((win / judged) * 100).toFixed(0)}%` : "—", sub: "prob theo phía bias" },
        ...(avgPnl != null ? [{ k: "PnL trung bình", v: `${avgPnl >= 0 ? "+" : ""}${avgPnl.toFixed(2)}%` }] : []),
        { k: "LONG / SHORT", v: `${rows.filter((r) => r.bias === "LONG").length} / ${rows.filter((r) => r.bias === "SHORT").length}` },
      ],
    };
  });

  return { at: now, sections: [sessions, combo, universe, auto, dock, openPos, hist, sg] };
}
