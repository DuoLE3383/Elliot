// ─── Session forecast v2 — composite multi-factor verdict (SERVER) ───────────
// 0.2.60 — "cần scan và lọc mạnh hơn để tìm ra phán đoán hướng đi của phiên
// rõ ràng hơn".
//
// Bản cũ (0.2.35–0.2.59): MỘT quy tắc Bull<40%/>60% trên nến 1h của phiên →
// phần lớn thời gian trả NEUTRAL vì mỗi tín hiệu đứng một mình, cửa sổ 1h
// ngắn (~40 ngày) và không có yếu tố ngữ cảnh nào khác.
//
// v2 gộp 9 phiếu bầu có trọng số thành MỘT điểm composite −100..+100:
//   1. sessionBull  (w=2.0) — Bull% phiên tới, tin cậy theo n mẫu
//   2. sessionDrift (w=1.0) — drift trung bình mỗi nến của phiên
//   3. regime       (w=2.0) — giá vs SMA200 khung đang xem (lọc hướng TT)
//   4. momentum24h  (w=1.0) — % đổi 24h (tính theo THỜI GIAN, đúng mọi TF)
//   5. weekday      (w=1.5) — tần suất thứ đó đóng tăng (nến ngày ~5,5 năm)
//   6. calendar     (w=0.5) — đầu/cuối tháng, cuối quý (bucket riêng)
//   7. whale        (w=1.5) — taker delta 20 nến / tổng volume cửa sổ
//   8. fearGreed    (w=1.0) — contrarian tại cực trị (mua sợ / bán tham)
//   9. derivatives  (w=1.0) — funding cao + long chật chội → lean ngược
//
// Mỗi phiếu có "reliability" theo số mẫu: mẫu mỏng tự mờ đi (n/đủ). Mọi phiếu
// kèm chữ giải thích trả về trong payload → panel liệt kê từng yếu tố, hết
// hộp đen. NGUYÊN TẮC: thống kê/chu kỳ = BỐI CẢNH phán đoán, KHÔNG trực tiếp
// mở lệnh — engine vào lệnh vẫn đi qua XGBoost + Risk Officer như cũ.

import { binanceHosts, binanceJson } from "./klines-direct";
import type { Kline } from "./types";
import { fmtCompact, nextSessionOpen, type SessionKey, type SessionStat, type WhaleDelta } from "./market";
import { cycleForecast, cycleStats, type CycleStats } from "./cycles";
import { getMarketPulse, type MarketPulse } from "./market-pulse";
import { pval, CYCLE_DAYS, SESS_CALL_BAND } from "./params";

// ─── helpers ──────────────────────────────────────────────────────────────────

const clamp1 = (x: number): number => Math.max(-1, Math.min(1, x));
/** reliability 0..1 — mẫu mỏng thì phiếu mờ đi (n=đủ mẫu → 1). */
const rel = (n: number, full: number): number => Math.max(0.05, Math.min(1, n / full));

const DOW_EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY_MS = 86_400_000;

// ─── deep daily fetch — phân trang ngược endTime (fetchKlinesDirect cap 1000) ─

/** mapRow giống klines-direct.ts (không export ở đó — giữ bản local). */
const row = (r: unknown): Kline => {
  const a = r as [number, string, string, string, string, string, number, string, number, string];
  return { t: a[0], o: Number(a[1]), h: Number(a[2]), l: Number(a[3]), c: Number(a[4]), v: Number(a[5]), tb: Number(a[9]) || 0 };
};

/**
 * Nạp tối đa `days` nến 1d Binance futures bằng cách đi LÙI theo endTime
 * (mỗi chunk ≤1000). Dùng cho thống kê chu kỳ lịch — 2000 ngày ≈ 5,5 năm,
 * vượt xa cửa sổ 1000 ngày (2,7 năm) cũ → ~256 mẫu/thứ thay vì ~142.
 */
async function fetchDailyDeep(symbol: string, days: number): Promise<Kline[]> {
  const host = binanceHosts()[0] ?? "https://fapi.binance.com";
  const out: Kline[] = [];
  let endTime: number | undefined;
  for (let guard = 0; guard < 4 && out.length < days; guard++) {
    const lim = Math.min(1000, days - out.length);
    const url = `${host}/fapi/v1/klines?symbol=${symbol}&interval=1d&limit=${lim}${endTime ? `&endTime=${endTime}` : ""}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(9000), cache: "no-store" });
    if (!res.ok) break;
    const raw = (await binanceJson<unknown[]>(res, host)).map(row);
    if (!raw.length) break;
    out.unshift(...raw);
    endTime = raw[0].t - 1;
    if (raw.length < lim) break; // hết lịch sử (cặp mới listing)
  }
  return out;
}

// cache 30 phút — nến ngày mới có giá trị 1 lần/ngày
let deepCache: { at: number; klines: Kline[] } | null = null;
const DEEP_TTL_MS = 30 * 60_000;

export async function deepDaily(symbol = "BTCUSDT"): Promise<Kline[]> {
  if (deepCache && Date.now() - deepCache.at < DEEP_TTL_MS) return deepCache.klines;
  const days = pval("CYCLE_DAYS", CYCLE_DAYS);
  try {
    const klines = await fetchDailyDeep(symbol, days);
    if (klines.length >= 60) {
      deepCache = { at: Date.now(), klines };
      return klines;
    }
  } catch {
    // mạng/API hỏng → dùng cache cũ nếu có
  }
  return deepCache?.klines ?? [];
}

// ─── composite verdict ────────────────────────────────────────────────────────

export interface VerdictFactor {
  key: string;
  /** giải thích ngắn (EN — ngôn ngữ chính của app) */
  text: string;
  /** lean −1..+1 (null = không đủ dữ liệu) */
  lean: number | null;
  weight: number;
}

export interface SessionVerdict {
  /** điểm composite −100..+100 */
  score: number;
  call: "BULL" | "BEAR" | "NEUTRAL";
  /** 0..100 = |score| */
  confidence: number;
  /** ngưỡng BULL/BEAR đã dùng (SESS_CALL_BAND) */
  band: number;
  factors: VerdictFactor[];
  targetSession: SessionKey | null;
  opensInMin: number | null;
  at: number;
}

export interface VerdictInputs {
  now: number;
  klines: Kline[];
  sessStats: SessionStat[];
  whale: WhaleDelta | null;
  daily: Kline[];
  pulse: MarketPulse | null;
}

/** HÀM THUẦN — mọi phiếu tính từ đầu vào; test được với dữ liệu tổng hợp. */
export function sessionVerdict(inp: VerdictInputs): SessionVerdict {
  const { klines, sessStats, whale, daily, pulse } = inp;
  const now = inp.now;
  const nx = nextSessionOpen(now);
  const lastClosed = klines.length - 2;
  const lastClose = klines[lastClosed]?.c ?? klines[klines.length - 1]?.c;
  const factors: VerdictFactor[] = [];
  const push = (key: string, weight: number, lean: number | null, text: string): void => {
    factors.push({ key, weight, lean, text });
  };

  // 1 + 2 — phiên tới trên cửa sổ 1h/TF đang xem
  const st = nx ? sessStats.find((s) => s.key === nx.key) : undefined;
  if (st?.bullPct != null) {
    const r = rel(st.candles, 150);
    push("session", 2, clamp1((st.bullPct - 50) / 20) * r, `Bull ${st.bullPct.toFixed(0)}% of ${nx!.key} candles (n=${st.candles}${r < 0.5 ? ", thin sample" : ""})`);
  } else {
    push("session", 2, null, "no session stat");
  }
  if (st?.driftPct != null) {
    push("drift", 1, clamp1(st.driftPct / 0.05) * rel(st.candles, 150), `mean drift ${st.driftPct >= 0 ? "+" : ""}${st.driftPct.toFixed(3)}% per candle`);
  } else {
    push("drift", 1, null, "no drift stat");
  }

  // 3 — regime: giá vs SMA200 khung đang xem (cửa sổ ≥100 nến mới có ý nghĩa)
  if (lastClose != null && lastClosed >= 99) {
    const w = Math.min(200, lastClosed);
    let sum = 0;
    for (let i = lastClosed - w + 1; i <= lastClosed; i++) sum += klines[i].c;
    const sma = sum / w;
    const dev = ((lastClose - sma) / sma) * 100;
    push("regime", 2, clamp1(dev / 1.5), `price ${dev >= 0 ? "+" : ""}${dev.toFixed(2)}% vs SMA200 (viewed TF)`);
  } else {
    push("regime", 2, null, "not enough candles for SMA200");
  }

  // 4 — momentum 24h theo thời gian (đúng mọi TF)
  if (lastClose != null) {
    const cutoff = now - DAY_MS;
    let base: number | null = null;
    for (let i = lastClosed; i >= 0; i--) {
      if (klines[i].t <= cutoff) {
        base = klines[i].c;
        break;
      }
    }
    if (base != null && base > 0) {
      const ret = ((lastClose - base) / base) * 100;
      push("momentum", 1, clamp1(ret / 2.5), `24h change ${ret >= 0 ? "+" : ""}${ret.toFixed(2)}%`);
    } else {
      push("momentum", 1, null, "window shorter than 24h");
    }
  }

  // 5 + 6 — chu kỳ lịch từ nến ngày (BTC — hiệu ứng lịch là của cả thị trường)
  const cs: CycleStats | null = daily.length >= 60 ? cycleStats(daily) : null;
  if (cs && nx) {
    const target = now + nx.inMin * 60_000;
    const fc = cycleForecast(target, cs);
    const b = fc.dow;
    if (b.upPct != null) {
      push(
        "weekday",
        1.5,
        clamp1((b.upPct - 50) / 10) * rel(b.n, 200),
        `${DOW_EN[fc.dowIndex]} closes up ${b.upPct.toFixed(0)}% (n=${b.n} daily candles ≈ ${(cs.days / 365).toFixed(1)}y)`,
      );
    } else {
      push("weekday", 1.5, null, "no weekday stats");
    }
    const sp = fc.special;
    if (sp && sp.bucket.upPct != null && sp.bucket.n >= 30) {
      push("calendar", 0.5, clamp1((sp.bucket.upPct - 50) / 10) * rel(sp.bucket.n, 100), `${sp.label} window: ${sp.bucket.upPct.toFixed(0)}% up (n=${sp.bucket.n})`);
    } else {
      push("calendar", 0.5, null, "ordinary calendar day");
    }
  } else {
    push("weekday", 1.5, null, "no daily history");
    push("calendar", 0.5, null, "no daily history");
  }

  // 7 — taker delta so với tổng volume cửa sổ
  if (whale && whale.n > 0 && lastClosed >= 0) {
    const from = Math.max(0, lastClosed - whale.n + 1);
    let vol = 0;
    for (let i = from; i <= lastClosed; i++) vol += klines[i].v;
    if (vol > 0) {
      const pct = (whale.net / vol) * 100;
      push("whale", 1.5, clamp1(pct / 3), `taker Δ ${fmtCompact(whale.net)} over ${whale.n} candles (${pct >= 0 ? "+" : ""}${pct.toFixed(1)}% of volume)`);
    } else {
      push("whale", 1.5, null, "no volume data");
    }
  } else {
    push("whale", 1.5, null, "no taker data");
  }

  // 8 — Fear & Greed: contrarian tại cực trị
  const fg = pulse?.fearGreed?.now.value ?? null;
  if (fg != null) {
    const lean = fg <= 20 ? 1 : fg <= 32 ? 0.5 : fg >= 80 ? -1 : fg >= 68 ? -0.5 : 0;
    push("feargreed", 1, lean, `F&G ${fg} ${pulse?.fearGreed?.now.label ?? ""} — contrarian at extremes (buy fear / fade greed)`);
  } else {
    push("feargreed", 1, null, "F&G unavailable");
  }

  // 9 — derivatives: funding cao + long chật chội → rủi ro xả
  const d = pulse?.derivatives ?? null;
  if (d) {
    let l = 0;
    const parts: string[] = [];
    if (d.fundingRatePct != null) {
      l += -clamp1((d.fundingRatePct - 0.01) / 0.03);
      parts.push(`funding ${d.fundingRatePct >= 0 ? "+" : ""}${d.fundingRatePct.toFixed(4)}%`);
    }
    if (d.longAccountPct != null) {
      l += d.longAccountPct >= 68 ? -0.5 : d.longAccountPct <= 45 ? 0.5 : 0;
      parts.push(`${d.longAccountPct.toFixed(0)}%L / ${(100 - d.longAccountPct).toFixed(0)}%S`);
    }
    push("derivs", 1, clamp1(l / 2), `crowding: ${parts.join(" · ")} — crowded longs pay funding, often precede flushes`);
  } else {
    push("derivs", 1, null, "derivatives unavailable");
  }

  // ── tổng phiếu ──
  let ws = 0;
  let acc = 0;
  for (const f of factors) {
    if (f.lean == null) continue;
    acc += f.lean * f.weight;
    ws += f.weight;
  }
  const score = ws > 0 ? Math.round((acc / ws) * 100) : 0;
  const band = Math.max(10, Math.min(45, pval("SESS_CALL_BAND", SESS_CALL_BAND)));
  return {
    score,
    call: score >= band ? "BULL" : score <= -band ? "BEAR" : "NEUTRAL",
    confidence: Math.abs(score),
    band,
    factors,
    targetSession: nx?.key ?? null,
    opensInMin: nx?.inMin ?? null,
    at: now,
  };
}

/** Bề mặt cho /api/view + session-broadcast: tự nạp daily sâu + market pulse. */
export async function buildSessionVerdict(inp: {
  symbol: string;
  klines: Kline[];
  sessStats: SessionStat[];
  whale: WhaleDelta | null;
  daily?: Kline[] | null;
}): Promise<SessionVerdict | null> {
  try {
    const [daily, pulse] = await Promise.all([
      inp.daily && inp.daily.length >= 60 ? Promise.resolve(inp.daily) : deepDaily("BTCUSDT"),
      getMarketPulse().catch(() => null),
    ]);
    return sessionVerdict({ now: Date.now(), klines: inp.klines, sessStats: inp.sessStats, whale: inp.whale, daily, pulse });
  } catch {
    return null; // fail-soft — panel vẫn hiển thị thống kê đơn như cũ
  }
}

/** 4 phiếu mạnh nhất theo |lean×w| — dùng cho tin Telegram gọn. */
export function topFactorLine(v: SessionVerdict): string {
  const arr = v.factors.filter((f) => f.lean != null && Math.abs(f.lean) >= 0.1);
  arr.sort((a, b) => Math.abs(b.lean! * b.weight) - Math.abs(a.lean! * a.weight));
  return arr
    .slice(0, 4)
    .map((f) => `${f.key} ${f.lean! > 0 ? "▲" : "▼"}${Math.abs(f.lean!).toFixed(1)}`)
    .join(" · ");
}
