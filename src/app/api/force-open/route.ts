// ─── /api/force-open — Force Start từ BEST ────────────────────────────────
// Bypass DQF/Wyckoff/combo. Mở ngay ở giá live, thoát vẫn theo Elliot/A.
// THEO ĐÚNG ENGINE B: stake = clampStake(riskPct HERCULES 10%), lev = dynLeverage(score, minScore, ATR)
// KHÔNG 100%, KHÔNG 2% (ZEUS), KHÔNG hardcode 10.
import { NextRequest, NextResponse } from "next/server";
import { POST as autotradePOST } from "../autotrade/route";
import { agentPresetOf } from "@/lib/agent-presets";
import { clampStake } from "@/lib/params";
import { dynLeverage } from "@/lib/engine";

export const dynamic = "force-dynamic";

async function dynSlTp(symbol: string, interval: string) {
  try {
    const r = await fetch(
      `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=100`,
      { cache: "no-store" },
    );
    const kl = (await r.json()) as any[][];
    if (!Array.isArray(kl) || kl.length < 20) return null;
    let atr = 0;
    for (let i = 1; i < kl.length; i++) {
      const h = Number(kl[i][2]), l = Number(kl[i][3]), pc = Number(kl[i - 1][4]);
      atr += Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
    }
    atr /= kl.length - 1;
    const last = Number(kl[kl.length - 1][4]);
    if (!last || !atr) return null;
    const atrPct = (atr / last) * 100;
    return { slPct: atrPct, tpPct: atrPct * 1.5, atrPct };
  } catch { return null; }
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown> = {};
  try { body = (await req.json()) as Record<string, unknown>; } catch {}
  const symbol = String(body.symbol ?? "").toUpperCase();
  const interval = String(body.interval ?? "5m");
  const bias = String(body.bias ?? body.side ?? "").toUpperCase();
  if (!symbol || (bias !== "LONG" && bias !== "SHORT"))
    return NextResponse.json({ error: "symbol/bias required (LONG/SHORT)" }, { status: 400 });

  const agentId = String(body.agent ?? "HERCULES").toUpperCase();
  const preset = agentPresetOf(agentId); // HERCULES: riskPct 1.0, minScore 55

  let entryPrice = Number(body.entryPrice ?? 0);
  if (!entryPrice || !isFinite(entryPrice)) {
    try {
      const r = await fetch(`https://fapi.binance.com/fapi/v1/ticker/price?symbol=${symbol}`, { cache: "no-store" });
      entryPrice = Number(((await r.json()) as { price?: string }).price);
    } catch {}
  }
  if (!entryPrice || !isFinite(entryPrice))
    return NextResponse.json({ error: "no live price for " + symbol }, { status: 502 });

  const dyn = await dynSlTp(symbol, interval);
  const atrPct = dyn?.atrPct ?? Number(body.slPct ?? 1.0);
  const score = Number(body.score ?? 0);

  // Leverage: đúng công thức engine B 0.3.4 — score vừa đủ gate -> 5x, +15 -> 20x, ATR to -> hạ lev
  const tradeLev = dynLeverage(score, preset.minScore, atrPct);
  // Stake: Force = ép mở nên lấy full riskPct (không lấy tierMin), rồi clamp như engine
  // Ưu tiên Risk slider UI gửi lên, không có thì fallback về preset HERCULES
  const uiRisk = Number(body.riskPct ?? body.stakePct ?? NaN);
  const stakeUsed = clampStake(isFinite(uiRisk) && uiRisk > 0 ? uiRisk : preset.riskPct);

  // SL/TP: ưu tiên row BEST gửi lên, không thì dyn ATR, rồi floor 5m như engine: max(1.5x ATR, 0.8%)
  let slPct = Number(body.slPct ?? dyn?.slPct ?? 1.0);
  let tpPct = Number(body.tpPct ?? dyn?.tpPct ?? slPct * 1.5);
  if (interval === "5m") {
    const slFloor = Math.max(atrPct * 1.5, Math.max(0.2, 4 / tradeLev));
    if (slPct < slFloor) {
      const k = slFloor / slPct;
      slPct = slFloor;
      tpPct = tpPct * k;
    }
  }
  if (slPct < atrPct * 0.8) {
    return NextResponse.json({ error: `noise_block SL ${slPct.toFixed(2)}% < 0.8x ATR ${atrPct.toFixed(2)}%` }, { status: 400 });
  }

  const inner = new NextRequest("http://localhost/api/autotrade", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "open",
      symbol, interval, side: bias, entryPrice, slPct, tpPct,
      source: "force", forced: true, book: "B", agent: agentId,
      methodId: "force",
      riskPct: stakeUsed, // gui dung stake da tinh (UI 10% -> 10%), khong gui preset 1% nua
      leverage: tradeLev,
      stakePct: stakeUsed,
      prob: body.prob ?? undefined,
      acc: body.acc ?? undefined,
      auc: body.auc ?? undefined,
      score: body.score ?? undefined,
      capitalBefore: body.capitalBefore ?? undefined,
    }),
  });
  const res = await autotradePOST(inner);
  const data = await res.json().catch(() => ({}));
  return NextResponse.json(data, { status: res.status });
}
