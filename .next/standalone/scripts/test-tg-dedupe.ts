// Unit tests for the multi-session anti-spam layer:
//   1. tg-dedupe — semantic keys collapse duplicate Telegram sends across
//      tabs/devices (TTL expiry, rollback on failed send, prune, text-hash key)
//   2. leader election — pickLeader determinism (smallest alive id wins,
//      stale peers ignored, empty → null)
// Run: bun scripts/test-tg-dedupe.ts

// scratch DATA_DIR must be set BEFORE the imports resolve
process.env.DATA_DIR = "/tmp/elliot-test-dedupe";
const { rmSync } = await import("node:fs");
rmSync("/tmp/elliot-test-dedupe", { recursive: true, force: true });

const {
  DEFAULT_TTL_MS,
  dedupeTtlMs,
  dedupeSend,
  loadDedupe,
  markSent,
  prune,
  rollback,
  shouldSend,
  textKey,
  saveDedupe,
} = await import("../src/lib/tg-dedupe");
type DedupeMap = Record<string, number>;
const { newTabId, pickLeader, STALE_MS } = await import("../src/lib/leader");

let n = 0;
const ok = (cond: boolean, label: string): void => {
  n++;
  if (!cond) {
    console.error(`FAIL #${n}: ${label}`);
    process.exit(1);
  }
};

// ─── 1. text-key stability ────────────────────────────────────────────────────
const k1 = textKey("@airealtime", "HTML", "xin chào");
const k2 = textKey("@airealtime", "HTML", "xin chào");
const k3 = textKey("@airealtime", undefined, "xin chào");
const k4 = textKey("@airealtime", "HTML", "xin chào khác");
ok(k1 === k2, "same text+chat+mode → same hash key");
ok(k1 !== k3, "different parse mode → different key");
ok(k1 !== k4, "different text → different key");
ok(k1.startsWith("h:"), "hash keys are namespaced");

// ─── 2. shouldSend / markSent / TTL expiry ───────────────────────────────────
const T0 = 1_000_000;
let map: DedupeMap = {};
ok(shouldSend(map, "open:t1", T0, DEFAULT_TTL_MS), "empty map → may send");
map = markSent(map, "open:t1", T0);
ok(!shouldSend(map, "open:t1", T0 + 1, DEFAULT_TTL_MS), "just sent → suppressed");
ok(!shouldSend(map, "open:t1", T0 + 89_999, DEFAULT_TTL_MS), "within 90s TTL → suppressed");
ok(shouldSend(map, "open:t1", T0 + 90_001, DEFAULT_TTL_MS), "past TTL → may send again");
ok(shouldSend(map, "open:t2", T0, DEFAULT_TTL_MS), "different key → not suppressed");

// ─── 3. dedupeSend end-to-end (file-backed) ───────────────────────────────────
let sends = 0;
const sendOk = async (): Promise<{ ok: boolean }> => {
  sends++;
  return { ok: true };
};
const r1 = await dedupeSend("top:100", sendOk);
ok(r1.ok && !r1.deduped, "first send goes out");
const r2 = await dedupeSend("top:100", sendOk);
ok(r2.ok === true && r2.deduped === true, "duplicate within TTL → ok + deduped, no API call");
ok(sends === 1, "suppressed duplicate never reached the Telegram API");
ok(loadDedupe()["top:100"] > 0, "send recorded in DATA_DIR file");

// dedupe disabled / no key → always passes through
const r3 = await dedupeSend(null, sendOk);
ok(r3.ok && r3.deduped == null, "null key → pass-through");
sends = 0;
await dedupeSend("top:101", sendOk);
await dedupeSend("top:101", sendOk);
ok(sends === 1, "second identical event in the same window collapsed");

// ─── 4. rollback — a FAILED send frees the key for the next session ──────────
let fail = true;
const sendFailsOnce = async (): Promise<{ ok: boolean; detail?: string }> => {
  if (fail) {
    fail = false;
    return { ok: false, detail: "HTTP 502" };
  }
  return { ok: true };
};
const f1 = await dedupeSend("close:t9", sendFailsOnce);
ok(!f1.ok, "failed send reported as failure");
const f2 = await dedupeSend("close:t9", sendFailsOnce);
ok(f2.ok && !f2.deduped, "retry after failure is NOT suppressed (rollback worked)");
ok(loadDedupe()["close:t9"] > 0, "successful retry re-records the key");

// ─── 5. prune — expired keys dropped, newest kept when over the cap ──────────
const big: DedupeMap = {};
for (let i = 0; i < 800; i++) big[`k${String(i).padStart(4, "0")}`] = 1000 + i;
const pruned = prune(big, 200_000, 90_000);
ok(Object.keys(pruned).length <= 600, "prune caps the map size");
ok(!pruned["k0000"] && pruned["k0799"], "prune keeps the NEWEST entries");
const tiny = prune({ old: T0 - 10_000_000, new: T0 }, T0, 90_000);
ok(tiny["new"] !== undefined && tiny["old"] === undefined, "prune drops long-expired keys");

// ─── 6. dedupeTtlMs env handling ─────────────────────────────────────────────
process.env.TG_DEDUPE_MS = "5000";
ok(dedupeTtlMs() === 5000, "TG_DEDUPE_MS=5000 honoured");
process.env.TG_DEDUPE_MS = "abc";
ok(dedupeTtlMs() === DEFAULT_TTL_MS, "invalid env → default TTL");
process.env.TG_DEDUPE_MS = "0";
ok(dedupeTtlMs() === 0, "TG_DEDUPE_MS=0 → disabled");
delete process.env.TG_DEDUPE_MS;

// ─── 7. leader election — pickLeader ─────────────────────────────────────────
const now = 5_000_000;
ok(pickLeader([], now) === null, "no peers → no leader");
ok(pickLeader([{ id: "b", ts: now }, { id: "a", ts: now - 100 }], now) === "a", "smallest alive id wins");
ok(
  pickLeader([{ id: "a", ts: now - STALE_MS - 1 }, { id: "b", ts: now }], now) === "b",
  "stale leader is skipped → next tab promoted",
);
ok(pickLeader([{ id: "a", ts: now + 500 }], now) === null, "future timestamp (clock skew) ignored");
ok(pickLeader([{ id: "", ts: now }, { id: "z", ts: now }], now) === "z", "empty id ignored");
// determinism: every tab computing from the SAME peer list elects the SAME leader
const peers = [
  { id: "tab-x", ts: now },
  { id: "tab-a", ts: now - 900 },
  { id: "tab-m", ts: now - 100 },
];
ok(pickLeader(peers, now) === "tab-a", "deterministic winner from a shared peer list");
ok(newTabId().length > 10 && newTabId() !== newTabId(), "tab ids are unique-ish");

// ─── 8. server-side senders still work: dedupe does not break unique texts ───
sends = 0;
for (let i = 0; i < 3; i++) await dedupeSend(`near:pos1:tp${i}`, sendOk);
ok(sends === 3, "distinct keys (per position/side) all send");

console.log(`ALL_TG_DEDUPE_OK (${n} checks)`);
