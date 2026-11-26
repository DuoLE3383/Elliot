// --- Audit Replay v1 - MEASURE, DO NOT FIX ---
// Re-run evalExit (engine.ts) on CLOSED candles, using CLOSE price,
// do not use wick price like live watcherTick.
// Purpose: measure "if closed at close price, how much would this order make" -
// to prove how much wick / too-tight BE closes lose.
// Do NOT overwrite DB, do NOT change live logic. Only return suggestions for comparison.
import { feeRoi } from "./params";
import { atrLevelsAtEntry } from "./indicators";
import {
  trailNextPeak, trailMovePct, trailRoiStopPrice, trailStopPrice, trailAutoLevels,
  slTpHit, liquidationHit,
} from "./autotrade";
import { trailHit, trailRatchet, movePct1x, runnerTp2, tp1Plan, combineClosePnl, SL_DEEP_FRAC, TRAIL_ROI_GIVEBACK } from "./trade-mgmt";
import { expectedPnlPctOf } from "./audit-book";

export interface ReplayKline { t: number; c: number; o?: number; h?: number; l?: number; }
export interface ReplayCfg {
  trailOn: boolean; trailAuto: boolean; trailActPct: number; trailDistPct: number;
  runnerOn: boolean; runnerSharePct: number; runnerTpMult: number; runnerTrailLock: number;
}
export interface ReplayTrade {
  symbol: string; interval: string; side: string;
  entryPrice: number; entryTime: string | Date;
  slPct: number; tpPct: number; leverage: number;
  exitPrice: number | null; exitTime: string | Date | null; p1Pct?: number | null; p1Share?: number | null; tp2Pct?: number | null; trailPct?: number | null;
  exitKind: string | null; pnlPct: number | null;
  exitBasis?: string | null; // 'mark' (old) | 'last' (new, Binance fill)
}
export interface ReplayResult {
  closed: boolean;
  replayExitPrice: number | null; replayExitTime: number | null; replayExitKind: string | null;
  replayPnlPct: number | null; storedPnlPct: number | null; diffPnl: number | null;
  wouldFlipToWin: boolean; notes: string[];
  peakPrice?: number | null; peakRoi?: number | null; trailArmed?: boolean; missedClosePrice?: number | null; missedPnlPct?: number | null;
}

export function replayExit(
  trade: ReplayTrade, klinesBefore: ReplayKline[], klinesAfter: ReplayKline[], cfg: ReplayCfg,
): ReplayResult {
  const notes: string[] = ["close-price replay - do not use wick price", "dcaCount=0 (DB does not store DCA count)"];
  const entry = trade.entryPrice;
  const entryMs = new Date(trade.entryTime).getTime();
  // 1) Tái tạo act/dist như updateTrail — khóa 1 lần từ ATR lúc vào lệnh
  let act = cfg.trailActPct, dist = cfg.trailDistPct;
  if (cfg.trailAuto) {
    const lv = atrLevelsAtEntry(klinesBefore.map((k) => ({ t: k.t, o: k.o ?? k.c, h: k.h ?? k.c, l: k.l ?? k.c, c: k.c, v: 0 } as never)), 1.5, 1.4);
    if (lv) {
      const auto = trailAutoLevels(lv.atrPct, trade.leverage);
      act = auto.actPct; dist = auto.distPct;
      notes.push(`act/dist auto from ATR: act ${act}% dist ${dist}%`);
    }
  }
  let peak = entry;
  let p1Pct: number | null = trade.p1Pct ?? null, p1Share: number | null = trade.p1Share ?? null, tp2Pct = trade.tp2Pct ?? 0, trailPct = trade.trailPct ?? 0;
  let runner = p1Pct != null;
  const sorted = [...klinesAfter].filter((k) => k.t > entryMs).sort((a, b) => a.t - b.t);
  // MFE - best favorable peak (close price) in order lifetime, computed once for Audit vs trail
  let peakPrice: number | null = null;
  for (const k of sorted) {
    const wick = trade.side === "SHORT" ? (k.l ?? k.c) : (k.h ?? k.c);
    if (peakPrice == null) peakPrice = wick;
    else if (trade.side === "SHORT" ? wick < peakPrice : wick > peakPrice) peakPrice = wick;
  }
  const peakRoi = peakPrice != null ? Math.round(trailMovePct(trade.side, entry, peakPrice) * trade.leverage * 100) / 100 : null;
  const trailArmed = peakRoi != null && peakRoi >= 0 && (peakRoi / Math.max(1, trade.leverage)) >= act; // peak move% >= act
  // Missed close: nếu peak đã armed mà replay vẫn đóng thấp hơn nhiều → giá trail lẽ ra chốt = peak lùi 1% ROI (roiStop)
  let missedClosePrice: number | null = null, missedPnlPct: number | null = null;
  if (peakPrice != null && peakRoi != null && peakRoi > 3) {
    const roiStopP = trailRoiStopPrice(trade.side, entry, peakRoi, trade.leverage);
    if (roiStopP != null) {
      missedClosePrice = Math.round(roiStopP * 100000) / 100000;
      const mMove = movePct1x(trade.side, entry, roiStopP);
      let mRem = Math.round((mMove * trade.leverage - feeRoi(trade.leverage)) * 100) / 100;
      if (trade.leverage > 1 && mMove <= -(100 / trade.leverage)) mRem = -100;
      missedPnlPct = mRem;
    }
  }
  for (let i = 0; i < sorted.length; i++) {
    const bar = sorted[i];
    const price = bar.c;
    if (!price || !entry) continue;
    // Liquidation - priority like evalExit
    if (liquidationHit(trade.side, price, entry, trade.leverage)) {
      return finish(price, sorted[i].t, "sl", p1Pct, p1Share, trade, notes, { peakPrice, peakRoi, trailArmed, missedClosePrice, missedPnlPct });
    }
    if (runner) {
      const move1x = movePct1x(trade.side, entry, price);
      // 0.3.40 - drop hard TP2 close: runner follows trail to end of position
      if (trailHit(trade.side, price, entry, trailPct)) return finish(price, sorted[i].t, "trail", p1Pct, p1Share, trade, notes, { peakPrice, peakRoi, trailArmed, missedClosePrice, missedPnlPct });
      const lock = trailRatchet(trailPct, Math.max(0, move1x), cfg.runnerTrailLock);
      if (lock > trailPct) trailPct = lock;
      continue;
    }
    // NORMAL PHASE - trail before SL/TP like evalExit
    // 0.3.42 - peak uses WICK (H/L), hit check uses WICK - matches live engine
    if (cfg.trailOn) {
      const peakWick = trade.side === "SHORT" ? (bar.l ?? bar.c) : (bar.h ?? bar.c);
      peak = trailNextPeak(trade.side, peak, peakWick);
      const peakRoi = trailMovePct(trade.side, entry, peak) * trade.leverage;
      const roiStop = trailRoiStopPrice(trade.side, entry, peakRoi, trade.leverage);
      const stop = roiStop ?? trailStopPrice(trade.side, entry, peak, act, dist);
      if (stop != null) {
        // hit check: has bar extreme touched stop yet
        const hitHit = trade.side === "SHORT" ? (bar.h ?? bar.c) : (bar.l ?? bar.c);
        const hit = roiStop != null
          ? (trade.side === "SHORT" ? hitHit >= stop : hitHit <= stop)
          : (trade.side === "SHORT" ? price >= stop : price <= stop);
        if (hit) {
          // LASTPRICE audit: trail hit detected on wick, fill at bar.c.
          // bar.c = lastPrice at that historical candle close (no historical ticker).
          // Same rule as engine closeTradeDirect: entry=mark, exit=lastPrice.
          // Old code filled at theoretical stop (min/max open,stop) -> diff vs stored.
          // exitBasis=mark (old): fill at theoretical stop. exitBasis=last (new): fill at bar.c = lastPrice at candle close proxy.
          const fillAt = trade.exitBasis === "mark" ? (trade.side === "LONG" ? Math.min(bar.o ?? price, stop) : Math.max(bar.o ?? price, stop)) : price;
          notes.push(`trail close @ candle ${new Date(sorted[i].t).toISOString()} - fill lastClose ${fillAt} (stop ${stop}, H=${bar.h} L=${bar.l})`);
          return finish(fillAt, sorted[i].t, "trail", p1Pct, p1Share, trade, notes, { peakPrice, peakRoi, trailArmed, missedClosePrice, missedPnlPct });
        }
      }
    }
    const kind = slTpHit(trade.side, price, entry, trade.slPct, trade.tpPct);
    if (kind === "tp") {
      const plan = tp1Plan({ runnerOn: cfg.runnerOn, runnerSharePct: cfg.runnerSharePct, runnerTpMult: cfg.runnerTpMult }, trade.tpPct, trade.leverage, 0);
      if (plan) {
        const p1Net = Math.round((plan.p1Pct - feeRoi(trade.leverage)) * 100) / 100;
        p1Pct = p1Net; p1Share = plan.share; tp2Pct = plan.tp2Pct; trailPct = trade.tpPct; runner = true;
        notes.push(`TP1 partial @ candle ${new Date(sorted[i].t).toISOString()} — bank ${(plan.share * 100).toFixed(2)}%`);
        continue;
      }
      return finish(price, sorted[i].t, "tp", p1Pct, p1Share, trade, notes, { peakPrice, peakRoi, trailArmed, missedClosePrice, missedPnlPct });
    }
    if (kind === "sl") {
      // SL CONFIRM on closed candle: deep >=15% of stop width -> close now; shallow -> need next candle still beyond SL to close
      const adverse1x = -movePct1x(trade.side, entry, price);
      const deep = adverse1x >= Math.abs(trade.slPct) * (1 + SL_DEEP_FRAC);
      if (deep) return finish(price, sorted[i].t, "sl", p1Pct, p1Share, trade, notes, { peakPrice, peakRoi, trailArmed, missedClosePrice, missedPnlPct });
      const nxt = sorted[i + 1];
      if (nxt && slTpHit(trade.side, nxt.c, entry, trade.slPct, trade.tpPct) === "sl") {
        return finish(nxt.c, nxt.t, "sl", p1Pct, p1Share, trade, notes, { peakPrice, peakRoi, trailArmed, missedClosePrice, missedPnlPct });
      }
      notes.push("SL shallow 1 candle - wait for confirm, do not close on wick");
      continue;
    }
  }
  return { closed: false, replayExitPrice: null, replayExitTime: null, replayExitKind: null, replayPnlPct: null, storedPnlPct: trade.pnlPct, diffPnl: null, wouldFlipToWin: false, notes: [...notes, "replay: no close in candle range - past stored exitTime"], peakPrice, peakRoi, trailArmed, missedClosePrice, missedPnlPct };
}

function finish(price: number, t: number, kind: string, p1Pct: number | null, p1Share: number | null, trade: ReplayTrade, notes: string[], peakInfo?: { peakPrice: number | null; peakRoi: number | null; trailArmed: boolean; missedClosePrice: number | null; missedPnlPct: number | null }): ReplayResult {
  const move = movePct1x(trade.side, trade.entryPrice, price);
  let remPnl = Math.round((move * trade.leverage - feeRoi(trade.leverage)) * 100) / 100;
  if (trade.leverage > 1 && move <= -(100 / trade.leverage)) remPnl = -100;
  else if (remPnl < -100) remPnl = -100;
  const total = combineClosePnl(p1Pct, p1Share, remPnl);
  // Cross-check with audit expectedPnlPctOf when no TP1 partial
  const auditExpected = p1Pct == null ? expectedPnlPctOf({ side: trade.side, entryPrice: trade.entryPrice, exitPrice: price, leverage: trade.leverage, exitKind: kind }) : total;
  const replayPnl = auditExpected ?? total;
  const stored = trade.pnlPct ?? 0;
  // Min peak = this close price (full ReplayResult will get real peak from klines via API)
  const _peakRoi = Math.round(trailMovePct(trade.side, trade.entryPrice, price) * trade.leverage * 100) / 100;
  return {
    closed: true, replayExitPrice: price, replayExitTime: t, replayExitKind: kind,
    replayPnlPct: replayPnl, storedPnlPct: stored, diffPnl: Math.round((replayPnl - stored) * 100) / 100,
    wouldFlipToWin: stored <= 0 && replayPnl > 0,
    notes,
    peakPrice: peakInfo?.peakPrice ?? null, peakRoi: peakInfo?.peakRoi ?? null, trailArmed: peakInfo?.trailArmed ?? false, missedClosePrice: peakInfo?.missedClosePrice ?? null, missedPnlPct: peakInfo?.missedPnlPct ?? null,
  };
}