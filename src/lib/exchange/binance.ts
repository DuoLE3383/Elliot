// ─── Binance adapter ────────────────────────────────────────────────────────
// Bọc các hàm có sẵn trong binance-live.ts (không viết lại logic ký lệnh).
// Dùng chung một tài khoản Binance (khoá toàn cục). acc.id chưa dùng để chọn khoá.
// Chưa được engine gọi: engine vẫn đi qua liveOpen/liveClose.
//
// QUY TẮC AN TOÀN: một lệnh đã có orderId là lệnh đã nằm trên sàn. Không bao giờ
// ném lỗi "thất bại" cho lệnh như vậy, vì engine sẽ coi như không có vị thế và
// để lại vị thế mồ côi. Thiếu giá khớp thì dùng ticker, thiếu qty thì dùng qty đã gửi.

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

async function tickerPrice(nativeSym: string): Promise<number | null> {
  try {
    const r = await fetch(`https://fapi.binance.com/fapi/v1/ticker/price?symbol=${nativeSym}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(2500),
    });
    if (!r.ok) return null;
    const p = Number((await r.json()).price);
    return Number.isFinite(p) && p > 0 ? p : null;
  } catch {
    return null;
  }
}

/** Chuyển kết quả marketOrder thành OrderFill. Chỉ ném lỗi khi lệnh CHƯA được đặt. */
async function toFill(
  r: MarketOrderResult,
  acc: ExchangeAccount,
  symbol: string,
  reqQty: number,
  action: string,
): Promise<OrderFill> {
  if (!r.orderId) {
    throw new Error(`binance ${action} ${symbol} chưa đặt được: ${r.note ?? "không có orderId"}`);
  }
  let avg = r.avgPrice ?? null;
  if (!avg) {
    console.warn(`[binance] ${action} ${symbol} orderId=${r.orderId}: thiếu avgPrice, dùng ticker`);
    avg = await tickerPrice(toNativeSymbol("binance", symbol));
  }
  if (!avg) {
    // Lệnh đã nằm trên sàn nhưng không có giá: KHÔNG ném lỗi thường. Phía gọi phải đối soát theo orderId.
    throw new Error(`ORDER_ON_EXCHANGE_UNPRICED orderId=${r.orderId} ${symbol} ${action}: cần đối soát`);
  }
  const qty = r.executedQty ?? reqQty;
  return {
    orderId: r.orderId,
    avgPrice: avg,
    qty,
    feeUsd: Math.round(avg * qty * (acc.takerFeePct / 100) * 100) / 100, // ước lượng, không phải phí thực
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
    return tickerPrice(toNativeSymbol("binance", symbol));
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
    return toFill(r, acc, req.symbol, qty, "open");
  },

  async close(acc: ExchangeAccount, symbol: string, side: Side, qty: number): Promise<OrderFill> {
    const sym = toNativeSymbol("binance", symbol);
    const f = await symbolFilter(sym);
    if (!f) throw new Error(`binance: không có symbol ${symbol}`);
    const q = roundQty(qty, f.stepSize);
    if (!(q > 0)) throw new Error(`binance close ${symbol}: qty ${qty} nhỏ hơn stepSize ${f.stepSize}`);
    const r = await marketOrder(sym, orderSide(side, true), q, { reduceOnly: true });
    return toFill(r, acc, symbol, q, "close");
  },
};
