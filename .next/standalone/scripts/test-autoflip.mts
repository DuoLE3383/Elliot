// v0.2.30 — ba thay đổi:
//   1. flipDecision — bộ loại AUTO-FLIP thuần: cùng sàn chất lượng với vào
//      lệnh + ngoài dải nhiễu + không regressed + sạch nến whale. prob LUÔN
//      là P(giá đi lên) nên SHORT prob=0.265 là tín hiệu MẠNH — test chặn
//      đúng bẫy "prob<0.5 là yếu" từng được cảnh báo trong dự án.
//   2. champ_check trong setupPrompt — LLM đọc được dữ liệu champion
//      (best-ever per pair+tf); không có champion → prompt KHÔNG thêm dòng.
//   3. exitKind "flip" — badge Telegram LẬT CHIỀU 🔄 + PATCH route chấp nhận.
import {
  flipDecision,
  type AutoTradeRow,
  type ScanRow,
} from "../src/lib/autotrade";
import { setupPrompt, type LlmSetup } from "../src/lib/llm";

let pass = 0;
let fail = 0;
const check = (name: string, cond: boolean, extra = "") => {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    console.log(`  ❌ ${name}${extra ? ` — ${extra}` : ""}`);
  }
};

// ─── scan row mẫu ────────────────────────────────────────────────────────────
const row = (over: Partial<ScanRow>): ScanRow => ({
  symbol: "LINKUSDT",
  interval: "15m",
  prob: 0.75,
  confidence: 0.5,
  bias: "LONG",
  auc: 0.845,
  acc: 78.1,
  score: 66.5,
  samples: 288,
  valSamples: 92,
  horizon: 5,
  slPct: 1.2,
  tpPct: 1.7,
  atrCoef: 1.5,
  ...(over as Partial<ScanRow>),
});
const open = (side: string): Pick<AutoTradeRow, "symbol" | "interval" | "side"> => ({
  symbol: "LINKUSDT",
  interval: "15m",
  side,
});
const cfg = { minAuc: 0.8, minAcc: 70, minScore: 60, whaleFilter: true };

console.log("\n═══ 1. flipDecision — đủ điều kiện lật ═══");
{
  // SHORT đang mở, model bật LONG dứt khoát (P(up)=0.75 → theo phía LONG)
  const d = flipDecision(open("SHORT"), row({ bias: "LONG", prob: 0.75 }), cfg);
  check("SHORT mở + model LONG đạt sàn → lật", d.ok, d.why);
  // LONG đang mở, model bật SHORT dứt khoát — prob 0.265 là P(up) ⇒ MẠNH theo
  // phía SHORT (73.5% tin giá giảm) — KHÔNG được chặn vì "prob thấp"
  const d2 = flipDecision(open("LONG"), row({ bias: "SHORT", prob: 0.265 }), cfg);
  check("LONG mở + model SHORT prob=0.265 (mạnh theo phía) → lật", d2.ok, d2.why);
}

console.log("\n═══ 2. flipDecision — từ chối có lý do ═══");
{
  const d1 = flipDecision(open("LONG"), row({ bias: "LONG" }), cfg);
  check("model vẫn cùng phía → không lật", !d1.ok && d1.why.includes("xác nhận"));
  const d2 = flipDecision(open("LONG"), row({ bias: "NEUTRAL" }), cfg);
  check("model NEUTRAL → không lật theo nhiễu", !d2.ok && d2.why.includes("NEUTRAL"));
  const d3 = flipDecision(open("LONG"), row({ bias: "SHORT", prob: 0.47, score: 66.5 }), cfg);
  check("prob 0.47 trong dải nhiễu (|P−0.5|=0.03<0.06) → không lật", !d3.ok && d3.why.includes("nhiễu"));
  const d4 = flipDecision(open("LONG"), row({ bias: "SHORT", acc: 55, auc: 0.55, score: 20 }), cfg);
  check("dưới sàn chung → không lật", !d4.ok && d4.why.includes("chưa đạt sàn"));
  const d5 = flipDecision(open("LONG"), row({ bias: "SHORT", regressed: true }), cfg);
  check("model thoái hoá vs champion → không lật", !d5.ok && d5.why.includes("thoái hoá"));
  const whaleRow = row({ bias: "SHORT" }) as ScanRow & { whale?: { tag: string } };
  whaleRow.whale = { tag: "whale" };
  const d6 = flipDecision(open("LONG"), whaleRow, cfg);
  check("nến whale → không lật vào bẫy wick", !d6.ok && d6.why.includes("whale"));
  // whale filter tắt → nến whale không còn chặn
  const d7 = flipDecision(open("LONG"), whaleRow, { ...cfg, whaleFilter: false });
  check("whale filter TẮT → nến whale không chặn", d7.ok, d7.why);
  const d8 = flipDecision(open("LONG"), undefined, cfg);
  check("scan chưa có combo → không lật", !d8.ok && d8.why.includes("chưa có"));
}

console.log("\n═══ 3. champ_check — LLM đọc được dữ liệu champion ═══");
{
  const base: LlmSetup = {
    symbol: "LINKUSDT",
    interval: "15m",
    side: "SHORT",
    prob: 0.265,
    confidence: 0.47,
    auc: 0.845,
    acc: 78.1,
    slPct: 1.2,
    tpPct: 1.7,
    leverage: 20,
    stakePct: 10,
    horizon: 5,
    samples: 288,
    score: 66.5,
    gatePassed: true,
  };
  // model bằng champion
  const pEq = setupPrompt({ ...base, champAuc: 0.845, champAcc: 61.6 });
  check("có champAuc → prompt có champ_check", pEq.includes("champ_check:"));
  check("model bằng đỉnh → AT or ABOVE champion", pEq.includes("AT or ABOVE champion"));
  check("dòng champion nêu best-ever đúng số", pEq.includes("val_auc=0.845/val_acc=61.6%"));
  // model tụt 0.012 — trong dung sai regressed 0.02
  const pNear = setupPrompt({ ...base, auc: 0.833, champAuc: 0.845, champAcc: 61.6 });
  check("tụt 0.012 → within regression tolerance", pNear.includes("within regression tolerance"));
  // model tụt 0.1 — regressed (engine bỏ, nút Duyệt thử vẫn gửi để user thấy)
  const pReg = setupPrompt({ ...base, auc: 0.745, champAuc: 0.845, champAcc: 61.6 });
  check("tụt 0.1 → REGRESSED vs champion", pReg.includes("REGRESSED vs champion"));
  // không có champion → không thêm dòng nhiễu
  const pNoChamp = setupPrompt(base);
  check("không champAuc → prompt KHÔNG có champ_check", !pNoChamp.includes("champ_check"));
  // các checks cũ vẫn nguyên
  check("rr_check vẫn còn", pEq.includes("rr_check:"));
  check("coinflip_check vẫn còn", pEq.includes("coinflip_check:"));
  check("liq_check vẫn còn", pEq.includes("liq_check:"));
  check("sample_base vẫn còn", pEq.includes("sample_base:"));
}

console.log("\n═══ 4. exitKind flip — wire-up ═══");
{
  // PATCH route + kindTag + badge là code UI/route — kiểm tra nguồn ở đây
  const fs = await import("node:fs");
  const route = fs.readFileSync("src/app/api/autotrade/route.ts", "utf8");
  check("PATCH /api/autotrade close nhận exitKind flip", route.includes('body.exitKind === "flip" ? "flip"'));
  const tg = fs.readFileSync("src/lib/tg-msgs.ts", "utf8");
  check("Telegram tag LẬT CHIỀU 🔄", tg.includes('"flip" ? "LẬT CHIỀU 🔄"'));
  const panel = fs.readFileSync("src/components/auto-panel.tsx", "utf8");
  check("badge lịch sử hiện 🔄 cho lệnh lật", panel.includes('r.exitKind === "flip" ? "🔄"'));
  check("panel có knob 🔄 autoFlip", panel.includes("autoFlip: !cfg.autoFlip"));
  const i18n = fs.readFileSync("src/lib/i18n.ts", "utf8");
  check("i18n có auto.flip.title", i18n.includes('"auto.flip.title"'));
  const cfgLib = fs.readFileSync("src/lib/autotrade.ts", "utf8");
  check("AutoConfig có autoFlip (default true)", cfgLib.includes("autoFlip: true"));
  check("loadAutoConfig giữ autoFlip", cfgLib.includes("autoFlip: p.autoFlip !== false"));
  const engine = fs.readFileSync("src/lib/engine.ts", "utf8");
  check("engine gọi flipDecision trong cycleTick", engine.includes("flipDecision(open, row, c)"));
  check("engine có tryFlip đóng exitKind flip", engine.includes('closeTradeDirect(open.id, price, "flip")'));
  check("llmGate gửi champAuc/champAcc cho LLM", engine.includes("champAuc: row.champAuc"));
  const aiInfo = fs.readFileSync("src/app/api/ai-info/route.ts", "utf8");
  check(
    "ai-info destructure khớp thứ tự Promise.all (champRows ở CUỐI)",
    aiInfo.includes("llm, autopsyCount, autopsyRows, champRows] = await Promise.all"),
  );
}

console.log(`\n═══ KẾT QUẢ: ${pass} PASS · ${fail} FAIL ═══`);
if (fail > 0) process.exit(1);
