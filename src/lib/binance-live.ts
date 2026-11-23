// ─── binance-live — đặt lệnh THẬT qua Binance USDT-M (0.2.97) ────────────────
// LIVE mode = lớp MIRROR của sổ dry-run B: engine giấy quyết định → module
// này gửi MARKET order thật + ghi khớp vào bảng LiveBook. Dry-run LUÔN chạy
// dù live bật hay tắt.
//
// An toàn:
//   · KHÔNG có key hợp lệ (binance-keys.json hoặc env) → mọi hàm từ chối.
//   · LIVE phải được bật bằng action "liveStart" (engine route) sau khi
//     testBinanceKeys() OK — state sống trong engine.json, restart giữ nguyên.
//   · Qty: balance × stake% × leverage / price → làm tròn theo stepSize của
//     symbol (cache exchangeInfo 12h) → sàn lọc minNotional < 5 USDT thì BỎ.
//   · positionSide one-way (BTCUSDT): LONG = BUY mở/SELL đóng,
//     SHORT = SELL mở/BUY đóng (reduceOnly khi đóng).
//   · Timeout 12s, mọi lỗi chỉ log + note vào LiveBook — không bao giờ giết
//     dry-run cycle.

import { db } from "./db";
import { effectiveKeys } from "./binance-keys";
import { fetchKlinesDirect } from "./klines-direct";
import { fmtPrice } from "./i18n";

const TRADE_HOST = (): string => {
  const raw = (process.env.BINANCE_TRADE_HOST ?? "").trim().replace(/\/+$/, "");
  return /^https?:\/\//.test(raw) ? raw : "https://fapi.binance.com";
};

// ── exchangeInfo cache — stepSize/tickSize/minNotional mỗi symbol ────────────

interface SymbolFilter {
  stepSize: number;
  tickSize: number;
  minNotional: number;
}
interface ExchCache {
  at: number;
  map: Map<string, SymbolFilter>;
}
let exchCache: ExchCache | null = null;
const EXCH_TTL = 12 * 60 * 60_000;

async function signed(method: "GET" | "POST", endpoint: string, params: Record<string, string> = {}, timeoutMs = 12_000): Promise<{ ok: boolean; status: number; body: unknown }> {
  const eff = effectiveKeys();
  if (!eff) throw new Error("no-key");
  const usp = new URLSearchParams({ ...params, timestamp: String(Date.now()), recvWindow: "10000" });
  const { createHmac } = await import("crypto");
  usp.set("signature", createHmac("sha256", eff.secret).update(usp.toString()).digest("hex"));
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`${TRADE_HOST()}${endpoint}?${usp.toString()}`, {
      method,
      headers: { "X-MBX-APIKEY": eff.key },
      signal: ctl.signal,
    });
    const body: unknown = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, body };
  } finally {
    clearTimeout(t);
  }
}

export async function symbolFilter(symbol: string): Promise<SymbolFilter | null> {
  const now = Date.now();
  if (!exchCache || now - exchCache.at > EXCH_TTL) {
    try {
      const res = await fetch(`${TRADE_HOST()}/fapi/v1/exchangeInfo`);
      const j = (await res.json()) as { symbols?: Array<{ symbol: string; quantityPrecision?: number; filters?: Record<string, unknown>[] }> };
      const map = new Map<string, SymbolFilter>();
      for (const s of j.symbols ?? []) {
        let stepSize = 0.001;
        let tickSize = 0.0001;
        let minNotional = 5;
        for (const f of s.filters ?? []) {
          if ((f as { filterType?: string }).filterType === "LOT_SIZE") {
            const ss = (f as { stepSize?: string }).stepSize;
            if (ss) stepSize = Number(ss);
          }
          if ((f as { filterType?: string }).filterType === "PRICE_FILTER") {
            const ts = (f as { tickSize?: string }).tickSize;
            if (ts) tickSize = Number(ts);
          }
          if ((f as { filterType?: string }).filterType === "MIN_NOTIONAL") {
            const nv = (f as { notional?: string }).notional;
            if (nv) minNotional = Number(nv);
          }
        }
        map.set(s.symbol, { stepSize, tickSize, minNotional });
      }
      exchCache = { at: now, map };
    } catch {
      return exchCache?.map.get(symbol) ?? null;
    }
  }
  return exchCache.map.get(symbol) ?? null;
}

/** Làm tròn qty xuống bội stepSize (floor) — loại 0. */
export function roundQty(qty: number, step: number): number {
  if (step <= 0) return qty;
  const q = Math.floor(qty / step) * step;
  return Number(q.toPrecision(12));
}

export interface BinanceBalance {
  ok: boolean;
  balance: number | null;
  canTrade: boolean | null;
  note?: string;
}

/** totalWalletBalance (USDT-M) — vốn sổ live. */
export async function liveBalance(): Promise<BinanceBalance> {
  try {
    const r = await signed("GET", "/fapi/v2/account");
    if (!r.ok) {
      const b = r.body as { code?: number; msg?: string } | null;
      return { ok: false, balance: null, canTrade: null, note: b?.msg ?? `HTTP ${r.status}` };
    }
    const acc = r.body as { totalWalletBalance?: string; canTrade?: boolean } | null;
    return { ok: true, balance: acc?.totalWalletBalance != null ? Number(acc.totalWalletBalance) : null, canTrade: acc?.canTrade ?? null };
  } catch (e) {
    return { ok: false, balance: null, canTrade: null, note: e instanceof Error ? e.message : "error" };
  }
}

/** Đặt leverage cho symbol (one-way). Lỗi kệ — market order vẫn chạy với lev
 *  hiện có trên sàn. */
export async function ensureLeverage(symbol: string, leverage: number): Promise<void> {
  try {
    await signed("POST", "/fapi/v1/leverage", { symbol, leverage: String(Math.max(1, Math.min(125, Math.round(leverage)))) });
  } catch {
    /* ignore */
  }
}

export interface MarketOrderResult {
  ok: boolean;
  orderId?: string;
  avgPrice?: number;
  executedQty?: number;
  note?: string;
}

/** MARKET order + đọc avgPrice khớp thực tế (place rồi GET order — MARKET
 *  khớp gần ngay nên avgPrice có sẵn trong status FILLED/NEW). */
export async function marketOrder(symbol: string, side: "BUY" | "SELL", qty: number, opts?: { reduceOnly?: boolean }): Promise<MarketOrderResult> {
  try {
    const params: Record<string, string> = {
      symbol,
      side,
      type: "MARKET",
      quantity: String(qty),
      newOrderRespType: "RESULT",
    };
    if (opts?.reduceOnly) params.reduceOnly = "true";
    const r = await signed("POST", "/fapi/v1/order", params);
    const b = r.body as { orderId?: number; avgPrice?: string; executedQty?: string; status?: string; msg?: string; code?: number } | null;
    if (!r.ok || !b?.orderId) {
      return { ok: false, note: b?.msg ?? `HTTP ${r.status}` };
    }
    let avg = Number(b.avgPrice ?? 0);
    let exec = Number(b.executedQty ?? 0);
    if (!avg || avg <= 0) {
      // MARKET RESULT trả avgPrice=0 ở một số trường hợp — GET lại
      const g = await signed("GET", "/fapi/v1/order", { symbol, orderId: String(b.orderId) });
      const gb = g.body as { avgPrice?: string; executedQty?: string } | null;
      if (gb?.avgPrice) avg = Number(gb.avgPrice);
      if (gb?.executedQty) exec = Number(gb.executedQty);
    }
    return { ok: true, orderId: String(b.orderId), avgPrice: avg > 0 ? avg : undefined, executedQty: exec > 0 ? exec : undefined };
  } catch (e) {
    return { ok: false, note: e instanceof Error ? e.message : "error" };
  }
}

export interface LiveMirrorResult {
  ok: boolean;
  note: string;
  liveId?: string;
}

/** Mirror một lệnh MỞ của sổ giấy → MARKET thật + dòng LiveBook.
 *  notional = balance × stakePct% × leverage; qty floor theo stepSize;
 *  minNotional không đạt → bỏ lệnh (ghi note). */
export async function liveOpen(symbol: string, side: "LONG" | "SHORT", dryRunTradeId: string, leverage: number, stakePct: number, note?: string): Promise<LiveMirrorResult> {
  try {
    const bal = await liveBalance();
    if (!bal.ok || !bal.balance || bal.balance <= 0) {
      return { ok: false, note: `live mở bỏ qua: ${bal.note ?? "không đọc được balance"}` };
    }
    // giá tham chiếu: nến 1m gần nhất (đủ chính xác cho qty)
    const kl = await fetchKlinesDirect(symbol, "1m", 2);
    const price = kl.length ? kl[kl.length - 1].c : 0;
    if (!(price > 0)) return { ok: false, note: "live mở bỏ qua: không đọc được giá" };
    const f = await symbolFilter(symbol);
    if (!f) return { ok: false, note: "live mở bỏ qua: symbol không có trên futures" };
    const notional = (bal.balance * (stakePct / 100) * leverage);
    let qty = roundQty(notional / price, f.stepSize);
    if (qty <= 0 || qty * price < Math.max(f.minNotional, 5)) {
      return { ok: false, note: `live mở bỏ qua: notional ${notional.toFixed(2)} USDT < min ${Math.max(f.minNotional, 5)} USDT` };
    }
    await ensureLeverage(symbol, leverage);
    const ord = await marketOrder(symbol, side === "LONG" ? "BUY" : "SELL", qty);
    if (!ord.ok) return { ok: false, note: `live mở lỗi: ${ord.note ?? "?"}` };
    const fill = ord.avgPrice ?? price;
    const row = await db.liveBook.create({
      data: {
        symbol,
        side,
        entryPrice: fill,
        status: "open",
        qty: ord.executedQty ?? qty,
        notional: (ord.executedQty ?? qty) * fill,
        leverage,
        binanceOrderId: ord.orderId,
        dryRunTradeId,
        balanceBefore: bal.balance,
        note: note ?? null,
      },
    });
    console.log(`[live] OPEN ${side} ${symbol} qty ${(ord.executedQty ?? qty).toPrecision(6)} @ ${fmtPrice(fill)} orderId ${ord.orderId} balance ${bal.balance}`);
    return { ok: true, note: "opened", liveId: row.id };
  } catch (e) {
    return { ok: false, note: `live mở lỗi: ${e instanceof Error ? e.message : "unknown"}` };
  }
}

/** Mirror một lệnh ĐÓNG của sổ giấy → MARKET reduceOnly ngược chiều.
 *  dryRunTradeId khớp dòng LiveBook đang mở của cùng symbol. */
export async function liveClose(symbol: string, side: "LONG" | "SHORT", dryRunTradeId: string, exitKind: string): Promise<LiveMirrorResult> {
  try {
    const open = await db.liveBook.findFirst({ where: { status: "open", symbol, dryRunTradeId }, orderBy: { entryTime: "desc" } });
    if (!open) return { ok: false, note: "live đóng bỏ qua: không tìm thấy dòng live mở" };
    const ord = await marketOrder(symbol, side === "LONG" ? "SELL" : "BUY", open.qty, { reduceOnly: true });
    const bal = await liveBalance();
    if (!ord.ok) {
      await db.liveBook.update({ where: { id: open.id }, data: { note: `close fail: ${ord.note ?? "?"} (giữ open, thử tick sau)` } });
      return { ok: false, note: `live đóng lỗi: ${ord.note ?? "?"}` };
    }
    const fill = ord.avgPrice ?? open.entryPrice;
    const raw = side === "LONG" ? (fill - open.entryPrice) / open.entryPrice : (open.entryPrice - fill) / open.entryPrice;
    const movePct = Math.round(raw * 100 * 100) / 100;
    const roePct = Math.round(movePct * open.leverage * 100) / 100; // ROI = move × lev (phí 2 chân ghi note)
    await db.liveBook.update({
      where: { id: open.id },
      data: {
        status: "closed",
        exitPrice: fill,
        exitTime: new Date(),
        exitKind,
        binanceExitOrderId: ord.orderId,
        movePct,
        roePct,
        balanceAfter: bal.ok ? bal.balance : null,
        note: `closed ${exitKind}`,
      },
    });
    console.log(`[live] CLOSE ${side} ${symbol} @ ${fmtPrice(fill)} (${exitKind}) move ${movePct}% balance ${open.balanceBefore ?? "?"}→${bal.balance ?? "?"}`);
    return { ok: true, note: "closed", liveId: open.id };
  } catch (e) {
    return { ok: false, note: `live đóng lỗi: ${e instanceof Error ? e.message : "unknown"}` };
  }
}

/** LIVE đang có vị thế sàn nào không — dùng để cảnh báo khi turn-off còn lệnh. */
export async function liveOpenCount(): Promise<number> {
  try {
    return await db.liveBook.count({ where: { status: "open" } });
  } catch {
    return 0;
  }
}
