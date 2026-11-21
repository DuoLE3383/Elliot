// ─── Audit Replay v1 — ĐO, KHÔNG SỬA ───
// Chạy lại evalExit (engine.ts) trên NẾN ĐÃ ĐÓNG, dùng GIÁ ĐÓNG (close),
// không dùng giá wick như watcherTick live.
// Mục đích: đo "nếu chốt bằng giá đóng thì lệnh này lãi bao nhiêu" —
// để chứng minh chốt bằng râu / BE quá chặt làm mất bao nhiêu.
// KHÔNG ghi đè DB, KHÔNG đổi logic live. Chỉ trả đề xuất để so sánh.
import { feeRoe } from "./params";
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
  const notes: string[] = ["close-price replay — khong dung gia wick", "dcaCount=0 (DB khong luu so lan DCA)"];
  const entry = trade.entryPrice;
  const entryMs = new Date(trade.entryTime).getTime();
  // 1) Tái tạo act/dist như updateTrail — khóa 1 lần từ ATR lúc vào lệnh
  let act = cfg.trailActPct, dist = cfg.trailDistPct;
  if (cfg.trailAuto) {
    const lv = atrLevelsAtEntry(klinesBefore.map((k) => ({ t: k.t, o: k.o ?? k.c, h: k.h ?? k.c, l: k.l ?? k.c, c: k.c, v: 0 } as never)), 1.5, 1.4);
    if (lv) {
      const auto = trailAutoLevels(lv.atrPct, trade.leverage);
      act = auto.actPct; dist = auto.distPct;
      notes.push(`act/dist auto tu ATR: act ${act}% dist ${dist}%`);
    }
  }
  let peak = entry;
  let p1Pct: number | null = trade.p1Pct ?? null, p1Share: number | null = trade.p1Share ?? null, tp2Pct = trade.tp2Pct ?? 0, trailPct = trade.trailPct ?? 0;
  let runner = p1Pct != null;
  const sorted = [...klinesAfter].filter((k) => k.t > entryMs).sort((a, b) => a.t - b.t);
  // MFE — đỉnh thuận nhất (giá đóng) trong đời lệnh, tính 1 lần để Audit so với trail
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
      let mRem = Math.round((mMove * trade.leverage - feeRoe(trade.leverage)) * 100) / 100;
      if (trade.leverage > 1 && mMove <= -(100 / trade.leverage)) mRem = -100;
      missedPnlPct = mRem;
    }
  }
  for (let i = 0; i < sorted.length; i++) {
    const price = sorted[i].c;
    if (!price || !entry) continue;
    // Liquidation — ưu tiên như evalExit
    if (liquidationHit(trade.side, price, entry, trade.leverage)) {
      return finish(price, sorted[i].t, "sl", p1Pct, p1Share, trade, notes, { peakPrice, peakRoi, trailArmed, missedClosePrice, missedPnlPct });
    }
    if (runner) {
      const move1x = movePct1x(trade.side, entry, price);
      // 0.3.40 — bỏ chốt cứng TP2: runner chạy theo trail tới hết position
      if (trailHit(trade.side, price, entry, trailPct)) return finish(price, sorted[i].t, "trail", p1Pct, p1Share, trade, notes, { peakPrice, peakRoi, trailArmed, missedClosePrice, missedPnlPct });
      const lock = trailRatchet(trailPct, Math.max(0, move1x), cfg.runnerTrailLock);
      if (lock > trailPct) trailPct = lock;
      continue;
    }
    // NORMAL PHASE — trail trước SL/TP như evalExit
    if (cfg.trailOn) {
      peak = trailNextPeak(trade.side, peak, price);
      const peakRoi = trailMovePct(trade.side, entry, peak) * trade.leverage;
      const roiStop = trailRoiStopPrice(trade.side, entry, peakRoi, trade.leverage);
      const stop = roiStop ?? trailStopPrice(trade.side, entry, peak, act, dist);
      const curRoi = trailMovePct(trade.side, entry, price) * trade.leverage;
      const hit = stop != null && (roiStop != null ? curRoi <= peakRoi - TRAIL_ROI_GIVEBACK : trade.side === "SHORT" ? price >= stop : price <= stop);
      if (hit && stop != null) {
        // 0.3.41 — spec user: trail hit TRƯỚC TP1 → đóng 100% tại stop
        const fillAt = trade.side === "LONG"
          ? (stop > price ? stop : price)
          : (stop < price ? stop : price);
        notes.push(`trail close @ nến ${new Date(sorted[i].t).toISOString()} — fill ${fillAt} (stop ${stop}, mark ${price})`);
        return finish(fillAt, sorted[i].t, "trail", p1Pct, p1Share, trade, notes, { peakPrice, peakRoi, trailArmed, missedClosePrice, missedPnlPct });
      }
    }
    const kind = slTpHit(trade.side, price, entry, trade.slPct, trade.tpPct);
    if (kind === "tp") {
      const plan = tp1Plan({ runnerOn: cfg.runnerOn, runnerSharePct: cfg.runnerSharePct, runnerTpMult: cfg.runnerTpMult }, trade.tpPct, trade.leverage, 0);
      if (plan) {
        const p1Net = Math.round((plan.p1Pct - feeRoe(trade.leverage)) * 100) / 100;
        p1Pct = p1Net; p1Share = plan.share; tp2Pct = plan.tp2Pct; trailPct = trade.tpPct; runner = true;
        notes.push(`TP1 partial @ nến ${new Date(sorted[i].t).toISOString()} — bank ${(plan.share * 100).toFixed(2)}%`);
        continue;
      }
      return finish(price, sorted[i].t, "tp", p1Pct, p1Share, trade, notes, { peakPrice, peakRoi, trailArmed, missedClosePrice, missedPnlPct });
    }
    if (kind === "sl") {
      // SL CONFIRM trên nến đóng: sâu >=15% bề rộng stop → đóng ngay; nông → cần nến sau vẫn vượt SL mới đóng
      const adverse1x = -movePct1x(trade.side, entry, price);
      const deep = adverse1x >= Math.abs(trade.slPct) * (1 + SL_DEEP_FRAC);
      if (deep) return finish(price, sorted[i].t, "sl", p1Pct, p1Share, trade, notes, { peakPrice, peakRoi, trailArmed, missedClosePrice, missedPnlPct });
      const nxt = sorted[i + 1];
      if (nxt && slTpHit(trade.side, nxt.c, entry, trade.slPct, trade.tpPct) === "sl") {
        return finish(nxt.c, nxt.t, "sl", p1Pct, p1Share, trade, notes, { peakPrice, peakRoi, trailArmed, missedClosePrice, missedPnlPct });
      }
      notes.push("SL nong 1 nen — doi xac nhan, khong dong bang rau");
      continue;
    }
  }
  return { closed: false, replayExitPrice: null, replayExitTime: null, replayExitKind: null, replayPnlPct: null, storedPnlPct: trade.pnlPct, diffPnl: null, wouldFlipToWin: false, notes: [...notes, "replay: khong dong trong khoang nen — qua exitTime luu"], peakPrice, peakRoi, trailArmed, missedClosePrice, missedPnlPct };
}

function finish(price: number, t: number, kind: string, p1Pct: number | null, p1Share: number | null, trade: ReplayTrade, notes: string[], peakInfo?: { peakPrice: number | null; peakRoi: number | null; trailArmed: boolean; missedClosePrice: number | null; missedPnlPct: number | null }): ReplayResult {
  const move = movePct1x(trade.side, trade.entryPrice, price);
  let remPnl = Math.round((move * trade.leverage - feeRoe(trade.leverage)) * 100) / 100;
  if (trade.leverage > 1 && move <= -(100 / trade.leverage)) remPnl = -100;
  else if (remPnl < -100) remPnl = -100;
  const total = combineClosePnl(p1Pct, p1Share, remPnl);
  // Đối chiếu với expectedPnlPctOf của audit khi không có TP1 partial
  const auditExpected = p1Pct == null ? expectedPnlPctOf({ side: trade.side, entryPrice: trade.entryPrice, exitPrice: price, leverage: trade.leverage, exitKind: kind }) : total;
  const replayPnl = auditExpected ?? total;
  const stored = trade.pnlPct ?? 0;
  // Peak tối thiểu = giá đóng này (ReplayResult đầy đủ sẽ được API bổ sung peak thật từ klines)
  const _peakRoi = Math.round(trailMovePct(trade.side, trade.entryPrice, price) * trade.leverage * 100) / 100;
  return {
    closed: true, replayExitPrice: price, replayExitTime: t, replayExitKind: kind,
    replayPnlPct: replayPnl, storedPnlPct: stored, diffPnl: Math.round((replayPnl - stored) * 100) / 100,
    wouldFlipToWin: stored <= 0 && replayPnl > 0,
    notes,
    peakPrice: peakInfo?.peakPrice ?? null, peakRoi: peakInfo?.peakRoi ?? null, trailArmed: peakInfo?.trailArmed ?? false, missedClosePrice: peakInfo?.missedClosePrice ?? null, missedPnlPct: peakInfo?.missedPnlPct ?? null,
  };
}
