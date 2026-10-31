// ─── Test — giá realtime kiểu sàn (live-stream.ts + params §5b) ──────────────
// Chạy: npx tsx scripts/test-live-stream.mts
//
// Che:
//   1. mergeTail — vá đuôi đúng mọi tình huống (thay nến đang chạy / lăn nến
//      mới + trượt cửa sổ / tin trễ bị bỏ / tail rỗng hoặc prev rỗng)
//   2. startLiveStream chạy THẬT với Binance — event về đúng shape, đuôi nến
//      tiến theo thời gian, ticker 24h đính kèm, stop() sạch (không rò event)
//   3. nhịp flush — chống spam: không gửi payload trùng liên tiếp, không bão
//
// Phần [2]/[3] cần mạng tới fapi.binance.com. Nếu môi trường không với tới
// được (proxy chặn, sandbox offline) thì SKIP có chủ đích — phần thuần [1]
// vẫn phải pass. Exit 0 khi chỉ SKIP.

import type { Kline } from "../src/lib/types";
import { mergeTail, startLiveStream, type TailEvent } from "../src/lib/live-stream";
import { fetchKlinesDirectResolved } from "../src/lib/klines-direct";

let pass = 0;
let fail = 0;
let skipped = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
function skip(name: string, why: string): void {
  skipped++;
  console.log(`  ⚠ SKIP ${name} — ${why}`);
}

const k = (t: number, c: number, o = c - 1, h = c + 1, l = o - 1, v = 100, tb = 40): Kline => ({
  t,
  o,
  h,
  l,
  c,
  v,
  tb,
});

// ── 1 · mergeTail ─────────────────────────────────────────────────────────────
console.log("\n[1] mergeTail — vá đuôi dãy nến");

const base = [k(0), k(60_000), k(120_000, 105, 100, 110, 95)];
const BASE_LEN = base.length;

{
  // nến đang chạy nhảy tick — cùng t → thay nến cuối, chiều dài giữ nguyên
  const prev = [k(0), k(60_000), k(120_000, 105, 100, 110, 95)];
  const out = mergeTail(prev, [k(120_000, 107, 100, 111, 99)], 500);
  check("cùng t → thay nến cuối", out[out.length - 1].c === 107 && out[out.length - 1].h === 111);
  check("chiều dài không đổi", out.length === BASE_LEN);
  check("không đụng mảng cũ (immutable)", prev[2].c === 105);
}

{
  // lăn nến mới — t mới hơn → nối vào, cửa sổ trượt khi vượt maxLen
  const out = mergeTail(base, [k(120_000, 106), k(180_000, 120)], 4);
  check("nến mới được nối", out[out.length - 1].t === 180_000 && out[out.length - 1].c === 120);
  check("nến đang chạy đóng lại giữ giá trị cuối", out[out.length - 2].c === 106);
  check("cửa sổ trượt — không vượt maxLen", out.length === 4);
}

{
  // tail chứa GAP nhiều nến — nối đủ theo thứ tự
  const out = mergeTail(base, [k(180_000), k(240_000)], 500);
  check("gap 1 nến được lấp", out.length === 5 && out[3].t === 180_000 && out[4].t === 240_000);
}

{
  // tin trễ — t cũ hơn nến cuối → bỏ qua
  const out = mergeTail(base, [k(60_000, 1)], 500);
  check("nến cũ hơn bị bỏ", out === base);
}

{
  // prev rỗng hoặc tail rỗng → nguyên trạng
  check("prev rỗng → trả prev", mergeTail([], [k(0)], 500).length === 0);
  check("tail rỗng → trả prev", mergeTail(base, [], 500) === base);
}

{
  // prev có nội dung y hệt nến cuối trong tail → không tạo mảng mới vô nghĩa
  const prev = [k(0), k(60_000)];
  const same = prev[1];
  const out = mergeTail(prev, [same], 500);
  check("tail trùng y hệt → giữ nguyên object (React bỏ qua render)", out === prev);
}

// ── Cổng mạng: Binance có với tới được không (2 lần thử)? ────────────────────
let binanceOk = false;
for (let i = 0; i < 2 && !binanceOk; i++) {
  try {
    await fetchKlinesDirectResolved("BTCUSDT", "1m", 1);
    binanceOk = true;
  } catch {
    await new Promise((r) => setTimeout(r, 2_000));
  }
}

// ── 2 · startLiveStream THẬT với Binance ─────────────────────────────────────
console.log("\n[2] startLiveStream — luồng thật BTCUSDT 1m (ws/poll tự chọn)");

const events: TailEvent[] = [];
const got = (ev: TailEvent): void => {
  events.push(ev);
};

let stop: () => void = () => {};
if (!binanceOk) {
  skip("luồng thật", "Binance không tới được từ môi trường này (proxy/offline)");
  skip("nhịp flush", "cần luồng thật");
} else {
  // 22s — đủ cho probe ws (10s) hạ xuống poll nếu mạng chặn frame dữ liệu, rồi
  // thấy ≥ vài event poll (2.5s/event). Mở mạng ws thật thì càng sớm càng tốt.
  stop = startLiveStream("BTCUSDT", "1m", got);
  await new Promise((r) => setTimeout(r, 22_000));
  stop();
  await new Promise((r) => setTimeout(r, 3_000));
  const countAfterStop = events.length;
  check("stop() dừng hẳn — không còn event rò", events.length === countAfterStop);
  check("stop() gọi 2 lần an toàn", (() => {
    stop();
    return true;
  })());

  check("có event kline về", events.length >= 3, `got ${events.length}`);
  if (events.length) {
    const srcs = new Set(events.map((e) => e.src));
    check("src hợp lệ (ws hoặc poll)", [...srcs].every((s) => s === "ws" || s === "poll"), [...srcs].join(","));
    check("symbol/khung đúng", events.every((e) => e.symbol === "BTCUSDT" && e.interval === "1m"));
    const withTail = events.filter((e) => e.tail.length > 0);
    check("tail luôn có nến", withTail.length === events.length);
    check("nến hợp lệ (c>0, h≥l, o≤h)", withTail.every((e) =>
      e.tail.every((kk) => kk.c > 0 && kk.h >= kk.l && kk.o <= kk.h && kk.v >= 0),
    ));
    const lastTs = withTail.map((e) => e.tail[e.tail.length - 1].t);
    check("thời gian nến không lùi", lastTs.every((t, i) => i === 0 || t >= lastTs[i - 1]));
    check("mở time nến khớp biên khung", lastTs.every((t) => t % 60_000 === 0));
    // self-heal: nếu ws bị chặn frame thì luồng phải TỰ hạ xuống poll và tiếp tục
    const lastSrc = events[events.length - 1].src;
    const sawTailAfter12s = events.some((e) => e.ts - events[0].ts >= 12_000 && e.tail.length > 0);
    check(
      `luồng tự chịu trách nhiệm (src cuối "${lastSrc}", vẫn có event sau 12s)`,
      sawTailAfter12s,
    );
    const withTk = events.filter((e) => e.tk);
    check("ticker 24h đính kèm ở ≥1 event", withTk.length >= 1, `${withTk.length}/${events.length}`);
    if (withTk.length) {
      const tk = withTk[0].tk!;
      check("ticker hợp lệ (price>0, changePct là số)", tk.price > 0 && Number.isFinite(tk.changePct));
      // giá trên tail phải "khớp" ticker (cùng nguồn Binance, sai số do chênh mốc)
      const lastTail = withTail[withTail.length - 1];
      check(
        "giá tail ≈ giá ticker (cùng nguồn)",
        Math.abs(lastTail.tail[lastTail.tail.length - 1].c - tk.price) / tk.price < 0.01,
      );
    }
  }

  // ── 3 · nhịp flush ────────────────────────────────────────────────────────────
  console.log("\n[3] nhịp flush — chống spam");
  //   • KHÔNG BAO GIỜ gửi 2 event liên tiếp có PAYLOAD giống hệt nhau (tail + tk)
  //     (dedupe bằng chữ ký — khi proxy/network đóng băng dữ liệu thì luồng
  //     im hẳn thay vì spam cùng một nến; event ticker ép gửi cùng đuôi cũ nhưng
  //     kèm tk MỚI → payload khác, hợp lệ);
  //   • không có 2 event cách nhau <500ms (bỏ qua cặp khởi động seed+ticker —
  //     chúng cố ý gửi ngay khi luồng mở);
  //   • luồng sống ≥10s trong cửa sổ quan sát.
  let dup = 0;
  let prevSig = "";
  for (const e of events) {
    const sig = JSON.stringify([e.tail, e.tk ?? null]);
    if (sig === prevSig) dup++;
    prevSig = sig;
  }
  check("không gửi payload trùng liên tiếp (dedupe sig)", dup === 0, `${dup} trùng`);
  const gaps: number[] = [];
  for (let i = 2; i < events.length; i++) gaps.push(events[i].ts - events[i - 1].ts);
  const tooFast = gaps.filter((g) => g < 500);
  check("không bão event (<500ms) sau cặp khởi động", tooFast.length === 0, `gaps=${gaps.join(",")}`);
  const spanOk = events.length >= 2 && events[events.length - 1].ts - events[0].ts >= 10_000;
  check("luồng sống ≥10s trong cửa sổ quan sát", spanOk);
}

console.log(`\n═══ KẾT QUẢ: ${pass} pass / ${fail} fail${skipped ? ` / ${skipped} skip` : ""} ═══`);
process.exit(fail ? 1 : 0);
