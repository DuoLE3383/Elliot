// QA 0.2.79 — RISK ENVELOPE + STATS THEO KHUNG GIỜ (audit 04/11:
// "Apply the exposure cuts (leverage, stake, DCA, position cap) now" +
// "Break your results down by timeframe, with fees and funding separated out"
// + "Compare the live hit rate to predicted probability bucket by bucket").
//
//  A. clampLev / clampStake / allowDcaAdd — toán kẹp trần, 0 = off, override
//     runtime pval ăn hiệu lực NGAY (không restart).
//  B. Exposure cuts — AUTO_DEFAULTS.riskPct 3% (audit: 2-3%), RISK_CHOICES có
//     2/3/5% bên các mức cũ; methodId đổi theo policy mới là ĐÚNG (self-improve
//     fallback 0.2.75 lo phần mẫu reset).
//  C. Wiring engine — clampLev ở CẢ HAI cửa ghi p.leverage (load engine.json +
//     sync browser); clampStake ở entry + flip + llmGate (Risk Officer thấy số
//     engine thực cam); allowDcaAdd chặn DCA trước mọi check scan/model; p.dca
//     .stake0 = stake ĐÃ KẸP (bù thêm đúng nấc trần); engine ĐƠN VỊ THỂ (findFirst
//     status "open" trước khi mở — cap vị thế đồng thời = 1 đã có sẵn).
//  D. params-store — RISK_MAX_LEV/RISK_MAX_STAKE thuộc nhóm Flip / SL-TP (không
//     thêm nhóm mới — test 02-59 fail cũ giữ nguyên byte), clamp biên, set/
//     reset roundtrip.
//  E. tf-stats — rowRoi tính gross từ GIÁ (đồng nhất pre/post 0.2.77), phí =
//     feeRoi 2 bên, net sàn −100, thanh lý = −100; tfBreakdown gộp đúng theo
//     khung (n/WR/gross/fee/net/hold/exits/flipNet/equity), thứ tự INTERVALS;
//     calibrationBuckets bucket pWin theo phía (SHORT = 1−prob), gap = real−pred.
//  F. Script stats-tf.mts — tồn tại, nạp .env (DATABASE_URL đúng DB app),
//     hydrate params-override, in đủ cột gross/fees/net + funding ước tính.
import {
  allowDcaAdd,
  clampLev,
  clampStake,
  RISK_MAX_LEV,
  RISK_MAX_STAKE,
  FEE_PCT,
} from "../src/lib/params.ts";
import { AUTO_DEFAULTS, RISK_CHOICES, DCA_CHOICES } from "../src/lib/autotrade.ts";
import { calibrationBuckets, rowRoi, tfBreakdown, tfTotal, type TfTradeRow } from "../src/lib/tf-stats.ts";
import { setOverride, paramCatalog } from "../src/lib/params-store.ts";
import { readFileSync } from "fs";

let fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) fail++;
};
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;
const setParams = (o: Record<string, unknown> | undefined) => {
  (globalThis as { __elliotParams?: Record<string, unknown> }).__elliotParams = o;
};

// ── A · clamp math ────────────────────────────────────────────────────────────
console.log("1. clampLev / clampStake / allowDcaAdd — toán trần");
{
  setParams(undefined);
  check("RISK_MAX_LEV mặc định 5 (audit ×3-5)", RISK_MAX_LEV === 5);
  check("RISK_MAX_STAKE mặc định 3 (audit stake 2-3%)", RISK_MAX_STAKE === 3);
  check("clampLev(10) = 5", clampLev(10) === 5);
  check("clampLev(3) = 3 (dưới trần giữ nguyên)", clampLev(3) === 3);
  check("clampLev(5) = 5 (đúng trần)", clampLev(5) === 5);
  check("clampLev(1) = 1 (lev tối thiểu)", clampLev(1) === 1);
  check("clampStake(25) = 3", clampStake(25) === 3);
  check("clampStake(2) = 2", clampStake(2) === 2);
  check("clampStake(3) = 3", clampStake(3) === 3);
  check("allowDcaAdd(3, 3) = false (3+3 > 3 — stake đầy không bù martingale)", allowDcaAdd(3, 3) === false);
  check("allowDcaAdd(2, 1) = true (2+1 ≤ 3)", allowDcaAdd(2, 1) === true);
  check("allowDcaAdd(1.5, 1.5) = true (3 == 3 — biên eps)", allowDcaAdd(1.5, 1.5) === true);
  check("allowDcaAdd(1.5, 1.50001) = false (vượt biên dù nhỏ)", allowDcaAdd(1.5, 1.50001) === false);
  // override runtime — chỉnh /ai ăn hiệu lực lệnh kế tiếp
  setParams({ RISK_MAX_LEV: 20, RISK_MAX_STAKE: 10 });
  check("override RISK_MAX_LEV 20 → clampLev(10) = 10", clampLev(10) === 10);
  check("override RISK_MAX_STAKE 10 → clampStake(25) = 10", clampStake(25) === 10);
  check("override → allowDcaAdd(5, 5) = true (10 == 10)", allowDcaAdd(5, 5) === true);
  // 0 = off
  setParams({ RISK_MAX_LEV: 0, RISK_MAX_STAKE: 0 });
  check("RISK_MAX_LEV 0 → clampLev(125) = 125 (off)", clampLev(125) === 125);
  check("RISK_MAX_STAKE 0 → clampStake(100) = 100 (off)", clampStake(100) === 100);
  check("off → allowDcaAdd(100, 100) = true", allowDcaAdd(100, 100) === true);
  setParams(undefined);
}

// ── B · defaults + choices ───────────────────────────────────────────────────
console.log("2. exposure cuts — AUTO_DEFAULTS + RISK_CHOICES");
{
  check("AUTO_DEFAULTS.riskPct = 3 (audit 2-3%)", AUTO_DEFAULTS.riskPct === 3);
  check("AUTO_DEFAULTS.dcaMax = 1 (giữ; trần stake tự chặn bù khi đầy)", AUTO_DEFAULTS.dcaMax === 1);
  check("RISK_CHOICES có 2/3/5 + các mức cũ", [2, 3, 5, 10, 25, 50, 100].every((x) => (RISK_CHOICES as readonly number[]).includes(x)));
  check("RISK_CHOICES đúng thứ tự tăng", JSON.stringify(RISK_CHOICES) === JSON.stringify([2, 3, 5, 10, 25, 50, 100]));
  check("DCA_CHOICES giữ nguyên [0,1,2]", JSON.stringify(DCA_CHOICES) === JSON.stringify([0, 1, 2]));
  // max exposure mặc định: 3% × ×5 = 15% notional; liq mất tối đa 3% vốn
  check("max notional mặc định = 15% vốn (3% × ×5)", near(clampStake(AUTO_DEFAULTS.riskPct) * clampLev(10), 15));
}

// ── C · wiring engine ────────────────────────────────────────────────────────
console.log("3. wiring — engine kẹp ở ĐÚNG cửa");
{
  const eng = readFileSync("src/lib/engine.ts", "utf8");
  const at = readFileSync("src/lib/autotrade.ts", "utf8");
  check("engine import clampLev/clampStake/allowDcaAdd từ ./params", eng.includes("clampLev,") && eng.includes("clampStake,") && eng.includes("allowDcaAdd,"));
  check("loadEngine: p.leverage = clampLev(raw.leverage)", eng.includes("p.leverage = clampLev(raw.leverage)"));
  check("syncEngine: p.leverage = clampLev(input.leverage)", eng.includes("p.leverage = clampLev(input.leverage)"));
  const entryClamps = eng.match(/stakeUsed = clampStake\(c\.riskPct\)/g) ?? [];
  check(`entry + flip đều có stakeUsed = clampStake(c.riskPct) — got ${entryClamps.length}`, entryClamps.length === 2);
  check("llmGate: stakePct: clampStake(c.riskPct) (Risk Officer thấy số thực cam)", eng.includes("stakePct: clampStake(c.riskPct)"));
  check("create (entry + flip): stakePct: stakeUsed", (eng.match(/stakePct: stakeUsed,/g) ?? []).length === 2);
  check("p.dca.stake0 = stakeUsed (bù đúng nấc đã kẹp)", (eng.match(/stake0: stakeUsed,/g) ?? []).length === 2);
  check("dcaRescue: allowDcaAdd chặn TRƯỚC check scan/model", eng.indexOf("allowDcaAdd(open.stakePct ?? c.riskPct, stake0Env)") >= 0 && eng.indexOf("allowDcaAdd(open.stakePct ?? c.riskPct, stake0Env)") < eng.indexOf("fail-safe: a FRESH scan must still confirm"));
  check("kẹp bị ghi log (không âm thầm)", eng.includes("trần RISK_MAX_STAKE"));
  check("vị thế đồng thời = 1 (engine đơn vị thể — findFirst status open ở entry + flip)", (eng.match(/findFirst\(\{ where: \{ status: "open" \} \}\)/g) ?? []).length === 2);
  check("autotrade: llmTestSetup stake = clampStake(cfg.riskPct)", at.includes("stakePct: clampStake(cfg.riskPct)"));
  check("autotrade: comment riskPct == stakePct (một núm hai tên)", at.includes("MỘT núm, hai tên gọi"));
}

// ── D · params-store ─────────────────────────────────────────────────────────
console.log("4. params-store — hai núm runtime nhóm Flip / SL-TP");
{
  const cat = paramCatalog();
  const all = cat.groups.flatMap((g) => g.items);
  const lev = all.find((i) => i.key === "RISK_MAX_LEV");
  const stake = all.find((i) => i.key === "RISK_MAX_STAKE");
  check("RISK_MAX_LEV trong catalog", lev != null);
  check("RISK_MAX_STAKE trong catalog", stake != null);
  const grpOf = (key: string) => cat.groups.find((g) => g.items.some((i) => i.key === key))?.name;
  check("cùng nhóm Flip / SL-TP (không thêm nhóm — 02-59 fail cũ giữ nguyên)", grpOf("RISK_MAX_LEV") === "Flip / SL-TP" && grpOf("RISK_MAX_STAKE") === "Flip / SL-TP");
  check("giá trị mặc định đúng (5 / 3)", lev?.def === 5 && stake?.def === 3);
  check("min 0 (0 = off)", lev?.min === 0 && stake?.min === 0);
  // set + reset roundtrip
  const r1 = setOverride("RISK_MAX_STAKE", 8);
  check("setOverride RISK_MAX_STAKE 8 ok", r1.ok && clampStake(25) === 8);
  const r2 = setOverride("RISK_MAX_STAKE", null);
  check("reset RISK_MAX_STAKE → về mặc định 3", r2.ok && clampStake(25) === 3);
  const r3 = setOverride("RISK_MAX_LEV", 300);
  check("clamp biên: RISK_MAX_LEV 300 → 125", r3.ok && clampLev(200) === 125);
  setOverride("RISK_MAX_LEV", null);
  check("reset RISK_MAX_LEV → về 5", clampLev(10) === 5);
}

// ── E · tf-stats ─────────────────────────────────────────────────────────────
console.log("5. tf-stats — gross từ GIÁ, phí, net, calibration");
{
  const t = (o: Partial<TfTradeRow>): TfTradeRow => ({
    symbol: "TESTUSDT",
    interval: "5m",
    side: "LONG",
    entryPrice: 100,
    exitPrice: 101,
    leverage: 10,
    stakePct: 3,
    prob: 0.62,
    pnlPct: null,
    exitKind: "tp",
    entryTime: new Date("2026-11-04T10:00:00Z"),
    exitTime: new Date("2026-11-04T10:25:00Z"),
    ...o,
  });
  // rowRoi
  const a = rowRoi(t({}));
  check("rowRoi LONG 100→101 ×10: gross +10", near(a.gross, 10));
  check(`rowRoi phí round-trip ×10 = ${2 * FEE_PCT * 10} (feeRoi cùng công thức settlement)`, near(a.fee, 2 * FEE_PCT * 10));
  check("rowRoi net = gross − fee = +9", near(a.net, 9));
  check("rowRoi không liq", a.isLiq === false);
  const b = rowRoi(t({ side: "SHORT", exitPrice: 99 }));
  check("rowRoi SHORT 100→99 ×10: gross +10 (chiều SHORT ăn khi giảm)", near(b.gross, 10));
  const c = rowRoi(t({ side: "SHORT", exitPrice: 110 }));
  check("rowRoi SHORT 100→110 ×10: adverse 10% = 100/lev → liq, gross −100", c.isLiq && near(c.gross, -100));
  check("rowRoi liq: net = −100 (phí không kéo dưới đáy)", near(c.net, -100));
  const d = rowRoi(t({ leverage: 1, exitPrice: 100.5 }));
  check("rowRoi ×1: fee = 2×0.05 = 0.1", near(d.fee, 0.1));
  const e = rowRoi(t({ exitPrice: null }));
  check("rowRoi thiếu exitPrice → 0 (không đoán mò)", e.gross === 0 && e.net === 0 && e.fee === 0);
  setParams({ FEE_PCT: 0 });
  const f = rowRoi(t({}));
  check("FEE_PCT = 0 → net = gross (off sạch)", near(f.fee, 0) && near(f.net, f.gross));
  setParams(undefined);

  // tfBreakdown — 3 lệnh 5m (1 win 2 loss, 1 flip) + 1 lệnh 1h + 1 lệnh khung lạ
  const rows = [
    t({ exitPrice: 101, exitKind: "tp", stakePct: 3 }), // +9 net · equity +0.27
    t({ exitPrice: 99.95, exitKind: "flip", stakePct: 3, exitTime: new Date("2026-11-04T10:10:00Z") }), // move −0.05 → gross −0.5, fee −1 → net −1.5
    t({ exitPrice: 99.8, exitKind: "sl", stakePct: 3 }), // move −0.2 → gross −2, net −3
    t({ interval: "1h", exitPrice: 102, exitKind: "tp", stakePct: 3, entryTime: new Date("2026-11-04T08:00:00Z"), exitTime: new Date("2026-11-04T09:00:00Z") }), // +20 − 1 = +19
    t({ interval: "3h", exitPrice: 100.1, exitKind: "manual", stakePct: 3 }), // +1 −1 = 0
  ];
  const per = tfBreakdown(rows);
  check("3 khung: 5m, 1h, 3h (3h là khung lạ đứng cuối)", per.length === 3 && per[0].interval === "5m" && per[1].interval === "1h" && per[2].interval === "3h");
  const m5 = per[0];
  check("5m n=3, wins=1 (chỉ lệnh net>0)", m5.n === 3 && m5.wins === 1);
  check("5m WR = 33.3%", near(m5.winRate, 33.3));
  check(`5m gross = ${rowRoi(rows[1]).gross - rowRoi(rows[2]).gross + 10}`, near(m5.grossRoe, 10 + rowRoi(rows[1]).gross + rowRoi(rows[2]).gross));
  check("5m fee = 3 × 1.0 = 3.0", near(m5.feeRoi, 3));
  check("5m net = 9 − 1.5 − 3 = 4.5", near(m5.netRoe, 4.5, 0.011));
  check("5m avgNet = 1.5", near(m5.avgNet, 1.5, 0.005));
  check("5m exits tp1/sl1/flip1", m5.exits.tp === 1 && m5.exits.sl === 1 && m5.exits.flip === 1);
  check(`5m flipNet = ${rowRoi(rows[1]).net} (chỉ lệnh flip)`, near(m5.flipNet, rowRoi(rows[1]).net));
  check("5m avgHoldMin = (25+10+25)/3 = 20", m5.avgHoldMin === 20);
  check("5m netEquityPct = Σ net×3% = 4.5×0.03 = 0.14", near(m5.netEquityPct, 0.14, 0.001));
  const h1 = per[1];
  check("1h n=1 wins=1 net=+19", h1.n === 1 && h1.wins === 1 && near(h1.netRoe, 19));
  check("1h avgHoldMin = 60", h1.avgHoldMin === 60);
  const tot = tfTotal(rows);
  check("ALL n=5, wins=2 (net 0 của manual KHÔNG tính win)", tot.n === 5 && tot.wins === 2);
  check("ALL netRoe = 4.5+19+0", near(tot.netRoe, 23.5, 0.011));
  check("ALL exits gộp đủ", tot.exits.tp === 2 && tot.exits.sl === 1 && tot.exits.flip === 1 && tot.exits.manual === 1);
  const empty = tfTotal([]);
  check("tfTotal rỗng an toàn", empty.n === 0 && empty.netRoe === 0 && empty.avgHoldMin === null);

  // calibration
  const cal = calibrationBuckets([
    t({ prob: 0.62, exitPrice: 101 }), // LONG p .62 win
    t({ prob: 0.38, side: "SHORT", exitPrice: 99 }), // SHORT 1−.38 = .62 win
    t({ prob: 0.63, exitPrice: 99.9 }), // p .63 loss (net −2… move −0.1 → −1 −1 = −2)
    t({ prob: 0.57, exitPrice: 101 }), // p .57 win → bucket .55-.60
    t({ prob: null, exitPrice: 101 }), // bỏ qua
    t({ prob: 0.61, side: "SHORT", exitPrice: 100.05 }), // SHORT p = .39 ≤ .5 → bỏ
  ]);
  const b62 = cal.find((x) => x.lo === 0.6);
  check("bucket .60-.65: n=3 (LONG .62, SHORT 1−.38, .63)", b62 != null && b62.n === 3);
  check("bucket .60-.65: avgPred 62.3", b62 != null && near(b62.avgPred, 62.3, 0.011));
  check("bucket .60-.65: real 66.7 (2/3 win)", b62 != null && near(b62.winRate, 66.7));
  check("bucket .60-.65: gap +4.3", b62 != null && near(b62.gap, 4.3, 0.11));
  const b55 = cal.find((x) => x.lo === 0.55);
  check("bucket .55-.60: n=1 win 100% gap +43", b55 != null && b55.n === 1 && near(b55.winRate, 100) && near(b55.gap, 43, 0.11));
  check("prob null / pWin ≤ 0.5 không vào bucket", cal.reduce((a, x) => a + x.n, 0) === 4);
}

// ── F · script ───────────────────────────────────────────────────────────────
console.log("6. scripts/stats-tf.mts — đủ cột + ghi chú funding");
{
  const s = readFileSync("scripts/stats-tf.mts", "utf8");
  check("script tồn tại + nạp .env (DATABASE_URL đúng DB app)", s.includes('readFileSync(path.join(process.cwd(), ".env")'));
  check("hydrate params-override như engine (FEE_PCT runtime)", s.includes("hydrateParams"));
  check("in cột gross/fees/net theo TF", s.includes("gross%") && s.includes("fees%") && s.includes("net%"));
  check("funding ước tính riêng (0.01%/8h) — không trộn cột phí", s.includes("0.01%/8h"));
  check("đối chiếu Σ pnlPct DB (giải thích lệch pre-0.2.77)", s.includes("Σ pnlPct trong DB"));
  check("copy-paste block cho audit", s.includes("COPY-PASTE"));
}

console.log(fail === 0 ? "\n═══ ALL RISK-CAP + TF-STATS PASS ═══" : `\n═══ ${fail} FAILED ═══`);
process.exit(fail === 0 ? 0 : 1);
