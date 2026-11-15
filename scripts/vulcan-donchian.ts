// vulcan-donchian.ts — TypeScript port của strategy DonchianBreakout (VulcanTrader)
// Nguồn: user_data/strategies/DonchianBreakout.py (thuonghoi3-stack/VulcanTrader)
// Mục đích: chạy làm CHIẾN LƯỢC A trong app Elliot (sổ dry-run riêng, tag "A"),
// đối trọng với chiến lược Elliott hiện tại (tag "B"). ROE/fee tính ĐỒNG NHẤT
// theo công thức Elliot: roe = movePct × lev − FEE_PCT × lev × 2.

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
  atrPeriod: number; // 14 (cố định theo Rust bridge)
  atrStopMult: number; // 2.0 — stop = entry ∓ mult×ATR
  maxStopDistPct: number; // 5   — stop không rộng hơn −5% giá (tương đương stoploss -0.05)
  roiLadder: Array<{ afterMin: number; movePct: number }>; // bậc chốt lời theo % GIÁ
  trailTriggerPct: number; // 2.0 — kích hoạt trailing khi lãi ≥ 2% giá
  trailGivebackPct: number; // 1.0 — trailing giữ lại phần lãi, nhường tối đa 1%
  leverage: number; // 5   — chiến lược gốc trả min(5, max_leverage)
  feePctSide: number; // 0.05 — % mỗi bên, khớp FEE_PCT của Elliot
  cooldownBars: number; // 3   — [bổ sung chống ồn] nghỉ N nến sau khi đóng lệnh trước khi được vào mới
  minHoldBars: number; // 2   — [bổ sung chống ồn] tín hiệu thoát (mid/rsi) chỉ áp dụng sau N nến; stop/ROI/trailing luôn active
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

// ── Chỉ báo (Wilder, khớp fast_indicators của Rust bridge) ──────────────────

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

// Tín hiệu vào lệnh trên nến ĐÓNG thứ i (i dùng band của nến i−1 như shift(1) gốc)
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
  reason: string; // stop | roi | trail | mid_exit | rsi_exit | end
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
  stop: number; // mức giá
  peak: number; // giá tốt nhất đạt được (cho trailing)
  trailArmed: boolean;
}

function exitRoe(pos: OpenPos, exitPrice: number, p: VulcanParams): { movePct: number; roePct: number } {
  const raw = pos.side === "LONG" ? (exitPrice - pos.entry) / pos.entry : (pos.entry - exitPrice) / pos.entry;
  const movePct = raw * 100;
  const feeRoe = p.feePctSide * p.leverage * 2;
  const roePct = Math.round((movePct * p.leverage - feeRoe) * 100) / 100;
  return { movePct: Math.round(movePct * 100) / 100, roePct };
}

// Backtest đơn giản trên chuỗi nến 15m đóng. Vào lệnh tại close của nến tín hiệu
// (khớp cách engine Elliot vào lệnh market khi thấy tín hiệu), thoát theo thứ tự:
// 1) stop chạm trong nến (gap thì khớp open), 2) ROI ladder theo phút, 3) trailing,
// 4) tín hiệu thoát (mid-channel / RSI cực đoan).
export function backtestDonchian(symbol: string, c: Candle[], params?: Partial<VulcanParams>): BacktestResult {
  const p: VulcanParams = { ...VULCAN_DEFAULTS, ...params };
  const ind = computeIndicators(c, p);
  const trades: VulcanTrade[] = [];
  let pos: OpenPos | null = null;
  let cooldownUntil = -1; // index nến: sau khi đóng lệnh, nghỉ cooldownBars nến

  const closePos = (i: number, price: number, reason: string) => {
    if (!pos) return;
    const { movePct, roePct } = exitRoe(pos, price, p);
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
    cooldownUntil = i + p.cooldownBars; // nghỉ vài nến sau MỌI lần thoát để tránh re-entry ồn
  };

  for (let i = p.donPeriod + 1; i < c.length; i++) {
    const bar = c[i];

    if (pos) {
      // 1) Stop theo giá (đã neo tại entry ∓ mult×ATR, có thể bị trailing siết)
      if (pos.side === "LONG" && bar.l <= pos.stop) {
        closePos(i, Math.min(bar.o, pos.stop), "stop");
      } else if (pos.side === "SHORT" && bar.h >= pos.stop) {
        closePos(i, Math.max(bar.o, pos.stop), "stop");
      }
      if (!pos) continue;

      const movePct = pos.side === "LONG" ? ((bar.c - pos.entry) / pos.entry) * 100 : ((pos.entry - bar.c) / pos.entry) * 100;
      const heldMin = (bar.t - pos.entryT) / 60000;

      // 2) Trailing: cập nhật đỉnh, arm khi đủ trigger, siết stop theo giveback
      if (pos.side === "LONG" && bar.h > pos.peak) pos.peak = bar.h;
      if (pos.side === "SHORT" && (pos.peak === 0 || bar.l < pos.peak)) pos.peak = bar.l;
      if (!pos.trailArmed && movePct >= p.trailTriggerPct) pos.trailArmed = true;
      if (pos.trailArmed) {
        if (pos.side === "LONG") {
          const trailStop = pos.peak * (1 - p.trailGivebackPct / 100);
          if (trailStop > pos.stop) pos.stop = trailStop;
        } else {
          const trailStop = pos.peak * (1 + p.trailGivebackPct / 100);
          if (trailStop < pos.stop) pos.stop = trailStop;
        }
      }

      // 3) ROI ladder theo % GIÁ và số phút nắm giữ (nến 15m khớp mốc 60/180/360)
      let roiHit = false;
      for (let k = p.roiLadder.length - 1; k >= 0; k--) {
        if (heldMin >= p.roiLadder[k].afterMin && movePct >= p.roiLadder[k].movePct) {
          closePos(i, bar.c, `roi_${p.roiLadder[k].movePct}pct`);
          roiHit = true;
          break;
        }
      }
      if (roiHit) continue;

      // 4) Tín hiệu thoát theo chiến lược gốc (chỉ sau minHoldBars nến để tránh RSI vọt ngay lúc breakout)
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

    // Vào lệnh mới nếu đang trống và hết cooldown (một vị thế mỗi symbol — khớp gốc)
    if (!pos && i > cooldownUntil) {
      const sig = entrySignalAt(c, ind, i, p);
      if (sig) {
        const entry = bar.c;
        const atr = ind.atr[i];
        let distPct = atr > 0 ? ((p.atrStopMult * atr) / entry) * 100 : p.maxStopDistPct;
        if (distPct > p.maxStopDistPct) distPct = p.maxStopDistPct; // cap −5% giá như stoploss gốc
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
  netRoe: number;
  bySide: Array<{ side: string; n: number; wr: number; net: number }>;
} {
  const wins = trades.filter((t) => t.roePct > 0);
  const losses = trades.filter((t) => t.roePct <= 0);
  const avgWin = wins.length ? wins.reduce((s, t) => s + t.roePct, 0) / wins.length : 0;
  const avgLoss = losses.length ? losses.reduce((s, t) => s + t.roePct, 0) / losses.length : 0;
  const netRoe = trades.reduce((s, t) => s + t.roePct, 0);
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
    netRoe: Math.round(netRoe * 100) / 100,
    bySide,
  };
}
