// ─── Explosion scanner — rà soát 1-4 năm lịch sử tìm các đợt BÙNG NỔ ──────────
// Trả lời câu hỏi: "những thời điểm bùng nổ đã xảy ra / lặp lại theo chu kỳ
// gì / có lẽ sắp xảy ra?"
//
// Định nghĩa BÙNG NỔ: ngày có |return| ≥ ngưỡng (mặc định 4%).
// Tiền đề được đo TRƯỚC ngày bùng nổ (không lookahead — dùng đúng các feature
// của model): atrRank / bbwRank (percentile trong 100 ngày trước — thấp = nén),
// donchian (vị trí đóng cửa trong range 20 ngày trước), phiên/thứ/cửa sổ lịch.
//
// Chạy: bun run scripts/explosion-scan.ts [SYMBOL] [years] [thresholdPct]
//   bun run scripts/explosion-scan.ts BTCUSDT 4 4
// Kết quả: báo cáo tiếng Việt (console) + download/explosion-report.json

const symbol = (process.argv[2] ?? "BTCUSDT").toUpperCase();
const YEARS = Number(process.argv[3] ?? 4) || 4;
const THR = (Number(process.argv[4] ?? 4) || 4) / 100;
const OUT = "/home/z/my-project/download/explosion-report.json";

interface Bar {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

const { buildCtx, donchianPos, trailingRank } = await import("../src/lib/xgb");
type Ctx = ReturnType<typeof buildCtx>;

const DOW = ["Chủ nhật", "Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7"];
const ddmm = (t: number): string =>
  new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(new Date(t));

const BASES = ["https://fapi.binance.com", "https://fapi1.binance.com"];
let baseIdx = 0;

async function getJSON(url: string): Promise<unknown> {
  for (let a = 1; ; a++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      if (a >= 5) throw e;
      // 418/429 = Binance throttle → longer backoff + try the mirror endpoint
      const wait = /HTTP 41[48]|HTTP 429/.test(String(e)) ? 3000 * a : 800 * a;
      if (a % 2 === 0) baseIdx = (baseIdx + 1) % BASES.length;
      await new Promise((res) => setTimeout(res, wait));
    }
  }
}

async function fetchDaily(symbol: string, want: number): Promise<Bar[]> {
  const raw: unknown[][] = [];
  let endTime: number | undefined;
  while (raw.length < want) {
    const q = new URLSearchParams({ symbol, interval: "1d", limit: "1000" });
    if (endTime) q.set("endTime", String(endTime));
    const chunk = (await getJSON(`${BASES[baseIdx]}/fapi/v1/klines?${q}`)) as unknown[][];
    if (!Array.isArray(chunk) || chunk.length === 0) break;
    raw.unshift(...chunk);
    endTime = Number(chunk[0][0]) - 1;
    if (chunk.length < 1000) break;
    await new Promise((res) => setTimeout(res, 1200)); // nhẹ nhàng với rate limit
  }
  return raw.map((k) => ({
    t: Number(k[0]),
    o: Number(k[1]),
    h: Number(k[2]),
    l: Number(k[3]),
    c: Number(k[4]),
    v: Number(k[5]),
  }));
}

async function fetchHourly(symbol: string, want: number): Promise<Bar[]> {
  const raw: unknown[][] = [];
  let endTime: number | undefined;
  while (raw.length < want) {
    const q = new URLSearchParams({ symbol, interval: "1h", limit: "1000" });
    if (endTime) q.set("endTime", String(endTime));
    const chunk = (await getJSON(`${BASES[baseIdx]}/fapi/v1/klines?${q}`)) as unknown[][];
    if (!Array.isArray(chunk) || chunk.length === 0) break;
    raw.unshift(...chunk);
    endTime = Number(chunk[0][0]) - 1;
    if (chunk.length < 1000) break;
    await new Promise((res) => setTimeout(res, 1200));
  }
  return raw.map((k) => ({ t: Number(k[0]), o: Number(k[1]), h: Number(k[2]), l: Number(k[3]), c: Number(k[4]), v: Number(k[5]) }));
}

// window of the UTC day — same taxonomy as the 📅 cycle block
function windowOf(t: number): "đầu tháng" | "cuối tháng" | "kết quý" | "giữa tháng" {
  const d = new Date(t);
  const day = d.getUTCDate();
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  const start = day <= 3;
  const end = last - day < 3;
  if (end && d.getUTCMonth() % 3 === 2) return "kết quý";
  if (end) return "cuối tháng";
  if (start) return "đầu tháng";
  return "giữa tháng";
}
const median = (a: number[]): number => {
  if (a.length === 0) return NaN;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};
const pct = (a: number[], p: number): number => {
  if (a.length === 0) return NaN;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))];
};

// ─── data ─────────────────────────────────────────────────────────────────────
console.log(`⏳ Tải ${YEARS} năm nến 1d ${symbol} từ Binance…`);
const daily = await fetchDaily(symbol, Math.ceil(YEARS * 365.25));
console.log(`✅ ${daily.length} nến 1d (${ddmm(daily[0].t)} → ${ddmm(daily[daily.length - 1].t)} UTC)`);
const hourly = await fetchHourly(symbol, 1000); // ~41 ngày gần nhất để soi burst trong ngày

const ctx: Ctx = buildCtx(daily, 0, 14);
const n = daily.length;
const atrRank: number[] = [];
const bbwRank: number[] = [];
const donch: number[] = [];
const ret: number[] = [];
const volX: number[] = [];
for (let i = 0; i < n; i++) {
  atrRank.push(trailingRank(ctx.atrPct, i));
  bbwRank.push(trailingRank(ctx.bbw, i));
  donch.push(donchianPos(daily, i));
  ret.push(i > 0 && daily[i - 1].c > 0 ? daily[i].c / daily[i - 1].c - 1 : 0);
  let s = 0;
  let cnt = 0;
  for (let j = Math.max(0, i - 20); j < i; j++) {
    s += daily[j].v;
    cnt++;
  }
  volX.push(cnt >= 5 && s > 0 ? daily[i].v / (s / cnt) : 1);
}

// ─── explosions + clustering (±2 ngày = 1 sự kiện) ────────────────────────────
interface Expl {
  i: number;
  t: number;
  dir: "LÊN" | "XUỐNG";
  ret: number;
  volX: number;
  atrRank: number;
  bbwRank: number;
  donch: number;
  dow: string;
  window: ReturnType<typeof windowOf>;
  gapDays: number;
}
const rawHits: number[] = [];
for (let i = 1; i < n; i++) if (Math.abs(ret[i]) >= THR) rawHits.push(i);
const clusters: number[][] = [];
for (const i of rawHits) {
  const last = clusters[clusters.length - 1];
  if (last && i - last[last.length - 1] <= 2) last.push(i);
  else clusters.push([i]);
}
let lastT = 0;
const expl: Expl[] = clusters.map((c) => {
  const best = c.reduce((a, b) => (Math.abs(ret[b]) > Math.abs(ret[a]) ? b : a));
  const gapDays = lastT ? Math.round((daily[best].t - lastT) / 86_400_000) : 0;
  lastT = daily[best].t;
  return {
    i: best,
    t: daily[best].t,
    dir: ret[best] > 0 ? "LÊN" : "XUỐNG",
    ret: ret[best],
    volX: volX[best],
    atrRank: atrRank[best],
    bbwRank: bbwRank[best],
    donch: donch[best],
    dow: DOW[new Date(daily[best].t).getUTCDay()],
    window: windowOf(daily[best].t),
    gapDays,
  };
});

// ─── stats ────────────────────────────────────────────────────────────────────
const yearOf = (t: number): number => new Date(t).getUTCFullYear();
const byYear = new Map<number, Expl[]>();
for (const e of expl) {
  const arr = byYear.get(yearOf(e.t)) ?? [];
  arr.push(e);
  byYear.set(yearOf(e.t), arr);
}
const allBbw = expl.map((e) => e.bbwRank);
const allAtr = expl.map((e) => e.atrRank);
const medBbw = median(allBbw);
const medAtr = median(allAtr);
// base rate + conditional probabilities (per day, skip first 100 warmup bars)
const evalDays = Array.from({ length: n - 101 }, (_, k) => k + 101);
const hit = new Set(rawHits);
const base = evalDays.filter((i) => hit.has(i)).length / evalDays.length;
const pSqueeze = evalDays.filter((i) => bbwRank[i] <= 0.25);
const pSqueezeHit = pSqueeze.filter((i) => hit.has(i)).length / Math.max(1, pSqueeze.length);
const pCalm = evalDays.filter((i) => atrRank[i] <= 0.3);
const pCalmHit = pCalm.filter((i) => hit.has(i)).length / Math.max(1, pCalm.length);
const byDow = new Map<string, number>();
const byWin = new Map<string, number>();
const winDays = new Map<string, number>();
for (const i of evalDays) {
  const w = windowOf(daily[i].t);
  winDays.set(w, (winDays.get(w) ?? 0) + 1);
}
for (const e of expl) {
  byDow.set(e.dow, (byDow.get(e.dow) ?? 0) + 1);
  byWin.set(e.window, (byWin.get(e.window) ?? 0) + 1);
}
const gaps = expl.filter((e) => e.gapDays > 0).map((e) => e.gapDays);
const medGap = median(gaps);
// intraday bursts (1h) — last ~41 days
const hRet = hourly.map((b, i) => (i > 0 && hourly[i - 1].c > 0 ? b.c / hourly[i - 1].c - 1 : 0));
const bursts = hourly
  .map((b, i) => ({ t: b.t, ret: hRet[i] }))
  .filter((x) => Math.abs(x.ret) >= 0.012)
  .sort((a, b) => Math.abs(b.ret) - Math.abs(a.ret))
  .slice(0, 8);

// ─── current state + upcoming windows ─────────────────────────────────────────
const li = n - 2; // last CLOSED daily candle
const daysSinceLast = expl.length ? Math.round((daily[li].t - expl[expl.length - 1].t) / 86_400_000) : 999;
const nowWin = windowOf(daily[li].t);
// upcoming calendar windows in the next 35 days (window start dates)
const upcoming: { t: number; label: string; histP: number }[] = [];
{
  const seen = new Set<string>();
  for (let d = 0; d <= 35; d++) {
    const t = daily[li].t + d * 86_400_000;
    const w = windowOf(t);
    const prev = d > 0 ? windowOf(t - 86_400_000) : w;
    if (w !== prev && w !== "giữa tháng" && !seen.has(w)) {
      seen.add(w);
      const hitWin = expl.filter((e) => e.window === w).length;
      const totDays = [...winDays.entries()].filter(([k]) => k === w).reduce((a, [, b]) => a + b, 0);
      // P(≥1 explosion trong cửa sổ) ≈ 1 − (1−p)^(số ngày của cửa sổ trong năm)
      const pPerDay = totDays > 0 ? hitWin / totDays : 0;
      const winLen = w === "kết quý" ? 3 : w === "đầu tháng" ? 3 : 3;
      upcoming.push({ t, label: w, histP: 1 - Math.pow(1 - pPerDay, winLen) });
    }
  }
}
let score = 0;
const parts: string[] = [];
if (bbwRank[li] <= 0.25) {
  score += 30;
  parts.push(`BBW nén (p${Math.round(bbwRank[li] * 100)}) +30`);
}
if (atrRank[li] <= 0.3) {
  score += 20;
  parts.push(`ATR lặng (p${Math.round(atrRank[li] * 100)}) +20`);
}
if (donch[li] >= 0.9 || donch[li] <= 0.1) {
  score += 15;
  parts.push(`Giá sát mép range 20n (${donch[li].toFixed(2)}) +15`);
}
if (daysSinceLast >= medGap) {
  score += 20;
  parts.push(`Quá ${daysSinceLast}n không bùng nổ (≥ median ${medGap}n) +20`);
}
const nextWin = upcoming[0];
if (nextWin && nextWin.t - daily[li].t <= 7 * 86_400_000) {
  score += 15;
  parts.push(`Cửa sổ "${nextWin.label}" trong ${(nextWin.t - daily[li].t) / 86_400_000 | 0}n +15`);
}

// ─── report ───────────────────────────────────────────────────────────────────
const L: string[] = [];
L.push(`💥 RÀ SOÁT BÙNG NỔ — ${symbol} · ${YEARS} NĂM (${ddmm(daily[0].t)} → ${ddmm(daily[n - 2].t)} UTC)`);
L.push(`Định nghĩa: ngày |return| ≥ ${(THR * 100).toFixed(0)}% · gộp cụm cách ≤2 ngày · ${expl.length} sự kiện / ${rawHits.length} ngày thô`);
L.push("");
L.push("── ĐÃ XẢY RA (toàn bộ, cũ → mới) ──");
for (const e of expl) {
  L.push(
    `${e.dir === "LÊN" ? "🟢" : "🔴"} ${ddmm(e.t)} (${e.dow}) · ${e.dir} ${Math.abs(e.ret * 100).toFixed(1)}% · vol ${e.volX.toFixed(1)}× · trước đó: BBW p${Math.round(e.bbwRank * 100)} · ATR p${Math.round(e.atrRank * 100)} · ${e.window} · cách lần trước ${e.gapDays || "—"}n`,
  );
}
L.push("");
L.push("── THEO NĂM ──");
for (const [y, arr] of [...byYear.entries()].sort()) {
  const big = arr.reduce((a, b) => (Math.abs(b.ret) > Math.abs(a.ret) ? b : a));
  L.push(`${y}: ${arr.length} lần · lớn nhất ${ddmm(big.t)} ${big.dir} ${Math.abs(big.ret * 100).toFixed(1)}%`);
}
L.push("");
L.push("── TIỀN ĐỀ (điều kiện TRƯỚC ngày bùng nổ) ──");
L.push(`Median BBW-rank trước bùng nổ: p${Math.round(medBbw * 100)} · median ATR-rank: p${Math.round(medAtr * 100)} (toàn bộ ngày: 50)`);
L.push(`Tần suất ngày bùng nổ: nền ${(base * 100).toFixed(1)}%/ngày`);
L.push(`Khi BBW nén (p≤25): ${(pSqueezeHit * 100).toFixed(1)}%/ngày → ${(pSqueezeHit / Math.max(base, 1e-9)).toFixed(1)}× nền`);
L.push(`Khi ATR lặng (p≤30): ${(pCalmHit * 100).toFixed(1)}%/ngày → ${(pCalmHit / Math.max(base, 1e-9)).toFixed(1)}× nền`);
L.push("");
L.push("── CHU KỲ LỊCH ──");
for (const w of ["kết quý", "cuối tháng", "đầu tháng", "giữa tháng"]) {
  const c = byWin.get(w) ?? 0;
  const tot = winDays.get(w) ?? 0;
  L.push(`${w}: ${c} sự kiện · ${tot ? ((c / tot) * 100).toFixed(1) : "0"}%/ngày (${(c / tot / Math.max(base, 1e-9)).toFixed(1)}× nền)`);
}
const dowLine = [...byDow.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(" · ");
L.push(`Theo thứ: ${dowLine}`);
L.push(`Khoảng cách giữa 2 lần bùng nổ: median ${medGap}n · p25 ${pct(gaps, 0.25)}n · p75 ${pct(gaps, 0.75)}n`);
L.push("");
L.push("── BURST 1H GẦN NHẤT (≈41 ngày) ──");
for (const b of bursts) {
  L.push(`${new Date(b.t).toISOString().slice(5, 16).replace("T", " ")} UTC · ${b.ret > 0 ? "+" : ""}${(b.ret * 100).toFixed(2)}% trong 1h`);
}
L.push("");
L.push("── HIỆN TẠI — CÓ SẮP BÙNG NỔ? ──");
L.push(`Ngày đóng cuối (${ddmm(daily[li].t)}): BBW p${Math.round(bbwRank[li] * 100)} · ATR p${Math.round(atrRank[li] * 100)} · Donchian ${donch[li].toFixed(2)} · ${nowWin} · ${daysSinceLast}n kể từ lần bùng nổ cuối`);
for (const u of upcoming) L.push(`Cửa sổ tới: ${u.label} từ ${ddmm(u.t)} — xác suất lịch sử có bùng nổ trong cửa sổ ≈ ${(u.histP * 100).toFixed(0)}%`);
L.push(`ĐIỂM TIỀN ĐỀ BÙNG NỔ: ${score}/100${parts.length ? " — " + parts.join(" · ") : " — không có tiền đề nào bật sáng"}`);
const report = L.join("\n");
console.log(report);

// JSON cho biểu đồ / phân tích tiếp
const mkdir = await import("node:fs");
mkdir.writeFileSync(
  OUT,
  JSON.stringify(
    {
      symbol,
      years: YEARS,
      thresholdPct: THR * 100,
      generatedAt: new Date().toISOString(),
      expl,
      stats: {
        base,
        pSqueezeHit,
        pCalmHit,
        medBbw,
        medAtr,
        medGap,
        byDow: Object.fromEntries(byDow),
        byWin: Object.fromEntries(byWin),
        current: { atrRank: atrRank[li], bbwRank: bbwRank[li], donchian: donch[li], daysSinceLast, window: nowWin, score, parts },
        upcoming,
      },
      series: {
        t: daily.map((d) => d.t),
        c: daily.map((d) => d.c),
        bbwRank,
        atrRank,
        donchian: donch,
        hitIdx: [...hit],
      },
    },
    null,
    1,
  ),
);
console.log(`\n💾 ${OUT}`);
