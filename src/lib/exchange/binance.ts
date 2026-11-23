// ─── Binance adapter (một phần) ─────────────────────────────────────────────
// Đã nối: balance (liveBalance), price (ticker công khai).
// Chưa nối: stepSize / open / close — cần đọc SymbolFilter và MarketOrderResult
// trong binance-live.ts trước. Engine vẫn gọi liveOpen/liveClose trực tiếp.

import type { ExchangeAccount, ExchangeAdapter, OrderFill } from "./adapter";
import { toNativeSymbol } from "./adapter";
import { liveBalance } from "../binance-live";

const NOT_WIRED = "binance adapter: chưa nối — engine vẫn dùng liveOpen/liveClose trực tiếp";

export const binanceAdapter: ExchangeAdapter = {
  id: "binance",

  async balance(_acc: ExchangeAccount): Promise<number> {
    const b = await liveBalance();
    return Number(b.balance);
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

  async stepSize(): Promise<number> {
    throw new Error(NOT_WIRED);
  },

  async open(): Promise<OrderFill> {
    throw new Error(NOT_WIRED);
  },

  async close(): Promise<OrderFill> {
    throw new Error(NOT_WIRED);
  },
};
