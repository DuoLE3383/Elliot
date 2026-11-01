// ─── Squeeze radar — sức ép đòn bẩy, dự báo sớm dump/pump ────────────────────
// Nghiên cứu từ coinglass.com/liquidations: bảng liquidation/đòn bẩy của
// Coinglass được TỔNG HỢP từ dữ liệu sàn — Coinglass API thì trả phí 100%
// (4 gói, không có free tier), nhưng các endpoint GỐC của Binance Futures là
// public miễn phí và cho cùng lớp dữ liệu:
//   /futures/data/openInterestHist            — Open Interest 5m (≤ 500 điểm)
//   /futures/data/globalLongShortAccountRatio — tỷ lệ tài khoản long/short
//   /futures/data/takerlongshortRatio         — buy/sell volume taker
//   /fapi/v1/premiumIndex                     — funding rate hiện tại (graceful)
//
// Ý nghĩa dự báo (những gì Coinglass gọi là "cascading effect"):
//   • Crowd LONG (LS cao) + funding dương + giá rơi  → DUMP: đám đông kẹt long,
//     OI rơi cùng giá = bơm tháo dần, thanh khoản bị bốc cột.
//   • Crowd SHORT (LS thấp) + funding âm + giá tăng  → SHORT SQUEEZE: shorts
//     bị đốt, đẩy giá lên nhanh.
//   • Giá↓ + OI↓ nhanh                               → cascade đang CHẠY, xu
//     hướng giảm chưa chắc hết.
//
// Toàn bộ fetch có host-fallback + timeout, funding lỗi → null (không cản
// report). Report được cache 3 phút theo symbol để nhiều caller xài chung.

import type { Kline } from "./types";
import { aliasFuturesSymbol } from "./types";
import { binanceHosts, binanceJson } from "./klines-direct";

const TTL_MS = 180_000; // 3 phút — dữ liệu 5m, không cần dày hơn

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SqueezeChg {
  h1: number | null;
  h4: number | null;
  h24: number | null;
}

export interface SqueezeInputs {
  priceChgPct: SqueezeChg;
  oiChgPct: SqueezeChg;
  lsRatio: number | null;
  takerBuySell: number | null;
  fundingRatePct: number | null;
}

export interface SqueezeRisk {
  /** 0..100 — cường độ sức ép đòn bẩy của bên yếu thế */
  score: number;
  lean: "dump" | "pump" | "calm";
  label: string;
  drivers: string[];
}

export interface SqueezeReport {
  symbol: string;
  ts: number;
  price: number | null;
  priceChgPct: SqueezeChg;
  oiValueUsd: number | null;
  oiChgPct: SqueezeChg;
  lsRatio: number | null;
  takerBuySell: number | null;
  fundingRatePct: number | null;
  risk: SqueezeRisk;
}

// ─── Pure scorer — unit-test được, không fetch ───────────────────────────────

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const num = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);

/** Điểm dump 0..100 — đám đông long + funding dương + bán đẩy + cascade.
 * Cân chỉnh: kịch bản dump kinh điển (LS ≥ 2.4, taker ≤ 0.6, giá −4%/4h,
 * OI −6%/4h) phải chạm 85+ → nhãn CAO; hỗn hợp yếu thì ở vùng nhẹ. */
export function dumpPressure(i: SqueezeInputs): number {
  let s = 0;
  const p4 = i.priceChgPct.h4;
  const o4 = i.oiChgPct.h4;
  if (num(i.lsRatio) && i.lsRatio > 1.3) s += 30 * clamp01((i.lsRatio - 1.3) / 1.1); // crowd long (đỉnh ~2.4)
  if (num(i.fundingRatePct) && i.fundingRatePct > 0.015) s += 10 * clamp01((i.fundingRatePct - 0.015) / 0.085);
  if (num(i.takerBuySell) && i.takerBuySell < 0.95) s += 25 * clamp01((0.95 - i.takerBuySell) / 0.35); // bán áp đảo (đáy ~0.60)
  if (num(p4) && p4 < -0.5) s += 20 * clamp01((-0.5 - p4) / 3.5); // giá đang rơi (−4%/4h bão hòa)
  if (num(p4) && num(o4) && p4 < -0.2 && o4 < -2) s += 20 * clamp01((-2 - o4) / 4); // giá↓ + OI↓ = cascade
  else if (num(p4) && num(o4) && p4 > 0.2 && o4 > 3 && num(i.lsRatio) && i.lsRatio >= 1.5)
    s += 20 * clamp01((o4 - 3) / 4); // OI↑ vào rally + crowd long = nhiên liệu dump
  return Math.round(Math.min(100, s));
}

/** Điểm short-squeeze 0..100 — đám đông short + funding âm + mua đẩy.
 * Đối xứng với dumpPressure: kịch bản squeeze kinh điển phải chạm 70+. */
export function pumpPressure(i: SqueezeInputs): number {
  let s = 0;
  const p4 = i.priceChgPct.h4;
  const o4 = i.oiChgPct.h4;
  if (num(i.lsRatio) && i.lsRatio < 0.7) s += 30 * clamp01((0.7 - i.lsRatio) / 0.25); // crowd short (đáy ~0.45)
  if (num(i.fundingRatePct) && i.fundingRatePct < -0.015) s += 10 * clamp01((-0.015 - i.fundingRatePct) / 0.085);
  if (num(i.takerBuySell) && i.takerBuySell > 1.05) s += 25 * clamp01((i.takerBuySell - 1.05) / 0.35);
  if (num(p4) && p4 > 0.5) s += 20 * clamp01((p4 - 0.5) / 3.5);
  if (num(p4) && num(o4) && p4 > 0.2 && o4 < -2) s += 20 * clamp01((-2 - o4) / 4); // giá↑ + OI↓ = đốt shorts
  else if (num(p4) && num(o4) && p4 > 0.2 && o4 > 3 && num(i.lsRatio) && i.lsRatio < 0.7)
    s += 20 * clamp01((o4 - 3) / 4);
  return Math.round(Math.min(100, s));
}

/** Tổng hợp dump vs pump → lean + nhãn tiếng Việt + các bằng chứng. */
export function scoreSqueeze(i: SqueezeInputs): SqueezeRisk {
  const dump = dumpPressure(i);
  const pump = pumpPressure(i);
  const drivers: string[] = [];
  const p1 = i.priceChgPct.h1;
  const p4 = i.priceChgPct.h4;
  const o1 = i.oiChgPct.h1;
  const o4 = i.oiChgPct.h4;
  const f = (v: number | null, d = 2): string => (num(v) ? `${v >= 0 ? "+" : ""}${v.toFixed(d)}%` : "—");
  if (num(i.lsRatio)) drivers.push(`LS ${i.lsRatio!.toFixed(2)} (${i.lsRatio! >= 1.3 ? "dân THÊM LONG" : i.lsRatio! <= 0.7 ? "dân THÊM SHORT" : "cân bằng"})`);
  if (num(i.takerBuySell)) drivers.push(`taker B/S ${i.takerBuySell!.toFixed(2)} (${i.takerBuySell! < 0.9 ? "bán áp đảo" : i.takerBuySell! > 1.1 ? "mua áp đảo" : "hai chiều"})`);
  if (num(i.fundingRatePct)) drivers.push(`funding ${f(i.fundingRatePct, 3)}/8h`);
  drivers.push(`giá ${f(p1, 1)}/1h ${f(p4, 1)}/4h`, `OI ${f(o1, 1)}/1h ${f(o4, 1)}/4h`);

  const score = Math.max(dump, pump);
  let lean: SqueezeRisk["lean"] = "calm";
  if (score >= 25) lean = dump >= pump ? "dump" : "pump";
  let label = "⚖️ đòn bẩy cân bằng";
  if (lean === "dump")
    label = score >= 70 ? "🔻 RỦI RO DUMP CAO" : score >= 45 ? "🔻 rủi ro dump trung bình" : "🔻 rủi ro dump nhẹ";
  else if (lean === "pump")
    label = score >= 70 ? "🔺 RỦI RO SHORT SQUEEZE CAO" : score >= 45 ? "🔺 rủi ro short squeeze trung bình" : "🔺 rủi ro short squeeze nhẹ";
  return { score, lean, label, drivers };
}

// ─── Fetch helpers (host fallback + timeout) ─────────────────────────────────

async function getJson<T>(path: string): Promise<T> {
  let lastErr: unknown = null;
  for (const host of binanceHosts()) {
    try {
      const res = await fetch(`${host}${path}`, { signal: AbortSignal.timeout(9000) });
      if (!res.ok) {
        lastErr = new Error(`HTTP ${res.status}`);
        continue;
      }
      return await binanceJson<T>(res, host);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("fetch failed");
}

interface OiPoint {
  sumOpenInterest: string;
  sumOpenInterestValue: string;
  timestamp: number;
}
interface LsPoint {
  longShortRatio: string;
  timestamp: number;
}
interface TakerPoint {
  buySellRatio: string;
  timestamp: number;
}
interface PremiumIndex {
  markPrice: string;
  lastFundingRate: string;
}

const chgPct = (now: number, old: number): number => ((now - old) / old) * 100;

/** % thay đổi của chuỗi OI so với 1h/4h/24h trước (5m điểm). */
function oiChanges(points: OiPoint[]): SqueezeChg {
  const n = points.length;
  const at = (back: number): number | null => (n > back ? Number(points[n - 1 - back].sumOpenInterestValue) : null);
  const now = n > 0 ? Number(points[n - 1].sumOpenInterestValue) : null;
  const h1 = at(12);
  const h4 = at(48);
  const h24 = at(Math.min(288, n - 1));
  const c = (old: number | null): number | null => (now != null && old != null && old > 0 ? chgPct(now, old) : null);
  return { h1: c(h1), h4: c(h4), h24: c(h24) };
}

/** mean của trường string số trong N điểm mới nhất. */
const meanOf = (rows: Array<Record<string, string>>, field: string, n: number): number | null => {
  const slice = rows.slice(-n).map((r) => Number(r[field])).filter((v) => Number.isFinite(v));
  return slice.length > 0 ? slice.reduce((a, b) => a + b, 0) / slice.length : null;
};

// ─── Cache + report builder ──────────────────────────────────────────────────

const cache = new Map<string, { ts: number; report: SqueezeReport }>();
const inflight = new Map<string, Promise<SqueezeReport>>();

async function buildReport(symbol: string): Promise<SqueezeReport> {
  const [klines, oi, ls, tk, premium] = await Promise.allSettled([
    getJson<unknown[]>(`/fapi/v1/klines?symbol=${symbol}&interval=1h&limit=26`),
    getJson<OiPoint[]>(`/futures/data/openInterestHist?symbol=${symbol}&period=5m&limit=289`),
    getJson<LsPoint[]>(`/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=5m&limit=12`),
    getJson<TakerPoint[]>(`/futures/data/takerlongshortRatio?symbol=${symbol}&period=5m&limit=12`),
    getJson<PremiumIndex>(`/fapi/v1/premiumIndex?symbol=${symbol}`),
  ]);

  // giá: nến 1h đóng gần nhất
  let price: number | null = null;
  let priceChgPct: SqueezeChg = { h1: null, h4: null, h24: null };
  if (klines.status === "fulfilled" && Array.isArray(klines.value) && klines.value.length >= 3) {
    const rows = klines.value as unknown[];
    const closes = rows.map((r) => Number((r as [unknown, string])[1]));
    const last = closes[closes.length - 2] ?? closes[closes.length - 1];
    if (Number.isFinite(last) && last > 0) {
      price = last;
      const back = (b: number): number | null => {
        const idx = closes.length - 2 - b;
        return idx >= 0 && closes[idx] > 0 ? chgPct(last, closes[idx]) : null;
      };
      priceChgPct = { h1: back(1), h4: back(4), h24: back(24) };
    }
  }

  const oiChgPct = oi.status === "fulfilled" && Array.isArray(oi.value) && oi.value.length > 2 ? oiChanges(oi.value) : { h1: null, h4: null, h24: null };
  const oiValueUsd = oi.status === "fulfilled" && Array.isArray(oi.value) && oi.value.length > 0 ? Number(oi.value[oi.value.length - 1].sumOpenInterestValue) : null;

  const lsRatio = ls.status === "fulfilled" && Array.isArray(ls.value) ? meanOf(ls.value as unknown as Array<Record<string, string>>, "longShortRatio", 12) : null;
  const takerBuySell = tk.status === "fulfilled" && Array.isArray(tk.value) ? meanOf(tk.value as unknown as Array<Record<string, string>>, "buySellRatio", 12) : null;
  const fundingRatePct = premium.status === "fulfilled" && premium.value?.lastFundingRate != null ? Number(premium.value.lastFundingRate) * 100 : null;

  const risk = scoreSqueeze({ priceChgPct, oiChgPct, lsRatio, takerBuySell, fundingRatePct });
  // mọi nguồn cùng chết (Binance không trả lời gì) → ném lỗi để caller bỏ khối
  // ⛓ thay vì gửi tin với toàn "—"
  if (price == null && oiValueUsd == null && lsRatio == null && takerBuySell == null && fundingRatePct == null) {
    throw new Error("binance_unreachable");
  }
  return { symbol, ts: Date.now(), price, priceChgPct, oiValueUsd, oiChgPct, lsRatio, takerBuySell, fundingRatePct, risk };
}

/**
 * Report squeeze cho 1 symbol — cache 3 phút, gọi dồn đồng thời chỉ fetch 1 lần.
 * Ném lỗi khi Binance không trả được dữ liệu nền (klines + OI cùng fail).
 */
export async function getSqueezeReport(symbolRaw: string): Promise<SqueezeReport> {
  const alias = aliasFuturesSymbol(symbolRaw.toUpperCase());
  if (!alias) throw new Error(`invalid symbol: ${symbolRaw}`);
  const hit = cache.get(alias);
  if (hit && Date.now() - hit.ts < TTL_MS) return hit.report;
  const busy = inflight.get(alias);
  if (busy) return busy;
  const p = buildReport(alias)
    .then((report) => {
      cache.set(alias, { ts: Date.now(), report });
      return report;
    })
    .finally(() => inflight.delete(alias));
  inflight.set(alias, p);
  return p;
}

/** Một dòng "⛓ Đòn bẩy: …" cho Telegram (HTML) — rỗng khi chưa có dữ liệu. */
export function squeezeLine(sq: SqueezeReport): string {
  return `⛓ Đòn bẩy: <b>${sq.risk.label}</b> (${sq.risk.score}/100) — ${sq.risk.drivers.join(" · ")}`;
}
