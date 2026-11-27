// ─── mark-price — lấy giá Mark Price thời gian thực từ Binance Futures ─────────
// Dùng REST poll (fapi/v1/premiumIndex) để đảm bảo ổn định trên mọi VPS.
// Cache TTL 3s để tránh rate limit khi watcher chạy liên tục.

const API_URL = "https://fapi.binance.com/fapi/v1/premiumIndex";
const TTL = 3000;

interface MarkPriceCache {
  prices: Map<string, { price: number; ts: number }>;
  lastFetch: number;
  fetching: boolean;
}

const cache: MarkPriceCache = {
  prices: new Map(),
  lastFetch: 0,
  fetching: false,
};

async function fetchAll() {
  if (cache.fetching) return;
  cache.fetching = true;
  try {
    const res = await fetch(API_URL, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as Array<{ symbol: string; markPrice: string }>;
    const now = Date.now();
    for (const item of data) {
      cache.prices.set(item.symbol, { price: Number(item.markPrice), ts: now });
    }
    cache.lastFetch = now;
  } catch (e) {
    console.error("[mark-price] fetch failed:", e);
  } finally {
    cache.fetching = false;
  }
}

export async function getMarkPrice(symbol: string): Promise<number> {
  const now = Date.now();
  if (now - cache.lastFetch > TTL) {
    void fetchAll();
  }
  const entry = cache.prices.get(symbol);
  if (entry && now - entry.ts < TTL) return entry.price;
  try {
    const res = await fetch(`${API_URL}?symbol=${symbol}`, { cache: "no-store" });
    if (res.ok) {
      const data = (await res.json()) as { markPrice: string };
      const price = Number(data.markPrice);
      if (price > 0) {
        cache.prices.set(symbol, { price, ts: now });
        return price;
      }
    }
  } catch { /* ignore */ }
  return 0;
}

export async function getMarkPrices(symbols: string[]): Promise<Map<string, number>> {
  const now = Date.now();
  if (now - cache.lastFetch > TTL) {
    await fetchAll();
  }
  const out = new Map<string, number>();
  for (const s of symbols) {
    const entry = cache.prices.get(s);
    if (entry) out.set(s, entry.price);
  }
  return out;
}
