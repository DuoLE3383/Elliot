// QA 0.2.75 — SELF-IMPROVE FALLBACK VOTER (bù chốt methodId reset)
//
// Bối cảnh: methodId = hash của TOÀN BỘ chuỗi chính sách → mỗi lần đổi knob
// (user chỉnh tay, agent tự +2 minScore, đổi tpMode 0.2.74) đúc methodId MỚI,
// bộ đếm mẫu của method active về 0 và decidePatch trả "skip" — agent 6h ngủ
// đúng lúc vốn đang chảy máu (data live: 28 lệnh đóng 46% WR −40.30% net ROI
// mà gates vẫn 60/70/25). LLM stats-dive phải "đề xuất thủ công" chính việc
// agent sinh ra để làm.
//
// Fix: cửa sổ GẦN (30 lệnh đóng mới nhất, mọi methodId) được vote khi method
// active còn non — CHỈ ĐỂ SIẾT (minScore +2 / minAcc +1 / risk bậc thang),
// KHÔNG BAO GIỜ restore. Flip-cooldown tuning cũng chạy khi starved (flipStats
// vốn đã đo cross-method). AGENT_FALLBACK_N (params.ts §4d) = ngưỡng bật, 0=tắt.
//
// Chạy: npx tsx scripts/test-agent-fallback.mts
import { decidePatch, aggStats, type MethodStats } from "../src/lib/self-improve.ts";
import { AGENT_FALLBACK_N, pval } from "../src/lib/params.ts";
import { EDITABLE, paramCatalog, setOverride } from "../src/lib/params-store.ts";
import { FLIP_COOLDOWN_CHOICES } from "../src/lib/autotrade.ts";
import { readFileSync } from "fs";

let fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "✅" : "❌"} ${name}${!ok && detail ? ` — ${detail}` : ""}`);
  if (!ok) fail++;
};

/** stats fixture — chỉ các field decidePatch đọc. */
const st = (over: Partial<MethodStats>): MethodStats =>
  ({
    methodId: "m1", n: 16, wins: 8, winRate: 46, netRoi: -23.04,
    expectancy: -1.44, avgWin: 1.2, avgLoss: -2.1, ...over,
  }) as MethodStats;
/** cfg fixture — đúng 4 field decidePatch chạm. */
type Cfg4 = { minScore: number; minAcc: number; riskPct: number; flipCooldownMin: number };
const cfg = (over: Partial<Cfg4> = {}): Cfg4 =>
  ({ minScore: 60, minAcc: 70, riskPct: 25, flipCooldownMin: 0, ...over }) as never;

// ══ 1 · aggStats — toán thuần, đối chiếu tay ═════════════════════════════════
console.log("1. aggStats — tổng hợp pnl thuần (flat không vào nồi nào)");
{
  const a = aggStats("x", [2, -1, 3, -0.5, 0, 1.5]);
  check("n=6 (flat vẫn tính n)", a.n === 6);
  check("wins=3 (2 · 3 · 1.5)", a.wins === 3);
  check("winRate=50%", a.winRate === 50);
  check("netRoi=5 (làm tròn 2 chữ số)", a.netRoi === 5);
  check("expectancy=0.83 (5/6, round 2dp)", a.expectancy === 0.83);
  check("avgWin=6.5/3", Math.abs(a.avgWin - 6.5 / 3) < 1e-12);
  check("avgLoss=−1.5/3 (n−wins gồm cả flat — cùng công thức measureMethods)", a.avgLoss === -0.5);
  const e = aggStats("x", []);
  check("rỗng → n=0, mọi rate 0, không NaN", e.n === 0 && e.winRate === 0 && e.expectancy === 0 && e.avgWin === 0 && e.avgLoss === 0 && Number.isFinite(e.netRoi));
}

// ══ 2 · hồi quy method-pure — đầu ra BYTE-IDENTICAL với 0.2.72 ═══════════════
console.log("2. method-pure giữ nguyên hành vi cũ (không truyền recent)");
{
  const r = decidePatch(st({ n: 16, expectancy: -1.44, winRate: 46 }), cfg());
  check("n=16 exp<0 → tighten đủ 3 field", JSON.stringify(r.patch) === JSON.stringify({ minScore: 62, minAcc: 71, riskPct: 10 }), JSON.stringify(r.patch));
  check("kind=promote", r.kind === "promote");
  check("note format cũ giữ nguyên", r.note === "tighten entry: exp -1.44% WR 46.00% n=16 → minScore 62 minAcc 71 risk 10%", r.note);

  const r2 = decidePatch(st({ n: 12, expectancy: -1.44 }), cfg());
  check("n=12 (10≤n<15) → measure, không tighten", r2.patch === null && r2.kind === "measure");
  check("note tracking cũ", r2.note === "tracking exp -1.44% WR 46.00% n=12", r2.note);

  const r3 = decidePatch(st({ n: 25, expectancy: 0.5, winRate: 60 }), cfg({ riskPct: 10 }));
  check("n=25 exp≥0.3 WR≥48 risk10 → restore 25", JSON.stringify(r3.patch) === JSON.stringify({ riskPct: 25 }) && r3.note === "restore risk 10→25 · exp 0.5% WR 60.00% n=25", r3.note);

  const r4 = decidePatch(st({ n: 25, expectancy: 0.5, winRate: 60 }), cfg({ riskPct: 25 }));
  check("risk 25 → không restore (chỉ từ 10)", r4.patch === null && r4.kind === "measure");

  const r5 = decidePatch(undefined, cfg());
  check("starved không recent → skip note cũ nguyên văn", r5.patch === null && r5.kind === "skip" && r5.note === "need ≥10 closed on active method (have 0)", r5.note);
}

// ══ 3 · FALLBACK — cửa sổ gần siết khi method active còn non ══════════════════
console.log("3. fallback tighten — recent cross-method, TIGHTEN ONLY");
{
  const rec = st({ methodId: "__recent__", n: 28, expectancy: -1.44, winRate: 46, netRoi: -40.3 });

  const r = decidePatch(undefined, cfg(), null, rec);
  check("starved + recent 28 exp<0 → tighten đủ 3 field", JSON.stringify(r.patch) === JSON.stringify({ minScore: 62, minAcc: 71, riskPct: 10 }), JSON.stringify(r.patch));
  check("kind=promote", r.kind === "promote");
  check("note ghi rõ fallback + nguồn", r.note.startsWith("fallback tighten (recent 28 closed, cross-method): exp -1.44% WR 46.00% · active method only 0 → minScore 62 minAcc 71 risk 10%"), r.note);

  const r2 = decidePatch(st({ n: 3, expectancy: -2 }), cfg(), null, rec);
  check("method có 3 lệnh (non nhưng có) → vẫn fallback, note 'active method only 3'", r2.patch?.minScore === 62 && r2.note.includes("active method only 3"), r2.note);

  const r3 = decidePatch(undefined, cfg(), null, st({ methodId: "__recent__", n: 14, expectancy: -1.44 }));
  check("recent n=14 < 15 → KHÔNG fallback (note skip cũ)", r3.patch === null && r3.kind === "skip" && r3.note === "need ≥10 closed on active method (have 0)", r3.note);

  const r4 = decidePatch(undefined, cfg({ riskPct: 10 }), null, st({ methodId: "__recent__", n: 28, expectancy: 0.5, winRate: 60 }));
  check("recent exp>0 → KHÔNG restore (tighten-only)", r4.patch === null && r4.kind === "skip", JSON.stringify(r4.patch));

  const r5 = decidePatch(undefined, cfg({ minScore: 85, minAcc: 85, riskPct: 10 }), null, rec);
  check("gates ở trần + risk sàn → fallback idle, không patch", r5.patch === null && r5.kind === "skip" && r5.note.includes("fallback nothing left to tighten (minScore 85 · risk 10%)"), r5.note);

  const r6 = decidePatch(st({ n: 16, expectancy: -1.44 }), cfg(), null, rec);
  check("method-pure đủ mẫu → DÙNG method-pure, không lẫn note fallback", r6.note === "tighten entry: exp -1.44% WR 46.00% n=16 → minScore 62 minAcc 71 risk 10%", r6.note);

  const r7 = decidePatch(st({ n: 25, expectancy: 0.5, winRate: 60 }), cfg({ riskPct: 10 }), null, rec);
  check("method-pure lành (n≥20) + recent âm → fallback KHÔNG đè (recent chỉ chạy khi starved)", r7.note === "restore risk 10→25 · exp 0.5% WR 60.00% n=25" && r7.patch?.riskPct === 25, r7.note);
}

// ══ 4 · AGENT_FALLBACK_N — ngưỡng runtime + off-switch ═══════════════════════
console.log("4. AGENT_FALLBACK_N — ngưỡng + tắt bằng 0");
{
  check("default = 15 (params.ts §4d)", AGENT_FALLBACK_N === 15);
  check("pval đọc được default", pval("AGENT_FALLBACK_N", AGENT_FALLBACK_N) === 15);
  const rec = st({ methodId: "__recent__", n: 28, expectancy: -1.44 });

  setOverride("AGENT_FALLBACK_N", 30);
  check("nhreshold 30 > n=28 → skip", decidePatch(undefined, cfg(), null, rec).patch === null);

  setOverride("AGENT_FALLBACK_N", 0);
  check("0 = TẮT (method-pure như 0.2.74)", decidePatch(undefined, cfg(), null, rec).patch === null);

  setOverride("AGENT_FALLBACK_N", 15);
  check("15 → fallback sống lại", decidePatch(undefined, cfg(), null, rec).patch?.minScore === 62);

  setOverride("AGENT_FALLBACK_N", null);
  check("reset → default 15", pval("AGENT_FALLBACK_N", AGENT_FALLBACK_N) === 15);
}

// ══ 5 · flip tuning chạy được khi starved (0.2.75) ═══════════════════════════
console.log("5. flip-cooldown tuning — hết bị cổng method-pure chặn");
{
  const bleed = st({ methodId: "__flip__", n: 8, expectancy: -1.2, winRate: 38 });
  const r = decidePatch(undefined, cfg({ flipCooldownMin: 0 }), bleed);
  check("starved + flip n=8 exp<0 → cooldown 0→15", JSON.stringify(r.patch) === JSON.stringify({ flipCooldownMin: 15 }) && r.kind === "promote", JSON.stringify(r.patch));
  check("note flip churn cũ nguyên văn", r.note === "flip churn bleed: exp -1.2% WR 38.00% n=8 → flipCooldownMin 0→15", r.note);

  const healthy = st({ methodId: "__flip__", n: 9, expectancy: 0.5, winRate: 55 });
  const r2 = decidePatch(undefined, cfg({ flipCooldownMin: 30 }), healthy);
  check("flip lành ở 30 → hạ một nấc về 15", r2.patch?.flipCooldownMin === 15, JSON.stringify(r2.patch));

  const rec = st({ methodId: "__recent__", n: 28, expectancy: -1.44 });
  const r3 = decidePatch(undefined, cfg({ flipCooldownMin: 0 }), bleed, rec);
  check("cả hai cùng chạy: 4 field trong MỘT patch", JSON.stringify(r3.patch) === JSON.stringify({ minScore: 62, minAcc: 71, riskPct: 10, flipCooldownMin: 15 }), JSON.stringify(r3.patch));
  check(
    "note đủ 2 đoạn theo đúng thứ tự",
    r3.note ===
      "fallback tighten (recent 28 closed, cross-method): exp -1.44% WR 46.00% · active method only 0 → minScore 62 minAcc 71 risk 10% · flip churn bleed: exp -1.2% WR 38.00% n=8 → flipCooldownMin 0→15",
    r3.note,
  );

  const none = decidePatch(undefined, cfg(), null, null);
  check("không flip, không recent → skip đúng note cũ", none.note === "need ≥10 closed on active method (have 0)");
}

// ══ 6 · wiring — nguồn thật, đếm call site (house style) ═════════════════════
console.log("6. wiring engine / params-store / catalog");
{
  const si = readFileSync("src/lib/self-improve.ts", "utf8");
  check("runAgentTick đo recent: `const recent = await measureRecent()`", si.includes("const recent = await measureRecent()"));
  check("decidePatch nhận 4 tham số: (active, cfg, flipStats, recent)", si.includes("decidePatch(active, cfg, flipStats, recent)"));
  check("fallback nhánh starved đứng TRƯỚC method-pure", si.indexOf("if (starved) {") < si.indexOf("stats.n >= MIN_N_TIGHTEN"));
  check("fallback tôn trọng ngưỡng pval", si.includes('pval("AGENT_FALLBACK_N", AGENT_FALLBACK_N)'));
  check("measureRecent: exitTime desc + take (cửa sổ GẦN nhất)", si.includes('orderBy: { exitTime: "desc" }') && si.includes("take,"));
  check("logEvent mang bằng chứng recent cho audit", si.includes("{ patch: decision.patch, active, snap, recent }"));

  const en = readFileSync("src/lib/engine.ts", "utf8");
  check("engine tick 6h vẫn gọi runAgentTick", en.includes("await runAgentTick(p.cfg, p.leverage"));

  const meta = EDITABLE.find((m) => m.key === "AGENT_FALLBACK_N");
  check("catalog có AGENT_FALLBACK_N", !!meta);
  check("nhóm Champion–challenger · def 15 · min 0 · max 30 · int", meta?.group === "Champion–challenger" && meta?.def === 15 && meta?.min === 0 && meta?.max === 30 && meta?.int === true, JSON.stringify(meta));
  const cat = paramCatalog();
  const cc = cat.groups.find((g) => g.name === "Champion–challenger");
  const item = cc?.items.find((i) => i.key === "AGENT_FALLBACK_N");
  check("paramCatalog view = 15 (không scale)", item?.view === 15 && item?.type === "number");
  check("note catalog nói rõ tighten-only + 0=off", typeof item?.note === "string" && item.note.includes("NEVER restores risk") && item.note.includes("0 = method-pure only"));

  const pr = readFileSync("src/lib/params.ts", "utf8");
  check("params.ts §4d export AGENT_FALLBACK_N = 15", pr.includes("export const AGENT_FALLBACK_N = 15;"));
}

// ══ 7 · BẢO HIỂM — fallback không bao giờ nới ════════════════════════════════
console.log("7. bất biến an toàn");
{
  const rec = st({ methodId: "__recent__", n: 30, expectancy: -5, winRate: 10 });
  // minScore đã 85 (trần) nhưng minAcc 84 → patch mang đủ 3 field như method-pure
  // (field không đổi vẫn được ghi lại giá trị cũ — applyCfg merge là no-op)
  const r = decidePatch(undefined, cfg({ minScore: 85, minAcc: 84, riskPct: 10 }), null, rec);
  check("minAcc 84→85 (còn chỗ thì siết)", r.patch?.minAcc === 85, JSON.stringify(r.patch));
  check("minScore giữ trần 85, risk giữ sàn 10", r.patch?.minScore === 85 && r.patch?.riskPct === 10, JSON.stringify(r.patch));
  check("risk KHÔNG BAO GIỜ tăng qua fallback (undefined hoặc ≤ hiện tại)", r.patch?.riskPct === undefined || r.patch.riskPct <= 10, JSON.stringify(r.patch?.riskPct));

  const ladder = decidePatch(undefined, cfg({ riskPct: 50 }), null, rec);
  check("risk 50 → 25 (một nấc, không nhảy thẳng 10)", ladder.patch?.riskPct === 25, JSON.stringify(ladder.patch));

  const cap = decidePatch(undefined, cfg({ minScore: 84 }), null, rec);
  check("minScore trần 85 (không vượt)", cap.patch?.minScore === 85);
  check("FLIP_COOLDOWN_CHOICES nguyên vẹn [0,15,30,60]", JSON.stringify([...FLIP_COOLDOWN_CHOICES]) === "[0,15,30,60]");
}

console.log(`\n${fail === 0 ? "ALL PASS" : `${fail} FAILED`}`);
process.exit(fail === 0 ? 0 : 1);
