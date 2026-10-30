// Unit-ish test for the session-open broadcast — stubs Binance klines +
// Telegram API, then asserts the message mirrors the "Phiên giao dịch"
// panel, the due/dedupe logic fires once per session per UTC date, and the
// late window / not-configured branches behave.
// Run: bun scripts/test-session-broadcast.ts

// env + scratch DATA_DIR must be set BEFORE the imports resolve
process.env.TELEGRAM_BOT_TOKEN = "123456789:AAEhSESS_E2E_TOKEN_NOT_REAL_00";
process.env.TELEGRAM_CHAT_ID = "@airealtime";
process.env.DATA_DIR = "/tmp/elliot-test-session-bcast";

const { mkdirSync, rmSync, readFileSync } = await import("node:fs");
rmSync("/tmp/elliot-test-session-bcast", { recursive: true, force: true });
mkdirSync("/tmp/elliot-test-session-bcast", { recursive: true });

const { tickSessionBroadcast, buildSessionOpenMessage, sendSessionPreview } = await import(
  "../src/lib/session-broadcast"
);
const { SESSIONS } = await import("../src/lib/market");
import type { Kline } from "../src/lib/types";

let failures = 0;
function check(cond: boolean, label: string, detail = "") {
  if (cond) {
    console.log(`  PASS ${label}`);
  } else {
    failures++;
    console.log(`  FAIL ${label} ${detail}`);
  }
}

// ─── fetch stub: Binance klines (synthetic 1h series) + Telegram capture ──────

interface TgCall {
  url: string;
  body: Record<string, unknown>;
}

const tgCalls: TgCall[] = [];

/** synthetic 1h candles ending at `now` (last one = forming candle) */
function series(now: number, n = 500): unknown[] {
  const out: unknown[] = [];
  const lastOpen = Math.floor(now / 3_600_000) * 3_600_000;
  let price = 68000;
  for (let i = 0; i < n; i++) {
    const t = lastOpen - (n - 1 - i) * 3_600_000;
    // deterministic pseudo-random walk with session-flavoured bias
    const hour = new Date(t).getUTCHours();
    const bias = hour >= 7 && hour < 16 ? 1.0008 : hour >= 0 && hour < 9 ? 0.9994 : 1.0001;
    price *= bias * (1 + 0.001 * Math.sin(i / 6));
    const o = price / (bias * (1 + 0.001 * Math.sin(i / 6)));
    const c = price;
    const h = Math.max(o, c) * 1.001;
    const l = Math.min(o, c) * 0.999;
    const v = 120 + 40 * Math.abs(Math.sin(i / 5));
    out.push([t, String(o), String(h), String(l), String(c), String(v), 0, "0", 0, String(v * 0.55)]);
  }
  return out;
}

const origFetch = globalThis.fetch;
globalThis.fetch = (async (url: string | URL | Request, opts?: RequestInit): Promise<Response> => {
  const raw = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
  if (raw.includes("/api/v3/klines")) {
    const u = new URL(raw);
    const now = Number(u.searchParams.get("_now") ?? Date.now());
    return new Response(JSON.stringify(series(now, Number(u.searchParams.get("limit") ?? 500))), { status: 200 });
  }
  if (raw.includes("api.telegram.org")) {
    tgCalls.push({ url: raw, body: JSON.parse(String(opts?.body ?? "{}")) as Record<string, unknown> });
    return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 });
  }
  return new Response("not found", { status: 404 });
}) as typeof fetch;

// fixed "now": 2026-10-30 00:05 UTC → Tokyo JUST opened, Sydney still open
const NOW = Date.UTC(2026, 9, 30, 0, 5);
const withNow = (u: string): string => `${u}${u.includes("?") ? "&" : "?"}_now=${NOW}`;
const realFetch = globalThis.fetch;
globalThis.fetch = ((url: string | URL | Request, opts?: RequestInit) =>
  realFetch(withNow(typeof url === "string" ? url : url instanceof URL ? url.href : url.url), opts)) as typeof fetch;

// ─── 1. message content mirrors the panel ─────────────────────────────────────

console.log("== buildSessionOpenMessage content");
const klinesUrl = "https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=500&_now=" + NOW;
const kres = (await realFetch(klinesUrl)) as Response;
// map the raw Binance rows exactly like fetchKlinesDirect does
const toK = (r: unknown[]): Kline => ({
  t: Number(r[0]),
  o: Number(r[1]),
  h: Number(r[2]),
  l: Number(r[3]),
  c: Number(r[4]),
  v: Number(r[5]),
  tb: Number(r[9]) || 0,
});
const klines = ((await kres.json()) as unknown[][]).map(toK);
const msg = buildSessionOpenMessage("tokyo", NOW, klines);
console.log("---- rendered message ----");
console.log(msg);
console.log("--------------------------");
check(msg.includes("PHIÊN TOKYO"), "title names the opened session");
check(msg.includes("00:00 UTC"), "UTC open hour shown");
check(msg.includes("07:00 GMT+7"), "GMT+7 open hour shown (0+7)");
check(msg.includes("VỪA MỞ"), "opened session flagged VỪA MỞ");
check(msg.includes("đang mở") && msg.includes("Sydney"), "Sydney still open at 00:05 UTC");
check(msg.includes("đóng") && msg.includes("London"), "London closed");
check(/thiên <b>(LONG|SHORT)<\/b>/.test(msg), "forecast lean present");
check(/P≈\d+% \(\d+ nến lịch sử\)/.test(msg), "forecast P + candle count present");
check(msg.includes("mạnh nhất") && msg.includes("yếu nhất"), "best/worst history line present");
check(msg.includes("không phải bảo đảm"), "disclaimer present");

// ─── 2. tick fires for the just-opened session only ───────────────────────────

console.log("== tickSessionBroadcast at 00:05 UTC");
const r1 = await tickSessionBroadcast(NOW);
check(r1.due.length === 1 && r1.due[0] === "tokyo", "due = [tokyo]", JSON.stringify(r1));
check(r1.sent.length === 1 && r1.sent[0] === "tokyo", "sent = [tokyo]", JSON.stringify(r1));
check(tgCalls.length === 1, "one Telegram call");
check(
  tgCalls[0]?.url.includes("/bot123456789:") && tgCalls[0]?.url.includes("/sendMessage"),
  "sendMessage via env token",
);
check(tgCalls[0]?.body.chat_id === "@airealtime", "chat_id = @airealtime");
check(tgCalls[0]?.body.parse_mode === "HTML", "HTML parse mode");
check(String(tgCalls[0]?.body.text ?? "").includes("PHIÊN TOKYO"), "text carries the broadcast body");

// ─── 3. dedupe: same session, same date → silent ──────────────────────────────

console.log("== dedupe within the late window");
const r2 = await tickSessionBroadcast(NOW + 60_000); // 00:06 same day
check(r2.due.length === 0 && r2.sent.length === 0, "second tick skipped (state file)");
check(tgCalls.length === 1, "no duplicate Telegram call");

// ─── 4. next session opens at 07:00 UTC → due = [london] ──────────────────────

console.log("== london open at 07:05 UTC same day");
const NOW7 = Date.UTC(2026, 9, 30, 7, 5);
globalThis.fetch = ((url: string | URL | Request, opts?: RequestInit) =>
  realFetch(withNow(typeof url === "string" ? url : url instanceof URL ? url.href : url.url).replace(
    "_now=" + NOW,
    "_now=" + NOW7,
  ), opts)) as typeof fetch;
const r3 = await tickSessionBroadcast(NOW7);
check(r3.due.length === 1 && r3.due[0] === "london", "due = [london]", JSON.stringify(r3));
check(r3.sent.length === 1, "london sent");
check(tgCalls.length === 2, "second Telegram call");
check(String(tgCalls[1]?.body.text ?? "").includes("PHIÊN LONDON"), "london broadcast body");
check(String(tgCalls[1]?.body.text ?? "").includes("📅 Chu kỳ lịch"), "calendar-cycle line present (weekday forecast)");
check(/📅 Chu kỳ lịch: <b>(Thứ \d|Chủ nhật)<\/b> \(\d+ ngày\)/.test(String(tgCalls[1]?.body.text ?? "")), "cycle line has weekday + sample count");
const msg7 = String(tgCalls[1]?.body.text ?? "");
check(msg7.includes("14:00 GMT+7"), "london = 14:00 GMT+7");

// ─── 5. late window: 11 min after open → skipped (already sent anyway) ───────

console.log("== late window boundary");
const NOW0 = Date.UTC(2026, 10, 2, 7, 11); // fresh date, 11 min past london open
globalThis.fetch = ((url: string | URL | Request, opts?: RequestInit) =>
  realFetch(withNow(typeof url === "string" ? url : url instanceof URL ? url.href : url.url).replace(
    "_now=" + NOW,
    "_now=" + NOW0,
  ), opts)) as typeof fetch;
const r4 = await tickSessionBroadcast(NOW0);
check(r4.due.length === 0, "11 min past open → not due anymore", JSON.stringify(r4));

// fresh date inside the window still fires (server restarted at 00:04)
const NOWF = Date.UTC(2026, 10, 2, 0, 4);
globalThis.fetch = ((url: string | URL | Request, opts?: RequestInit) =>
  realFetch(withNow(typeof url === "string" ? url : url instanceof URL ? url.href : url.url).replace(
    "_now=" + NOW0,
    "_now=" + NOWF,
  ), opts)) as typeof fetch;
const r5 = await tickSessionBroadcast(NOWF);
check(r5.due.length === 1 && r5.due[0] === "tokyo", "fresh date + 4 min past open → due", JSON.stringify(r5));
check(r5.sent.length === 1, "sent after restart");

// ─── 6. state file exists and maps both sessions to their dates ───────────────

console.log("== persisted state");
const rawState = readFileSync("/tmp/elliot-test-session-bcast/session-bcast.json", "utf8");
check(rawState.includes("tokyo") && rawState.includes("2026-11-02"), "state maps tokyo → 2026-11-02");

// ─── 6b. pre-open send: 5 minutes BEFORE tokyo opens (23:55 UTC) ─────────────

console.log("== pre-open window: 23:55 UTC → tokyo due (opens tomorrow)");
const NOWP = Date.UTC(2026, 10, 2, 23, 55); // tokyo opens 2026-11-03 00:00
globalThis.fetch = ((url: string | URL | Request, opts?: RequestInit) =>
  realFetch(withNow(typeof url === "string" ? url : url instanceof URL ? url.href : url.url).replace(
    "_now=" + NOWF,
    "_now=" + NOWP,
  ), opts)) as typeof fetch;
const r6 = await tickSessionBroadcast(NOWP);
check(r6.due.length === 1 && r6.due[0] === "tokyo", "pre-open due = [tokyo]", JSON.stringify(r6));
check(r6.sent.length === 1, "pre-open sent");
const msgP = String(tgCalls[tgCalls.length - 1]?.body.text ?? "");
check(msgP.includes("SẮP MỞ PHIÊN TOKYO"), "pre-open title", msgP.split("\n")[0]);
check(msgP.includes("sau 5p"), "5-minute countdown shown");
check(msgP.includes("sắp mở sau 5p"), "session line marked sắp mở");
check(msgP.includes("00:00 UTC"), "title shows the OPEN hour, not the fire hour");
check(/thiên <b>(LONG|SHORT)<\/b>/.test(msgP), "forecast lean for the imminent session");
const rawStateP = readFileSync("/tmp/elliot-test-session-bcast/session-bcast.json", "utf8");
check(rawStateP.includes("2026-11-03"), "state keyed by OPEN date (tomorrow)", rawStateP);

// ─── 6c. the pre-open send suppresses the post-open one for the same open ────

console.log("== dedupe across the open boundary");
const NOWA = Date.UTC(2026, 10, 3, 0, 5); // 5 min AFTER tokyo opened 2026-11-03
globalThis.fetch = ((url: string | URL | Request, opts?: RequestInit) =>
  realFetch(withNow(typeof url === "string" ? url : url instanceof URL ? url.href : url.url).replace(
    "_now=" + NOWP,
    "_now=" + NOWA,
  ), opts)) as typeof fetch;
const r7 = await tickSessionBroadcast(NOWA);
check(r7.due.length === 0 && r7.sent.length === 0, "post-open tick suppressed by pre-open send", JSON.stringify(r7));

// ─── 7. preview builder (force switch) ────────────────────────────────────────

console.log("== sendSessionPreview");
const before = tgCalls.length;
const pv = await sendSessionPreview();
check(pv.ok === true, "preview sent", JSON.stringify(pv));
check(tgCalls.length === before + 1, "preview made one call");
check(String(tgCalls[tgCalls.length - 1]?.body.text ?? "").includes("🧪"), "preview marked 🧪");

// ─── 8. every session's VN hour renders correctly ─────────────────────────────

console.log("== VN hour per session (GMT+7)");
for (const s of SESSIONS) {
  const m = buildSessionOpenMessage(s.key, NOW, klines);
  const vn = (s.from + 7) % 24;
  check(m.includes(`${String(vn).padStart(2, "0")}:00 GMT+7`), `${s.key} → ${String(vn).padStart(2, "0")}:00 GMT+7`);
}

globalThis.fetch = origFetch;
console.log(failures === 0 ? "ALL_SESSION_BCAST_OK" : `SESSION_BCAST_FAILED (${failures})`);
process.exit(failures === 0 ? 0 : 1);
