// QA 0.2.74 — SL/TP ĐỘNG: pair × time × volume, không còn số cứng.
//   A. dynLevelsAtEntry (indicators.ts) — pure math:
//      pair  → atrPct  = ATR(14)% nến đóng cuối (xương sống, đúng khung giao dịch)
//      time  → heatMul = mean TR(5 nến đóng cuối) / ATR14, kẹp [0.8, 1.4]
//      vol   → volMul  = vol(20 gần nhất) / vol(100 baseline), kẹp [0.85, 1.25]
//      slPct = clamp(atrPct × coef × heatMul × volMul, 0.3, 20); TP = SL × 1.4
//      — trung tính (heat=vol=1) suy biến ĐÚNG bằng atrLevelsAtEntry cũ.
//   B. mode plumbing — tpMode "atr" → "dyn" (type, defaults, TP_MODES,
//      sanitizeTpMode một nguồn cho localStorage + engine.json + sync).
//   C. wiring — engine entry/flip gọi dyn, sanitizeTpMode ở loadEngine +
//      syncEngine, panel/i18n nhãn mới, không còn `=== "atr"` mode check.
import {
  atr,
  atrLevelsAtEntry,
  dynLevelsAtEntry,
  DYN_HEAT_WIN,
  DYN_VOL_WIN,
  DYN_VOL_BASE,
  DYN_HEAT_CLAMP,
  DYN_VOL_CLAMP,
} from "../src/lib/indicators.ts";
import {
  AUTO_DEFAULTS,
  TP_MODES,
  sanitizeTpMode,
  type AutoConfig,
} from "../src/lib/autotrade.ts";
import type { Kline } from "../src/lib/types.ts";
import { readFileSync } from "fs";

let fail = 0;
const check = (name: string, ok: boolean) => {
  console.log(`${ok ? "✅" : "❌"} ${name}`);
  if (!ok) fail++;
};
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;
const r1 = (v: number) => Math.round(v * 10) / 10;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// fixture: n nến ĐÓNG TR+volume hằng, tuỳ chọn ghi đè `cnt` nến đóng cuối
// (TR/vol khác) + 1 nến đang hình thành (bị loại theo quy ước last-closed).
// close = 100 hằng → không gap → TR = h−l đúng bằng tham số.
const C = 100;
function mk(n: number, tr: number, vol: number, tail?: { tr?: number; vol?: number; cnt?: number }): Kline[] {
  const cnt = tail?.cnt ?? 0;
  const out: Kline[] = [];
  for (let i = 0; i < n; i++) {
    const t = cnt > 0 && i >= n - cnt ? (tail?.tr ?? tr) : tr;
    const v = cnt > 0 && i >= n - cnt ? (tail?.vol ?? vol) : vol;
    out.push({ t: i * 60_000, o: C, h: C + t / 2, l: C - t / 2, c: C, v });
  }
  out.push({ t: n * 60_000, o: C, h: C + tr / 2, l: C - tr / 2, c: C, v: vol });
  return out;
}
// tham chiếu độc lập: ATR Wilder + các thành phần dyn tính tay từ klines thô
function refDyn(kl: Kline[], coef: number) {
  const last = kl.length - 2;
  const a = atr(kl, 14)[last]!;
  const atrPct = (a / kl[last].c) * 100;
  let trSum = 0;
  for (let i = last - DYN_HEAT_WIN + 1; i <= last; i++) {
    const k = kl[i];
    const p = kl[i - 1];
    trSum += Math.max(k.h - k.l, Math.abs(k.h - p.c), Math.abs(k.l - p.c));
  }
  const heatMul = clamp(trSum / DYN_HEAT_WIN / a, DYN_HEAT_CLAMP[0], DYN_HEAT_CLAMP[1]);
  let recSum = 0;
  for (let i = last - DYN_VOL_WIN + 1; i <= last; i++) recSum += kl[i].v;
  let baseSum = 0;
  let baseCnt = 0;
  for (let i = Math.max(0, last - DYN_VOL_WIN - DYN_VOL_BASE + 1); i <= last - DYN_VOL_WIN; i++) {
    baseSum += kl[i].v;
    baseCnt++;
  }
  const volMul = baseCnt >= 30 && baseSum > 0 ? clamp(recSum / DYN_VOL_WIN / (baseSum / baseCnt), DYN_VOL_CLAMP[0], DYN_VOL_CLAMP[1]) : 1;
  return {
    atrPct,
    heatMul,
    volMul,
    slPct: r1(clamp(atrPct * coef * heatMul * volMul, 0.3, 20)),
    tpPct: r1(clamp(r1(clamp(atrPct * coef * heatMul * volMul, 0.3, 20)) * 1.4, 0.4, 28)),
  };
}

// ── A · dynLevelsAtEntry — pure math ─────────────────────────────────────────
console.log("1. constants + trường hợp trung tính (pair thuần)");
check("DYN_HEAT_WIN = 5", DYN_HEAT_WIN === 5);
check("DYN_VOL_WIN = 20 · DYN_VOL_BASE = 100", DYN_VOL_WIN === 20 && DYN_VOL_BASE === 100);
check("heat clamp [0.8, 1.4] · vol clamp [0.85, 1.25]", DYN_HEAT_CLAMP[0] === 0.8 && DYN_HEAT_CLAMP[1] === 1.4 && DYN_VOL_CLAMP[0] === 0.85 && DYN_VOL_CLAMP[1] === 1.25);
{
  const kl = mk(130, 1, 100); // TR 1 (1% giá) · vol 100 — trung tính tuyệt đối
  const d = dynLevelsAtEntry(kl, 1.5)!;
  check("ATR hằng → atrPct = 1%", near(d.atrPct, 1));
  check("heatMul = 1 (TR gần = ATR)", near(d.heatMul, 1));
  check("volMul = 1 (vol gần = baseline)", near(d.volMul, 1));
  check("SL = 1% × 1.5 = 1.5% · TP = 2.1%", d.slPct === 1.5 && d.tpPct === 2.1);
  const legacy = atrLevelsAtEntry(kl, 1.5)!;
  check(
    "suy biến = atrLevelsAtEntry cũ (bit-for-bit)",
    d.slPct === legacy.slPct && d.tpPct === legacy.tpPct && near(d.atrPct, legacy.atrPct),
  );
  const d2 = dynLevelsAtEntry(kl, 2)!;
  check("coef 2 → SL 2% · TP 2.8% (tuyến tính theo xương sống)", d2.slPct === 2 && d2.tpPct === 2.8);
}

console.log("2. time — heatMul: thị trường ĐANG nóng / nguội so baseline của pair");
{
  const neutral = dynLevelsAtEntry(mk(130, 1, 100), 1.5)!;
  const hot = dynLevelsAtEntry(mk(130, 1, 100, { tr: 3, cnt: 5 }), 1.5)!;
  const cool = dynLevelsAtEntry(mk(130, 1, 100, { tr: 0.2, cnt: 5 }), 1.5)!;
  check("5 nến TR 3× → heatMul chặn trần 1.4", near(hot.heatMul, 1.4));
  check("5 nến TR 0.2× → heatMul chặn sàn 0.8", near(cool.heatMul, 0.8));
  check("nóng → SL RỘNG hơn trung tính", hot.slPct > neutral.slPct);
  check("nguội → SL HẸP hơn trung tính", cool.slPct < neutral.slPct);
  // giá trị chính xác theo công thức (ATR Wilder tiến hoá qua 5 nến TR=3)
  const klHot = mk(130, 1, 100, { tr: 3, cnt: 5 });
  const ref = refDyn(klHot, 1.5);
  const d = dynLevelsAtEntry(klHot, 1.5)!;
  check(
    "heat case khớp tham chiếu độc lập (ATR RMA + mean TR)",
    near(d.atrPct, ref.atrPct) && near(d.heatMul, ref.heatMul) && near(d.volMul, ref.volMul) && near(d.slPct, ref.slPct) && near(d.tpPct, ref.tpPct),
  );
  // chu kỳ nóng DÀI bị ATR hút vào — heat đo độ lệch NGẮN HẠN, không lặpfinite
  const longHot = dynLevelsAtEntry(mk(130, 1, 100, { tr: 3, cnt: 20 }), 1.5)!;
  check("20 nến nóng → ATR hấp thụ, heatMul < 1.4 (đo lệch ngắn hạn)", longHot.heatMul < 1.4);
}

console.log("3. volume — volMul: volume phồng / khô so baseline 100 nến");
{
  const neutral = dynLevelsAtEntry(mk(130, 1, 100), 1.5)!;
  const surge = dynLevelsAtEntry(mk(130, 1, 100, { vol: 400, cnt: 20 }), 1.5)!;
  const dry = dynLevelsAtEntry(mk(130, 1, 100, { vol: 30, cnt: 20 }), 1.5)!;
  check("vol 4× trong 20 nến → volMul chặn trần 1.25", near(surge.volMul, 1.25));
  check("vol 0.3× trong 20 nến → volMul chặn sàn 0.85", near(dry.volMul, 0.85));
  check("volume phồng → SL RỘNG hơn", surge.slPct > neutral.slPct);
  check("volume khô → SL HẸP hơn", dry.slPct < neutral.slPct);
  check("volume KHÔNG đụng tới ATR/heat (chỉ nhân volMul)", near(surge.atrPct, neutral.atrPct) && near(surge.heatMul, neutral.heatMul));
  const combo = dynLevelsAtEntry(mk(130, 1, 100, { tr: 3, vol: 400, cnt: 20 }), 1.5)!;
  const ref = refDyn(mk(130, 1, 100, { tr: 3, vol: 400, cnt: 20 }), 1.5);
  check(
    "kết hợp heat × vol khớp công thức (SL = atr% × coef × heat × vol)",
    near(combo.heatMul, ref.heatMul) && near(combo.volMul, ref.volMul) && near(combo.slPct, ref.slPct) && near(combo.tpPct, ref.tpPct),
  );
  check("R:R giữ 1.4 khi không chạm trần (TP = SL × 1.4)", near(combo.tpPct, r1(combo.slPct * 1.4)));
}

console.log("4. no-lookahead + edge cases");
{
  const base = mk(130, 1, 100);
  const d0 = dynLevelsAtEntry(base, 1.5)!;
  // nến đang hình thành (index cuối) TR/volume điên loạn → KHÔNG ảnh hưởng
  const wild = [...base.slice(0, -1), { ...base[base.length - 1], h: C + 50, l: C - 50, v: 999999 }];
  const d1 = dynLevelsAtEntry(wild, 1.5)!;
  check("nến FORMING đổi TR/vol khủng → output GIỐNG HỆT (no-lookahead)", JSON.stringify(d0) === JSON.stringify(d1));
  check("12 nến đóng → null (fail-open)", dynLevelsAtEntry(mk(12, 1, 100), 1.5) == null);
  check("14 nến đóng → null (guard last ≥ 14)", dynLevelsAtEntry(mk(14, 1, 100), 1.5) == null);
  check("15 nến đóng → có giá trị", dynLevelsAtEntry(mk(15, 1, 100), 1.5) != null);
  const zeroVol = dynLevelsAtEntry(mk(130, 1, 0), 1.5)!;
  check("volume toàn 0 → volMul = 1 trung tính (ATR vẫn chạy)", near(zeroVol.volMul, 1) && zeroVol.slPct === 1.5);
  // baseline < 30 nến → volMul trung tính dù volume đang surge
  const thin = dynLevelsAtEntry(mk(45, 1, 100, { vol: 400, cnt: 20 }), 1.5)!;
  check("baseline 25 nến (< 30) → volMul = 1, không phạt serie ngắn", near(thin.volMul, 1));
  // sàn/cận SL-TP giữ như ATR mode
  const tiny = dynLevelsAtEntry(mk(130, 0.01, 100), 1)!;
  check("ATR 0.01% × coef 1 → SL sàn 0.3%", tiny.slPct === 0.3 && tiny.tpPct === 0.4);
}

// ── B · mode plumbing — "atr" → "dyn" ────────────────────────────────────────
console.log("5. sanitizeTpMode + defaults + TP_MODES");
check(`TP_MODES = ["dyn","auto","manual"] (got ${JSON.stringify(TP_MODES)})`, JSON.stringify(TP_MODES) === JSON.stringify(["dyn", "auto", "manual"]));
check(`AUTO_DEFAULTS.tpMode = "dyn" (got ${AUTO_DEFAULTS.tpMode})`, AUTO_DEFAULTS.tpMode === "dyn");
check("sanitizeTpMode: legacy \"atr\" → \"dyn\"", sanitizeTpMode("atr") === "dyn");
check("sanitizeTpMode: \"dyn\" → \"dyn\"", sanitizeTpMode("dyn") === "dyn");
check("sanitizeTpMode: \"auto\" giữ nguyên", sanitizeTpMode("auto") === "auto");
check("sanitizeTpMode: \"manual\" giữ nguyên", sanitizeTpMode("manual") === "manual");
check("sanitizeTpMode: undefined / giá trị lạ → \"dyn\"", sanitizeTpMode(undefined) === "dyn" && sanitizeTpMode("bogus" as unknown as never) === "dyn" && sanitizeTpMode(42 as unknown as never) === "dyn");
{
  // default thả nổi qua sanitize vẫn ổn — type-level smoke
  const cfg: AutoConfig = { ...AUTO_DEFAULTS };
  check("AutoConfig compile với tpMode \"dyn\" + manual fallback levels giữ nguyên", cfg.tpMode === "dyn" && cfg.slPct === 1 && cfg.tpPct === 1.5 && cfg.atrCoef === 1.5);
}

// ── C · wiring — engine / panel / i18n ───────────────────────────────────────
console.log("6. wiring nguồn (source checks như test-lev-flip)");
const eng = readFileSync("src/lib/engine.ts", "utf8");
const at = readFileSync("src/lib/autotrade.ts", "utf8");
const panel = readFileSync("src/components/auto-panel.tsx", "utf8");
const i18n = readFileSync("src/lib/i18n.ts", "utf8");

check("engine: import dynLevelsAtEntry từ indicators", /import \{ atrLevelsAtEntry, dynLevelsAtEntry \} from "\.\/indicators";/.test(eng));
check(`engine: 2 call site dynLevelsAtEntry (entry + flip) — got ${(eng.match(/dynLevelsAtEntry\(/g) ?? []).length}`, (eng.match(/dynLevelsAtEntry\(/g) ?? []).length === 2);
check(`engine: 2 cổng if (tpMode === "dyn") (entry + flip) — got ${(eng.match(/if \(c\.tpMode === "dyn"\) \{/g) ?? []).length}`, (eng.match(/if \(c\.tpMode === "dyn"\) \{/g) ?? []).length === 2);
check(`engine: 6 nhánh dyn && live (2 SL + 2 TP chọn mức + 2 note Telegram) — got ${(eng.match(/c\.tpMode === "dyn" && live/g) ?? []).length}`, (eng.match(/c\.tpMode === "dyn" && live/g) ?? []).length === 6);
check(`engine: sanitizeTpMode ở loadEngine + syncEngine — got ${(eng.match(/p\.cfg\.tpMode = sanitizeTpMode\(p\.cfg\.tpMode\)/g) ?? []).length}`, (eng.match(/p\.cfg\.tpMode = sanitizeTpMode\(p\.cfg\.tpMode\)/g) ?? []).length === 2);
check("engine: KHÔNG còn tpMode === \"atr\" nào", (eng.match(/tpMode === "atr"/g) ?? []).length === 0);
check(`engine: lev behavior 0.2.72 (manual ? 1 : levNormScale) đủ 3 luồng — entry dynLev + flip bù stake + force — got ${(eng.match(/c\.tpMode === "manual" \? 1 : levNormScale\((?:tradeLev|p\.leverage)\)/g) ?? []).length}`, (eng.match(/c\.tpMode === "manual" \? 1 : levNormScale\((?:tradeLev|p\.leverage)\)/g) ?? []).length === 3);
check("engine: msgOpen note phân tích thành phần (time × · vol ×)", eng.includes("· time ×${live.heatMul.toFixed(2)} · vol ×${live.volMul.toFixed(2)}"));
check("autotrade: sanitizeTpMode export + loadAutoConfig dùng nó", /export function sanitizeTpMode/.test(at) && at.includes("tpMode: sanitizeTpMode(p.tpMode)"));
check("autotrade: TP_MODES = [\"dyn\", \"auto\", \"manual\"]", at.includes('export const TP_MODES = ["dyn", "auto", "manual"] as const;'));
check("autotrade: KHÔNG còn nhánh mode \"atr\"", (at.match(/=== "atr"/g) ?? []).length === 0);
check(`panel: nút mode dyn (TP_MODES map) + khối atrCoef 1 điều kiện === \"dyn\" — got ${(panel.match(/cfg\.tpMode === "dyn"/g) ?? []).length}`, panel.includes('m === "dyn" ? "auto.cfg.tpDyn"') && (panel.match(/cfg\.tpMode === "dyn"/g) ?? []).length === 1);
check("panel: KHÔNG còn === \"atr\"", (panel.match(/cfg\.tpMode === "atr"|m === "atr"/g) ?? []).length === 0);
check(`i18n: tpDyn + tpDynDesc đủ vi + en — got ${(i18n.match(/auto\.cfg\.tpDyn"/g) ?? []).length}/${(i18n.match(/auto\.cfg\.tpDynDesc"/g) ?? []).length}`, (i18n.match(/auto\.cfg\.tpDyn"/g) ?? []).length === 2 && (i18n.match(/auto\.cfg\.tpDynDesc"/g) ?? []).length === 2);
check("i18n: key cũ tpAtr/tpAtrDesc đã xoá", (i18n.match(/auto\.cfg\.tpAtr\b|auto\.cfg\.tpAtrDesc/g) ?? []).length === 0);

console.log(fail === 0 ? "\nALL_SLTP_DYN_OK" : `\nSLTP_DYN_FAILED: ${fail}`);
process.exit(fail === 0 ? 0 : 1);
