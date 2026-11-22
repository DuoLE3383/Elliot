// vulcan.ts — CHIẾN LƯỢC A: port TypeScript của DonchianBreakout (VulcanTrader)
// Nguồn: user_data/strategies/DonchianBreakout.py (thuonghoi3-stack/VulcanTrader)
// Vai trò trong app: engine A chạy sổ dry-run riêng (bảng VulcanBook), đối trọng
// với chiến lược Elliott hiện tại (sổ B, bảng AutoTrade). ROI/fee tính ĐỒNG
// NHẤT theo công thức Elliot: roi = movePct × lev − FEE_PCT × lev × 2.
// Hai lớp chống ồn Thêm so với gốc (khai báo rõ, chỉnh được): cooldownBars
// (nghỉ N nến sau MỌI lần thoát) và minHoldBars (tín hiệu thoát mid/rsi chỉ
// áp dụng sau N nến — stop/ROI/trailing luôn active).

export interface Candle {
  t: number; // open time (ms)
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface VulcanParams {
  donPeriod: number; // 20  — chu kỳ kênh Donchian
  rsiLongMin: number; // 50  — LONG cần RSI > ngưỡng
  rsiShortMax: number; // 50  — SHORT cần RSI < ngưỡng
  rsiOverbought: number; // 70  — thoát LONG khi RSI vượt
  rsiOversold: number; // 30  — thoát SHORT khi RSI dưới
  volFactor: number; // 1.5 — volume phải ≥ volMA20 × hệ số
  volMaPeriod: number; // 20
  atrPeriod: number; // 14 (cố định theo Rust bridge gốc)
  atrStopMult: number; // 2.0 — stop = entry ∓ mult×ATR
  maxStopDistPct: number; // 5   — stop không rộng hơn −5% giá (tương đương stoploss gốc −0.05)
  roiLadder: Array<{ afterMin: number; movePct: number }>; // bậc chốt lời theo % GIÁ
  trailTriggerPct: number; // 2.0 — kích hoạt trailing khi lãi ≥ 2% giá
  trailGivebackPct: number; // 1.0 — trailing giữ lại phần lãi, nhường tối đa 1%
  leverage: number; // 5   — chiến lược gốc trả min(5, max_leverage)
  feePctSide: number; // 0.05 — % mỗi bên, khớp FEE_PCT của Elliot
  cooldownBars: number; // 3   — [chống ồn] nghỉ N nến sau khi đóng lệnh
  minHoldBars: number; // 2   — [chống ồn] thoát tín hiệu chỉ sau N nến
}

export const VULCAN_DEFAULTS: VulcanParams = {
  donPeriod: 20,
  rsiLongMin: 50,
  rsiShortMax: 50,
  rsiOverbought: 70,
  rsiOversold: 30,
  volFactor: 1.5,
  volMaPeriod: 20,
  atrPeriod: 14,
  atrStopMult: 2.0,
  maxStopDistPct: 5,
  roiLadder: [
    { afterMin: 0, movePct: 8 },
    { afterMin: 60, movePct: 5 },
    { afterMin: 180, movePct: 3 },
    { afterMin: 360, movePct: 1 },
  ],
  trailTriggerPct: 2,
  trailGivebackPct: 1,
  leverage: 5,
  feePctSide: 0.05,
  cooldownBars: 3,
  minHoldBars: 2,
};

// ── Chỉ báo (Wilder, khớp fast_indicators của Rust bridge gốc) ───────────────

export function rsiWilder(closes: number[], period = 14): number[] {
  const n = closes.length;
  const out = new Array<number>(n).fill(NaN);
  if (n <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gain += d;
    else loss -= d;
  }
  let ag = gain / period;
  let al = loss / period;
  out[period] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  for (let i = period + 1; i < n; i++) {
    const d = closes[i] - closes[i - 1];
    ag = (ag * (period - 1) + (d > 0 ? d : 0)) / period;
    al = (al * (period - 1) + (d < 0 ? -d : 0)) / period;
    out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  }
  return out;
}

export function atrWilder(c: Candle[], period = 14): number[] {
  const n = c.length;
  const out = new Array<number>(n).fill(NaN);
  if (n <= period) return out;
  const tr: number[] = [0];
  for (let i = 1; i < n; i++) {
    tr.push(Math.max(c[i].h - c[i].l, Math.abs(c[i].h - c[i - 1].c), Math.abs(c[i].l - c[i - 1].c)));
  }
  let sum = 0;
  for (let i = 1; i <= period; i++) sum += tr[i];
  let atr = sum / period;
  out[period] = atr;
  for (let i = period + 1; i < n; i++) {
    atr = (atr * (period - 1) + tr[i]) / period;
    out[i] = atr;
  }
  return out;
}

function rollingMax(x: number[], p: number): number[] {
  const out = new Array<number>(x.length).fill(NaN);
  for (let i = p - 1; i < x.length; i++) {
    let m = -Infinity;
    for (let j = i - p + 1; j <= i; j++) if (x[j] > m) m = x[j];
    out[i] = m;
  }
  return out;
}

function rollingMin(x: number[], p: number): number[] {
  const out = new Array<number>(x.length).fill(NaN);
  for (let i = p - 1; i < x.length; i++) {
    let m = Infinity;
    for (let j = i - p + 1; j <= i; j++) if (x[j] < m) m = x[j];
    out[i] = m;
  }
  return out;
}

function rollingMean(x: number[], p: number): number[] {
  const out = new Array<number>(x.length).fill(NaN);
  for (let i = p - 1; i < x.length; i++) {
    let s = 0;
    for (let j = i - p + 1; j <= i; j++) s += x[j];
    out[i] = s / p;
  }
  return out;
}

export interface VulcanIndicators {
  rsi: number[];
  atr: number[];
  donUpper: number[];
  donLower: number[];
  donMid: number[];
  volRatio: number[];
}

export function computeIndicators(c: Candle[], p: VulcanParams): VulcanIndicators {
  const closes = c.map((x) => x.c);
  const highs = c.map((x) => x.h);
  const lows = c.map((x) => x.l);
  const vols = c.map((x) => x.v);
  const donUpper = rollingMax(highs, p.donPeriod);
  const donLower = rollingMin(lows, p.donPeriod);
  const donMid = donUpper.map((u, i) => (u + donLower[i]) / 2);
  const volMa = rollingMean(vols, p.volMaPeriod);
  const volRatio = vols.map((v, i) => (volMa[i] > 0 ? v / volMa[i] : 1));
  return { rsi: rsiWilder(closes, p.atrPeriod), atr: atrWilder(c, p.atrPeriod), donUpper, donLower, donMid, volRatio };
}

/** Tín hiệu vào lệnh trên nến đóng thứ i (band lấy từ nến i−1 như shift(1) gốc). */
export function entrySignalAt(c: Candle[], ind: VulcanIndicators, i: number, p: VulcanParams): "LONG" | "SHORT" | null {
  if (i < p.donPeriod + 1 || i < p.volMaPeriod || i <= p.atrPeriod) return null;
  const volOk = ind.volRatio[i] >= p.volFactor && c[i].v > 0;
  if (!volOk) return null;
  if (c[i].c > ind.donUpper[i - 1] && ind.rsi[i] > p.rsiLongMin) return "LONG";
  if (c[i].c < ind.donLower[i - 1] && ind.rsi[i] < p.rsiShortMax) return "SHORT";
  return null;
}

export interface VulcanTrade {
  symbol: string;
  side: "LONG" | "SHORT";
  entryT: number;
  exitT: number;
  entry: number;
  exit: number;
  movePct: number; // % giá (dương = đúng hướng)
  roePct: number; // movePct × lev − fee round-trip
  bars: number;
  reason: string; // stop | roi_* | trail | mid_exit | rsi_exit | end
}

export interface BacktestResult {
  trades: VulcanTrade[];
  indicators: VulcanIndicators;
}

interface OpenPos {
  side: "LONG" | "SHORT";
  entry: number;
  entryIdx: number;
  entryT: number;
  stop: number;
  peak: number;
  trailArmed: boolean;
}

function exitRoi(pos: OpenPos, exitPrice: number, p: VulcanParams): { movePct: number; roePct: number } {
  const raw = pos.side === "LONG" ? (exitPrice - pos.entry) / pos.entry : (pos.entry - exitPrice) / pos.entry;
  const movePct = raw * 100;
  const feeRoi = p.feePctSide * p.leverage * 2;
  const roePct = Math.round((movePct * p.leverage - feeRoi) * 100) / 100;
  return { movePct: Math.round(movePct * 100) / 100, roePct };
}

/** Backtest đơn giản trên chuỗi nến đóng — dùng cho smoke test + so tinh engine live. */
export function backtestDonchian(symbol: string, c: Candle[], params?: Partial<VulcanParams>): BacktestResult {
  const p: VulcanParams = { ...VULCAN_DEFAULTS, ...params };
  const ind = computeIndicators(c, p);
  const trades: VulcanTrade[] = [];
  let pos: OpenPos | null = null;
  let cooldownUntil = -1;

  const closePos = (i: number, price: number, reason: string) => {
    if (!pos) return;
    const { movePct, roePct } = exitRoi(pos, price, p);
    trades.push({
      symbol,
      side: pos.side,
      entryT: pos.entryT,
      exitT: c[i].t,
      entry: pos.entry,
      exit: price,
      movePct,
      roePct,
      bars: i - pos.entryIdx,
      reason,
    });
    pos = null;
    cooldownUntil = i + p.cooldownBars;
  };

  for (let i = p.donPeriod + 1; i < c.length; i++) {
    const bar = c[i];
    if (pos) {
      if (pos.side === "LONG" && bar.l <= pos.stop) closePos(i, Math.min(bar.o, pos.stop), "stop");
      else if (pos.side === "SHORT" && bar.h >= pos.stop) closePos(i, Math.max(bar.o, pos.stop), "stop");
      if (!pos) continue;
      const movePct = pos.side === "LONG" ? ((bar.c - pos.entry) / pos.entry) * 100 : ((pos.entry - bar.c) / pos.entry) * 100;
      const heldMin = (bar.t - pos.entryT) / 60000;
      if (pos.side === "LONG" && bar.h > pos.peak) pos.peak = bar.h;
      if (pos.side === "SHORT" && (pos.peak === 0 || bar.l < pos.peak)) pos.peak = bar.l;
      // spec #1+#2+#3 — arm 3% ROI, lock 2% ROI, trail gap 1% ROI
      const peakMovePct = pos.side === "LONG"
        ? ((pos.peak - pos.entry) / pos.entry) * 100
        : ((pos.entry - pos.peak) / pos.entry) * 100;
      const peakRoi = peakMovePct * VULCAN_DEFAULTS.leverage;
      if (!pos.trailArmed && peakRoi >= 3) pos.trailArmed = true;
      if (pos.trailArmed) {
        const stopRoi = Math.max(peakRoi - 1, 2);
        const stopMovePct = stopRoi / VULCAN_DEFAULTS.leverage;
        const ts = pos.side === "LONG"
          ? pos.entry * (1 + stopMovePct / 100)
          : pos.entry * (1 - stopMovePct / 100);
        if (pos.side === "LONG" && ts > pos.stop) pos.stop = ts;
        if (pos.side === "SHORT" && ts < pos.stop) pos.stop = ts;
      }
      let roiHit = false;
      for (let k = p.roiLadder.length - 1; k >= 0; k--) {
        if (heldMin >= p.roiLadder[k].afterMin && movePct >= p.roiLadder[k].movePct) {
          closePos(i, bar.c, `roi_${p.roiLadder[k].movePct}pct`);
          roiHit = true;
          break;
        }
      }
      if (roiHit) continue;
      if (i - pos.entryIdx >= p.minHoldBars) {
        if (pos.side === "LONG" && (bar.c < ind.donMid[i] || ind.rsi[i] > p.rsiOverbought)) {
          closePos(i, bar.c, ind.rsi[i] > p.rsiOverbought ? "rsi_exit" : "mid_exit");
          continue;
        }
        if (pos.side === "SHORT" && (bar.c > ind.donMid[i] || ind.rsi[i] < p.rsiOversold)) {
          closePos(i, bar.c, ind.rsi[i] < p.rsiOversold ? "rsi_exit" : "mid_exit");
          continue;
        }
      }
    }
    if (!pos && i > cooldownUntil) {
      const sig = entrySignalAt(c, ind, i, p);
      if (sig) {
        const entry = bar.c;
        const atr = ind.atr[i];
        let distPct = atr > 0 ? ((p.atrStopMult * atr) / entry) * 100 : p.maxStopDistPct;
        if (distPct > p.maxStopDistPct) distPct = p.maxStopDistPct;
        const stop = sig === "LONG" ? entry * (1 - distPct / 100) : entry * (1 + distPct / 100);
        pos = { side: sig, entry, entryIdx: i, entryT: bar.t, stop, peak: sig === "LONG" ? bar.h : bar.l, trailArmed: false };
      }
    }
  }
  return { trades, indicators: ind };
}

export function summarize(trades: VulcanTrade[]): {
  n: number;
  wins: number;
  wr: number;
  avgWin: number;
  avgLoss: number;
  payoff: number;
  netRoi: number;
  bySide: Array<{ side: string; n: number; wr: number; net: number }>;
} {
  const wins = trades.filter((t) => t.roePct > 0);
  const losses = trades.filter((t) => t.roePct <= 0);
  const avgWin = wins.length ? wins.reduce((s, t) => s + t.roePct, 0) / wins.length : 0;
  const avgLoss = losses.length ? losses.reduce((s, t) => s + t.roePct, 0) / losses.length : 0;
  const netRoi = trades.reduce((s, t) => s + t.roePct, 0);
  const bySide = (["LONG", "SHORT"] as const).map((side) => {
    const ts = trades.filter((t) => t.side === side);
    const w = ts.filter((t) => t.roePct > 0);
    return { side, n: ts.length, wr: ts.length ? (w.length / ts.length) * 100 : 0, net: ts.reduce((s, t) => s + t.roePct, 0) };
  });
  return {
    n: trades.length,
    wins: wins.length,
    wr: trades.length ? (wins.length / trades.length) * 100 : 0,
    avgWin: Math.round(avgWin * 100) / 100,
    avgLoss: Math.round(avgLoss * 100) / 100,
    payoff: avgLoss !== 0 ? Math.abs(avgWin / avgLoss) : 0,
    netRoi: Math.round(netRoi * 100) / 100,
    bySide,
  };
}
