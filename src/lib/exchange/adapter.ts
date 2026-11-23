// ─── Hợp đồng sàn (exchange adapter): chỉ kiểu + chuyển ký hiệu, không gọi mạng ───
// Mỗi sàn (Binance, OKX, MEXC...) implement ExchangeAdapter. Engine chỉ nói chuyện
// qua interface này. Phí lấy từ cấu hình tài khoản, KHÔNG hard-code: biểu phí mỗi
// sàn khác nhau.

export type ExchangeId = "binance" | "okx" | "mexc";
export type Side = "LONG" | "SHORT";

export interface ExchangeAccount {
  id: string;
  exchange: ExchangeId;
  label: string;
  enabled: boolean;
  quote: "USDT" | "USDC";
  makerFeePct: number;
  takerFeePct: number;
}

export interface OrderReq {
  symbol: string;
  side: Side;
  qty: number;
  leverage: number;
}

export interface OrderFill {
  orderId: string;
  avgPrice: number;
  qty: number;
  feeUsd: number;
}

export interface ExchangeAdapter {
  readonly id: ExchangeId;
  balance(acc: ExchangeAccount): Promise<number>;
  price(acc: ExchangeAccount, symbol: string): Promise<number | null>;
  stepSize(acc: ExchangeAccount, symbol: string): Promise<number>;
  open(acc: ExchangeAccount, req: OrderReq): Promise<OrderFill>;
  close(acc: ExchangeAccount, symbol: string, side: Side, qty: number): Promise<OrderFill>;
}

const QUOTES = ["USDT", "USDC", "BUSD"] as const;

/** "BTCUSDT" → { base: "BTC", quote: "USDT" }. Ném lỗi nếu không có quote hợp lệ. */
export function splitSymbol(sym: string): { base: string; quote: string } {
  const q = QUOTES.find((x) => sym.endsWith(x));
  if (!q) throw new Error(`symbol không có quote hợp lệ: ${sym}`);
  return { base: sym.slice(0, -q.length), quote: q };
}

/** Ký hiệu nội bộ → ký hiệu perpetual gốc của từng sàn. */
export function toNativeSymbol(ex: ExchangeId, sym: string): string {
  const { base, quote } = splitSymbol(sym);
  if (ex === "binance") return `${base}${quote}`;
  if (ex === "okx") return `${base}-${quote}-SWAP`;
  return `${base}_${quote}`;
}
