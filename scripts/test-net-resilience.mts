// Test lớp chống "Unexpected end of JSON input" (0.2.34) — pm2 log 01/11 cho
// thấy đường VPS → Binance bị NGẮT GIỮA response: fetch trả 200 nhưng body
// rỗng/cắt cụt, res.json() ném lỗi cryptic. Sau bản này:
//   • binanceJson() biến body hỏng thành lỗi rõ HOST + triệu chứng
//   • fetchKlinesDirect() failover sang host kế / KLINES_HOSTS override
// Run: npx tsx scripts/test-net-resilience.mts

const ORIG_ENV = process.env.KLINES_HOSTS;
delete process.env.KLINES_HOSTS;

const { binanceHosts, binanceJson, fetchKlinesDirect } = await import("../src/lib/klines-direct");

let failures = 0;
function check(cond: boolean, label: string, detail = "") {
  if (cond) {
    console.log(`  PASS ${label}`);
  } else {
    failures++;
    console.log(`  FAIL ${label} ${detail}`);
  }
}
const expectThrow = async (fn: () => Promise<unknown>, label: string, needle: string) => {
  try {
    await fn();
    check(false, label, "không ném lỗi nào");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    check(msg.includes(needle), label, msg);
  }
};

// ─── 1. binanceJson — parse phòng thủ ─────────────────────────────────────────

console.log("== binanceJson");
const okRes = new Response(JSON.stringify([[1, "2", "3", "4", "5", "6"]]), { status: 200 });
const ok = await binanceJson<unknown[]>(okRes, "https://fapi.binance.com");
check(Array.isArray(ok) && (ok as unknown[]).length === 1, "JSON hợp lệ → parse bình thường");

await expectThrow(
  () => binanceJson(new Response("", { status: 200 }), "https://fapi.binance.com"),
  "body rỗng → lỗi nêu host + 'empty body'",
  "fapi.binance.com: empty body",
);
await expectThrow(
  () => binanceJson(new Response("[[1,2,3", { status: 200 }), "https://fapi1.binance.com"),
  "body cắt cụt → lỗi nêu host + 'truncated'",
  "fapi1.binance.com: truncated/non-JSON body",
);
await expectThrow(
  () => binanceJson(new Response("<html>blocked</html>", { status: 200 }), "https://proxy.example.com"),
  "body HTML (middleware chặn) → lỗi 'truncated/non-JSON'",
  "proxy.example.com",
);

// ─── 2. binanceHosts — KLINES_HOSTS override ──────────────────────────────────

console.log("== binanceHosts");
const def = binanceHosts();
check(def.length === 4 && def[0] === "https://fapi.binance.com", "mặc định 4 host fapi*", JSON.stringify(def));

process.env.KLINES_HOSTS = "https://my-proxy.workers.dev/";
check(binanceHosts().join(",") === "https://my-proxy.workers.dev", "override 1 host + bỏ slash đuôi");

process.env.KLINES_HOSTS = "https://a.workers.dev, https://b.example.com,";
check(binanceHosts().length === 2, "override nhiều host (phẩy, khoảng trắng)");

process.env.KLINES_HOSTS = "my-proxy khong https, javascript:alert(1)";
check(binanceHosts().length === 4, "override rác → rơi về mặc định");

delete process.env.KLINES_HOSTS;
check(binanceHosts().length === 4, "xoá env → về mặc định");

// ─── 3. fetchKlinesDirect — failover qua body hỏng ────────────────────────────

console.log("== fetchKlinesDirect (mock fetch)");
const origFetch = globalThis.fetch;
const hits: string[] = [];
const row = [Date.now(), "68000", "68100", "67900", "68050", "123", 0, "0", 0, "67"];
globalThis.fetch = (async (url: string | URL | Request): Promise<Response> => {
  const raw = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
  hits.push(raw);
  if (raw.startsWith("https://cut1.example.com")) return new Response("", { status: 200 }); // body rỗng
  if (raw.startsWith("https://cut2.example.com")) return new Response('[[1,2,"3"', { status: 200 }); // cắt cụt
  if (raw.startsWith("https://ok.example.com")) return new Response(JSON.stringify([row]), { status: 200 });
  return new Response("nope", { status: 404 });
}) as typeof fetch;

process.env.KLINES_HOSTS = "https://cut1.example.com,https://cut2.example.com,https://ok.example.com";
const kls = await fetchKlinesDirect("BTCUSDT", "1h", 10);
check(kls.length === 1 && kls[0].c === 68050, "2 host đầu body hỏng → host thứ 3 vẫn lấy được nến", JSON.stringify(kls).slice(0, 80));
check(hits.length === 3, "đúng 3 lần fetch (không retry vô ích)", JSON.stringify(hits));

process.env.KLINES_HOSTS = "https://cut1.example.com,https://cut2.example.com";
await expectThrow(
  () => fetchKlinesDirect("BTCUSDT", "1h", 10),
  "cả 2 host đều cắt cụt → ném lỗi nêu host 'truncated'",
  "truncated/non-JSON body",
);

process.env.KLINES_HOSTS = "https://ok.example.com";
const kls2 = await fetchKlinesDirect("BTCUSDT", "1h", 10);
check(kls2.length === 1, "host override khoẻ → 1 lần fetch là xong");

delete process.env.KLINES_HOSTS;
if (ORIG_ENV) process.env.KLINES_HOSTS = ORIG_ENV;
globalThis.fetch = origFetch;

console.log(failures === 0 ? "ALL_NET_RESILIENCE_OK" : `NET_RESILIENCE_FAILED (${failures})`);
process.exit(failures === 0 ? 0 : 1);
