// POST /api/audit-fix-vulcan — replay Book A (VulcanBook) theo spec v2
// body: { apply?: boolean }
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { binanceHosts } from "@/lib/klines-direct";

const LEV = 5;

async function fetchKs(symbol: string, iv: string, startMs: number, endMs: number): Promise<{ t: number; o: number; h: number; l: number; c: number }[]> {
  const out: { t: number; o: number; h: number; l: number; c: number }[] = [];
  let start = startMs;
  while (start < endMs) {
    let got: any[] = [];
    for (const host of binanceHosts()) {
      try {
        const url = `${host}/fapi/v1/klines?symbol=${symbol}&interval=${iv}&startTime=${start}&endTime=${endMs}&limit=1500`;
        const res = await fetch(url, { signal: AbortSignal.timeout(9000) });
        if (!res.ok) continue;
        got = (await res.json()) as any[];
        break;
      } catch { /* try next */ }
    }
    if (!got.length) throw new Error(`klines_unreachable ${symbol} ${iv}`);
    out.push(...got.map((r) => ({ t: Number(r[0]), o: Number(r[1]), h: Number(r[2]), l: Number(r[3]), c: Number(r[4]) })));
    const lastT = got[got.length - 1][0];
    if (lastT <= start) break;
    start = lastT + 1;
    if (got.length < 1500) break;
  }
  return out;
}

interface ReplayResult {
  exitPrice: number;
  exitTimeMs: number;
  exitKind: string;
  peak: number;
  trailArmed: boolean;
  changed: boolean;
  note: string;
}

function replayVulcan(
  side: "LONG" | "SHORT",
  entry: number,
  entryMs: number,
  exitMs: number,
  storedExit: { price: number; kind: string | null; timeMs: number },
  bars: { t: number; o: number; h: number; l: number; c: number }[],
): ReplayResult | null {
  if (!bars.length) return null;

  // Stop gốc: ATR×mult dựa vào stopPrice DB (đã bị trail modify)
  // → KHÔNG thể recover. Thay vào đó: check spec cho case trail đã arm.
  // Nếu peak < 3% → giữ nguyên stored (không arm, không sửa).

  let peak = entry;
  let trailArmed = false;
  let peakRoi = 0;
  let peakBarI = -1;

  // Pass 1: tìm peak + arm
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    if (b.t < entryMs) continue;
    if (side === "LONG" && b.h > peak) { peak = b.h; peakBarI = i; }
    if (side === "SHORT" && (peak === entry || b.l < peak)) { peak = b.l; peakBarI = i; }
    const pm = side === "LONG" ? ((peak - entry) / entry) * 100 : ((entry - peak) / entry) * 100;
    peakRoi = pm * LEV;
    if (peakRoi >= 3) trailArmed = true;
  }

  if (!trailArmed) {
    // peak < 3% → giữ stored
    return {
      exitPrice: storedExit.price,
      exitTimeMs: storedExit.timeMs,
      exitKind: storedExit.kind ?? "unknown",
      peak,
      trailArmed: false,
      changed: false,
      note: `peakROI=${peakRoi.toFixed(2)}% < 3% → không arm, giữ stored`,
    };
  }

  // Pass 2: từ peak bar trở đi, tìm bar chạm trail stop cuối cùng (trail ratchets)
  // Spec: stop = max(peakRoi-1, 2) tại từng thời điểm — peak chỉ tăng.
  let stopRoi = Math.max(peakRoi - 1, 2);
  let stopP = side === "LONG" ? entry * (1 + stopRoi / LEV / 100) : entry * (1 - stopRoi / LEV / 100);

  let peakSoFar = side === "LONG" ? entry : entry;
  let stopSoFar = stopP;

  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    if (b.t < entryMs) continue;
    // update peak theo bar
    if (side === "LONG" && b.h > peakSoFar) peakSoFar = b.h;
    if (side === "SHORT" && (peakSoFar === entry || b.l < peakSoFar)) peakSoFar = b.l;

    const pm = side === "LONG" ? ((peakSoFar - entry) / entry) * 100 : ((entry - peakSoFar) / entry) * 100;
    const pr = pm * LEV;
    if (pr < 3) continue;

    const sr = Math.max(pr - 1, 2);
    const newStop = side === "LONG" ? entry * (1 + sr / LEV / 100) : entry * (1 - sr / LEV / 100);
    if (side === "LONG" && newStop > stopSoFar) stopSoFar = newStop;
    if (side === "SHORT" && newStop < stopSoFar) stopSoFar = newStop;

    // check hit
    if (side === "LONG" && b.l <= stopSoFar) {
      const fill = Math.min(b.o, stopSoFar);
      return {
        exitPrice: fill,
        exitTimeMs: b.t,
        exitKind: "trail",
        peak: peakSoFar,
        trailArmed: true,
        changed: Math.abs(fill - storedExit.price) / storedExit.price > 0.005 || storedExit.kind !== "trail",
        note: `hit trail bar ${new Date(b.t).toISOString()} stop=${stopSoFar.toFixed(4)} fill=${fill.toFixed(4)}`,
      };
    }
    if (side === "SHORT" && b.h >= stopSoFar) {
      const fill = Math.max(b.o, stopSoFar);
      return {
        exitPrice: fill,
        exitTimeMs: b.t,
        exitKind: "trail",
        peak: peakSoFar,
        trailArmed: true,
        changed: Math.abs(fill - storedExit.price) / storedExit.price > 0.005 || storedExit.kind !== "trail",
        note: `hit trail bar ${new Date(b.t).toISOString()} stop=${stopSoFar.toFixed(4)} fill=${fill.toFixed(4)}`,
      };
    }
  }

  // Không hit trail trong range → giữ stored (có thể RSI/mid exit trước)
  return {
    exitPrice: storedExit.price,
    exitTimeMs: storedExit.timeMs,
    exitKind: storedExit.kind ?? "unknown",
    peak,
    trailArmed: true,
    changed: false,
    note: `armed (peakROI=${peakRoi.toFixed(2)}%) nhưng không hit trail trong range → giữ stored`,
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const apply = body.apply === true;

    const rows = await db.vulcanBook.findMany({
      where: { status: "closed" },
      orderBy: { createdAt: "asc" },
    });

    const results: any[] = [];
    let skipped = 0, changed = 0;

    for (const row of rows) {
      if (row.exitPrice == null || row.exitTime == null) { skipped++; continue; }
      const side = row.side === "SHORT" ? "SHORT" : "LONG" as const;
      const entryMs = new Date(row.entryTime).getTime();
      const exitMs = new Date(row.exitTime).getTime();

      let bars: any[];
      try {
        bars = await fetchKs(row.symbol, "15m", entryMs - 900_000, exitMs + 900_000);
      } catch { skipped++; continue; }

      const r = replayVulcan(side, row.entryPrice, entryMs, exitMs,
        { price: row.exitPrice, kind: row.exitKind, timeMs: exitMs }, bars);
      if (!r) { skipped++; continue; }

      if (r.changed) {
        changed++;
        results.push({
          id: row.id, symbol: row.symbol, side,
          stored: { price: row.exitPrice, kind: row.exitKind },
          replay: { price: r.exitPrice, kind: r.exitKind, time: new Date(r.exitTimeMs).toISOString() },
          note: r.note,
        });
        if (apply) {
          // recompute pnl
          const move = side === "LONG" ? (r.exitPrice - row.entryPrice) / row.entryPrice * 100 : (row.entryPrice - r.exitPrice) / row.entryPrice * 100;
          const roi = Math.round((move * LEV - 0.05) * 100) / 100;
          const before = row.capitalBefore ?? 1000;
          const delta = Math.round(before * 0.10 * (roi / 100) * 100) / 100;
          const after = Math.max(0, Math.round((before + delta) * 100) / 100);
          await db.vulcanBook.update({
            where: { id: row.id },
            data: {
              exitPrice: r.exitPrice,
              exitTime: new Date(r.exitTimeMs),
              exitKind: r.exitKind,
              peak: r.peak,
              trailArmed: r.trailArmed,
              movePct: Math.round(move * 100) / 100,
              roePct: roi,
              capitalAfter: after,
            },
          });
        }
      }
    }

    return NextResponse.json({ ok: true, applied: apply, total: rows.length, skipped, changed, results: results.slice(0, 20) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}