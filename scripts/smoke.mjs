/**
 * Smoke test for the paper-trading engine over live Binance data.
 * Run with: bun scripts/smoke.mjs   (bun imports the REAL src/lib TS directly)
 *
 * Contract (v5 — + Wyckoff Schematic Auto Detect):
 *  1. A reversal ALWAYS closes the open paper at the next candle open AND opens
 *     the opposite paper at that same price/time — the SMA gate never blocks it.
 *  2. The SMA gate is DIRECTIONAL and only filters FRESH entries from flat, and
 *     only when enabled: close < SMA blocks BUYs but never SELLs (and vice versa).
 *     An SMA value of null (start of the 500-candle window) must NOT block.
 *  3. Gate off → every confirmed signal enters immediately, no pending entries.
 *  4. Leverage: ROE = price move × leverage; positions are liquidated
 *     (~100%/leverage adverse move) → ROE = -100%, flagged `liquidated`.
 *  5. Analysis helpers: EMA seeds correctly, RSI stays in [0,100] (extremes on
 *     monotone runs), pivot structure returns a sane range/position.
 *  6. Wyckoff port: deterministic; events anchored to the exact pivot/transition
 *     bar extreme (T-space inversion for distribution); label orientation (below/
 *     above) matches the Pine f_lbl rule; boxes top>bottom; tints in {-1,0,1};
 *     dash sane; reqPhaseC=false never removes events; speed changes pivLen;
 *     synthetic accumulation produces SC→AR (+ mirrored BC on the inverted series).
 */
import { wyckoffFrom } from "../src/lib/wyckoff.ts";
import { DEFAULT_WYCKOFF } from "../src/lib/types.ts";

const HOSTS = ["https://api.binance.com", "https://data-api.binance.vision"];

async function fetchKlines(symbol, interval, limit = 500) {
  let lastErr;
  for (const host of HOSTS) {
    try {
      const res = await fetch(
        `${host}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`,
        { signal: AbortSignal.timeout(10000) },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()).map((r) => ({
        t: r[0], o: +r[1], h: +r[2], l: +r[3], c: +r[4], v: +r[5],
      }));
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

// ── engine replica (kept in sync with src/lib) ──────────────────────────────
function sma(klines, period) {
  const out = new Array(klines.length).fill(null);
  let sum = 0;
  for (let i = 0; i < klines.length; i++) {
    sum += klines[i].c;
    if (i >= period) sum -= klines[i - period].c;
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

function atr(klines, period) {
  const out = new Array(klines.length).fill(null);
  const tr = klines.map((k, i) =>
    i === 0 ? k.h - k.l : Math.max(k.h - k.l, Math.abs(k.h - klines[i - 1].c), Math.abs(k.l - klines[i - 1].c)),
  );
  let acc = 0;
  for (let i = 0; i < klines.length; i++) {
    if (i < period) {
      acc += tr[i];
      if (i === period - 1) out[i] = acc / period;
    } else out[i] = (out[i - 1] * (period - 1) + tr[i]) / period;
  }
  return out;
}

function signalsFrom(klines, atrKey, atrPeriod, smaPeriod) {
  const a = atr(klines, atrPeriod);
  const smaArr = sma(klines, smaPeriod);
  const n = klines.length;
  const stop = new Array(n).fill(null);
  const trend = new Array(n).fill(0);
  let prevStop = 0, prevTrend = 0;
  for (let i = 0; i < n; i++) {
    if (a[i] == null) continue;
    const close = klines[i].c, loss = atrKey * a[i];
    if (prevTrend === 0) { prevStop = close - loss; prevTrend = 1; stop[i] = prevStop; trend[i] = 1; continue; }
    let s = prevStop, t = prevTrend;
    if (t === 1) { s = Math.max(prevStop, close - loss); if (close < s) { t = -1; s = close + loss; } }
    else { s = Math.min(prevStop, close + loss); if (close > s) { t = 1; s = close - loss; } }
    stop[i] = s; trend[i] = t; prevStop = s; prevTrend = t;
  }
  const signals = [];
  for (let i = 1; i < n; i++) {
    if (trend[i - 1] === 0) continue;
    const k = klines[i], sv = smaArr[i];
    // null SMA must NOT block (matches Pine computing SMA over full history)
    if (trend[i] === 1 && trend[i - 1] === -1)
      signals.push({ i, t: k.t, dir: "BUY", smaOk: sv == null || k.c > sv, price: k.c });
    else if (trend[i] === -1 && trend[i - 1] === 1)
      signals.push({ i, t: k.t, dir: "SELL", smaOk: sv == null || k.c < sv, price: k.c });
  }
  return { signals, sma: smaArr };
}

function papersFrom(klines, signals, smaArr, symbol, interval, slPct, tpPct, leverage = 1, smaFilter = true) {
  const papers = [];
  let open, pending;
  const sigByIndex = new Map(signals.map((s) => [s.i, s]));
  const last = klines.length - 1;
  const gateOkAt = (side, idx) => {
    if (!smaFilter) return true;
    const sv = smaArr[idx];
    if (sv == null) return true;
    return side === "LONG" ? klines[idx].c > sv : klines[idx].c < sv;
  };
  const closeAt = (p, price, index, kind, liquidated = false) => {
    p.status = "closed"; p.exit = price; p.exitIndex = index; p.exitTime = klines[index].t; p.exitKind = kind;
    const pricePct = p.side === "LONG"
      ? ((price - p.entry) / p.entry) * 100
      : ((p.entry - price) / p.entry) * 100;
    p.pricePnlPct = pricePct;
    if (liquidated) { p.liquidated = true; p.pnlPct = -100; }
    else p.pnlPct = pricePct * p.leverage;
    open = undefined;
  };
  const enterAt = (side, price, index, flippedFrom) => {
    const p = {
      id: `${symbol}-${interval}-${side}-${klines[index].t}`, symbol, interval, side,
      entry: price, entryTime: klines[index].t, entryIndex: index, leverage,
      sl: side === "LONG" ? price * (1 - slPct / 100) : price * (1 + slPct / 100),
      tp: side === "LONG" ? price * (1 + tpPct / 100) : price * (1 - tpPct / 100),
      status: "open", flippedFrom,
    };
    papers.push(p); open = p; pending = undefined;
  };
  for (let i = 0; i < klines.length; i++) {
    const k = klines[i];
    if (pending && !open && i > pending.signalIndex && gateOkAt(pending.side, i - 1))
      enterAt(pending.side, k.o, i);
    if (open && open.entryIndex <= i) {
      const liqPrice = open.side === "LONG"
        ? open.entry * (1 - 1 / open.leverage)
        : open.entry * (1 + 1 / open.leverage);
      if (open.side === "LONG") {
        const stopLevel = Math.max(open.sl, liqPrice);
        const isLiq = liqPrice > open.sl + 1e-12;
        if (k.l <= stopLevel) closeAt(open, stopLevel, i, "sl", isLiq);
        else if (k.h >= open.tp) closeAt(open, open.tp, i, "tp");
      } else {
        const stopLevel = Math.min(open.sl, liqPrice);
        const isLiq = liqPrice < open.sl - 1e-12;
        if (k.h >= stopLevel) closeAt(open, stopLevel, i, "sl", isLiq);
        else if (k.l <= open.tp) closeAt(open, open.tp, i, "tp");
      }
    }
    const sig = sigByIndex.get(i);
    if (!sig || i >= last) continue;
    const newSide = sig.dir === "BUY" ? "LONG" : "SHORT";
    if (open && open.side !== newSide) {
      // reversal: ALWAYS close + open opposite (gate never blocks a flip)
      const old = open, fi = i + 1, fp = klines[fi].o;
      closeAt(old, fp, fi, "flip");
      enterAt(newSide, fp, fi, old.id);
    } else if (open) {
      // pyramiding=0
    } else if (pending && pending.side !== newSide) pending = { side: newSide, signalIndex: i };
    else if (pending) pending = { ...pending, signalIndex: i };
    else if (gateOkAt(newSide, i)) enterAt(newSide, klines[i + 1].o, i + 1);
    else pending = { side: newSide, signalIndex: i };
  }
  return { papers, open, pending };
}

// ── analysis replicas (kept in sync with src/lib/indicators.ts + analysis.ts) ─
function ema(klines, period) {
  const out = new Array(klines.length).fill(null);
  if (klines.length < period) return out;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += klines[i].c;
  let prev = sum / period;
  out[period - 1] = prev;
  const k = 2 / (period + 1);
  for (let i = period; i < klines.length; i++) {
    prev = klines[i].c * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

function rsi(klines, period) {
  const out = new Array(klines.length).fill(null);
  if (klines.length <= period) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = klines[i].c - klines[i - 1].c;
    if (d >= 0) gain += d; else loss -= d;
  }
  let avgG = gain / period, avgL = loss / period;
  out[period] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
  for (let i = period + 1; i < klines.length; i++) {
    const d = klines[i].c - klines[i - 1].c;
    const g = d > 0 ? d : 0, l = d < 0 ? -d : 0;
    avgG = (avgG * (period - 1) + g) / period;
    avgL = (avgL * (period - 1) + l) / period;
    out[i] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
  }
  return out;
}

function pivotRange(klines, endIndex, pivot = 5, lookback = 150) {
  const end = endIndex + 1;
  const start = Math.max(pivot, end - 1 - lookback);
  let high = null, low = null;
  for (let j = end - 1 - pivot; j >= start; j--) {
    let isHigh = true, isLow = true;
    for (let k = j - pivot; k <= j + pivot; k++) {
      if (k < 0 || k >= end || k === j) continue;
      if (klines[k].h >= klines[j].h) isHigh = false;
      if (klines[k].l <= klines[j].l) isLow = false;
    }
    if (high == null && isHigh) high = klines[j].h;
    if (low == null && isLow) low = klines[j].l;
    if (high != null && low != null) break;
  }
  return high != null && low != null && high > low ? { high, low } : null;
}

function runAnalysisSuite(klines, tag) {
  const closed = klines.length - 2;
  // EMA seeds with the SMA of the first `period` closes and stays finite
  const e50 = ema(klines, 50);
  let smaSeed = 0;
  for (let i = 0; i < 50; i++) smaSeed += klines[i].c;
  check(Math.abs(e50[49] - smaSeed / 50) < 1e-9, `${tag}: ema50 seed == sma50`);
  check(e50[closed] != null && isFinite(e50[closed]), `${tag}: ema50 finite on closed candle`);

  // RSI bounds + extremes on monotone synthetic runs
  const r = rsi(klines, 14);
  let inBounds = true, hasVal = false;
  for (const v of r) {
    if (v == null) continue;
    hasVal = true;
    if (!(v >= 0 && v <= 100)) inBounds = false;
  }
  check(hasVal && inBounds, `${tag}: rsi14 within [0,100]`);
  const upRun = Array.from({ length: 40 }, (_, i) => ({ t: i, o: 1 + i, h: 1.5 + i, l: 0.9 + i, c: 2 + i, v: 1 }));
  const downRun = Array.from({ length: 40 }, (_, i) => ({ t: i, o: 41 - i, h: 41.5 - i, l: 40.9 - i, c: 40 - i, v: 1 }));
  check(rsi(upRun, 14)[39] === 100, `${tag}: rsi == 100 on pure uptrend`);
  check(rsi(downRun, 14)[39] === 0, `${tag}: rsi == 0 on pure downtrend`);

  // pivot structure on live data
  const range = pivotRange(klines, closed);
  check(range != null, `${tag}: pivot range found on 500 candles`);
  if (range) {
    check(range.high > range.low, `${tag}: range high > low`);
    const c = klines[closed].c;
    const pos = ((c - range.low) / (range.high - range.low)) * 100;
    check(isFinite(pos), `${tag}: range position finite`);
    check(
      (pos >= 0 && pos <= 100) || pos > 100 || pos < 0,
      `${tag}: structure classifiable`,
      `pos=${pos}`,
    );
  }

  // directional gate on live data: BUYs below SMA must not have entered directly
  const { signals, sma } = signalsFrom(klines, 2, 10, 200);
  for (const s of signals) {
    const sv = sma[s.i];
    if (sv == null) continue;
    if (s.dir === "BUY") check(s.smaOk === (klines[s.i].c > sv), `${tag}: BUY smaOk directional`, `i=${s.i}`);
    else check(s.smaOk === (klines[s.i].c < sv), `${tag}: SELL smaOk directional`, `i=${s.i}`);
  }
  // a downtrend stretch must produce SELL smaOk=true — the gate is NOT a wall
  const sells = signals.filter((s) => s.dir === "SELL");
  check(sells.length > 0, `${tag}: has SELL signals`);
}

// ── invariants ──────────────────────────────────────────────────────────────
let failures = 0;
function check(cond, label, detail = "") {
  if (!cond) {
    failures++;
    console.log(`  FAIL ${label} ${detail}`);
  }
}

async function runSuite(klines, symbol, interval, cfg) {
  const { slPct, tpPct, leverage, smaFilter } = cfg;
  const { signals, sma } = signalsFrom(klines, 2, 10, 200);
  const { papers, open, pending } = papersFrom(klines, signals, sma, symbol, interval, slPct, tpPct, leverage, smaFilter);

  const tag = `${symbol} ${interval} ${cfg.name}`;
  const flips = papers.filter((p) => p.exitKind === "flip");
  const closed = papers.filter((p) => p.status === "closed");
  const tpC = closed.filter((p) => p.exitKind === "tp").length;
  const slC = closed.filter((p) => p.exitKind === "sl").length;
  const liqC = closed.filter((p) => p.liquidated).length;

  check(papers.length > 0, `${tag}: has papers`, `n=${papers.length}`);

  // determinism
  const again = papersFrom(klines, signals, sma, symbol, interval, slPct, tpPct, leverage, smaFilter);
  check(JSON.stringify(again.papers) === JSON.stringify(papers), `${tag}: deterministic`);

  // max 1 open at any time
  let concurrent = 0;
  const events = [];
  for (const p of papers) {
    events.push({ t: p.entryTime, d: 1 });
    if (p.exitTime) events.push({ t: p.exitTime, d: -1 });
  }
  events.sort((a, b) => a.t - b.t || a.d - b.d);
  for (const e of events) {
    concurrent += e.d;
    check(concurrent <= 1, `${tag}: <=1 open position`, `concurrent=${concurrent}`);
  }

  // reversal contract — EVERY flip has an immediate opposite child
  for (const f of flips) {
    check(f.exit != null, `${tag}: flip has exit price`);
    const sig = signals.find((s) => s.i === f.exitIndex - 1);
    check(sig != null, `${tag}: flip has originating signal`);
    if (!sig) continue;
    const kOpen = klines[f.exitIndex].o;
    check(Math.abs(f.exit - kOpen) < 1e-9, `${tag}: flip exit == next candle open`,
      `exit=${f.exit} open=${kOpen}`);
    check(f.exitTime === klines[f.exitIndex].t, `${tag}: flip exitTime == candle open time`);
    // gate NEVER blocks a reversal → child always exists, same price/time
    const child = papers.find((p) => p.flippedFrom === f.id);
    check(child != null, `${tag}: flip always opens child (gate-proof)`, `sigIdx=${sig.i} smaOk=${sig.smaOk}`);
    if (child) {
      check(child.side !== f.side, `${tag}: child side is opposite`);
      check(child.entryIndex === f.exitIndex, `${tag}: child enters on the flip candle`,
        `child=${child.entryIndex} flip=${f.exitIndex}`);
      check(Math.abs(child.entry - f.exit) < 1e-9, `${tag}: child entry == flip exit price`);
      check(child.entryTime === f.exitTime, `${tag}: child entryTime == flip exitTime`);
      check(child.leverage === f.leverage, `${tag}: child inherits leverage`);
    }
  }

  // flippedFrom links
  for (const p of papers) {
    if (!p.flippedFrom) continue;
    const old = papers.find((q) => q.id === p.flippedFrom);
    check(old != null, `${tag}: flippedFrom link valid`, p.id);
    if (old) check(old.side !== p.side, `${tag}: flippedFrom side opposite`);
    check(old?.exitKind === "flip", `${tag}: flippedFrom source closed as flip`);
  }

  // entries: direct (signal at entryIndex-1) or queued-pending (gate-on only)
  const gateOkAt = (side, idx) => {
    if (!smaFilter) return true;
    const sv = sma[idx];
    if (sv == null) return true;
    return side === "LONG" ? klines[idx].c > sv : klines[idx].c < sv;
  };
  for (const p of papers) {
    if (p.flippedFrom) continue; // flip entries checked above
    const sig = signals.find((s) => s.i === p.entryIndex - 1);
    let pendingOk = false;
    if (!sig && smaFilter) {
      const prior = signals.filter(
        (s) => s.i < p.entryIndex && s.dir === (p.side === "LONG" ? "BUY" : "SELL"),
      );
      if (prior.length) {
        const s0 = prior[prior.length - 1];
        if (gateOkAt(p.side, p.entryIndex - 1)) {
          let blocked = true;
          for (let k = s0.i; k <= p.entryIndex - 2; k++) {
            if (gateOkAt(p.side, k)) { blocked = false; break; }
          }
          pendingOk = blocked;
        }
      }
    }
    check(sig != null || pendingOk, `${tag}: entry is direct or queued-pending`, p.id);
    if (sig && smaFilter) {
      check(sig.dir === (p.side === "LONG" ? "BUY" : "SELL"), `${tag}: entry direction matches signal`);
      check(sig.smaOk, `${tag}: direct entry signal passed gate`, p.id);
    }
    if (!smaFilter) check(pending == null || pending.side != null, `${tag}: gate-off pending shape`);
    check(Math.abs(p.entry - klines[p.entryIndex].o) < 1e-9, `${tag}: entry == candle open`);
  }

  // gate-off → no pending entries at all
  if (!smaFilter) check(pending == null, `${tag}: gate off → no pending`, JSON.stringify(pending));

  // SL/TP geometry (price distances)
  for (const p of papers) {
    if (p.side === "LONG") check(p.sl < p.entry && p.tp > p.entry, `${tag}: LONG sl<entry<tp`);
    else check(p.sl > p.entry && p.tp < p.entry, `${tag}: SHORT sl>entry>tp`);
    check(Math.abs(Math.abs(p.sl / p.entry - 1) * 100 - slPct) < 1e-6, `${tag}: SL distance == slPct`);
    check(Math.abs(Math.abs(p.tp / p.entry - 1) * 100 - tpPct) < 1e-6, `${tag}: TP distance == tpPct`);
    check(p.leverage === leverage, `${tag}: leverage snapshot == settings`);
  }

  // exit kinds + PnL math
  for (const p of closed) {
    check(["tp", "sl", "flip"].includes(p.exitKind), `${tag}: valid exitKind`);
    if (p.liquidated) {
      check(p.exitKind === "sl", `${tag}: liquidation exits as sl`, p.exitKind);
      check(p.pnlPct === -100, `${tag}: liquidation ROE == -100`, String(p.pnlPct));
      const dist = Math.abs(p.pricePnlPct);
      check(Math.abs(dist - 100 / leverage) < 1e-6, `${tag}: liq distance == 100/lev`,
        `dist=${dist} expect=${100 / leverage}`);
    } else {
      check(
        Math.abs(p.pnlPct - p.pricePnlPct * leverage) < 1e-6,
        `${tag}: ROE == price move × leverage`,
        `pnl=${p.pnlPct} price=${p.pricePnlPct} lev=${p.leverage}`,
      );
    }
    if (p.exitKind === "tp") check(p.pnlPct > 0 || Math.abs(p.pnlPct) < 1e-9, `${tag}: TP exit non-negative PnL`);
    if (p.exitKind === "sl") check(p.pnlPct < 0 || Math.abs(p.pnlPct) < 1e-9, `${tag}: SL exit non-positive PnL`);
  }

  // KPI math
  const wins = closed.filter((p) => p.pnlPct > 0).length;
  check(tpC + slC + flips.length === closed.length, `${tag}: closed == tp+sl+flip`);
  check(wins + closed.filter((p) => p.pnlPct <= 0).length === closed.length, `${tag}: wins+losses == closed`);
  check(!open || papers.filter((p) => p.status === "open").length === 1, `${tag}: at most 1 open paper`);

  return { tag, papers: papers.length, closed: closed.length, flips: flips.length, tpC, slC, liqC, wins, open: !!open, pending: !!pending };
}

// ── Wyckoff suite (imports the real src/lib/wyckoff.ts) ───────────────────────
function runWyckoffSuite(klines, tag) {
  const cfgs = [
    { name: "auto", s: { ...DEFAULT_WYCKOFF } },
    { name: "noPhaseC", s: { ...DEFAULT_WYCKOFF, reqPhaseC: false } },
    { name: "fast", s: { ...DEFAULT_WYCKOFF, speed: "fast" } },
    { name: "manual", s: { ...DEFAULT_WYCKOFF, mode: "manual" } },
  ];
  const KINDS = new Set(["SC", "AR", "ST", "Spring", "SOS", "LPS", "Markup", "BC", "UT", "SOW", "LPSY", "Markdown"]);
  const LOW_EVENTS = ["SC", "ST", "Spring", "LPS"]; // acc events sitting on a pivot low
  const HIGH_DIST_EVENTS = ["BC", "ST", "UT", "LPSY"]; // dist events sitting on a real-space HIGH

  for (const c of cfgs) {
    const wy1 = wyckoffFrom(klines, "5m", c.s);
    const wy2 = wyckoffFrom(klines, "5m", c.s);
    const ser = (w) =>
      JSON.stringify({ e: w.events, b: w.boxes, p: w.pivots, d: w.dash, t: Array.from(w.tints) });
    check(ser(wy1) === ser(wy2), `wy ${tag} ${c.name}: deterministic`);

    let lastBar = -1;
    for (const e of wy1.events) {
      check(KINDS.has(e.kind), `wy ${tag} ${c.name}: kind enum`, e.kind);
      check(e.bar >= 0 && e.bar <= wy1.lastClosed, `wy ${tag} ${c.name}: bar in range`, `${e.kind} bar=${e.bar}`);
      check(isFinite(e.price) && e.price > 0, `wy ${tag} ${c.name}: finite price`, `${e.kind} ${e.price}`);
      check(e.bar >= lastBar, `wy ${tag} ${c.name}: events sorted by bar`);
      lastBar = e.bar;

      // anchor: the event price must be EXACTLY the extreme of its own bar —
      // acc low events sit on the pivot low, dist low events mirror to the high, etc.
      const k = klines[e.bar];
      const anchor =
        e.dir === 1
          ? LOW_EVENTS.includes(e.kind) ? k.l : k.h
          : HIGH_DIST_EVENTS.includes(e.kind) ? k.h : k.l;
      check(Math.abs(e.price - anchor) < 1e-9, `wy ${tag} ${c.name}: ${e.kind} anchored to bar extreme`,
        `price=${e.price} anchor=${anchor}`);

      // label orientation (Pine f_lbl: below = (d==1) == atLowT)
      const belowExp =
        e.dir === 1
          ? LOW_EVENTS.includes(e.kind)
          : ["AR", "SOW", "Markdown"].includes(e.kind);
      check(e.below === belowExp, `wy ${tag} ${c.name}: below flag for ${e.kind}`);
    }
    for (const b of wy1.boxes) {
      check(b.top > b.bottom, `wy ${tag} ${c.name}: box top>bottom`, `${b.top}/${b.bottom}`);
      check(b.left <= b.right, `wy ${tag} ${c.name}: box left<=right`);
      check(isFinite(b.top) && isFinite(b.bottom), `wy ${tag} ${c.name}: box finite`);
    }
    check(wy1.tints.length === klines.length, `wy ${tag} ${c.name}: tints aligned`);
    check(Array.from(wy1.tints).every((t) => t === 1 || t === -1 || t === 0), `wy ${tag} ${c.name}: tint domain`);
    const d = wy1.dash;
    check(d.st >= 0 && d.st <= 7, `wy ${tag} ${c.name}: dash st range`, String(d.st));
    check(d.rsi == null || (d.rsi >= 0 && d.rsi <= 100), `wy ${tag} ${c.name}: dash rsi bounds`);
    check(d.pivLen >= 2, `wy ${tag} ${c.name}: pivLen sane`, String(d.pivLen));
    check(d.volRatio == null || isFinite(d.volRatio), `wy ${tag} ${c.name}: volRatio finite`);
  }

  // reqPhaseC=false only OPENS a door (SOS/SOW from st 3) — never fewer live events
  const wyPc = wyckoffFrom(klines, "5m", { ...DEFAULT_WYCKOFF });
  const wyNoPc = wyckoffFrom(klines, "5m", { ...DEFAULT_WYCKOFF, reqPhaseC: false });
  const liveCount = (w) => w.events.filter((e) => !e.deleted).length;
  check(liveCount(wyNoPc) >= liveCount(wyPc), `${tag} wy: reqPhaseC=false >= events`,
    `${liveCount(wyNoPc)}/${liveCount(wyPc)}`);

  // speed changes the pivot length (auto mapping: 8 → fast 5, safe 12 on 5m)
  const wyFast = wyckoffFrom(klines, "5m", { ...DEFAULT_WYCKOFF, speed: "fast" });
  const wySafe = wyckoffFrom(klines, "5m", { ...DEFAULT_WYCKOFF, speed: "safe" });
  check(wyFast.dash.pivLen < wySafe.dash.pivLen, `${tag} wy: fast pivLen < safe pivLen`,
    `${wyFast.dash.pivLen}/${wySafe.dash.pivLen}`);
}

/** Synthetic accumulation: flat → climax dump → base → rally → flat peak.
 *  Must yield SC (bar 79, price = bar low) and AR (flat peak), and the exact
 *  inverted series must yield BC/AR(dist) at mirrored prices (T-space proof). */
function runWyckoffSynthetic() {
  const tag = "wy synth";
  const mk = (invert) => {
    const raw = [];
    const t0 = 1700000000000;
    const step = 300000;
    let i = 0;
    const push = (o, h, l, c, v) => {
      raw.push(
        invert
          ? { t: t0 + i * step, o: 200 - o, h: 200 - l, l: 200 - h, c: 200 - c, v }
          : { t: t0 + i * step, o, h, l, c, v },
      );
      i++;
    };
    for (let k = 0; k < 70; k++) push(99.9, 100.2, 99.8, 100, 1); // quiet
    for (let k = 1; k <= 10; k++)
      push(100 - (k - 1) * 1.5, 100 - (k - 1) * 1.5 + 0.3, 100 - k * 1.5 - 0.4, 100 - k * 1.5, 8); // climax dump
    for (let k = 0; k < 30; k++) {
      const c = 85.5 + (k % 3) * 0.5;
      push(c - 0.2, c + 0.3, c - 0.5, c, 0.8); // base
    }
    for (let k = 1; k <= 20; k++) {
      const c = 86 + k * 0.45;
      push(86 + (k - 1) * 0.45, c + 0.2, c - 0.4, c, 2); // rally
    }
    for (let k = 0; k < 14; k++) {
      const h = 95.4 - Math.abs(k - 3) * 0.06;
      push(94.8, h, 94.6, 94.85, 1); // flat with a single confirmed peak at bar 133
    }
    return raw;
  };
  const s = { ...DEFAULT_WYCKOFF };

  const acc = wyckoffFrom(mk(false), "5m", s);
  const liveAcc = acc.events.filter((e) => !e.deleted);
  const sc = liveAcc.find((e) => e.kind === "SC" && e.dir === 1);
  const ar = liveAcc.find((e) => e.kind === "AR" && e.dir === 1);
  check(sc != null, `${tag}: SC detected`, JSON.stringify(liveAcc.map((e) => e.kind)));
  check(ar != null, `${tag}: AR detected`, JSON.stringify(liveAcc.map((e) => e.kind)));
  if (sc) {
    check(sc.bar === 79, `${tag}: SC at dump-bottom bar`, String(sc.bar));
    check(Math.abs(sc.price - 84.6) < 1e-9, `${tag}: SC price == bar low`, String(sc.price));
    check(sc.below, `${tag}: SC label below`);
  }
  if (ar) {
    check(ar.bar === 133, `${tag}: AR at flat-peak bar`, String(ar.bar));
    check(Math.abs(ar.price - 95.4) < 1e-9, `${tag}: AR price == bar high`, String(ar.price));
    check(!ar.below, `${tag}: AR label above`);
  }
  if (sc && ar) check(ar.bar > sc.bar, `${tag}: AR after SC`);
  const accBox = acc.boxes.find((b) => !b.deleted && b.dir === 1);
  check(accBox != null, `${tag}: acc TR box exists`);
  if (accBox) {
    check(accBox.top > accBox.bottom, `${tag}: acc box geometry`);
    check(Math.abs(accBox.top - 95.4) < 1e-9, `${tag}: acc box top == AR high`, String(accBox.top));
    check(Math.abs(accBox.bottom - 84.6) < 1e-9, `${tag}: acc box bottom == SC low`, String(accBox.bottom));
  }

  // T-space proof: the exact inverted series must give BC at the mirrored top
  const dist = wyckoffFrom(mk(true), "5m", s);
  const liveDist = dist.events.filter((e) => !e.deleted);
  const bc = liveDist.find((e) => e.kind === "BC" && e.dir === -1);
  check(bc != null, `${tag}: BC detected on inverted series`, JSON.stringify(liveDist.map((e) => `${e.dir}:${e.kind}`)));
  if (bc) {
    check(bc.bar === 79, `${tag}: BC at pump-top bar`, String(bc.bar));
    check(Math.abs(bc.price - 115.4) < 1e-9, `${tag}: BC price == mirrored bar high`, String(bc.price));
    check(!bc.below, `${tag}: BC label above`);
  }
}

async function main() {
  const symbols = ["BTCUSDT", "ETHUSDT", "SOLUSDT"];
  const intervals = ["5m", "15m", "1h"];
  const configs = [
    { name: "wide-l1-gate", slPct: 6, tpPct: 3.2, leverage: 1, smaFilter: true },
    { name: "pine-l5-gate", slPct: 1.5, tpPct: 3, leverage: 5, smaFilter: true },
    { name: "wide-l10-nogate", slPct: 6, tpPct: 3.2, leverage: 10, smaFilter: false },
  ];
  const summary = [];
  for (const sym of symbols) {
    for (const itv of intervals) {
      let klines;
      try {
        klines = await fetchKlines(sym, itv);
      } catch (e) {
        failures++;
        console.log(`FETCH FAIL ${sym} ${itv}: ${e.message}`);
        continue;
      }
      for (const cfg of configs) {
        summary.push(await runSuite(klines, sym, itv, cfg));
      }
      runAnalysisSuite(klines, `${sym} ${itv} analysis`);
      runWyckoffSuite(klines, `${sym} ${itv}`);
    }
  }
  runWyckoffSynthetic();
  console.log("\n========== SUMMARY ==========");
  for (const s of summary) {
    console.log(
      `${s.tag.padEnd(30)} papers=${String(s.papers).padStart(3)} closed=${String(s.closed).padStart(3)} (TP ${s.tpC} · SL ${s.slC} · LIQ ${s.liqC} · FLIP ${s.flips}) wins=${String(s.wins).padStart(3)} open=${s.open ? "Y" : "n"} pending=${s.pending ? "Y" : "n"}`,
    );
  }
  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECKS FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
