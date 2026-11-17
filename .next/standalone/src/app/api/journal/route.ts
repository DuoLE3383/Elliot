// ─── /api/journal — default journal for /stats, computed ON THE SERVER ───────────────
// GET /api/journal?interval=15m&symbol=BTCUSDT → journal for one pair
// GET /api/journal?interval=15m&symbol=ALL     → journal AGGREGATED across the 11 staple pairs
//                                                  + per-pair breakdown table
// Uses the exact same papersFrom/kpiFrom of /api/view on DEFAULT settings (SL 6% /
// TP 3.2% / 1× / gate off) — but over its OWN window: JOURNAL_KLINES = 200 candles
// (0.2.52, was the shared 500) so the card reflects the recent regime without
// touching the engine's train/scan window. The browser only renders.
// "All pairs" = the standard SYMBOLS list (staples). Custom watchlist pairs are
// intentionally excluded so numbers stay stable and comparable across views.
// ALL results are cached in-memory for 60 s (11× papersFrom on every call would be wasteful);
// single-pair requests go through the normal 10 s klines cache.

import { NextRequest, NextResponse } from "next/server";
import {
  DEFAULT_SETTINGS,
  JOURNAL_KLINES,
  SYMBOLS,
} from "@/lib/types";
import { fetchKlinesDirectResolved } from "@/lib/klines-direct";
import { signalsFrom } from "@/lib/signals";
import { kpiFrom, papersFrom, type KpiStats } from "@/lib/papers";

export const dynamic = "force-dynamic";

export interface JournalPerPair {
  symbol: string;
  kpi: KpiStats;
  /** số tín hiệu UT trong khung 200 nến (0.2.52) của cặp này (cột "basis") */
  signals: number;
}

export interface JournalPayload {
  at: number;
  /** "ALL" hoặc symbol đơn */
  symbol: string;
  interval: string;
  kpi: KpiStats;
  /** tổng số tín hiệu trong khung — khớp "basis" của card journal */
  basis: number;
  /** bảng con theo cặp — chỉ khác null khi symbol === "ALL" */
  per: JournalPerPair[] | null;
  /** cặp tính lỗi (nến lỗi/mạng) — bị loại khỏi tổng hợp */
  failed: string[];
}

/** Journal MỘT cặp — cùng engine papersFrom với /api/view, nhưng cửa sổ RIÊNG
 *  200 nến (JOURNAL_KLINES, 0.2.52) — khác 500 nến của view. */
async function journalOne(symbol: string, interval: string): Promise<{ kpi: KpiStats; basis: number } | null> {
  try {
    const { klines } = await fetchKlinesDirectResolved(symbol, interval, JOURNAL_KLINES, { revalidate: 10 });
    if (klines.length < 10) return null;
    const s = DEFAULT_SETTINGS;
    const raw = signalsFrom(klines, s.atrKey, s.atrPeriod, s.smaPeriod);
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
    return { kpi: kpiFrom(res.papers), basis: signals.length };
  } catch {
    return null;
  }
}

/** 11 cặp bắn song song dễ chạm rate-limit/đứt gói (mạng VPS từng thấy
 * "Unexpected end of JSON input") — thử lại MỘT lần sau 500ms trước khi bỏ. */
async function journalOneRetry(symbol: string, interval: string): Promise<{ kpi: KpiStats; basis: number } | null> {
  const first = await journalOne(symbol, interval);
  if (first) return first;
  await new Promise((r) => setTimeout(r, 500));
  return journalOne(symbol, interval);
}

// ── cache 60s cho payload ALL ────────────────────────────────────────────────
let allCache: { at: number; interval: string; payload: JournalPayload } | null = null;
const ALL_TTL_MS = 60_000;

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const interval = (sp.get("interval") ?? "15m").slice(0, 8);
  const symbol = (sp.get("symbol") ?? "BTCUSDT").toUpperCase().slice(0, 20);

  // ── ALL — gộp 11 cặp tiêu chuẩn + bảng con ─────────────────────────────────
  if (symbol === "ALL") {
    if (allCache && allCache.interval === interval && Date.now() - allCache.at < ALL_TTL_MS) {
      return NextResponse.json(allCache.payload, { headers: { "Cache-Control": "no-store" } });
    }
    const rows = await Promise.all(
      SYMBOLS.map(async (sym): Promise<JournalPerPair | null> => {
        const r = await journalOneRetry(sym, interval);
        return r ? { symbol: sym, kpi: r.kpi, signals: r.basis } : null;
      }),
    );
    const per: JournalPerPair[] = rows.filter((x): x is JournalPerPair => x != null);
    const failed = SYMBOLS.filter((sym) => !per.some((p) => p.symbol === sym));
    // gộp: cộng từng trường cộng được rồi tính lại winRate trên tổng lệnh đóng
    // (cách gộp này khớp kpiFrom trên mảng papers nối liền của mọi cặp)
    const sum = (f: (k: KpiStats) => number) => per.reduce((acc, p) => acc + f(p.kpi), 0);
    const closed = sum((k) => k.closed);
    const wins = sum((k) => k.wins);
    const kpi: KpiStats = {
      total: sum((k) => k.total),
      closed,
      open: sum((k) => k.open),
      wins,
      losses: closed - wins,
      winRate: closed ? (wins / closed) * 100 : 0,
      tpCount: sum((k) => k.tpCount),
      slCount: sum((k) => k.slCount),
      flipCount: sum((k) => k.flipCount),
      flipWins: sum((k) => k.flipWins),
      flipLosses: sum((k) => k.flipLosses),
      flipNetPnl: sum((k) => k.flipNetPnl),
      netPnl: sum((k) => k.netPnl),
    };
    // bảng con: nhiều lệnh đóng trước, rồi net ROE giảm dần
    per.sort((a, b) => b.kpi.closed - a.kpi.closed || b.kpi.netPnl - a.kpi.netPnl);
    const payload: JournalPayload = {
      at: Date.now(),
      symbol: "ALL",
      interval,
      kpi,
      basis: per.reduce((acc, p) => acc + p.signals, 0), // tổng tín hiệu mọi cặp
      per,
      failed,
    };
    allCache = { at: Date.now(), interval, payload };
    return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
  }

  // ── 1 cặp ──────────────────────────────────────────────────────────────────
  // 0.2.52: dùng chung journalOneRetry với đường ALL — mạng VPS từng đứt gói
  // Binance ("Unexpected end of JSON input"), 1 lần thử duy nhất dễ trả 502 oan.
  const r = await journalOneRetry(symbol, interval);
  if (!r) {
    return NextResponse.json({ error: "no klines", symbol }, { status: 502 });
  }
  const payload: JournalPayload = {
    at: Date.now(),
    symbol,
    interval,
    kpi: r.kpi,
    basis: r.basis,
    per: null,
    failed: [],
  };
  return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
}
