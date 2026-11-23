// ─── Binance adapter (một phần) ─────────────────────────────────────────────
// Đã nối: balance (fail loud khi lỗi), price (ticker công khai), stepSize (exchangeInfo).
// Chưa nối: open / close — cần export hàm đặt đòn bẩy trong binance-live.ts.
// Engine vẫn gọi liveOpen/liveClose trực tiếp cho đến khi nối xong.

import type { ExchangeAccount, ExchangeAdapter, OrderFill } from "./adapter";
import { toNativeSymbol } from "./adapter";
import { liveBalance, symbolFilter } from "../binance-live";

const NOT_WIRED = "binance adapter: open/close chưa nối — engine vẫn dùng liveOpen/liveClose";

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

  async open(): Promise<OrderFill> {
    throw new Error(NOT_WIRED);
  },

  async close(): Promise<OrderFill> {
    throw new Error(NOT_WIRED);
  },
};
