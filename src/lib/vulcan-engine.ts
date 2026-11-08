// ─── VULCAN ENGINE (0.2.93) — sổ dry-run CHIẾN LƯỢC A, tách biệt hoàn toàn ───
// Sổ A (DonchianBreakout port — ./vulcan) sống trong bảng VulcanBook RIÊNG,
// KHÔNG đụng bảng AutoTrade (sổ B — Elliott) và engine.ts. Lý do tách bảng:
// một lỗi logic bên A không bao giờ làm vỡ chuỗi vốn của B, và /arena đọc
// được cả hai sổ để so head-to-head.
//
// Luồng vốn sổ A: chuỗi tuyến tính như sổ B (capitalAfter kế thừa) — một vị
// thế mở TOÀN CỤC tại mỗi thời điểm (đơn giản, rà sổ được bằng audit-book).
// Vốn xuất phát = vốn ví DryRunState sau lần reset gần nhất (cùng mốc với B
// để so sánh công bằng), fallback 1000.
//
// Nhịp: bám mốc nến 15m đóng (mốc :00/:15/:30/:45 + 15s cho kline chốt),
// quét lần lượt VULCAN_SYMBOLS; mở/tköng một vị thế theo decideVulcanLive().
// pm2 restart an toàn: stop/peak/trailArmed lưu trong dòng DB, tick kế tiếp
// tự nhận lại vị thế dở từ nến mới.

import { db } from "./db";
import { fetchKlinesDirect } from "./klines-direct";
import { feeRoe } from "./params";
import { readWallet } from "./autostate";
import {
  VULCAN_DEFAULTS,
  computeIndicators,
  entrySignalAt,
  type Candle,
  type VulcanParams,
} from "./vulcan";

export const VULCAN_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "DOGEUSDT", "XLMUSDT"];
export const VULCAN_STAKE_PCT = 10; // mỗi lệnh dùng 10% equity sổ A
export const VULCAN_LEV = VULCAN_DEFAULTS.leverage; // 5 — đúng chiến lược gốc

export interface VulcanOpenState {
  side: "LONG" | "SHORT";
  entry: number;
  entryTime: number; // ms — entryTime của dòng DB
  barsHeld: number; // số nến 15m đã trôi qua kể từ nến vào lệnh
  stopPrice: number;
  peak: number;
  trailArmed: boolean;
}

export type VulcanAction =
  | { kind: "hold" }
  | { kind: "open"; side: "LONG" | "SHORT"; entry: number; stopPrice: number; atr: number }
  | { kind: "close"; price: number; exitKind: string };

/** Trailing có thể siết stop/đỉnh — trả kèm để engine ghi DB cho tick sau. */
export interface VulcanLiveState {
  stopPrice: number;
  peak: number;
  trailArmed: boolean;
}

export interface VulcanDecision {
  action: VulcanAction;
  state?: VulcanLiveState;
}

/**
 * Quyết định cho MỘT symbol tại nến đóng cuối cùng (nowIdx = cuối mảng).
 * Thứ tự thoát khớp backtest: 1) stop chạm (gap → khớp open), 2) trailing
 * siết stop, 3) ROI ladder theo phút nắm giữ, 4) tín hiệu thoát mid/RSI
 * (chỉ sau minHoldBars nến). Không có vị thế → xem tín hiệu vào (nến cuối).
 */
export function decideVulcanLive(candles: Candle[], open: VulcanOpenState | null, p: VulcanParams): VulcanDecision {
  const ind = computeIndicators(candles, p);
  const i = candles.length - 1;
  const bar = candles[i];
  if (i < p.donPeriod + 1) return { action: { kind: "hold" } };

  if (open) {
    const state: VulcanLiveState = { stopPrice: open.stopPrice, peak: open.peak, trailArmed: open.trailArmed };
    // 1) stop theo giá (stop đã được trailing siết từ các tick trước)
    if (open.side === "LONG" && bar.l <= state.stopPrice)
      return { action: { kind: "close", price: Math.min(bar.o, state.stopPrice), exitKind: "sl" }, state };
    if (open.side === "SHORT" && bar.h >= state.stopPrice)
      return { action: { kind: "close", price: Math.max(bar.o, state.stopPrice), exitKind: "sl" }, state };

    const movePct = open.side === "LONG" ? ((bar.c - open.entry) / open.entry) * 100 : ((open.entry - bar.c) / open.entry) * 100;
    const heldMin = (bar.t - open.entryTime) / 60000;

    // 2) trailing — cập nhật đỉnh bằng nến hiện tại, siết stop cho các tick sau
    if (open.side === "LONG" && bar.h > state.peak) state.peak = bar.h;
    if (open.side === "SHORT" && (state.peak === 0 || bar.l < state.peak)) state.peak = bar.l;
    if (!state.trailArmed && movePct >= p.trailTriggerPct) state.trailArmed = true;
    if (state.trailArmed) {
      if (open.side === "LONG") {
        const ts = state.peak * (1 - p.trailGivebackPct / 100);
        if (ts > state.stopPrice) state.stopPrice = ts;
      } else {
        const ts = state.peak * (1 + p.trailGivebackPct / 100);
        if (ts < state.stopPrice) state.stopPrice = ts;
      }
    }

    // 3) ROI ladder theo % giá + phút nắm giữ
    for (let k = p.roiLadder.length - 1; k >= 0; k--) {
      if (heldMin >= p.roiLadder[k].afterMin && movePct >= p.roiLadder[k].movePct)
        return { action: { kind: "close", price: bar.c, exitKind: `roi_${p.roiLadder[k].movePct}pct` }, state };
    }

    // 4) tín hiệu thoát (mid/RSI) — sau minHoldBars nến
    if (open.barsHeld >= p.minHoldBars) {
      if (open.side === "LONG" && (bar.c < ind.donMid[i] || ind.rsi[i] > p.rsiOverbought))
        return { action: { kind: "close", price: bar.c, exitKind: ind.rsi[i] > p.rsiOverbought ? "rsi_exit" : "mid_exit" }, state };
      if (open.side === "SHORT" && (bar.c > ind.donMid[i] || ind.rsi[i] < p.rsiOversold))
        return { action: { kind: "close", price: bar.c, exitKind: ind.rsi[i] < p.rsiOversold ? "rsi_exit" : "mid_exit" }, state };
    }
    const changed =
      state.stopPrice !== open.stopPrice || state.peak !== open.peak || state.trailArmed !== open.trailArmed;
    return { action: { kind: "hold" }, state: changed ? state : undefined };
  }

  const sig = entrySignalAt(candles, ind, i, p);
  if (!sig) return { action: { kind: "hold" } };
  const entry = bar.c;
  const atr = ind.atr[i];
  let distPct = atr > 0 ? ((p.atrStopMult * atr) / entry) * 100 : p.maxStopDistPct;
  if (distPct > p.maxStopDistPct) distPct = p.maxStopDistPct;
  const stopPrice = sig === "LONG" ? entry * (1 - distPct / 100) : entry * (1 + distPct / 100);
  return { action: { kind: "open", side: sig, entry, stopPrice, atr } };
}

// ── Sổ & chuỗi vốn ───────────────────────────────────────────────────────────

async function vulcanChainHead(): Promise<number> {
  const last = await db.vulcanBook.findFirst({ where: { status: "closed" }, orderBy: { exitTime: "desc" } });
  if (last?.capitalAfter != null) return last.capitalAfter;
  const wallet = await readWallet();
  return wallet.capital ?? 1000;
}

async function vulcanSymbolTick(symbol: string, lastCandleT: Map<string, number>): Promise<void> {
  const kl = await fetchKlinesDirect(symbol, "15m", 130);
  if (kl.length < 40) return; // chưa đủ nến cho Donchian 20 + startup
  const lastT = kl[kl.length - 1].t;
  if (lastCandleT.get(symbol) === lastT) return; // nến đã xử lý rồi
  lastCandleT.set(symbol, lastT);

  const openRow = await db.vulcanBook.findFirst({ where: { status: "open" } }); // một vị thế toàn cục sổ A
  const isOpenForSymbol = openRow?.symbol === symbol;
  const now = Date.now();

  const open: VulcanOpenState | null =
    openRow && isOpenForSymbol
      ? {
          side: openRow.side === "SHORT" ? "SHORT" : "LONG",
          entry: openRow.entryPrice,
          entryTime: openRow.entryTime.getTime(),
          barsHeld: Math.max(0, Math.floor((lastT - openRow.entryTime.getTime()) / 900_000)),
          stopPrice: openRow.stopPrice,
          peak: openRow.peak,
          trailArmed: openRow.trailArmed,
        }
      : null;

  const decision = decideVulcanLive(kl as Candle[], open, VULCAN_DEFAULTS);
  const action = decision.action;

  if (action.kind === "close" && openRow && open) {
    const raw =
      open.side === "LONG" ? (action.price - open.entry) / open.entry : (open.entry - action.price) / open.entry;
    const movePct = Math.round(raw * 100 * 100) / 100;
    const roePct = Math.round((movePct * VULCAN_LEV - feeRoe(VULCAN_LEV)) * 100) / 100;
    const before = openRow.capitalBefore ?? (await vulcanChainHead());
    const delta = Math.round(before * (VULCAN_STAKE_PCT / 100) * (roePct / 100) * 100) / 100;
    const after = Math.max(0, Math.round((before + delta) * 100) / 100);
    await db.vulcanBook.update({
      where: { id: openRow.id },
      data: {
        status: "closed",
        exitPrice: action.price,
        exitTime: new Date(now),
        exitKind: action.exitKind,
        movePct,
        roePct,
        capitalAfter: after,
      },
    });
    console.log(`[vulcan] CLOSE ${open.side} ${symbol} @ ${action.price} (${action.exitKind}) move ${movePct}% ROE ${roePct}% vốn ${before}→${after}`);
    return;
  }

  if (action.kind === "open" && !openRow) {
    const head = await vulcanChainHead();
    const created = await db.vulcanBook.create({
      data: {
        symbol,
        side: action.side,
        entryPrice: action.entry,
        entryTime: new Date(now),
        status: "open",
        stopPrice: action.stopPrice,
        peak: action.side === "LONG" ? kl[kl.length - 1].h : kl[kl.length - 1].l,
        trailArmed: false,
        capitalBefore: head,
      },
    });
    console.log(`[vulcan] OPEN ${action.side} ${symbol} @ ${action.entry} stop ${action.stopPrice.toFixed(6)} (ATR×${VULCAN_DEFAULTS.atrStopMult}) vốn ${head} id=${created.id}`);
    return;
  }

  // hold — nhưng nếu trailing vừa siết stop thì cập nhật DB cho tick sau
  if (openRow && isOpenForSymbol && open && decision.state && decision.state.stopPrice !== open.stopPrice) {
    await db.vulcanBook.update({
      where: { id: openRow.id },
      data: { stopPrice: decision.state.stopPrice, peak: decision.state.peak, trailArmed: decision.state.trailArmed },
    });
  }
}

let started = false;

/** Khởi động nhịp sổ A — gọi MỘT lần lúc boot (engine.ts). VULCAN_A=0 để tắt. */
export function startVulcanEngine(): void {
  if (started || process.env.VULCAN_A === "0") return;
  started = true;
  const lastCandleT = new Map<string, number>();
  const tickAll = async (): Promise<void> => {
    for (const sym of VULCAN_SYMBOLS) {
      try {
        await vulcanSymbolTick(sym, lastCandleT);
      } catch (e) {
        console.error(`[vulcan] ${sym}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  };
  // boot: sau 40s chạy một lượt (nhận lại vị thế dở sau restart), rồi bám mốc 15m
  const boot = setTimeout(() => {
    void tickAll();
    const arm = (): void => {
      const now = Date.now();
      const next = Math.ceil(now / 900_000) * 900_000 + 15_000;
      const t = setTimeout(() => {
        void tickAll().then(arm);
      }, next - now);
      t.unref?.();
    };
    arm();
  }, 40_000);
  boot.unref?.();
  console.warn(`[vulcan] engine A khởi động — ${VULCAN_SYMBOLS.length} symbol 15m, lev ${VULCAN_LEV}, stake ${VULCAN_STAKE_PCT}%, sổ bảng VulcanBook`);
}
