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
// 0.2.68 — mỗi metric thêm hint/hintVi (tooltip hover giải thích field), mỗi
// section thêm accent (màu nhận diện theo luồng: thị trường → model → scan →
// lệnh → lịch sử) + charts (dữ liệu thô để client vẽ SVG, không cần dependency).
// Read-only 100% — không ghi gì vào DB.

import { db } from "@/lib/db";
import { engineSnapshot } from "@/lib/engine";
import { readAutoState } from "@/lib/autostate";
import { comboStats, isTradeable, type ScanRow } from "@/lib/autotrade";
import { readDqfFile, DQF_MIN_N, type DqfBand } from "@/lib/dqf";
import { outcomeOf, type XgbBiasRow } from "@/lib/history";
import { LESSON_WEIGHT, NOISE_BAND, SCAN_TTL, UNIVERSE_LOOKBACK_CANDLES, UNIVERSE_SCAN_MS, pval, feeRoi } from "@/lib/params";
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
/** 0.2.68 — màu nhận diện SECTION theo luồng xử lý. Các section nối tiếp nhau
 *  trong pipeline dùng màu để nhận ra "phần này nối vào phần nào":
 *  market(cyan) → universe(sky) → combo(violet) → dock(amber) → auto(emerald)
 *  → open(rose) → hist(orange) / sg(indigo); journal(fuchsia), analysis(blue). */
export type StatAccent =
  | "cyan" | "sky" | "violet" | "emerald" | "amber" | "rose" | "orange" | "indigo"
  | "fuchsia" | "blue";

export interface StatMetric {
  k: string; // nhãn tiếng Việt (chuẩn chung với /api/ai-info — server gắn nhãn)
  v: string;
  sub?: string;
  /** chiếm trọn cả hàng (sm:col-span-2) — dòng dài không bị cắt giữa chừng */
  wide?: boolean;
  /** 0.2.67 — tone màu cho giá trị (client tô theo bảng TONE_TEXT/TONE_EDGE) */
  tone?: StatTone;
  /** 0.2.68 — tooltip hover TIẾNG ANH giải thích field: công thức + nguồn */
  hint?: string;
  /** 0.2.68 — tooltip hover TIẾNG VIỆT — client chọn theo lang hiện tại */
  hintVi?: string;
}

/** 0.2.68 — dữ liệu thô cho biểu đồ; client vẽ SVG tay (stat-charts.tsx),
 *  KHÔNG thêm chart library nào — giữ bundle nhẹ và đồng bộ theme tối. */
export type StatChart =
  | {
      /** đường vốn — x = thời điểm đóng lệnh (ms), y = vốn ảo sau lệnh */
      kind: "line";
      unit: string;
      points: { t: number; v: number }[];
      hint?: string;
      hintVi?: string;
    }
  | {
      /** cột — v có thể âm (PnL) hoặc 0..max (win rate, score) */
      kind: "bars";
      unit: string;
      items: { label: string; v: number; /** (0.2.91) dòng chi tiết hiện trong tooltip hover TỪNG cột */ sub?: string[] }[];
      /** trần cố định trục Y (vd 100 cho win rate) — bỏ trống thì tự scale */
      max?: number;
      hint?: string;
      hintVi?: string;
    }
  | {
      /** thanh xếp lớp một hàng + chú giải — phân bố kind/bias/outcome */
      kind: "stack";
      items: { label: string; n: number }[];
      hint?: string;
      hintVi?: string;
    }
  | {
      /** table: hourly and daily trade history, PNL pct and PNL USD visible */
      kind: "table";
      columns: string[];
      rows: string[][];
      details?: Record<string, Array<Array<string>>>;
      hint?: string;
      hintVi?: string;
    }
  | {
      /** timeline 24h của 4 phiên UTC + mốc "now" — client tự vẽ từ SESSIONS */
      kind: "timeline";
      hint?: string;
      hintVi?: string;
    };

export interface StatSection {
  key: string;
  state: StatState;
  /** kiểm chéo đã chạy thật + kết luận nhất quán với logic engine */
  note: string;
  /** độ tin cậy của con số: Wilson LB cho tỉ lệ, 100 cho số đếm/mô tả */
  accPct: number;
  accNote: string;
  metrics: StatMetric[];
  /** 0.2.68 — màu nhận diện section (viền trên + tiêu đề + chấm màu) */
  accent?: StatAccent;
  /** 0.2.68 — các biểu đồ kèm section (client render dưới lưới field) */
  charts?: StatChart[];
}
/** 0.3.4 — khối số liệu THÔ cho layout APM của trang /stats (sơ đồ phễu
 *  Sankey + rail phải Events/Health/Scorecard + cột Net result). Tách khỏi
 *  metrics dạng chữ để client không phải parse string — mọi số đây là số
 *  nguyên/thật từ cùng nguồn DB + engine với các section. */

export type LedgerBook = { start: number; pnlClosed: number; closed: number; wins: number };
export type Ledger = { perBook: Record<string, LedgerBook>; totalStart: number; pnlClosed: number; pnlOpen: number; totalPnl: number; totalEquity: number; wins: number; closed: number; open: number; winRate: number; netRoiClosed: number };
export interface StatsFlow {
  ledger: Ledger;
  totalEquity?: number;
  totalStartCapital?: number;
  // ── phễu quét (trái sơ đồ) ──
  universePool: number; // tổng cặp UNIVERSE (11 staples + mở rộng)
  publishedTop: number; // cặp được chấm điểm lần re-rank gần nhất
  uptrend: number; // trong đó đang uptrend
  universeAgeMin: number | null;
  scanCombos: number; // combo quét lần scan gần nhất
  scanAgeMin: number | null;
  gatePass: number; // "GATE PASSED (RECENT)" — combo đang pass gate (BcastVerdict) chấm trong 24h gần nhất
  directional: number; // combo có phía LONG/SHORT
  neutral: number; // combo NEUTRAL (bỏ qua)
  bcastPass: number;
  bcastTotal: number;
  // ── sổ lệnh (giữa/phải sơ đồ) ──
  tradesTotal: number;
  openTrades: number;
  closedTrades: number;
  wins: number;
  winRate: number; // %
  wilson: number; // Wilson 95% LB — độ tin cậy cận dưới
  netRoi: number; // % tổng ROI ròng
  avgRoi: number; // % ROI bình quân/lệnh
  tp: number;
  sl: number;
  trail: number;
  flip: number;
  manual: number;
  unlabeled: number;
  last7d: number;
  // ── dry-run vốn + lệnh đang mở ──
  autoOn: boolean;
  equity: number | null;
  open: { symbol: string; side: string; roi: number | null; ageH: number } | null;
  openPositions?: Array<{ symbol: string; side: string; roi: number | null; ageH: number }>;
  // ── phiên ──
  activeSessions: string[];
  nextSession: string;
  nextInMin: number; // đếm ngược mở phiên kế (phút)
  // ── tình trạng kiểm chéo các section ──
  ok: number;
  warn: number;
  na: number;
}

export interface StatsSnapshot {
  at: number;
  /** 0.3.2 — công tắc DQF (sàn chất lượng động) — trang /stats dùng cho Switch */
  dqfOn?: boolean;
  /** 0.3.4 — số liệu thô cho sơ đồ APM (null = DB chết, trang vẫn render) */
  flow?: StatsFlow | null;
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

  // 0.3.4 — đọc trạng thái dry-run MỘT lần dùng chung cho 3 nơi (auto / open
  // / flow) thay vì mỗi section tự đọc; DB chết → null, safe() từng section
  // vẫn tự xử lý đúng
  const st0 = await readAutoState().catch(() => null);
  // Flow hien du opens: B (st0.opens) + A/C/D (db truc tiep, giong /api/books-open)
  let booksOpens: any[] = [];
  try {
    const [aRows, cRows, dRows] = await Promise.all([
      (db as any).vulcanBook?.findMany({ where: { status: "open" } }) ?? [],
      (db as any).wyckoffBook?.findMany({ where: { status: "open" } }) ?? [],
      (db as any).liquidBook?.findMany({ where: { status: "open" } }) ?? [],
    ]);
    const mapBook = (r: any, lev: number) => ({ symbol: r.symbol, side: r.side, entryPrice: Number(r.entryPrice ?? 0), leverage: lev, entryTime: r.entryTime ?? r.createdAt ?? null });
    booksOpens = [...aRows.map((r: any) => mapBook(r, 5)), ...cRows.map((r: any) => mapBook(r, 1)), ...dRows.map((r: any) => mapBook(r, 3))];
  } catch { booksOpens = []; }
  const allOpens: any[] = [...(st0?.opens ?? (st0?.open ? [st0.open] : [])), ...booksOpens];
  // giá live cho lệnh đang mở — fetch MỘT lần dùng chung (trước đây open tự
  // fetch; giờ flow + open chia sẻ, tiết kiệm 1 round-trip Binance mỗi poll)
  let livePrice: number | null = null;
  const priceMap: Record<string, number> = {};
  if (allOpens.length > 0) {
    const syms = Array.from(new Set(allOpens.map((x: any) => x.symbol).filter(Boolean)));
    const results = await Promise.all(syms.map(async (sym) => {
      try {
        const r = await fetch(`https://fapi.binance.com/fapi/v1/ticker/price?symbol=${sym}`, { signal: AbortSignal.timeout(2500), cache: "no-store" });
        if (r.ok) return [sym, Number((await r.json()).price) || null];
      } catch {}
      return [sym, null];
    }));
    for (const [sym, px] of results) { if (px != null) priceMap[sym as string] = px as number; }
    if (st0?.open?.symbol && priceMap[st0.open.symbol] != null) livePrice = priceMap[st0.open.symbol];
  }

  // ─── 1. Market Model — dự báo xu hướng (thay panel Trading sessions 0.2.68) ─
  // Dự báo = TỔNG HỢP output các model đang chạy, không phải model mới:
  //   • lean = (Σ prob LONG − Σ prob SHORT) / (Σ prob cả hai), bỏ NEUTRAL —
  //     prob đã căn theo phía bias lúc scan nên cộng thẳng được.
  //   • regime từ universe (tỉ lệ cặp uptrend) + vector phiên one-hot model
  //     đang nhận + cửa sổ thanh khoản. Ngưỡng ±15% mới gọi là nghiêng hẳn.
  const market = await safe("market", async () => {
    const active = sessionOf(now);
    const ov = sessionOverlap(now);
    const d = new Date(now);
    const minsNow = d.getUTCHours() * 60 + d.getUTCMinutes();
    const fmtDur = (m: number): string => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;

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

    // ── đồng thuận từ scan mới nhất (cùng nguồn với Signal dock) ──
    const scanRows: ScanRow[] = eng.scan?.rows ?? [];
    const age = eng.scan ? min(now - eng.scan.at) : null;
    const stale = !eng.scan || age == null || age > SCAN_TTL / 60_000;
    const longs = scanRows.filter((r) => r.bias === "LONG");
    const shorts = scanRows.filter((r) => r.bias === "SHORT");
    const wLong = longs.reduce((a, r) => a + r.prob, 0);
    const wShort = shorts.reduce((a, r) => a + r.prob, 0);
    const wTotal = wLong + wShort;
    const lean = wTotal > 0 ? (wLong - wShort) / wTotal : 0; // −1..+1
    const dirN = longs.length + shorts.length;
    const dirShare = scanRows.length > 0 ? dirN / scanRows.length : 0;
    const best = [...longs, ...shorts].sort((a, b) => b.prob - a.prob)[0] ?? null;

    // ── regime từ universe ──
    const uRows = eng.universe?.rows ?? [];
    const upN = uRows.filter((r) => r.trend > 0).length;
    const upShare = uRows.length > 0 ? upN / uRows.length : 0;

    const forecast: { v: string; tone: StatTone } =
      wTotal === 0
        ? { v: "no directional signal", tone: "dim" }
        : lean >= 0.15
          ? { v: "LONG", tone: "ok" }
          : lean <= -0.15
            ? { v: "SHORT", tone: "bad" }
            : { v: "BALANCED", tone: "info" };

    const oneHot = sessionOneHot(now);

    return {
      state: (scanRows.length === 0 ? "na" : stale ? "warn" : "ok") as StatState,
      note: stale
        ? `Scan ${age == null ? "unknown" : `${age}m`} old (past SCAN_TTL) — the forecast below is aggregated from that older scan; auto-cycle refreshes next 5m bucket.`
        : "Forecast = probability-weighted consensus of the FRESH scan: lean = (Σprob LONG − Σprob SHORT)/(Σboth), NEUTRAL excluded; ≥ +15% calls LONG, ≤ −15% calls SHORT, else BALANCED. Regime context from universe uptrend share. Same scan rows as the Signal dock — consistent by construction; sessions are definition-only (fixed UTC table).",
      accPct: 100,
      accNote: "aggregation of live model outputs — formula-true, no estimate",
      accent: "cyan" as StatAccent,
      charts: [
        {
          kind: "timeline" as const,
          hint: "The 4 UTC sessions across 24h (fixed table in market.ts) — red line = now. The model consumes these as one-hot features; London+NY overlap 12–16h UTC is the deep-liquidity window.",
          hintVi: "4 phiên UTC trong 24h (bảng cố định market.ts) — vạch đỏ = bây giờ. Model nhận các phiên này dưới dạng one-hot; chồng London+NY 12–16h UTC là cửa sổ thanh khoản sâu.",
        },
      ],
      metrics: [
        {
          k: "Forecast",
          v: forecast.v,
          sub: `${(lean * 100).toFixed(2)}% lean · Σprob LONG ${wLong.toFixed(2)} vs SHORT ${wShort.toFixed(2)}`,
          tone: forecast.tone,
          hint: "Trend forecast = probability-weighted consensus of the latest scan: lean = (Σprob LONG − Σprob SHORT) / (Σprob both), NEUTRAL excluded. lean ≥ +15% → LONG, ≤ −15% → SHORT, else BALANCED. Aggregation of existing model outputs, not a new predictive model.",
          hintVi: "Dự báo xu hướng = đồng thuận có trọng số xác suất từ scan mới nhất: lean = (Σprob LONG − Σprob SHORT)/(Σprob hai bên), bỏ NEUTRAL. lean ≥ +15% → LONG, ≤ −15% → SHORT, còn lại BALANCED. Đây là tổng hợp output các model hiện có, không phải model dự báo mới.",
        },
        {
          k: "Directional coverage",
          v: scanRows.length > 0 ? `${(dirShare * 100).toFixed(2)}% (${dirN}/${scanRows.length})` : "—",
          sub: "scan combos with a LONG/SHORT bias",
          tone: dirShare >= 0.3 ? "ok" : dirShare > 0 ? "info" : "dim",
          hint: "Share of scanned combos currently directional (not NEUTRAL). Low coverage = the models see no clear edge right now — a balanced/flat market.",
          hintVi: "Tỉ lệ combo scan đang có phía (không NEUTRAL). Tỉ lệ thấp = các model không thấy lợi thế rõ lúc này — thị trường Flat/từ từ.",
        },
        ...(best
          ? [{
              k: "Strongest signal",
              v: `${best.symbol.replace("USDT", "")} ${best.interval}`,
              sub: `${best.bias} · prob ${(best.prob * 100).toFixed(2)}% · score ${best.score.toFixed(2)}`,
              tone: (best.bias === "LONG" ? "ok" : "bad") as StatTone,
              hint: "Highest-probability directional row in the latest scan (prob already aligned to the bias side) — the model's most confident call right now.",
              hintVi: "Dòng có xác suất cao nhất trong scan mới nhất (prob đã căn theo phía bias) — phán đoán tự tin nhất của model lúc này.",
            }]
          : []),
        {
          k: "Trend regime",
          v: uRows.length > 0 ? `${upN}/${uRows.length} uptrend` : "—",
          sub: "universe pairs with EMA20>EMA89 trend",
          tone: uRows.length === 0 ? "dim" : upShare > 0.5 ? "ok" : upN > 0 ? "warn" : "bad",
          hint: "Share of universe pairs in an uptrend (positive trend component of the universe score) — regime context: >50% = broad uptrend, mixed = choppy.",
          hintVi: "Tỉ lệ cặp trong universe đang uptrend (thành phần xu hướng dương của điểm universe) — bối cảnh regime: >50% = uptrend rộng, trộn lẫn = thị trường xoay chiều.",
        },
        {
          k: "Session input",
          v: `one-hot [${oneHot.join(" · ")}]`,
          sub: `order: Sydney · Tokyo · London · New York · liqFlag=${ov}`,
          tone: "info",
          hint: "The one-hot session vector the model receives THIS minute (train-time encoding) + the London∩NY deep-liquidity flag. Sessions are fixed UTC ranges — same frame as training.",
          hintVi: "Vector one-hot phiên mà model đang nhận TẠI PHÚT NÀY (đúng encoding lúc train) + cờ thanh khoản London∩NY. Phiên là khung UTC cố định — cùng hệ quy chiếu lúc train.",
        },
        {
          k: "Open now",
          v: active.length ? active.map((s) => SESSION_VI[s]).join(" + ") : "between sessions",
          tone: active.length ? "ok" : "dim",
          hint: "Sessions currently open (UTC convention). Green = market hours with live liquidity, gray = quiet hours.",
          hintVi: "Các phiên đang mở (quy ước UTC). Xanh = giờ có thanh khoản, xám = giờ vắng.",
        },
        {
          k: "Next session",
          v: `${SESSION_VI[nextKey]} opens in ${fmtDur(nextInMin)}`,
          tone: "info",
          hint: "Countdown to the next session open — session opens often bring volume/stop-runs; the model sees this boundary via one-hot features.",
          hintVi: "Đếm ngược tới phiên kế mở — lúc mở phiên thường có volume/ quét stop; model thấy ranh giới này qua biến one-hot.",
        },
        {
          k: "Notes",
          v: "Forecast strength scales with directional coverage — a lean on 2/20 combos is noise. London + New York overlap 12–16h UTC = peak liquidity; Sydney/Tokyo hours run thinner.",
          wide: true,
          tone: "dim",
          hint: "Reading guidance: always check Directional coverage next to the Forecast — the lean % is only meaningful when enough combos are directional.",
          hintVi: "Cách đọc: luôn xem Directional coverage cạnh Forecast — % lean chỉ có ý nghĩa khi đủ nhiều combo có phía.",
        },
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
        ? "Two independent paths (direct win count vs comboStats sum) match — consistent with win = ROI > 0 in autotrade.comboStats."
        : `Count mismatch: count()=${winsByCount} vs sum=${wins} — check null/odd pnlPct rows.`,
      accPct: wilsonLB(wins, closed),
      accNote: `Wilson 95% lower bound on ${closed} closed trades — worst-case WR still credible`,
      accent: "violet" as StatAccent,
      ...(combos.length > 0
        ? {
            charts: [
              {
                kind: "bars" as const,
                unit: "%",
                max: 100,
                items: combos.map((c) => ({
                  label: `${c.symbol.replace("USDT", "")} ${c.interval}`,
                  v: c.winRate,
                  // (0.2.91) chi tiết hover từng cột: số lệnh + ROI ròng
                  sub: [`${c.closed} trades`, `net ${c.netPnlPct >= 0 ? "+" : ""}${c.netPnlPct.toFixed(2)}%`],
                })),
                hint: "Win rate per pair+timeframe (top 6 by closed trades, 0–100%). Bars ≥50% are green-tinted on the page. Hover a bar for trades count and net ROI.",
                hintVi: "Win rate theo cặp+khung giờ (top 6 theo số lệnh đóng, 0–100%). Di chuột lên cột để xem số lệnh và ROI ròng.",
              },
              {
                // (0.2.91) ROI trung bình MỖI LỆNH theo combo — WR cao mà avg
                // âm là thắng ít nhưng lỗ to: chất lượng lệnh đằng sau WR
                kind: "bars" as const,
                unit: "%",
                items: combos.map((c) => ({
                  label: `${c.symbol.replace("USDT", "")} ${c.interval}`,
                  v: c.closed > 0 ? c.netPnlPct / c.closed : 0,
                  sub: [`${c.closed} trades`, `WR ${c.winRate.toFixed(2)}%`, `net tổng ${c.netPnlPct >= 0 ? "+" : ""}${c.netPnlPct.toFixed(2)}%`],
                })),
                hint: "Average ROI per closed trade for each pair+timeframe (net ROI sum ÷ trades) — the trade QUALITY behind the win rate: 67% WR can still lose money when losses outweigh wins. Hover a bar for trades, WR and net sum.",
                hintVi: "ROI trung bình mỗi lệnh đã đóng theo cặp+khung (tổng ROI ròng ÷ số lệnh) — CHẤT LƯỢNG lệnh đằng sau win rate: WR 67% vẫn có thể lỗ nếu lỗ to hơn lãi. Di chuột xem số lệnh, WR và tổng net.",
              },
            ],
          }
        : {}),
      metrics: [
        { k: "Closed trades", v: String(closed), sub: `${wins} wins`, tone: "info", hint: "All AutoTrade rows with status=closed across every pair/timeframe; a win = ROI (pnlPct) > 0.", hintVi: "Mọi lệnh AutoTrade đã đóng ở mọi cặp/khung; thắng = ROI (pnlPct) > 0." },
        { k: "Combos with data", v: String(comboStats(rows).length), tone: "info", hint: "Distinct symbol+interval combos with at least one closed trade.", hintVi: "Số combo symbol+khung giờ có ít nhất 1 lệnh đã đóng." },
        ...combos.map(
          (c): StatMetric => ({
            k: `${c.symbol.replace("USDT", "")} ${c.interval}`,
            v: `${c.winRate.toFixed(2)}%`,
            sub: `${c.closed} trades · net ${c.netPnlPct >= 0 ? "+" : ""}${c.netPnlPct.toFixed(2)}%`,
            // WR ≥50% xanh, ≥40% vàng, dưới đỏ — cùng ngưỡng với bảng theo cặp
            tone: c.winRate >= 50 ? "ok" : c.winRate >= 40 ? "warn" : "bad",
            hint: "Win rate of this pair+timeframe (win = ROI > 0). Tint: ≥50% green, 40–49% amber, <40% red. Sub shows trade count and net ROI sum.",
            hintVi: "Win rate của cặp+khung này (thắng = ROI > 0). Màu: ≥50% xanh, 40–49% vàng, <40% đỏ. Dòng dưới = số lệnh và tổng ROI ròng.",
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
      accent: "sky" as StatAccent,
      ...(rows.length > 0
        ? {
            charts: [
              {
                kind: "bars" as const,
                unit: "score",
                items: rows.slice(0, 8).map((r) => ({ label: r.symbol.replace("USDT", ""), v: r.score })),
                hint: "Top-8 universe scores (60% trend + 40% ATR%, 0–5 scale). The ranking feeds pair selection candidates — higher = stronger trend/volatility mix.",
                hintVi: "Top 8 điểm universe (60% xu hướng + 40% ATR%, thang 0–5). Xếp hạng này nuôi việc chọn cặp — càng cao càng mạnh về xu hướng/biến động.",
              },
            ],
          }
        : {}),
      metrics: [
        { k: "Universe pool", v: `${UNIVERSE.length} pairs`, sub: "11 staple pairs always included", tone: "info", hint: "Hardcoded candidate pool in universe.ts; the 11 staple pairs are always re-scored even if they fall out of the top.", hintVi: "Quỹ cặp ứng viên cố định trong universe.ts; 11 cặp chủ lực luôn được chấm kể cả khi rớt khỏi top." },
        { k: "Published top", v: `${rows.length} pairs`, sub: u ? `scored ${ago(u.at)}` : "no snapshot yet", tone: rows.length > 0 ? "info" : "warn", hint: "Pairs included in the latest published snapshot (re-ranked every 8h by the scheduler).", hintVi: "Số cặp trong snapshot mới nhất (xếp hạng lại mỗi 8h bởi scheduler)." },
        ...(top
          ? [{
              k: "Top ranked",
              v: top.symbol.replace("USDT", ""),
              sub: `score ${top.score.toFixed(2)} · ATR ${top.atrPct.toFixed(2)}% · trend ${(top.trend * 100).toFixed(2)}% · 10d ${(top.ret10d * 100).toFixed(2)}%`,
              tone: "info" as StatTone,
              hint: "Best score right now. Sub: total score, ATR% (volatility), trend share (0–100%) and 10-day return of that pair.",
              hintVi: "Cặp có điểm cao nhất lúc này. Dòng dưới: tổng điểm, ATR% (biến động), tỉ lệ xu hướng (0–100%) và lợi nhuận 10 ngày.",
            }]
          : []),
        { k: "Uptrend count", v: `${upN}/${rows.length}`, tone: rows.length === 0 ? "dim" : upN / rows.length > 0.5 ? "ok" : upN > 0 ? "warn" : "bad", hint: "Pairs with a positive trend component in the snapshot — the same regime signal the Market Model panel uses as context.", hintVi: "Số cặp có thành phần xu hướng dương trong snapshot — cùng tín hiệu regime mà panel Market Model dùng làm bối cảnh." },
        { k: "Scoring window", v: `${UNIVERSE_LOOKBACK_CANDLES} 1h bars (~10 days)`, tone: "dim", hint: "Lookback used for the ranking formula — long enough to smooth intraday noise, short enough to catch regime shifts.", hintVi: "Cửa sổ dữ liệu cho công thức chấm điểm — đủ dài để làm mượt nhiễu trong ngày, đủ ngắn để bắt được đổi regime." },
      ],
    };
  });

  // ─── 4. Auto Trade — Dry-run ──────────────────────────────────────────────
  const auto = await safe("auto", async () => {
    const st = st0 ?? (await readAutoState());
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
    // đường vốn: chuỗi capitalAfter theo thời điểm đóng lệnh (client vẽ line)
    const eq = await db.autoTrade.findMany({
      where: { status: "closed", capitalAfter: { not: null }, exitTime: { not: null } },
      select: { exitTime: true, capitalAfter: true },
      orderBy: { exitTime: "asc" },
      take: 300,
    });
    const eqPoints = eq
      .filter((r) => r.exitTime != null && r.capitalAfter != null)
      .map((r) => ({ t: new Date(r.exitTime as Date).getTime(), v: r.capitalAfter as number }));
    return {
      state: (chainOk ? "ok" : "warn") as StatState,
      note: chainOk
        ? "Equity chain OK: open.capitalBefore == lastClosed.capitalAfter — matches closeTradeDirect. Paper dry-run only (AutoTrade DB)."
        : "Equity chain MISMATCH: open.capitalBefore ≠ lastClosed.capitalAfter — check for a manual close or PATCH in between.",
      accPct: st.stats.closed > 0 ? wilsonLB(st.stats.wins, st.stats.closed) : 0,
      accNote: st.stats.closed > 0 ? `Wilson 95% lower bound on ${st.stats.closed} trades` : "no closed trades yet",
      accent: "emerald" as StatAccent,
      ...(eqPoints.length >= 2
        ? {
            charts: [
              {
                kind: "line" as const,
                unit: "$",
                points: eqPoints,
                hint: "Equity curve: virtual capital after each closed trade (the capitalAfter chain, $1000 start). Rising = compounded paper profits; hover a dot for time + exact value.",
                hintVi: "Đường vốn: vốn ảo sau từng lệnh đóng (chuỗi capitalAfter, bắt đầu $1000). Đi lên = lãi giấy cộng dồn; di chuột vào điểm để xem thời gian + giá trị.",
              },
            ],
          }
        : {}),
      metrics: [
        { k: "Mode", v: cfg.on ? "Auto ON" : "Auto OFF", sub: "paper dry-run only", tone: cfg.on ? "ok" : "warn", hint: "Engine auto-trading switch (cfg.on). Green = engine may open dry-run trades automatically; amber = manual only. No real orders either way.", hintVi: "Công tắc tự động giao dịch (cfg.on). Xanh = engine được tự mở lệnh giấy; vàng = chỉ thủ công. Cả hai đều không phải lệnh thật." },
        { k: "Equity", v: st.capital != null ? `$${st.capital.toFixed(2)}` : "—", sub: "start $1000", tone: st.capital == null ? "dim" : st.capital > 1000 ? "ok" : st.capital < 1000 ? "bad" : "info", hint: "Current virtual capital. Above $1000 = net paper profit (green), below = net loss (red). See the equity curve below for the path.", hintVi: "Vốn ảo hiện tại. Trên $1000 = đang lãi giấy (xanh), dưới = đang lỗ (đỏ). Xem đường vốn bên dưới để biết hành trình." },
        { k: "Closed / wins", v: `${st.stats.closed} / ${st.stats.wins}`, sub: `win rate ${st.stats.winRate.toFixed(2)}%`, tone: st.stats.closed === 0 ? "dim" : st.stats.winRate >= 50 ? "ok" : st.stats.winRate >= 40 ? "warn" : "bad", hint: "Closed trades / wins of the dry-run engine. Win-rate tint: ≥50% green, 40–49% amber, <40% red.", hintVi: "Số lệnh đã đóng / số thắng của engine dry-run. Màu WR: ≥50% xanh, 40–49% vàng, <40% đỏ." },
        { k: "Net ROI sum", v: `${st.stats.netPnlPct >= 0 ? "+" : ""}${st.stats.netPnlPct.toFixed(2)}%`, tone: st.stats.netPnlPct > 0 ? "ok" : st.stats.netPnlPct < 0 ? "bad" : "dim", hint: "Sum of per-trade ROI (pnlPct, leverage-inclusive, net of round-trip fees since 0.2.77) over closed trades — NOT compounded; the equity curve shows the compounded path.", hintVi: "Tổng ROI từng lệnh (pnlPct, đã gồm đòn bẩy, đã trừ phí round-trip từ 0.2.77) của các lệnh đóng — KHÔNG compounding; đường vốn mới là đường cộng dồn." },
        { k: "Lesson samples", v: `${st.stats.closed * lw}`, sub: `${st.stats.closed} trades × LESSON_WEIGHT ${lw}`, tone: "info", hint: "Pseudo-sample count feeding the self-learning loop: each closed trade counts LESSON_WEIGHT times when re-ranking parameters.", hintVi: "Số mẫu giả nạp vào vòng tự học: mỗi lệnh đóng được tính LESSON_WEIGHT lần khi xếp lại tham số." },
      ],
    };
  });

  // ─── 4b. DQF — DYNAMIC quality floor learning from whole Elliott session (0.3.2) ────
  // Only READ DATA_DIR/dqf-state.json (engine tick writes after measuring) — DO NOT touch DB here
  // (stats polls often, DB only touched where controlled — integrity lesson).
  const dqfSec = await safe("dqf", async () => {
    const f = readDqfFile();
    const s = f.state;
    const sess = s?.session;
    const wins = sess && sess.n > 0 ? Math.round((sess.wr * sess.n) / 100) : 0;
    const nSess = sess?.n ?? 0;
    const fmtF = (x: { minScore: number; minAuc: number; minAcc: number }): string =>
      `${Math.round(x.minScore)} / ${x.minAuc.toFixed(2)} / ${Math.round(x.minAcc)}`;
    const bandLabel = (b: DqfBand): string => { const hi = (b as unknown as { hi: number | null }).hi; return hi == null || hi === Infinity ? `≥${b.lo}` : `${b.lo}–${hi}`; };
    const bandBars = (bands: DqfBand[] | undefined) =>
      (bands ?? [])
        .filter((b) => b.n > 0)
        .map((b) => ({
          label: bandLabel(b),
          v: Math.round(b.exp * 100) / 100,
          sub: [`${b.n} trades · WR ${b.wr.toFixed(2)}% · avg ${b.exp >= 0 ? "+" : ""}${b.exp.toFixed(2)}%/trade`],
        }));
    const bandChart = (bands: DqfBand[] | undefined, unitName: string, hint: string, hintVi?: string) =>
      (bands ?? []).some((b) => b.n > 0)
        ? [
            {
              kind: "bars" as const,
              unit: "%",
              items: bandBars(bands),
              hint,
              hintVi,
            },
          ]
        : [];
    const hist0 = f.hist[0] ?? null;
    const atTarget = s?.target ? s.floors.minScore === s.target.minScore && s.floors.minAuc === s.target.minAuc && s.floors.minAcc === s.target.minAcc : false;
    const lastChange = hist0
      ? `${ago(hist0.at)} — ${Math.round(hist0.from.minScore)}/${hist0.from.minAuc.toFixed(2)}/${Math.round(hist0.from.minAcc)} → ${Math.round(hist0.to.minScore)}/${hist0.to.minAuc.toFixed(2)}/${Math.round(hist0.to.minAcc)}${atTarget ? " · Stable at target, no step needed" : ""}`
      : atTarget ? "Stable at target — no step needed" : "never changed";
    return {
      state: (!f.on ? "warn" : s && s.src === "dqf" ? "ok" : "warn") as StatState,
      note: f.on
        ? s && s.src === "dqf"
          ? `DQF holds floor authority (${fmtF(s.floors)}) — decided from ${nSess} closed trades, band target ${s.target ? fmtF(s.target) : "not enough group samples"}. Engine funnel + flip use these floors.`
          : `DQF on but NOT enough samples (need ≥ ${DQF_MIN_N} closed trades) — passthrough cfg panel floors, not evolved yet.`
        : "DQF OFF — engine uses cfg panel floors (minScore/minAuc/minAcc as in Auto panel).",
      accPct: nSess > 0 ? wilsonLB(wins, nSess) : 0,
      accNote: nSess > 0 ? `Wilson 95% lower bound on ${nSess} closed trades (whole session)` : "no closed trades yet",
      accent: "cyan" as StatAccent,
      charts: [
        ...bandChart(
          s?.bands.score,
          "%",
          "Expectancy (avg ROI%/trade, leverage+fee included) cumulated per ENTRY-SCORE band from the ENTIRE Elliott session. The DQF floor moves toward the break-even boundary: smallest floor whose band-group ≥ 0. Hover for n/WR.",
          "Expectancy (avg ROI%/trade, leverage+fee included) cumulated per ENTRY-SCORE band from the ENTIRE Elliott session. The DQF floor moves toward the break-even boundary: smallest floor whose band-group ≥ 0. Hover for n/WR.",
        ),
        ...bandChart(
          s?.bands.auc,
          "%",
          "Same break-even read by ENTRY-AUC band. Bands below the historical floor are thin/empty — that is expected (the old floor gated them out).",
          "Same break-even read by ENTRY-AUC band. Bands below the historical floor are thin/empty — that is expected (the old floor gated them out).",
        ),
        ...bandChart(
          s?.bands.acc,
          "%",
          "Same break-even read by ENTRY-ACC band.",
          "Same break-even read by ENTRY-ACC band.",
        ),
      ],
      metrics: [
        { k: "Switch", v: f.on ? "DQF ON" : "DQF OFF", sub: f.on ? "learned floors from session" : "floors = cfg panel", tone: f.on ? "ok" : "warn", hint: "DQF master switch (POST /api/dqf). ON = the dynamic quality floor learns from the whole Elliott session and overrides the panel floors at entry/flip time. OFF = panel cfg floors only. Either way nothing is applied below the safe defaults (50/0.60/55)." },
        { k: "Effective floors", v: s ? fmtF(s.floors) : fmtF({ minScore: 50, minAuc: 0.6, minAcc: 55 }), sub: s ? `source: ${s.src === "dqf" ? "DQF learned" : "cfg panel (not enough samples/off)"}` : "no cycle ran yet", tone: s?.src === "dqf" ? "ok" : "info", hint: "The floors the engine ACTUALLY used last cycle: minScore / minAuc / minAcc (entry + flip + funnel tooltips). Source shows who decided: DQF (learned) vs cfg (panel)." },
        { k: "Band target", v: s?.target ? fmtF(s.target) : "—", sub: "break-even threshold per metric", tone: "info", hint: "Band-derived target: for each metric the smallest floor whose entry-group has expectancy ≥ 0 (min 10 trades). Floors evolve ONE step (±2 score / ±0.01 AUC / ±1 ACC) toward it every ≤30min, clamped to defaults..caps." },
        { k: "Session (all)", v: `${nSess} trades`, sub: sess ? `WR ${sess.wr.toFixed(2)}% · exp ${sess.exp >= 0 ? "+" : ""}${sess.exp.toFixed(2)}%/trade · sum ROI ${sess.net >= 0 ? "+" : ""}${sess.net.toFixed(2)}%` : "—", tone: !sess ? "dim" : sess.exp >= 0 ? "ok" : "bad", hint: "The WHOLE Elliott dry-run session (every closed AutoTrade row with PnL, flips included) — the dataset DQF learns from. Need ≥ 20 closed trades before it may speak. Sum ROI is the plain sum of per-trade ROI, not compounded capital — capital ROI lives in Recent Trades." },
        { k: "Payoff", v: sess && Number.isFinite(sess.payoff) ? sess.payoff.toFixed(2) : "—", sub: "avg win / avg loss", tone: !sess ? "dim" : sess.payoff >= 1 ? "ok" : "warn", hint: "Average win / average loss of the session — payoff < 1 with low WR is the bleed pattern that pushes floors up." },
        { k: "Current reason", v: s?.why ? (s.why.length > 64 ? `${s.why.slice(0, 64)}…` : s.why) : "—", wide: true, tone: "info", hint: s?.why ?? "Full reason with numbers from the last DQF decision (also in pm2 logs at every change)." },
        { k: "Latest evolution", v: lastChange, wide: true, tone: hist0 ? "info" : "dim", hint: "Latest floor step: time + from → to (one step per change; full history below via the charts and DATA_DIR/dqf-state.json)." },
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
    const biasStack = [
      { label: "LONG", n: rows.filter((r) => r.bias === "LONG").length },
      { label: "SHORT", n: rows.filter((r) => r.bias === "SHORT").length },
      { label: "NEUTRAL", n: rows.filter((r) => r.bias === "NEUTRAL").length },
    ];
    return {
      state: (stale ? "warn" : "ok") as StatState,
      note: stale
        ? `Latest scan ${age == null ? "unknown" : `${age}m`} old — past SCAN_TTL ${SCAN_TTL / 60_000}m: panel keeps last scan by design; auto-cycle refreshes next 5m bucket.`
        : `Fresh scan (< ${SCAN_TTL / 60_000}m). Candidates counted with the same auto-cycle filters: gate minAuc ${cfg.minAuc}/minAcc ${cfg.minAcc}/minScore ${cfg.minScore} + not regressed vs champion + outside noise band ±${(nb * 100).toFixed(2)}%.`,
      accPct: 100,
      accNote: "live scan metrics — counted on ScanRow",
      accent: "amber" as StatAccent,
      ...(rows.length > 0
        ? {
            charts: [
              {
                kind: "stack" as const,
                items: biasStack,
                hint: "Bias distribution of the latest scan across all combos — green LONG, red SHORT, gray NEUTRAL. The Market Model panel aggregates the same rows into the lean %.",
                hintVi: "Phân bố bias của scan mới nhất trên mọi combo — xanh LONG, đỏ SHORT, xám NEUTRAL. Panel Market Model gom đúng các dòng này thành % lean.",
              },
            ],
          }
        : {}),
      metrics: [
        { k: "Latest scan", v: scan ? ago(scan.at) : "not scanned", sub: `${rows.length} combo`, tone: scan ? "info" : "bad", hint: "Age of the last full-pool scan (scheduler runs every 5m bucket). Past SCAN_TTL it is stale but kept by design.", hintVi: "Tuổi của lần scan toàn pool gần nhất (scheduler chạy theo bucket 5 phút). Quá SCAN_TTL là cũ nhưng vẫn giữ theo thiết kế." },
        { k: "Gate-pass candidates", v: `${cands.length}/${rows.length}`, sub: cands[0] ? `best ${cands[0].symbol.replace("USDT", "")} ${cands[0].interval} score ${cands[0].score.toFixed(2)}` : "—", tone: cands.length > 0 ? "ok" : "warn", hint: "Rows passing the EXACT auto-cycle filter: quality gate (minAuc/minAcc/minScore) + not regressed vs champion + |prob−0.5| ≥ NOISE_BAND. Green when at least one candidate is actionable.", hintVi: "Số dòng qua đúng bộ lọc auto-cycle: cổng chất lượng (minAuc/minAcc/minScore) + không regress so với champion + |prob−0.5| ≥ NOISE_BAND. Xanh khi có ít nhất 1 ứng viên." },
        { k: "NEUTRAL (skipped)", v: String(rows.filter((r) => r.bias === "NEUTRAL").length), tone: "dim", hint: "Combos the model tagged NEUTRAL — intentionally skipped, never traded.", hintVi: "Số combo model đánh dấu NEUTRAL — cố ý bỏ qua, không bao giờ vào lệnh." },
        { k: "Bcast gate 5m", v: `${pass}/${bcast.length} pass`, sub: "single gate algorithm for panel + Telegram", tone: bcast.length > 0 && pass === bcast.length ? "ok" : pass > 0 ? "info" : "warn", hint: "Broadcast verdicts stored in the DB that passed the gate — the SAME algorithm filters panel display and Telegram messages.", hintVi: "Verdict broadcast lưu trong DB đã qua cổng — panel và Telegram dùng CÙNG một thuật toán lọc." },
      ],
    };
  });

  // ─── 6. Open auto position ────────────────────────────────────────────────
  const openPos = await safe("open", async () => {
    const st = st0 ?? (await readAutoState());
    const o = st.open;
    if (!o) {
      return {
        state: "na" as StatState,
        note: "No open auto trade — engine stays flat until a gated candidate + LLM go.",
        accPct: 100,
        accNote: "empty state — by design",
        accent: "rose" as StatAccent,
        metrics: [{ k: "Position", v: "No open trade", tone: "dim", hint: "The engine holds at most ONE dry-run position at a time. Gray = flat right now.", hintVi: "Engine chỉ giữ TỐI ĐA một vị thế dry-run. Xám = đang không có lệnh." }],
      };
    }
    const durMs = now - new Date(o.entryTime).getTime();
    const durH = durMs / 3_600_000;
    // giá live do buildStatsSnapshot fetch sẵn MỘT lần dùng chung với flow
    const last: number | null = livePrice;
    const roi =
      last != null
        ? ((o.side === "SHORT" ? (o.entryPrice - last) / o.entryPrice : (last - o.entryPrice) / o.entryPrice) * 100 * o.leverage)
        : null;
    const slDist = last != null ? Math.abs((last - o.entryPrice) / o.entryPrice) * 100 - o.slPct : null;
    return {
      state: (durH > 24 ? "warn" : "ok") as StatState,
      note:
        durH > 24
          ? `Position open ${durH.toFixed(2)}h (>24h) — long vs 5m/flip cadence; only if no TP/SL/flip signal was strong enough. Worth LLM review.`
          : "Single dry-run position at a time. ROI = live Binance futures move × leverage — same formula as closeTradeDirect.",
      accPct: 100,
      accNote: "live price at request time (if Binance responds)",
      accent: "rose" as StatAccent,
      metrics: [
        // LONG xanh / SHORT đỏ — đúng quy ước side của cả app (suggestions, auto-panel…)
        { k: "Position", v: `${o.side} ${o.symbol.replace("USDT", "")} ${o.interval}`, sub: `×${o.leverage} · stake ${o.stakePct ?? 100}%`, tone: o.side === "LONG" ? "ok" : "bad", hint: "The single dry-run position: side (green LONG / red SHORT), pair, timeframe; sub = leverage and % of virtual capital staked.", hintVi: "Vị thế dry-run duy nhất: phía (LONG xanh / SHORT đỏ), cặp, khung; dòng dưới = đòn bẩy và % vốn ảo đang đặt." },
        { k: "Entry", v: String(o.entryPrice), sub: `${durH.toFixed(2)}h ago`, tone: "info", hint: "Entry price recorded when the trade opened; sub = age of the position in hours.", hintVi: "Giá vào lệnh được ghi lúc mở; dòng dưới = tuổi vị thế theo giờ." },
        ...(roi != null ? [{ k: "Unrealized ROI", v: `${roi >= 0 ? "+" : ""}${roi.toFixed(2)}%`, tone: (roi >= 0 ? "ok" : "bad") as StatTone, hint: "Floating ROI = price move toward the side × leverage, priced from the Binance futures ticker at request time — the same formula closeTradeDirect uses to settle.", hintVi: "ROI thả nổi = biến động giá theo phía × đòn bẩy, tính từ giá futures Binance tại lúc gọi — cùng công thức closeTradeDirect dùng để chốt." }] : []),
        { k: "SL / TP", v: `${o.slPct}% / ${o.tpPct}%`, ...(slDist != null ? { sub: `to SL ${slDist >= 0 ? "+" : ""}${slDist.toFixed(2)} pts %` } : {}), tone: "info", hint: "Configured stop-loss / take-profit in ROI %. Sub = distance from current price to the SL level in price % (positive = price is above the SL distance).", hintVi: "Cắt lỗ / chốt lời đã đặt theo % ROI. Dòng dưới = khoảng cách từ giá hiện tại tới mức SL theo % giá." },
        { k: "LLM at entry", v: o.llmVerdict ?? "—", sub: o.llmReason ?? undefined, tone: o.llmVerdict === "go" ? "ok" : o.llmVerdict === "skip" ? "warn" : o.llmVerdict ? "bad" : "dim", hint: "Risk-officer LLM verdict at entry: go = approved (green), skip = declined (amber), unreachable = LLM was down (red). Sub = the reason it gave.", hintVi: "Verdict của LLM risk officer lúc vào lệnh: go = duyệt (xanh), skip = từ chối (vàng), unreachable = LLM không phản hồi (đỏ). Dòng dưới = lý do." },
      ],
    };
  });

  // ─── 7. Auto history ──────────────────────────────────────────────────────
  const hist = await safe("hist", async () => {
    const rows = await db.autoTrade.findMany({
      select: { status: true, exitKind: true, pnlPct: true, exitTime: true, symbol: true, interval: true, side: true, capitalBefore: true, stakePct: true, capitalAfter: true, entryTime: true, leverage: true, entryPrice: true, exitPrice: true },
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
    // Hourly and daily breakdown: PNL USD from margin times ROI, PNL pct from totals
    const pnlUsdOf = (r: typeof closed[number]) => {
      if (r.capitalBefore != null && r.stakePct != null && r.pnlPct != null) return ((r.capitalBefore * r.stakePct) / 100) * (r.pnlPct / 100);
      if (r.capitalAfter != null && r.capitalBefore != null) return r.capitalAfter - r.capitalBefore;
      return 0;
    };
    const hourFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", hour12: false });
    const dayFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit" });
    const hourKey = (d: Date) => hourFmt.format(d);
    const dayKey = (d: Date) => {
      const parts = dayFmt.formatToParts(d);
      const get = (type: string) => parts.find((x) => x.type === type)?.value ?? "";
      return `${get("year")}-${get("month")}-${get("day")}`;
    };
    type HistGroup = { n: number; wins: number; sumPnlPct: number; sumUsd: number; margin: number };
    const groupByHist = (keyFn: (d: Date) => string) => {
      const m = new Map<string, HistGroup>();
      for (const r of closed) {
        if (!r.exitTime) continue;
        const k = keyFn(new Date(r.exitTime));
        const g = m.get(k) ?? { n: 0, wins: 0, sumPnlPct: 0, sumUsd: 0, margin: 0 };
        g.n += 1;
        if ((r.pnlPct ?? 0) > 0) g.wins += 1;
        g.sumPnlPct += r.pnlPct ?? 0;
        g.sumUsd += pnlUsdOf(r);
        if (r.capitalBefore != null && r.stakePct != null) g.margin += (r.capitalBefore * r.stakePct) / 100;
        m.set(k, g);
      }
      return m;
    };
    const byHourMap = groupByHist(hourKey);
    const byDayMap = groupByHist(dayKey);
    // Day x Hour breakdown for drill-down (click a day to see its hours). Display-only aggregation.
    const byDayHourMap = new Map<string, Map<string, HistGroup>>();
    for (const r of closed) {
      if (!r.exitTime) continue;
      const d = dayKey(new Date(r.exitTime));
      const h = hourKey(new Date(r.exitTime));
      let inner = byDayHourMap.get(d);
      if (!inner) { inner = new Map(); byDayHourMap.set(d, inner); }
      const g = inner.get(h) ?? { n: 0, wins: 0, sumPnlPct: 0, sumUsd: 0, margin: 0 };
      g.n += 1;
      if ((r.pnlPct ?? 0) > 0) g.wins += 1;
      g.sumPnlPct += r.pnlPct ?? 0;
      g.sumUsd += pnlUsdOf(r);
      if (r.capitalBefore != null && r.stakePct != null) g.margin += (r.capitalBefore * r.stakePct) / 100;
      inner.set(h, g);
    }
    const toBarItems = (m: Map<string, HistGroup>) => [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([label, g]) => {
      const winRate = g.n ? (g.wins / g.n) * 100 : 0;
      const avgG = g.n ? g.sumPnlPct / g.n : 0;
      const totalPct = g.margin > 0 ? (g.sumUsd / g.margin) * 100 : 0;
      return { label, v: Math.round(g.sumUsd * 100) / 100, sub: [`${g.wins}/${g.n} trades, ${winRate.toFixed(1)}% win`, `avg ${avgG >= 0 ? "+" : ""}${avgG.toFixed(2)}%, total ${totalPct >= 0 ? "+" : ""}${totalPct.toFixed(2)}%`] };
    });
    const hourItems = toBarItems(byHourMap);
    const dayItems = toBarItems(byDayMap);
    const totalUsd = closed.reduce((a, r) => a + pnlUsdOf(r), 0);
    const totalMargin = closed.reduce((a, r) => a + (r.capitalBefore != null && r.stakePct != null ? (r.capitalBefore * r.stakePct) / 100 : 0), 0);
    const totalPnlPct = totalMargin > 0 ? (totalUsd / totalMargin) * 100 : null;
    // PnL 20 lệnh đóng gần nhất (cũ → mới) — client vẽ cột xanh/đỏ
    // (0.2.91) mỗi cột kèm chi tiết hover: phía · kiểu đóng + thời điểm
    const pnlBars = closed
      .slice(0, 20)
      .reverse()
      .map((r) => ({
        label: `${r.symbol.replace("USDT", "")} ${r.interval}`,
        v: r.pnlPct ?? 0,
        sub: [
          `${r.side ?? "?"} · ${r.exitKind ?? "manual"}`,
          r.exitTime ? new Date(r.exitTime).toLocaleString("en-GB", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "",
        ].filter(Boolean),
      }));
    const charts: StatChart[] = [];
    if (pnlBars.length >= 2) {
      charts.push({
        kind: "bars",
        unit: "%",
        items: pnlBars,
        hint: "ROI of the last 20 closed trades (oldest → newest): green = profit, red = loss; height scales to the biggest absolute move. Hover a bar for pair+timeframe and exact ROI.",
        hintVi: "ROI 20 lệnh đóng gần nhất (cũ → mới): xanh = lãi, đỏ = lỗ; chiều cao theo lần biến động lớn nhất. Di chuột lên cột để xem cặp+khung và ROI chính xác.",
      });
    }
    if (closed.length > 0) {
      charts.push({
        kind: "stack",
        items: [
          { label: "TP", n: kinds.tp },
          { label: "SL", n: kinds.sl },
          { label: "trail", n: kinds.trail },
          { label: "flip", n: kinds.flip },
          { label: "manual", n: kinds.manual },
        ],
        hint: "How closed trades ended: TP = take-profit hit (green), SL = stop-loss (red), trail = trailing stop, flip = reversed signal, manual = closed by hand. Healthy mix leans green.",
        hintVi: "Các lệnh đóng kết thúc thế nào: TP = chạm chốt lời (xanh), SL = chạm cắt lỗ (đỏ), trail = trailing stop, flip = đảo tín hiệu, manual = đóng tay. Cơ cấu lệch về xanh là healthy.",
      });
    }
    // (0.2.91) win rate theo PHÍA — LONG vs SHORT lệch bền vững là tín hiệu
    // model nghiêng sai một hướng hoặc regime bất lợi phía kia
    const sideBars = (["LONG", "SHORT"] as const).map((side) => {
      const rowsS = closed.filter((r) => r.side === side);
      const winsS = rowsS.filter((r) => (r.pnlPct ?? 0) > 0).length;
      const netS = rowsS.reduce((a, r) => a + (r.pnlPct ?? 0), 0);
      return {
        label: side,
        v: rowsS.length ? (winsS / rowsS.length) * 100 : 0,
        sub: [`${winsS}/${rowsS.length} trades`, `net ${netS >= 0 ? "+" : ""}${netS.toFixed(2)}%`],
      };
    });
    if (closed.length > 0) {
      charts.push({
        kind: "bars",
        unit: "%",
        max: 100,
        items: sideBars,
        hint: "Win rate by side (LONG vs SHORT, win = ROI > 0). A persistent gap means the model leans wrong on one direction or the regime favours the other side. Hover for wins/closed and net ROI.",
        hintVi: "Win rate theo phía (LONG so với SHORT, thắng = ROI > 0). Lệch bền vững nghĩa là model nghiêng sai một hướng hoặc regime bất lợi phía kia. Di chuột xem thắng/tổng và ROI ròng.",
      });
    }
    if (hourItems.length > 0) {
      charts.push({ kind: "bars", unit: "$", items: hourItems, hint: "Net PNL USD by closing hour (Asia/Ho_Chi_Minh). Hover a bar for trades, win rate, avg ROI and total ROI on margin." });
    }
    if (dayItems.length > 0) {
      charts.push({ kind: "bars", unit: "$", items: dayItems, hint: "Net PNL USD by closing day (Asia/Ho_Chi_Minh). Hover a bar for trades, win rate, avg ROI and total ROI on margin." });
    }
    const toTableRows = (m: Map<string, HistGroup>) => [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([label, g]) => {
      const wr = g.n ? (g.wins / g.n) * 100 : 0;
      const avgT = g.n ? g.sumPnlPct / g.n : 0;
      const totT = g.margin > 0 ? (g.sumUsd / g.margin) * 100 : 0;
      return [label, String(g.n), `${wr.toFixed(1)}%`, `${avgT >= 0 ? "+" : ""}${avgT.toFixed(2)}%`, `${totT >= 0 ? "+" : ""}${totT.toFixed(2)}%`, `${g.sumUsd >= 0 ? "+" : ""}$${g.sumUsd.toFixed(2)}`];
    });
    // VOLUME (round-trip notional, Binance-style): notional mở + notional đóng.
    // Chỉ hiển thị thêm; không đổi PnL / WR / ROI.
    const volOf = (r: typeof closed[number]) => {
      if (!r.capitalBefore || !r.stakePct || !r.leverage) return 0;
      const open = (r.capitalBefore * r.stakePct / 100) * r.leverage;
      const close = r.entryPrice && r.exitPrice ? open * (r.exitPrice / r.entryPrice) : open;
      return open + close;
    };
    const volMap = (keyFn: (d: Date) => string) => {
      const m = new Map<string, number>();
      for (const r of closed) {
        if (!r.exitTime) continue;
        const k = keyFn(new Date(r.exitTime));
        m.set(k, (m.get(k) ?? 0) + volOf(r));
      }
      return m;
    };
    const volByDayHour = new Map<string, Map<string, number>>();
    for (const r of closed) {
      if (!r.exitTime) continue;
      const d = dayKey(new Date(r.exitTime));
      const h = hourKey(new Date(r.exitTime));
      let inner = volByDayHour.get(d);
      if (!inner) { inner = new Map(); volByDayHour.set(d, inner); }
      inner.set(h, (inner.get(h) ?? 0) + volOf(r));
    }
    // thêm cột Volume vào cuối row; khóa là phần tử đầu của row
    const withVol = (rows: any[][], m: Map<string, number>) =>
      rows.map((row) => [...row, Math.round(m.get(String(row[0])) ?? 0).toLocaleString("en-US")]);
    if (byHourMap.size > 0) charts.push({ kind: "table", columns: ["Hour", "Trades", "Win rate", "Avg PNL %", "Total PNL %", "PNL $", "Volume"], rows: withVol(toTableRows(byHourMap), volMap(hourKey)), hint: "Trade history by closing hour (Asia/Ho_Chi_Minh). PNL USD equals capitalBefore times stakePct times pnlPct." });
    const byDayDetails: Record<string, Array<Array<string>>> = {};
    for (const entry of byDayHourMap.entries()) { const day = entry.at(0) as string; const inner = entry.at(1) as Map<string, HistGroup>; byDayDetails[day] = withVol(toTableRows(inner), volByDayHour.get(day) ?? new Map()); }
    if (byDayMap.size > 0) charts.push({ kind: "table", columns: ["Day", "Trades", "Win rate", "Avg PNL %", "Total PNL %", "PNL $", "Volume"], rows: withVol(toTableRows(byDayMap), volMap(dayKey)), details: byDayDetails, hint: "Trade history by closing day (Asia/Ho_Chi_Minh). PNL USD equals capitalBefore times stakePct times pnlPct." });
    return {
      state: (unlabeled > 0 ? "warn" : "ok") as StatState,
      note:
        unlabeled > 0
          ? `${unlabeled} closed trades missing exitKind (pre-0.2.24 or legacy manual close) — label totals under-count; remainder is legacy.`
          : "Label totals match closed count — every close goes through closeTradeDirect (tp/sl/trail/flip/manual).",
      accPct: 100,
      accNote: "exact DB counts — not estimates",
      accent: "orange" as StatAccent,
      ...(charts.length > 0 ? { charts } : {}),
      metrics: [
        { k: "Total trades", v: String(rows.length), sub: `${rows.length - closed.length} open · ${closed.length} closed`, tone: "info", hint: "Every AutoTrade row (newest 2000): sub shows how many are still open vs closed.", hintVi: "Mọi dòng AutoTrade (2000 mới nhất): dòng dưới cho biết đang mở bao nhiêu / đã đóng bao nhiêu." },
        // TP nhiều hơn SL xanh, ngược lại đỏ — bằng nhau thì teal
        { k: "TP / SL", v: `${kinds.tp} / ${kinds.sl}`, sub: `flip ${kinds.flip} · tay ${kinds.manual}`, tone: kinds.tp > kinds.sl ? "ok" : kinds.tp < kinds.sl ? "bad" : "info" },
        { k: "Trail", v: String(kinds.trail), sub: "Trailing stop - gia quay ve cham trail, khong phai SL goc", tone: "info", hint: "Trailing-stop closes. Separate from SL.", hintVi: "So lenh dong o trailing stop. Tach rieng khoi SL goc." },
        { k: "Total PNL USD", v: `${totalUsd >= 0 ? "+" : ""}$${totalUsd.toFixed(2)}`, sub: totalPnlPct != null ? `total ${totalPnlPct >= 0 ? "+" : ""}${totalPnlPct.toFixed(2)}% on margin` : undefined, tone: (totalUsd > 0 ? "ok" : totalUsd < 0 ? "bad" : "dim") as StatTone, hint: "Sum of PNL USD across closed trades. PNL USD equals capitalBefore times stakePct times pnlPct." },
        ...(avg != null ? [{ k: "Avg ROI", v: `${avg >= 0 ? "+" : ""}${avg.toFixed(2)}%`, tone: (avg > 0 ? "ok" : avg < 0 ? "bad" : "dim") as StatTone, hint: "Mean ROI across all closed trades — the expectancy per trade before compounding.", hintVi: "ROI trung bình mọi lệnh đã đóng — kỳ vọng mỗi lệnh trước khi cộng dồn." }] : []),
        ...(best != null ? [{ k: "Best / worst", v: `+${best.toFixed(2)}% / ${worst ?? 0}%`, tone: "info" as StatTone, hint: "Best and worst single-trade ROIs ever recorded — the tail risk you survived.", hintVi: "ROI tốt nhất và xấu nhất của một lệnh từ trước tới nay — rủi ro đuôi mà bạn đã sống sót." }] : []),
        { k: "Last 7 days", v: `${last7d} closed trades`, tone: "info", hint: "Trades closed in the past 7 days — recent activity level of the engine.", hintVi: "Số lệnh đóng trong 7 ngày qua — mức độ hoạt động gần đây của engine." },
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
    // (0.2.91) hit-rate theo bias — chỉ tính sides nào CÓ lệnh đã chấm (ex-flat)
    const biasBars = (["LONG", "SHORT"] as const)
      .map((b) => {
        const rowsB = res.filter((r) => r.bias === b && r.outcome !== "flat");
        const wB = rowsB.filter((r) => r.outcome === "win").length;
        return {
          label: b,
          v: rowsB.length ? (wB / rowsB.length) * 100 : 0,
          sub: [`${wB}/${rowsB.length} judged (ex-flat)`],
        };
      })
      .filter((x) => x.sub[0] !== "0/0 judged (ex-flat)");
    return {
      state: (mismatch === 0 ? "ok" : "warn") as StatState,
      note:
        mismatch === 0
          ? "Re-scored all stored outcomes via outcomeOf(entry, exit) — 100% match. win = price moved with bias side at write and read."
          : `${mismatch} suggestions re-score mismatch from price — bad resolve data or formula drift. Clean before trusting hit-rate.`,
      accPct: judged > 0 ? wilsonLB(win, judged) : 0,
      accNote: judged > 0 ? `Wilson 95% lower bound on ${judged} resolved suggestions (ex-flat)` : "no scored suggestions yet",
      accent: "indigo" as StatAccent,
      ...(rows.length > 0
        ? {
            charts: [
              {
                kind: "stack" as const,
                items: [
                  { label: "win", n: win },
                  { label: "loss", n: loss },
                  { label: "flat", n: flat },
                ],
                hint: "Outcome mix of resolved suggestions: win = price moved with the bias side (green), loss = against (red), flat = inside the dead zone (gray, excluded from hit-rate).",
                hintVi: "Kết quả các đề xuất đã chấm: win = giá đi đúng phía bias (xanh), loss = ngược phía (đỏ), flat = trong vùng chết (xám, loại khỏi hit-rate).",
              },
              // (0.2.91) hit-rate theo bias LONG/SHORT — lệch hai phía cho biết
              // model tốt hơn ở hướng nào
              ...(biasBars.length > 0
                ? [
                    {
                      kind: "bars" as const,
                      unit: "%",
                      max: 100,
                      items: biasBars,
                      hint: "Side-aware hit-rate by bias (win / (win+loss), ex-flat): LONG vs SHORT. A gap shows which direction the model reads better — trade confidence should follow. Hover for the judged counts.",
                      hintVi: "Hit-rate theo phía bias (win / (win+loss), loại flat): LONG so với SHORT. Lệch cho biết model đọc đúng hướng nào hơn — độ tin nên theo phía đó. Di chuột xem số lệnh đã chấm.",
                    },
                  ]
                : []),
            ],
          }
        : {}),
      metrics: [
        { k: "Total suggestions", v: String(rows.length), sub: `${rows.length - res.length} awaiting horizon`, tone: "info", hint: "All stored suggestions (model proposals written during scans); sub = how many have not yet passed their evaluation horizon.", hintVi: "Mọi đề xuất đã lưu (model ghi trong lúc scan); dòng dưới = số chưa quá horizon chấm kết quả." },
        { k: "Win / Loss", v: `${win} / ${loss}`, sub: `flat ${flat} (excluded from hit-rate)`, tone: judged === 0 ? "dim" : win > loss ? "ok" : win < loss ? "bad" : "info", hint: "Resolved outcomes: win = price moved with the bias side between write and read; flat counts as neither.", hintVi: "Kết quả đã chấm: win = giá đi đúng phía bias từ lúc ghi tới lúc đọc; flat không tính bên nào." },
        { k: "Side-aware hit-rate", v: judged > 0 ? `${((win / judged) * 100).toFixed(2)}%` : "—", sub: "prob aligned to bias side", tone: judged === 0 ? "dim" : (win / judged) * 100 >= 50 ? "ok" : (win / judged) * 100 >= 40 ? "warn" : "bad", hint: "win / (win + loss) — the probability of each suggestion was already aligned to its bias side, so this is the honest directional accuracy. Tint: ≥50% green, 40–49% amber.", hintVi: "win / (win + loss) — xác suất của từng đề xuất đã căn theo phía bias nên đây là độ chính xác hướng trung thực. Màu: ≥50% xanh, 40–49% vàng." },
        ...(avgPnl != null ? [{ k: "Avg PnL", v: `${avgPnl >= 0 ? "+" : ""}${avgPnl.toFixed(2)}%`, tone: (avgPnl >= 0 ? "ok" : "bad") as StatTone, hint: "Mean PnL% over non-flat resolved suggestions.", hintVi: "PnL% trung bình các đề xuất đã chấm (không tính flat)." }] : []),
        { k: "LONG / SHORT", v: `${rows.filter((r) => r.bias === "LONG").length} / ${rows.filter((r) => r.bias === "SHORT").length}`, tone: "info", hint: "Side distribution of all stored suggestions — a healthy model proposes both sides depending on regime.", hintVi: "Phân bố phía của mọi đề xuất đã lưu — model healthy sẽ đề xuất cả hai phía tùy regime." },
      ],
    };
  });

  // ─── 0.3.4 — khối FLOW cho sơ đồ APM: 1 query sổ lệnh + số liệu đã có ──
  // DB chết → flow = null, trang vẫn render các section bình thường.
  const flow = await (async (): Promise<StatsFlow | null> => {
    try {
      const rows = await db.autoTrade.findMany({ // lay full: can margin/entry/exit/leverage/p1Pct/p1Share de tinh PARTIAL
        orderBy: { createdAt: "desc" },
        take: 2000,
      });
      const closedRows = rows.filter((r) => r.status === "closed");
      const wins = closedRows.filter((r) => (r.pnlPct ?? 0) > 0).length;
      const kinds = { tp: 0, sl: 0, trail: 0, flip: 0, manual: 0 };
      for (const r of closedRows) {
        const k = (r.exitKind ?? "") as keyof typeof kinds;
        if (k in kinds) kinds[k] += 1;
      }
      const pnls = closedRows.map((r) => r.pnlPct ?? 0);
      const sumPnl = pnls.reduce((a, b) => a + b, 0);
      const scanRows: ScanRow[] = eng.scan?.rows ?? [];
      const bcast = await db.bcastVerdict.findMany();
      const uRows = eng.universe?.rows ?? [];
      const o = st0?.open ?? null;
      const ageH = o?.entryTime ? (now - new Date(o.entryTime).getTime()) / 3_600_000 : 0;
      const openPositions = allOpens.map((x: any) => {
        const px = priceMap[x.symbol] ?? (x.symbol === o?.symbol ? livePrice : null);
        const ah = x?.entryTime ? (now - new Date(x.entryTime).getTime()) / 3_600_000 : 0;
        const rr = px != null && x.entryPrice ? (x.side === "SHORT" ? (x.entryPrice - px) / x.entryPrice : (px - x.entryPrice) / x.entryPrice) * 100 * Number(x.leverage ?? 1) : null;
      return { symbol: x.symbol, side: x.side, roi: rr, ageH: ah };
      });
      const roi =
        o && livePrice != null
          ? (o.side === "SHORT"
              ? (o.entryPrice - livePrice) / o.entryPrice
              : (livePrice - o.entryPrice) / o.entryPrice) *
            100 *
            o.leverage
          : null;
      const active = sessionOf(now);
      const h = new Date(now).getUTCHours();
      let nextIn = 999;
      let nextKey: SessionKey = "sydney";
      for (const s of SESSIONS) {
        const wait = (s.from - h + 24) % 24;
        if (wait > 0 && wait < nextIn) {
          nextIn = wait;
          nextKey = s.key;
        }
      }
      const cnt = { ok: 0, warn: 0, na: 0 };
      for (const s of [market, combo, universe, auto, dqfSec, dock, openPos, hist, sg]) cnt[s.state] += 1;
      // LEDGER DUY NHAT - moi card (TOTAL EQUITY / TOTAL PNL / NET ROI / WIN RATE / TOTAL TRADES / Flow / Recent Trades) deu xai cai nay
      // NHÃN A/B KHỚP autostate.ts + reset endpoint (route.ts "B: AutoTrade, A: VulcanBook"):
      // A=VulcanBook (base 1000), B=AutoTrade (base 1000), C=WyckoffBook (base 0), D=LiquidBook (base 0), E=LiveBook (base 0)
      // TOTAL START = wallet start. TOTAL EQUITY = start + realized + open net PnL (single source)
      const ledger = await (async () => {
        const books = [
          { name: "A", model: "vulcanBook", start: 1000 },
          { name: "B", model: "autoTrade", start: 1000 },
          { name: "C", model: "wyckoffBook", start: 0 },
          { name: "D", model: "liquidBook", start: 0 },
          { name: "E", model: "liveBook", start: 0 },
        ] as const;
        let pnlClosed = 0, wins = 0, closed = 0;
        const perBook: Record<string, { start: number; pnlClosed: number; closed: number; wins: number }> = {};
        for (const b of books) {
          let pc = 0, w = 0, c = 0;
          try {
            const br: any[] = await (db as any)[b.model].findMany({ take: 5000, orderBy: { createdAt: "asc" } });
            for (const r of br) {
              if (r.status === "closed" || r.exitPrice != null) {
                const before = Number(r.capitalBefore ?? r.balanceBefore ?? NaN);
                const after = Number(r.capitalAfter ?? r.balanceAfter ?? NaN);
                if (Number.isFinite(before) && Number.isFinite(after)) pc += after - before;
                const pct = Number(r.pnlPct ?? r.roePct ?? NaN);
                if (Number.isFinite(pct)) { c++; if (pct > 0) w++; }
              }
            }
          } catch {}
          perBook[b.name] = { start: b.start, pnlClosed: Math.round(pc*100)/100, closed: c, wins: w };
          pnlClosed += pc; wins += w; closed += c;
        }
        // Open net (da tru phi, da gom TP1) - dung allOpens, margin theo capitalBefore*stakePct
        let pnlOpen = 0;
        const marginOfL = (r: any) => {
          const d = Number(r.margin ?? r.entryCapital ?? NaN);
          if (Number.isFinite(d) && d > 0) return d;
          const stakeRaw = Number(r.stakePct ?? r.stake ?? NaN);
          const stake = Number.isFinite(stakeRaw) && stakeRaw > 0 ? stakeRaw : 10; // VulcanBook khong luu stake -> mac dinh 10% (VULCAN_STAKE_PCT)
          const base = Number(r.capitalBefore ?? r.balanceBefore ?? r.capital ?? NaN);
          if (Number.isFinite(base) && base > 0) return base * (stake / 100);
          return 1000 * (stake / 100);
        };
        for (const x of allOpens as any[]) {
          const px = priceMap[x.symbol] ?? Number((x as any).markPrice ?? (x as any).lastPrice ?? NaN);
          const lev = Number(x.leverage ?? 1);
          const gross = Number.isFinite(px) && x.entryPrice ? (x.side === "SHORT" ? (x.entryPrice - px) / x.entryPrice : (px - x.entryPrice) / x.entryPrice) * 100 * lev : 0;
          const fee = feeRoi(lev) // feeRoi = 0.05*lev*2, khop settlement engine.ts;
          const sr = Number(x.p1Share ?? 0);
          const share = sr > 1 ? Math.min(1, sr/100) : Math.min(1, Math.max(0, sr));
          const hasTp1 = (x as any).p1Pct != null && share > 0;
          const net = hasTp1 ? share * Number((x as any).p1Pct) + (1-share)*(gross - fee) : gross - fee;
          pnlOpen += marginOfL(x) * (net/100);
        }
        pnlClosed = Math.round(pnlClosed*100)/100; pnlOpen = Math.round(pnlOpen*100)/100;
        // Wallet start from DryRunState "wallet": one paper wallet across A-D, not a hard-coded 2000.
        const walletRow = await db.dryRunState.findUnique({ where: { id: "wallet" } }).catch(() => null);
        const totalStart = walletRow?.capital ?? 1000;
        return { perBook, totalStart, pnlClosed, pnlOpen, totalPnl: Math.round((pnlClosed+pnlOpen)*100)/100, totalEquity: Math.round((totalStart+pnlClosed+pnlOpen)*100)/100, wins, closed, open: (allOpens as any[]).length, winRate: closed ? wins/closed*100 : 0, netRoiClosed: totalStart ? pnlClosed/totalStart*100 : 0 };
      })();
      // SO CAI CHUAN: PNL$ = sum(capitalAfter - capitalBefore) cua closed (da tru phi, da gom TP1)
      // + sum(open unrealized NET). Khong dung margin*ROI gross (thieu phi, thieu so).
      // Open: ROI net = share*p1Pct + (1-share)*(gross - 0.05*lev*2) neu co TP1, else gross - 0.05*lev*2
      const totalPnlAllBooks = await (async () => {
        let s = 0;
        // Closed: chuoi von cua ca 5 so - lay capitalAfter-before, khong tinh lai tu ROI
        const bookNames = ["autoTrade","vulcanBook","wyckoffBook","liquidBook","liveBook"] as const;
        for (const bn of bookNames) {
          try {
            const br: any[] = await (db as any)[bn].findMany({ take: 5000, orderBy: { createdAt: "asc" } });
            for (const r of br) {
              if (r.status === "closed" || r.exitPrice != null) {
                const before = Number(r.capitalBefore ?? r.balanceBefore ?? NaN);
                const after = Number(r.capitalAfter ?? r.balanceAfter ?? NaN);
                if (Number.isFinite(before) && Number.isFinite(after)) s += after - before;
              }
            }
          } catch {}
        }
        // Open: unrealized NET
        const marginOf2 = (r: any) => {
          const d = Number(r.margin ?? r.entryCapital ?? NaN);
          if (Number.isFinite(d) && d > 0) return d;
          const stakeRaw = Number(r.stakePct ?? r.stake ?? NaN);
          const stake = Number.isFinite(stakeRaw) && stakeRaw > 0 ? stakeRaw : 10; // VulcanBook khong luu stake -> mac dinh 10% (VULCAN_STAKE_PCT)
          const base = Number(r.capitalBefore ?? r.balanceBefore ?? r.capital ?? NaN);
          if (Number.isFinite(base) && base > 0) return base * (stake / 100);
          return 1000 * (stake / 100);
        };
        for (const x of allOpens as any[]) {
          const px = priceMap[x.symbol] ?? Number((x as any).markPrice ?? (x as any).lastPrice ?? NaN);
          const lev = Number(x.leverage ?? 1);
          const gross = Number.isFinite(px) && x.entryPrice ? (x.side === "SHORT" ? (x.entryPrice - px) / x.entryPrice : (px - x.entryPrice) / x.entryPrice) * 100 * lev : 0;
          const fee = feeRoi(lev) // feeRoi = 0.05*lev*2, khop settlement engine.ts;
          const shareRaw = Number(x.p1Share ?? 0);
          const share = shareRaw > 1 ? Math.min(1, shareRaw / 100) : Math.min(1, Math.max(0, shareRaw));
          const hasTp1 = (x as any).p1Pct != null && share > 0;
          const net = hasTp1 ? share * Number((x as any).p1Pct) + (1 - share) * (gross - fee) : gross - fee;
          s += marginOf2(x) * (net / 100);
        }
        return Math.round(s * 100) / 100;
      })();
      return {
        universePool: UNIVERSE.length,
        publishedTop: uRows.length,
        uptrend: uRows.filter((r) => r.trend > 0).length,
        universeAgeMin: eng.universe ? min(now - eng.universe.at) : null,
        scanCombos: scanRows.length,
        scanAgeMin: eng.scan ? min(now - eng.scan.at) : null,
        // "GATE PASSED (RECENT)" — đếm từ bảng BcastVerdict (gate DUY NHẤT panel + Telegram
        // dùng, engine upsert mỗi tick 5p): combo được chấm trong 24h gần nhất và chất lượng
        // còn đạt floor. Không phụ thuộc snapshot RAM eng.scan — sống qua restart, thị trường
        // yên tĩnh vẫn giữ combo đã pass lần chấm gần nhất thay vì rớt về 0.
        // Cooldown 3h/symbol (BCAST_REPEAT_MS) là luật anti-spam broadcast, KHÔNG phải lỗi
        // chất lượng: gateRow (bcast-gate.ts) chấm cooldown CUỐI CÙNG nên reject "cooldown
        // Nm left" đã qua đủ AUC/ACC/score/PL1/vol — tính cả nhóm này để số không tụt oan
        // đúng lúc symbol đang hot. Riêng "outside top-30" là fail tầng universe → không tính.
        gatePass: bcast.filter(
          (b) =>
            now - new Date(b.at).getTime() < 24 * 3_600_000 &&
            (b.verdict === "pass" || (b.verdict === "reject" && b.reason.includes("cooldown"))),
        ).length,
        directional: scanRows.filter((r) => r.bias !== "NEUTRAL").length,
        neutral: scanRows.filter((r) => r.bias === "NEUTRAL").length,
        bcastPass: bcast.filter((b) => b.verdict === "pass").length,
        bcastTotal: bcast.length,
        tradesTotal: rows.length,
        openTrades: rows.length - closedRows.length,
        closedTrades: closedRows.length,
        wins,
        winRate: closedRows.length > 0 ? (wins / closedRows.length) * 100 : 0,
        wilson: wilsonLB(wins, closedRows.length),
        netRoi: st0?.stats.netPnlPct ?? sumPnl,
        avgRoi: pnls.length ? sumPnl / pnls.length : 0,
        tp: kinds.tp,
        sl: kinds.sl,
        trail: kinds.trail,
        flip: kinds.flip,
        manual: kinds.manual,
        unlabeled: closedRows.length - kinds.tp - kinds.sl - kinds.trail - kinds.flip - kinds.manual,
        last7d: closedRows.filter((r) => r.exitTime && now - new Date(r.exitTime).getTime() < 7 * 86_400_000).length,
        autoOn: cfg.on,
        equity: st0?.capital ?? null,
        totalStartCapital: ledger.totalStart,
        totalEquity: ledger.totalEquity, // wallet start + realized + open net PnL (single source)
        ledger, // single ledger: perBook A/B/C/D, pnlClosed, pnlOpen, totalPnl, winRate, closed, open
        open: o ? { symbol: o.symbol, side: o.side, roi, ageH } : null,
        openPositions,
        activeSessions: active.map((s) => SESSION_VI[s]),
        nextSession: SESSION_VI[nextKey],
        nextInMin: nextIn === 999 ? 0 : nextIn * 60,
        ok: cnt.ok,
        warn: cnt.warn,
        na: cnt.na,
      };
    } catch {
      return null;
    }
  })();

  return { at: now, dqfOn: readDqfFile().on, flow, sections: [market, combo, universe, auto, dqfSec, dock, openPos, hist, sg] };
}