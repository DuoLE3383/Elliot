// GET /api/audit-replay?id=<tradeId> — CHỈ ĐỌC, KHÔNG GHI DB.
// Lấy lệnh closed + cfg live hiện tại + nến lịch sử (startTime) rồi chạy replayExit().
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { engineSnapshot } from "@/lib/engine";
import { binanceHosts } from "@/lib/klines-direct";
import { replayExit, type ReplayKline } from "@/lib/audit-replay";

async function fetchRange(symbol: string, interval: string, startMs: number, endMs: number): Promise<ReplayKline[]> {
  // Binance klines với startTime/endTime — fetchKlinesDirect hiện chỉ lấy N nến mới nhất nên không dùng được cho lệnh cũ.
  const out: ReplayKline[] = [];
  let start = startMs;
  while (start < endMs) {
    let got: ReplayKline[] = [];
    let lastErr = "";
    for (const host of binanceHosts()) {
      try {
        const url = `${host}/fapi/v1/klines?symbol=${symbol}&interval=${interval}&startTime=${start}&endTime=${endMs}&limit=1000`;
        const res = await fetch(url, { signal: AbortSignal.timeout(9000) });
        if (!res.ok) { lastErr = `HTTP ${res.status}`; continue; }
        const raw = (await res.json()) as unknown[][];
        got = raw.map((r) => ({ t: Number(r[0]), o: Number(r[1]), h: Number(r[2]), l: Number(r[3]), c: Number(r[4]) }));
        break;
      } catch (e) { lastErr = e instanceof Error ? e.message : "fetch failed"; }
    }
    if (!got.length) throw new Error(`klines_unreachable: ${lastErr}`);
    out.push(...got);
    const lastT = got[got.length - 1].t;
    if (lastT <= start) break;
    start = lastT + 1;
    if (got.length < 1000) break;
  }
  return out;
}

export async function GET(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ ok: false, error: "missing id" }, { status: 400 });
    const row = await db.autoTrade.findUnique({ where: { id } });
    if (!row) return NextResponse.json({ ok: false, error: "trade not found" }, { status: 404 });
    if (row.status !== "closed" || row.exitPrice == null || row.exitTime == null) {
      return NextResponse.json({ ok: false, error: "chi replay lenh da dong co exitPrice/exitTime" }, { status: 400 });
    }
    const c = engineSnapshot().cfg;
    const cfg = {
      trailOn: c.trailOn, trailAuto: c.trailAuto, trailActPct: c.trailActPct, trailDistPct: c.trailDistPct,
      runnerOn: c.runnerOn, runnerSharePct: c.runnerSharePct, runnerTpMult: c.runnerTpMult, runnerTrailLock: c.runnerTrailLock,
    };
    const entryMs = new Date(row.entryTime).getTime();
    const exitMs = new Date(row.exitTime).getTime();
    const intervalMs = (() => {
      const m = /^(\d+)([mhdw])$/.exec(row.interval);
      if (!m) return 15 * 60_000;
      const n = Number(m[1]); const u = m[2];
      return n * (u === "m" ? 60_000 : u === "h" ? 3_600_000 : u === "d" ? 86_400_000 : 604_800_000);
    })();
    // 100 nến trước entry để tính ATR lúc vào lệnh + nến entry→exit (+1 nến đệm cho SL confirm)
    const before = await fetchRange(row.symbol, row.interval, entryMs - 100 * intervalMs, entryMs);
    const after = await fetchRange(row.symbol, row.interval, entryMs, exitMs + intervalMs);
    const result = replayExit(
      { symbol: row.symbol, interval: row.interval, side: row.side, entryPrice: row.entryPrice, entryTime: row.entryTime, slPct: row.slPct, tpPct: row.tpPct, leverage: row.leverage, exitPrice: row.exitPrice, exitTime: row.exitTime, exitKind: row.exitKind, pnlPct: row.pnlPct, p1Pct: row.p1Pct, p1Share: row.p1Share, tp2Pct: row.tp2Pct, trailPct: row.trailPct },
      before, after, cfg,
    );
    return NextResponse.json({ ok: true, trade: { id: row.id, symbol: row.symbol, interval: row.interval, side: row.side, entryPrice: row.entryPrice, entryTime: row.entryTime, exitPrice: row.exitPrice, exitTime: row.exitTime, exitKind: row.exitKind, pnlPct: row.pnlPct, slPct: row.slPct, tpPct: row.tpPct, leverage: row.leverage }, cfg, klines: { before: before.length, after: after.length }, replay: result });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "replay failed" }, { status: 500 });
  }
}
