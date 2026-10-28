/**
 * Smoke test for the paper-trading engine over live Binance data.
 *
 * Contract (v3 — SMA gate fix + leverage):
 *  1. A reversal ALWAYS closes the open paper at the next candle open AND opens
 *     the opposite paper at that same price/time — the SMA gate never blocks it.
 *  2. The SMA gate only filters FRESH entries from flat, and only when enabled.
 *     An SMA value of null (start of the 500-candle window) must NOT block.
 *  3. Gate off → every confirmed signal enters immediately, no pending entries.
 *  4. Leverage: ROE = price move × leverage; positions are liquidated
 *     (~100%/leverage adverse move) → ROE = -100%, flagged `liquidated`.
 */
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
    }
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
