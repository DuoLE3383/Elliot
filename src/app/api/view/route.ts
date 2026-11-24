// ─── /api/view — MỌI thứ trang chính cần, tính Ở SERVER ──────────────────────
// "dọn hết những gì đang chạy trên web về chạy ở server trừ chart" (0.2.35):
// trước đây trình duyệt tự chạy signalsFrom + papersFrom (engine), wyckoffFrom,
// analyze, 3× pies (replay preset), sessionStats/whaleDelta, cycleStats và
// signalsFrom×N cho watchlist — mỗi tick SSE một lượt, điện thoại quạt cấp.
// Giờ route này tính TẤT CẢ một lần trên server (klines chung 10s cache, mini
// 60s cache, daily BTC 1h cache) và trả JSON; client chỉ poll 2s/lần để render.
// Chart vẫn sống bằng /api/klines + SSE /api/stream — chỉ vẽ, không tính.

import { NextRequest, NextResponse } from "next/server";
import {
  DEFAULT_SETTINGS,
  DEFAULT_WYCKOFF,
  KLINE_LIMIT,
  STRATEGY_PRESETS,
  type EngineSettings,
  type Kline,
  type WyckoffSettings,
} from "@/lib/types";
import { fetchKlinesDirectResolved } from "@/lib/klines-direct";
import { signalsFrom } from "@/lib/signals";
import { kpiFrom, papersFrom } from "@/lib/papers";
import { wyckoffFrom } from "@/lib/wyckoff";
import { analyze } from "@/lib/analysis";
import { sessionStats, whaleDelta } from "@/lib/market";
import { cycleStats } from "@/lib/cycles";
import { buildSessionVerdict, deepDaily } from "@/lib/session-forecast";
import { SESS_INTERVAL, SESS_KLINE_COUNT, SESS_SYMBOL, pval } from "@/lib/params";
import type { PieStat, Sparkline, ViewPayload, WatchRow, WatchStatus } from "@/lib/view";

export const dynamic = "force-dynamic";

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Làm tròn số để payload nhẹ (10 chữ số đáng kể — thừa cho mọi đường chart). */
const r10 = (v: number | null): number | null => (v == null ? null : Number(v.toPrecision(10)));
const r10n = (v: number): number => Number(v.toPrecision(10));

const r10Arr = (a: (number | null)[]): (number | null)[] => a.map(r10);
const r10Num = (a: number[]): number[] => a.map(r10n);

function safeJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return { ...fallback, ...(JSON.parse(raw) as object) } as T;
  } catch {
    return fallback;
  }
}

/** Trạng thái watchlist cho MỘT cặp — y hệt watchStatus cũ của watchlist.tsx:
 *  tín hiệu UT fresh trong 3 nến đóng cuối trên cửa sổ mini 48 nến. */
function watchStatusOf(
  mini: Kline[] | undefined,
  atrKey: number,
  atrPeriod: number,
  smaPeriod: number,
): WatchStatus {
  if (!mini || mini.length < 10) return { kind: "loading" };
  const lastClosed = mini.length - 2;
  const { signals } = signalsFrom(mini, atrKey, atrPeriod, smaPeriod);
  const last = signals.at(-1);
  if (!last || last.i < mini.length - 1) {
    // tín hiệu tạm trên nến đang chạy → chưa có gì xác nhận
    return { kind: "wait" };
  }
  if (last.i >= lastClosed - 2) {
    return { kind: "signal", side: last.dir === "BUY" ? "LONG" : "SHORT", fresh: last.smaOk };
  }
  return { kind: "wait" };
}

/** Sparkline 0..1 chuẩn hoá min-max từ dãy close — client chỉ vẽ path. */
function sparkOf(mini: Kline[] | undefined): Sparkline | null {
  if (!mini || mini.length < 2) return null;
  const closes = mini.map((k) => k.c);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const span = max - min || max * 0.001 || 1;
  return {
    up: closes[closes.length - 1] >= closes[0],
    pts: closes.map((c) => Math.round(((c - min) / span) * 1000) / 1000),
  };
}

// ─── mini-klines 48 nến cho watchlist — cache 60s (20s cho cái hỏng) ─────────

interface MiniEntry {
  at: number;
  klines: Kline[] | null;
}
const miniCache = new Map<string, MiniEntry>();
const MINI_TTL_MS = 60_000;
const MINI_FAIL_TTL_MS = 20_000;

async function miniFor(sym: string, interval: string): Promise<Kline[] | null> {
  const key = `${sym}|${interval}`;
  const hit = miniCache.get(key);
  if (hit && Date.now() - hit.at < (hit.klines ? MINI_TTL_MS : MINI_FAIL_TTL_MS)) return hit.klines;
  try {
    const { klines } = await fetchKlinesDirectResolved(sym, interval, 48, { revalidate: 30 });
    miniCache.set(key, { at: Date.now(), klines });
    return klines;
  } catch {
    miniCache.set(key, { at: Date.now(), klines: null });
    return null;
  }
}

// ─── BTC daily cho chu kỳ lịch + composite verdict — deep fetch 30 phút/lần ──

let dailyCache: { at: number; klines: Kline[] } | null = null;
const DAILY_TTL_MS = 30 * 60_000;

let sessRefCache: { at: number; klines: Kline[] } | null = null;
const SESS_REF_TTL_MS = 5 * 60_000;
async function sessRefKlines(): Promise<Kline[]> {
  if (sessRefCache && Date.now() - sessRefCache.at < SESS_REF_TTL_MS) return sessRefCache.klines;
  const { klines } = await fetchKlinesDirectResolved(pval("SESS_SYMBOL", SESS_SYMBOL), pval("SESS_INTERVAL", SESS_INTERVAL), pval("SESS_KLINE_COUNT", SESS_KLINE_COUNT), { revalidate: 60 });
  if (klines.length >= 10) sessRefCache = { at: Date.now(), klines };
  return klines.length >= 10 ? klines : (sessRefCache?.klines ?? []);
}

async function btcDaily(): Promise<Kline[]> {
  if (dailyCache && Date.now() - dailyCache.at < DAILY_TTL_MS) return dailyCache.klines;
  const klines = await deepDaily("BTCUSDT"); // 0.2.60: 1000 → CYCLE_DAYS (2000 ≈ 5,5 năm)
  if (klines.length > 0) dailyCache = { at: Date.now(), klines };
  return klines.length > 0 ? klines : (dailyCache?.klines ?? []);
}

// ─── payload cache 1.5s — nhiều tab cùng xem một combo chia nhau một lượt tính ─

const viewCache = new Map<string, { at: number; payload: ViewPayload }>();
const VIEW_TTL_MS = 1_500;

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const symbol = (sp.get("symbol") ?? "BTCUSDT").toUpperCase().slice(0, 20);
  const interval = sp.get("interval") ?? "5m";
  const s = safeJson<EngineSettings>(sp.get("s"), DEFAULT_SETTINGS);
  const w = safeJson<WyckoffSettings>(sp.get("w"), DEFAULT_WYCKOFF);
  const pairs = (sp.get("pairs") ?? "")
    .split(",")
    .map((x) => x.trim().toUpperCase())
    .filter((x) => /^[A-Z0-9]{5,20}$/.test(x))
    .slice(0, 80);

  const cacheKey = JSON.stringify([symbol, interval, s, w, pairs]);
  const cached = viewCache.get(cacheKey);
  if (cached && Date.now() - cached.at < VIEW_TTL_MS) {
    return NextResponse.json(cached.payload, { headers: { "Cache-Control": "no-store" } });
  }

  try {
    const { klines } = await fetchKlinesDirectResolved(symbol, interval, KLINE_LIMIT, { revalidate: 10 });
    if (klines.length < 10) {
      return NextResponse.json({ error: "no klines" }, { status: 502 });
    }

    // ── engine — chính là các hàm client từng chạy, giờ chạy 1 lần ở đây ────
    const raw = signalsFrom(klines, s.atrKey, s.atrPeriod, s.smaPeriod);
    // UT off → không sinh tín hiệu mới (lệnh đang mở vẫn thoát bằng SL/TP);
    // gate off → không có gì bị "chặn" trong UI
    const signals = !s.utOn
      ? []
      : s.smaFilter
        ? raw.signals
        : raw.signals.map((x) => ({ ...x, smaOk: true }));
    const res = papersFrom(
      klines,
      signals,
      raw.sma,
      symbol,
      interval,
      s.slPct,
      s.tpPct,
      s.leverage,
      s.smaFilter,
    );
    const kpi = kpiFrom(res.papers);
    const confirmed = signals.filter((x) => x.i < klines.length - 1);

    // cổng SMA hướng — y hệt logic client cũ
    const smaVal = raw.sma[klines.length - 1];
    const lastClose = klines[klines.length - 1].c;
    const gate = {
      long: smaVal == null ? true : lastClose > smaVal,
      short: smaVal == null ? true : lastClose < smaVal,
      sma: (smaVal as number | null) ?? null,
    };

    // ── wyckoff — Int8Array không stringify được → mảng thường + làm tròn EMA
    let wyckoff: ViewPayload["wyckoff"] = null;
    if (w.enabled && klines.length >= 60) {
      try {
        const wy = wyckoffFrom(klines, interval, w);
        wyckoff = {
          ...wy,
          tints: Array.from(wy.tints),
          emaF: r10Arr(wy.emaF),
          emaS: r10Arr(wy.emaS),
        };
      } catch {
        wyckoff = null; // máy trạng thái lỗi → panel ẩn, chart vẫn chạy
      }
    }
    // ── phân tích sâu + 3 donut preset (replay engine trên cùng nến) ────────
    const analysis = analyze(klines);
    const pies: PieStat[] = STRATEGY_PRESETS.map((p) => {
      const cfg = { ...p.settings, leverage: s.leverage };
      const rawP = signalsFrom(klines, cfg.atrKey, cfg.atrPeriod, cfg.smaPeriod);
      const sigsP = cfg.smaFilter ? rawP.signals : rawP.signals.map((x) => ({ ...x, smaOk: true }));
      const resP = papersFrom(
        klines,
        sigsP,
        rawP.sma,
        "pies",
        "pies",
        cfg.slPct,
        cfg.tpPct,
        cfg.leverage,
        cfg.smaFilter,
      );
      const closed = resP.papers.filter((x) => x.status === "closed");
      const allSlices: PieStat["slices"] = [
        { key: "tp", n: closed.filter((x) => x.exitKind === "tp" && !x.liquidated).length },
        { key: "sl", n: closed.filter((x) => x.exitKind === "sl" && !x.liquidated).length },
        { key: "liq", n: closed.filter((x) => x.liquidated).length },
        { key: "flip", n: closed.filter((x) => x.exitKind === "flip").length },
      ];
      return { key: p.key, k: kpiFrom(resP.papers), slices: allSlices.filter((x) => x.n > 0) };
    });

    // ── phiên + cá voi + chu kỳ lịch + composite forecast ────────────────────
    // Market-wide session forecast: use SESS_SYMBOL reference klines, never the viewed coin/timeframe klines.
    let refKlines: Kline[] = [];
    try { refKlines = await sessRefKlines(); } catch { refKlines = sessRefCache?.klines ?? []; }
    const forecastKlines = refKlines.length >= 10 ? refKlines : [];
    const sessStats = forecastKlines.length ? sessionStats(forecastKlines) : [];
    const whale = forecastKlines.length ? whaleDelta(forecastKlines) : null;
    const daily = await btcDaily();
    const cycles = daily.length >= 60 ? cycleStats(daily) : null;
    const forecast = forecastKlines.length ? await buildSessionVerdict({ symbol: pval("SESS_SYMBOL", SESS_SYMBOL), klines: forecastKlines, sessStats, whale, daily }) : null;

    // ── watchlist — song song, mỗi cặp mini 48 nến (cache 60s) ──────────────
    const minis = await Promise.all(pairs.map((sym) => miniFor(sym, interval)));
    const watch: WatchRow[] = pairs.map((sym, i) => ({
      sym,
      status: watchStatusOf(minis[i] ?? undefined, s.atrKey, s.atrPeriod, s.smaPeriod),
      spark: sparkOf(minis[i] ?? undefined),
    }));

    const payload: ViewPayload = {
      at: Date.now(),
      symbol,
      interval,
      n: klines.length,
      signals,
      confirmed,
      sma: r10Arr(raw.sma),
      stop: r10Arr(raw.stop),
      trend: r10Num(raw.trend),
      papers: res.papers,
      open: res.open ?? null,
      pending: res.pending ?? null,
      kpi,
      gate,
      wyckoff,
      analysis,
      pies,
      sessStats,
      whale,
      cycles,
      forecast,
      watch,
    };

    viewCache.set(cacheKey, { at: Date.now(), payload });
    if (viewCache.size > 64) {
      // dọn cache — giữ 32 mục mới nhất
      const entries = [...viewCache.entries()].sort((a, b) => b[1].at - a[1].at);
      viewCache.clear();
      for (const [k, v] of entries.slice(0, 32)) viewCache.set(k, v);
    }
    return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "fetch failed";
    if (msg === "invalid symbol") {
      return NextResponse.json({ error: "invalid symbol", symbol }, { status: 400 });
    }
    return NextResponse.json({ error: "binance_unreachable", detail: msg }, { status: 502 });
  }
}
