/**
 * D · LIQUID — Wyckoff Distribution SHORT, chạy song song A/B/C.
 * Mirror của Wyckoff C (LONG tích luỹ) nhưng đảo chiều:
 *   C: Spring/SOS → LONG | D: Upthrust/Breakdown → SHORT
 * Chỉ SHORT khi RISK_OFF + range hợp lệ + có Upthrust/Breakdown.
 * Ngược Long ở C = ĐỨNG NGOÀI, không phải SHORT — D mới là chỗ SHORT.
 */
import { detectUpthrust, detectDistribution } from "./wyckoff-engine";
import { identifyTradingRange } from "./wyckoff-gate";
import { fetchKlinesDirect } from "./klines-direct";
import { breadthPct } from "./wyckoff-gate";
import { db } from "./db";
import { tgSendMessage } from "./telegram-store";
import { fmtPrice } from "./i18n";
import { buildTradeHeader } from "./tg-msgs";
import { bumpSettledWallet, readUnifiedSettled } from "./unified-balance";

// Pair lấy từ pair scan / Universe — KHÔNG hardcode, KHÔNG fallback.
// startLiquidEngine(symbols: string[]) nhận symbols từ scheduler, scan fail -> STANDBY.
export function liquidSymbolsFromUniverse(universe: string[]): string[] {
  return [...universe];
}
export const LIQUID_LEV = 3;
export const LIQUID_STAKE_PCT = 10;

export type LiquidDecision =
  | { action: "SHORT"; reason: string; stopPct: number; tp1Pct: number }
  | { action: "WAIT"; reason: string };

export function decideLiquidShort(
  d: any[], // Kline[] >= 90 nến, khung nao cung duoc (1h/4h/1d)
  breadth: number | null,
  breadthMin: number
): LiquidDecision {
  if (breadth !== null && breadth >= breadthMin)
    return { action: "WAIT", reason: `RISK_ON (breadth ${breadth}%) — không SHORT khi thị trường hồi` };
  const range = identifyTradingRange(d, 90, 3, 1);
  if (!range)
    return { action: "WAIT", reason: "không có trading range hợp lệ (width 3–60%, drift ≤25%, test ≥1 mặt mỗi biên trong 60 nến 1d)" };
  const up = detectUpthrust(d);
  const dist = detectDistribution(d);
  if (!up && !dist)
    return { action: "WAIT", reason: "chưa có Upthrust / Distribution — chờ phân phối xác nhận" };
  // SL trên đỉnh phân phối, TP1 dưới đáy range — mirror C
  return {
    action: "SHORT",
    reason: up ? `Upthrust: ${up.reason}` : `Distribution: ${dist!.reason}`,
    stopPct: 2.0, // sẽ tinh từ range-high + ATR ở bước wire engine, để placeholder rõ ràng
    tp1Pct: 2.0,
  };
}




// ─── Scheduler entry — mirror C, nhưng SHORT ───
let _liquidTimer: any = null;
let _liquidStatus = { state: "STANDBY", reason: "chưa quét", lastScan: "" };
export function liquidEngineStatus() { return { ..._liquidStatus }; }
export async function startLiquidEngine(symbols: string[]) {
  console.log(`[liquid] engine D khởi động — ${symbols.length} symbol (từ Universe rank) 1d, lev 3, stake 10%, SHORT phân phối`);
  if (_liquidTimer) return;
  const scanOnce = async () => {
    const list = liquidSymbolsFromUniverse(symbols);
    if (list.length === 0) {
      _liquidStatus = { state: "STANDBY", reason: "Universe rỗng — chờ pair scan", lastScan: new Date().toISOString() };
      return;
    }
    // Dong lenh D da mo neu cham TP/SL — neu khong, lenh se treo open mai
    try {
      const opens = await db.liquidBook.findMany({ where: { status: "open" } });
      for (const o of opens) {
        const kd: any[] = await fetchKlinesDirect(o.symbol, "1h", 2);
        const last: any = kd[kd.length - 1];
        const mark = Number(last?.close ?? last?.c ?? last?.closePrice ?? 0);
        if (!mark || !o.entryPrice) continue;
        const movePct = ((mark - o.entryPrice) / o.entryPrice) * 100; // SHORT: move am = loi
        let exitKind: string | null = null;
        if (mark <= o.tpPrice) exitKind = "tp";
        else if (mark >= o.stopPrice) exitKind = "sl";
        if (exitKind) {
          const pnlPct = -movePct * 3 - (0.05 * 3 * 2) // feeRoi(3) = 0.05*lev*2, giong B/C; // lev 3, SHORT: gia giam -> pnl duong
          const capBeforeD = Number((o as any).capitalBefore ?? 1000); const marginD = capBeforeD * 0.10; const capAfterD = capBeforeD + marginD * (pnlPct / 100); await db.liquidBook.update({ where: { id: o.id }, data: { status: "closed", exitPrice: mark, exitTime: new Date(), exitKind, exitReason: exitKind === "tp" ? "TP RR 1.4" : "SL", movePct, pnlPct, capitalAfter: Math.round(capAfterD * 100) / 100 } }); await bumpSettledWallet(Math.round((capAfterD - capBeforeD) * 100) / 100).catch(() => null);
          console.log(`[liquid] CLOSE ${exitKind.toUpperCase()} ${o.symbol} @ ${mark} · pnl ${pnlPct.toFixed(2)}%`);
        }
      }
    } catch {}
    let breadth: number | null = null;
    try { const b: any = await (breadthPct as any)(list); breadth = b?.pct ?? null; } catch { breadth = null; }
    let lastReason = "đang quét";
    const reasonCount: Record<string, number> = {};
    for (const tf of ["1h", "4h", "1d"]) for (const sym of list) {
      try {
        const d = await fetchKlinesDirect(sym, tf, 120);
        if (!d || d.length < 90) continue;
        const dec = decideLiquidShort(d, breadth, 60);
        lastReason = `${sym}: ${dec.reason}`;
        const key = dec.reason.split(" — ")[0].slice(0, 40);
        reasonCount[key] = (reasonCount[key] ?? 0) + 1;
        if (dec.action === "SHORT") {
          const last: any = d[d.length - 1];
          const entry = Number(last?.close ?? last?.c ?? last?.closePrice ?? 0);
          if (entry > 0) {
            const existing = await db.liquidBook.findFirst({ where: { symbol: sym, status: "open" } });
            if (!existing) {
              const stopPrice = entry * (1 + dec.stopPct / 100);
              const tpPrice = entry * (1 - (dec.stopPct * 1.4) / 100);
              const closedD: any[] = await db.liquidBook.findMany({ where: { status: "closed" } }); const equityD = 1000 + closedD.reduce((s: number, r: any) => s + (Number(r.capitalAfter ?? 0) - Number(r.capitalBefore ?? 0)), 0); await db.liquidBook.create({ data: { symbol: sym, side: "SHORT", capitalBefore: Math.round(equityD * 100) / 100, trigger: ("[" + tf + "] " + dec.reason).slice(0, 80), score: 0, breadth, entryPrice: entry, status: "open", stopPrice, tpPrice } });
              console.log(`[liquid] OPEN SHORT ${sym} [${tf}] @ ${entry} · SL ${stopPrice.toFixed(2)} · TP ${tpPrice.toFixed(2)} · ${dec.reason}`);
    const unifiedBalD = await readUnifiedSettled().then((u) => u.balance).catch(() => undefined);
    void tgSendMessage(
      [
      ...buildTradeHeader("🟢", "OPEN", { symbol: sym, interval: tf, side: "SHORT", book: "D" }),
      `🎯 Entry <b>${fmtPrice(Number(entry))}</b>`,
      `🛑 Stop Loss <b>${fmtPrice(Number(stopPrice))}</b> (+${dec.stopPct.toFixed(2)}% price)`,
      `🏁 Take Profit <b>${fmtPrice(Number(tpPrice))}</b> (−${(dec.stopPct * 1.4).toFixed(2)}% price)`,
      "",
      `⚖️ Leverage ×3 · Stake 10% of Balance`,
      "",
      ...(unifiedBalD != null ? [`💰 Balance <b>${unifiedBalD.toFixed(2)}</b> USDT`] : []),
      ].join("\n"),
      "HTML",
      { dedupeKey: `open:D:${sym}:${tf}:${entry}` },
    ).catch(() => {});
            } else {
              console.log(`[liquid] SKIP ${sym} - da co lenh mo`);
            }
          }
          break;
        }
      } catch { continue; }
    }
    _liquidStatus = { state: "SCANNING", reason: lastReason, lastScan: new Date().toISOString() };
    console.log(`[liquid] scan xong · breadth ${breadth ?? "?"}% · reasons: ${JSON.stringify(reasonCount)} · last: ${lastReason}`);
  };
  await scanOnce().catch((e) => { console.log(`[liquid] scan loi: ${String((e as any)?.message ?? e)}`); _liquidStatus = { state: "STANDBY", reason: "scan lỗi — thử lại sau 60s", lastScan: new Date().toISOString() }; });
  _liquidTimer = setInterval(() => { scanOnce().catch(() => {}); }, 60_000);
  _liquidTimer.unref?.();
}