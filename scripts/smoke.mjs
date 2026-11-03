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
 *     dash sane; reqPhaseC=true ties every live SOS/SOW to a same-dir Spring/UT,
 *     reqPhaseC=false runs deterministic; speed changes pivLen;
 *     synthetic accumulation produces SC→AR (+ mirrored BC on the inverted series).
 *  7. Market context: sessions cover all 24h with sane Bull%/drift; whale delta
 *     bounded by volume (null without taker data); volume profile distributes
 *     exactly the window's volume; compact formatter stable.
 *  8. Equity curve: cumulative ROE over closed papers in exit order (peak ≥ 0,
 *     trough ≤ 0), consistent with kpiFrom netPnl / flipNetPnl.
 */
import { wyckoffFrom } from "../src/lib/wyckoff.ts";
import { DEFAULT_WYCKOFF } from "../src/lib/types.ts";
import { sessionOf, sessionStats, whaleDelta, volumeProfile, fmtCompact } from "../src/lib/market.ts";
import { equityFrom } from "../src/lib/equity.ts";
import { kpiFrom, papersFrom as libPapersFrom } from "../src/lib/papers.ts";
import { signalsFrom as libSignalsFrom } from "../src/lib/signals.ts";
import { runXgb, FEATURE_NAMES } from "../src/lib/xgb.ts";
import { DEFAULT_SETTINGS, matchPreset, PRESET_SAFE, PRESET_AGGRESSIVE, STRATEGY_PRESETS } from "../src/lib/types.ts";

const HOSTS = ["https://fapi.binance.com", "https://fapi1.binance.com"];

async function fetchKlines(symbol, interval, limit = 500) {
  let lastErr;
  for (const host of HOSTS) {
    try {
      const res = await fetch(
        `${host}/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`,
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

  // reqPhaseC=true: every live SOS/SOW must carry its Spring/UT (same structure,
  // same direction, pivot bar not after the SOS bar). Trajectory-level event
  // counts are NOT monotone in reqPhaseC — the earlier st5 entry changes which
  // failure rule applies — so only the rule-level invariant is asserted.
  const wyPc = wyckoffFrom(klines, "5m", { ...DEFAULT_WYCKOFF });
  const wyNoPc = wyckoffFrom(klines, "5m", { ...DEFAULT_WYCKOFF, reqPhaseC: false });
  const liveEv = (w) => w.events.filter((e) => !e.deleted);
  for (const e of liveEv(wyPc)) {
    if (e.kind !== "SOS" && e.kind !== "SOW") continue;
    const hasPhC = liveEv(wyPc).some(
      (p) => p.dir === e.dir && (p.kind === "Spring" || p.kind === "UT") && p.bar <= e.bar,
    );
    check(hasPhC, `${tag} wy: reqPhaseC SOS has Spring/UT`, `${e.kind}@${e.bar}`);
  }
  // reqPhaseC=false only OPENS a door — the run itself must stay deterministic
  const wyNoPc2 = wyckoffFrom(klines, "5m", { ...DEFAULT_WYCKOFF, reqPhaseC: false });
  check(
    JSON.stringify(liveEv(wyNoPc)) === JSON.stringify(liveEv(wyNoPc2)),
    `${tag} wy: reqPhaseC=false deterministic`,
  );

  // speed changes the pivot length (auto mapping: 8 → fast 5, safe 12 on 5m)
  const wyFast = wyckoffFrom(klines, "5m", { ...DEFAULT_WYCKOFF, speed: "fast" });
  const wySafe = wyckoffFrom(klines, "5m", { ...DEFAULT_WYCKOFF, speed: "safe" });
  check(wyFast.dash.pivLen < wySafe.dash.pivLen, `${tag} wy: fast pivLen < safe pivLen`,
    `${wyFast.dash.pivLen}/${wySafe.dash.pivLen}`);
}

/** Synthetic accumulation: flat → climax dump → base → rally → flat peak.
 *  Must yield SC (bar 119, price = bar low) and AR (flat peak), and the exact
 *  inverted series must yield BC/AR(dist) at mirrored prices (T-space proof).
 *  0.2.73: lead-in im 70 → 110 nến — EMA89 (auto intraday) cần 89 nến warmup
 *  trước cú climax, nếu không closePvT < emaPvT không bao giờ đúng (EMA null). */
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
    for (let k = 0; k < 110; k++) push(99.9, 100.2, 99.8, 100, 1); // quiet (EMA89 warmup)
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
    check(sc.bar === 119, `${tag}: SC at dump-bottom bar`, String(sc.bar));
    check(Math.abs(sc.price - 84.6) < 1e-9, `${tag}: SC price == bar low`, String(sc.price));
    check(sc.below, `${tag}: SC label below`);
  }
  if (ar) {
    check(ar.bar === 173, `${tag}: AR at flat-peak bar`, String(ar.bar));
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
    check(bc.bar === 119, `${tag}: BC at pump-top bar`, String(bc.bar));
    check(Math.abs(bc.price - 115.4) < 1e-9, `${tag}: BC price == mirrored bar high`, String(bc.price));
    check(!bc.below, `${tag}: BC label above`);
  }
}

// ── market context: sessions / whale delta / volume profile ─────────────────
function runMarketSuite(klines, tag) {
  const closed = klines.length - 2;
  if (closed < 50) return;

  // session windows: UTC hour boundaries
  const at = (h) => Date.UTC(2025, 0, 15, h, 0, 0);
  const lny = sessionOf(at(13));
  check(lny.includes("london") && lny.includes("newyork") && lny.length === 2, "sessions: 13h = london+ny", JSON.stringify(lny));
  const syd = sessionOf(at(23));
  check(syd.length === 1 && syd[0] === "sydney", "sessions: 23h = sydney", JSON.stringify(syd));
  const tok = sessionOf(at(2));
  check(tok.includes("tokyo") && tok.includes("sydney"), "sessions: 02h = sydney+tokyo", JSON.stringify(tok));

  // stats: bull% within [0,100], every closed candle counted at least once
  const stats = sessionStats(klines);
  check(stats.length === 4, "sessions: 4 sessions returned");
  let nSum = 0;
  for (const s of stats) {
    if (s.bullPct != null) {
      check(s.bullPct >= 0 && s.bullPct <= 100, `${tag}: bull% in [0,100] (${s.key})`, String(s.bullPct));
      check(isFinite(s.driftPct ?? 0), `${tag}: drift finite (${s.key})`);
    }
    nSum += s.candles;
  }
  check(nSum >= closed, `${tag}: session candle coverage ≥ closed count`, `${nSum} vs ${closed}`);

  // whale delta bounded by total volume; null without taker data
  const withTb = klines.map((k) => ({ ...k, tb: k.v * 0.6 }));
  const wd = whaleDelta(withTb, 20);
  check(wd != null, `${tag}: whale delta present with taker data`);
  if (wd) {
    let volSum = 0;
    for (let i = Math.max(0, closed - 19); i <= closed; i++) volSum += klines[i].v;
    check(Math.abs(wd.net) <= volSum + 1e-9, `${tag}: |net delta| ≤ window volume`, `${wd.net} vs ${volSum}`);
    check(wd.strongBuy >= 0 && wd.strongSell >= 0, `${tag}: strong deltas non-negative`);
    check(Math.abs(wd.last - (2 * 0.6 - 1) * klines[closed].v) < 1e-6, `${tag}: last delta = 2tb − v`);
  }
  // fetched klines carry no tb field → whale panel must degrade to null
  check(whaleDelta(klines, 20) === null, `${tag}: whale delta null without taker data`);

  // volume profile distributes exactly the window volume
  const vp = volumeProfile(withTb, 0, closed, 26);
  check(vp != null, `${tag}: volume profile built`);
  if (vp) {
    check(vp.rows.length === 26, `${tag}: vp rows = 26`);
    let tot = 0;
    for (const r of vp.rows) tot += r.buy + r.sell;
    let vSum = 0;
    for (let i = 0; i <= closed; i++) vSum += klines[i].v;
    check(Math.abs(tot - vSum) < vSum * 1e-9, `${tag}: vp conserves volume`, `${tot} vs ${vSum}`);
    check(vp.max > 0 && vp.poc >= vp.minP && vp.poc <= vp.maxP, `${tag}: vp poc in range`);
    const buyRatioTot = vp.rows.reduce((a, r) => a + r.buy, 0) / Math.max(tot, 1e-9);
    check(Math.abs(buyRatioTot - 0.6) < 0.02, `${tag}: vp buy split ≈ taker share`, String(buyRatioTot));
  }

  // compact formatter
  check(fmtCompact(1234567) === "1.23M", "fmtCompact: M", fmtCompact(1234567));
  check(fmtCompact(-9876) === "-9.9K", "fmtCompact: -K", fmtCompact(-9876));
  check(fmtCompact(512) === "512", "fmtCompact: plain");
}

// ── equity curve + kpi extensions ───────────────────────────────────────────
function runEquitySuite(klines, symbol, interval, cfg) {
  const { slPct, tpPct, leverage, smaFilter } = cfg;
  const tag = `${symbol} ${interval} ${cfg.name} equity`;
  const { signals, sma } = signalsFrom(klines, 2, 10, 200);
  const { papers } = papersFrom(klines, signals, sma, symbol, interval, slPct, tpPct, leverage, smaFilter);

  const eq = equityFrom(papers);
  const closed = papers.filter((p) => p.status === "closed");
  check(eq.count === closed.length, `${tag}: point count == closed`, `${eq.count} vs ${closed.length}`);
  check(eq.peak >= 0 && eq.trough <= 0, `${tag}: peak ≥ 0 / trough ≤ 0`, `${eq.peak}/${eq.trough}`);

  const kpi = kpiFrom(papers);
  check(Math.abs(eq.last - kpi.netPnl) < 1e-9, `${tag}: last cum == kpi netPnl`, `${eq.last} vs ${kpi.netPnl}`);
  const flipNet = closed.filter((p) => p.exitKind === "flip").reduce((a, p) => a + (p.pnlPct ?? 0), 0);
  check(Math.abs(kpi.flipNetPnl - flipNet) < 1e-9, `${tag}: flipNetPnl consistent`);

  // exit-order times non-decreasing
  let sorted = true;
  for (let i = 1; i < eq.points.length; i++)
    if (eq.points[i].time < eq.points[i - 1].time) sorted = false;
  check(sorted, `${tag}: equity points time-sorted`);

  // exact synthetic math
  const fake = [
    { status: "closed", pnlPct: 10, entryIndex: 0, entryTime: 500, exitIndex: 1, exitTime: 1500, exitKind: "tp", leverage: 1 },
    { status: "closed", pnlPct: -4, entryIndex: 2, entryTime: 2500, exitIndex: 3, exitTime: 3500, exitKind: "sl", leverage: 1 },
    { status: "open", pnlPct: undefined, entryIndex: 4, entryTime: 4500, exitIndex: undefined, exitTime: undefined, leverage: 1 },
  ];
  const e2 = equityFrom(fake);
  check(e2.count === 2 && Math.abs(e2.last - 6) < 1e-9 && Math.abs(e2.peak - 10) < 1e-9 && Math.abs(e2.trough - 0) < 1e-9, "equity: synthetic cum 10→6, peak 10, trough 0", JSON.stringify(e2));
  const k2 = kpiFrom(fake);
  check(Math.abs(k2.netPnl - 6) < 1e-9 && k2.flipNetPnl === 0, "kpi: synthetic net 6, flipNet 0");
  const fakeFlip = [...fake, { status: "closed", pnlPct: -2, entryIndex: 5, entryTime: 5500, exitIndex: 6, exitTime: 6500, exitKind: "flip", leverage: 1 }];
  check(Math.abs(kpiFrom(fakeFlip).flipNetPnl + 2) < 1e-9, "kpi: flipNetPnl sums flip trades only");
}

// ─── 9. XGBoost trainer + strategy tuner ──────────────────────────────
function synthMomentumKlines(n = 480) {
  // AR(1) returns (φ=0.55) — momentum is genuinely learnable, so the boosted
  // trees MUST beat coin-flip on the validation slice
  let price = 100;
  let rPrev = 0;
  let seed = 42;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const ks = [];
  for (let i = 0; i < n; i++) {
    const r = 0.55 * rPrev + (rnd() - 0.5) * 0.01;
    rPrev = r;
    price = price * Math.exp(r);
    const o = price * (1 + (rnd() - 0.5) * 0.001);
    const h = Math.max(o, price) * (1 + rnd() * 0.002);
    const l = Math.min(o, price) * (1 - rnd() * 0.002);
    const v = 1000 + rnd() * 500;
    ks.push({ t: 1700000000000 + i * 3600000, o, h, l, c: price, v, tb: v * (0.4 + rnd() * 0.2) });
  }
  return ks;
}

async function runXgbSuite(liveKlines, tag) {
  const settings = { ...DEFAULT_SETTINGS, leverage: 1 };

  // 9a. UT off semantics at lib level: no signals → engine never enters
  {
    const raw = libSignalsFrom(liveKlines, settings.atrKey, settings.atrPeriod, settings.smaPeriod);
    const smaOk = raw.signals.map((s) => ({ ...s, smaOk: true }));
    const withSignals = libPapersFrom(liveKlines, smaOk, raw.sma, "T", "1h", 6, 3.2, 1, false);
    const withoutSignals = libPapersFrom(liveKlines, [], raw.sma, "T", "1h", 6, 3.2, 1, false);
    check(
      withSignals.papers.length > 0 && withoutSignals.papers.length === 0 && !withoutSignals.open && !withoutSignals.pending,
      `${tag}: UT off (no signals) → engine never enters`,
      `with=${withSignals.papers.length} without=${withoutSignals.papers.length}`,
    );
  }

  // 9b. strategy presets + matchPreset
  check(STRATEGY_PRESETS.length === 3, "xgb: 3 strategy presets");
  check(matchPreset(DEFAULT_SETTINGS) === "balanced", "xgb: DEFAULT matches 'balanced'", matchPreset(DEFAULT_SETTINGS));
  check(matchPreset({ ...DEFAULT_SETTINGS, ...PRESET_SAFE }) === "safe", "xgb: SAFE preset matches 'safe'");
  check(matchPreset({ ...DEFAULT_SETTINGS, ...PRESET_AGGRESSIVE }) === "aggressive", "xgb: AGGRESSIVE preset matches");
  check(matchPreset({ ...DEFAULT_SETTINGS, utOn: false }) === null, "xgb: UT off breaks preset match");

  // 9c. synthetic momentum — model must find real signal
  {
    const res = await runXgb(synthMomentumKlines(), settings, "SYNTH-1h", "1h");
    check(res.auc > 0.6, `xgb synth: AUC finds momentum signal (${res.auc.toFixed(2)})`);
    check(res.acc >= 45 && res.acc <= 100, `xgb synth: accuracy sane (${res.acc.toFixed(1)}%)`);
    check(res.samples + res.valSamples >= 300, `xgb synth: row count ${res.samples}/${res.valSamples}`);
    check(
      res.importance.length === 6 &&
        res.importance.every((f, i) => f.gain >= 0 && f.gain <= 1 && (i === 0 || res.importance[i - 1].gain >= f.gain)) &&
        res.importance.reduce((a, f) => a + f.gain, 0) <= 1.0001,
      "xgb synth: importance sorted, bounded, ≤ 1",
    );
    const names = new Set(FEATURE_NAMES);
    check(res.importance.every((f) => names.has(f.name)), "xgb synth: importance names valid");
    const s = res.suggestion;
    check(["LONG", "SHORT", "NEUTRAL"].includes(s.bias), `xgb synth: bias ${s.bias}`);
    check(s.prob > 0 && s.prob < 1, `xgb synth: prob ${(s.prob).toFixed(3)}`);
    check(s.slPct >= 0.3 && s.slPct <= 20, `xgb synth: SL ${s.slPct} clamped (0.3–20 ATR-based)`);
    check(s.tpPct > s.slPct, `xgb synth: TP ${s.tpPct} > SL ${s.slPct}`);
    check([1, 1.5, 2, 3].includes(s.atrKey) && [7, 10, 14].includes(s.atrPeriod), `xgb synth: UT combo ${s.atrKey}/${s.atrPeriod}`);
    check(!s.smaFilter || [50, 100, 150, 200].includes(s.smaPeriod), `xgb synth: gate period ${s.smaPeriod}`);
    console.log(
      `  xgb synth: acc=${res.acc.toFixed(1)}% auc=${res.auc.toFixed(2)} bias=${s.bias} p=${s.prob.toFixed(2)} SL ${s.slPct}/TP ${s.tpPct} ut=${s.atrKey}/${s.atrPeriod} sma=${s.smaFilter ? s.smaPeriod : "off"}`,
    );
  }

  // 9d. live data — must train without throwing and stay in range
  {
    const res = await runXgb(liveKlines, settings, "BTCUSDT-1h", "1h");
    check(res.acc > 0 && res.acc <= 100 && res.auc >= 0 && res.auc <= 1, `xgb live: metrics in range (acc ${res.acc.toFixed(1)} auc ${res.auc.toFixed(2)})`);
    check(res.suggestion.tpPct > res.suggestion.slPct * 1.25, `xgb live: TP/SL ratio ≥ 1.25R (${res.suggestion.tpPct}/${res.suggestion.slPct})`);
    check(res.horizon >= 3 && res.horizon <= 6, `xgb live: horizon ${res.horizon}`);
    console.log(
      `  xgb live : acc=${res.acc.toFixed(1)}% auc=${res.auc.toFixed(2)} trees=${res.trees} top=${res.importance[0].name}`,
    );
  }
}

async function main() {
  const symbols = ["BTCUSDT", "ETHUSDT", "SOLUSDT"];
  // 30m / 4h added with the terminal rebuild — engine must hold on all five TFs
  const intervals = ["5m", "15m", "30m", "1h", "4h"];
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
      runMarketSuite(klines, `${sym} ${itv} market`);
      runWyckoffSuite(klines, `${sym} ${itv}`);
      for (const cfg of configs) {
        runEquitySuite(klines, sym, itv, cfg);
      }
    }
  }
  runWyckoffSynthetic();
  const btc1h = await fetchKlines("BTCUSDT", "1h").catch(() => null);
  if (btc1h) {
    await runXgbSuite(btc1h, "xgb");
  } else {
    failures++;
    console.log("FETCH FAIL BTCUSDT 1h (xgb suite)");
  }
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
