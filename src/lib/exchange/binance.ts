// ─── Binance adapter ────────────────────────────────────────────────────────
// Bọc các hàm có sẵn trong binance-live.ts (không viết lại logic ký lệnh).
// Dùng chung một tài khoản Binance (khoá toàn cục). acc.id chưa được dùng
// để chọn khoá — nhiều tài khoản Binance cần tách khoá theo accountId trước.
// Chưa được engine gọi: engine vẫn đi qua liveOpen/liveClose.

import type { ExchangeAccount, ExchangeAdapter, OrderFill, Side } from "./adapter";
import { toNativeSymbol } from "./adapter";
import {
  ensureLeverage,
  liveBalance,
  marketOrder,
  roundQty,
  symbolFilter,
  type MarketOrderResult,
} from "../binance-live";

/** LONG mở = BUY, LONG đóng = SELL; SHORT mở = SELL, SHORT đóng = BUY. */
const orderSide = (side: Side, closing: boolean): "BUY" | "SELL" => {
  const buy = side === "LONG" ? !closing : closing;
  return buy ? "BUY" : "SELL";
};

/** Phí ước tính theo biểu phí của tài khoản (takerFeePct tính bằng %).
 *  marketOrder không trả phí thực từ sàn nên đây là ước lượng, không phải số đối soát. */
function toFill(r: MarketOrderResult, acc: ExchangeAccount, symbol: string, action: string): OrderFill {
  if (!r.ok || !r.orderId || !r.avgPrice || !r.executedQty) {
    throw new Error(`binance ${action} ${symbol} thất bại: ${r.note ?? "không có fill"}`);
  }
  const notional = r.avgPrice * r.executedQty;
  return {
    orderId: r.orderId,
    avgPrice: r.avgPrice,
    qty: r.executedQty,
    feeUsd: Math.round(notional * (acc.takerFeePct / 100) * 100) / 100,
  };
}

export const binanceAdapter: ExchangeAdapter = {
  id: "binance",

  async balance(_acc: ExchangeAccount): Promise<number> {
    const b = await liveBalance();
    if (!b.ok || b.balance == null) {
      throw new Error(b.note ?? "binance: không đọc được số dư ví");
    }
    return b.balance;
  },

  async price(_acc: ExchangeAccount, symbol: string): Promise<number | null> {
    try {
      const url = `https://fapi.binance.com/fapi/v1/ticker/price?symbol=${toNativeSymbol("binance", symbol)}`;
      const r = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(2500) });
      if (!r.ok) return null;
      const p = Number((await r.json()).price);
      return Number.isFinite(p) && p > 0 ? p : null;
    } catch {
      return null;
    }
  },

  async stepSize(_acc: ExchangeAccount, symbol: string): Promise<number> {
    const f = await symbolFilter(toNativeSymbol("binance", symbol));
    if (!f) throw new Error(`binance: không có symbol ${symbol} trên exchangeInfo`);
    return f.stepSize;
  },

  async open(acc: ExchangeAccount, req) {
    const sym = toNativeSymbol("binance", req.symbol);
    const f = await symbolFilter(sym);
    if (!f) throw new Error(`binance: không có symbol ${req.symbol}`);
    const qty = roundQty(req.qty, f.stepSize);
    if (!(qty > 0)) throw new Error(`binance open ${req.symbol}: qty ${req.qty} nhỏ hơn stepSize ${f.stepSize}`);
    await ensureLeverage(sym, req.leverage);
    const r = await marketOrder(sym, orderSide(req.side, false), qty);
    return toFill(r, acc, req.symbol, "open");
  },

  async close(acc: ExchangeAccount, symbol: string, side: Side, qty: number): Promise<OrderFill> {
    const sym = toNativeSymbol("binance", symbol);
    const f = await symbolFilter(sym);
    if (!f) throw new Error(`binance: không có symbol ${symbol}`);
    const q = roundQty(qty, f.stepSize);
    if (!(q > 0)) throw new Error(`binance close ${symbol}: qty ${qty} nhỏ hơn stepSize ${f.stepSize}`);
    const r = await marketOrder(sym, orderSide(side, true), q, { reduceOnly: true });
    return toFill(r, acc, symbol, "close");
  },
};
