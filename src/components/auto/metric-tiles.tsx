"use client";

// ─── Dải 4 chỉ số đầu trang /auto ────────────────────────────────────────────
// Balance · Total PnL · Total ROI · Win rate. Một nguồn: /api/capital.
// DRY: pool giấy ABCD. LIVE: số dư ví Binance Futures, PnL/ROI tính từ lúc START.

import { useEffect, useState } from "react";

export interface CapBook {
  pnlUsd: number | null;
  closed: number;
  wr: number | null;
}

export interface CapBody {
  mode: "dry" | "live";
  equity: number | null;
  startEquity: number | null;
  pnlUsd: number | null;
  roiPct: number | null;
  winRate: number | null;
  closed: number;
  books: Record<"A" | "B" | "C" | "D", CapBook>;
  note?: string;
}

/** Lấy số liệu vốn theo chế độ; làm mới mỗi 60 giây. */
export function useCapital(mode: "dry" | "live"): CapBody | null {
  const [cap, setCap] = useState<CapBody | null>(null);
  useEffect(() => {
    let alive = true;
    setCap(null);
    const pull = async (): Promise<void> => {
      try {
        const r = await fetch(`/api/capital?mode=${mode}`, { cache: "no-store" });
        if (r.ok && alive) setCap((await r.json()) as CapBody);
      } catch {
        /* giữ số cũ */
      }
    };
    void pull();
    const id = window.setInterval(() => void pull(), 60_000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [mode]);
  return cap;
}

const fmtUsd = (n: number | null): string =>
  n == null ? "—" : `${n >= 0 ? "+" : "−"}$${Math.abs(n).toFixed(2)}`;
const fmtPct = (n: number | null): string => (n == null ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`);
const toneOf = (n: number | null): string =>
  n == null ? "text-zinc-500" : n > 0 ? "text-emerald-400" : n < 0 ? "text-rose-400" : "text-zinc-200";

function Tile({ label, value, sub, cls }: { label: string; value: string; sub: string; cls: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-[#0f141c] px-4 py-3">
      <p className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</p>
      <p className={`mt-1 font-mono text-xl font-bold ${cls}`}>{value}</p>
      <p className="mt-0.5 text-[10px] text-zinc-500">{sub}</p>
    </div>
  );
}

export function MetricTiles({ liveOn }: { liveOn: boolean }) {
  const cap = useCapital(liveOn ? "live" : "dry");
  const start = cap?.startEquity;
  return (
    <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      <Tile
        label="Balance"
        value={cap?.equity != null ? `$${cap.equity.toFixed(2)}` : "—"}
        sub={liveOn ? "Binance Futures · live" : "DRY-RUN · paper wallet"}
        cls="text-zinc-100"
      />
      <Tile
        label="Total PnL"
        value={fmtUsd(cap?.pnlUsd ?? null)}
        sub={liveOn ? "since START" : "since wallet reset"}
        cls={toneOf(cap?.pnlUsd ?? null)}
      />
      <Tile
        label="Total ROI"
        value={fmtPct(cap?.roiPct ?? null)}
        sub={start != null ? `on start $${start.toFixed(2)}` : "on start balance"}
        cls={toneOf(cap?.roiPct ?? null)}
      />
      <Tile
        label="Win rate"
        value={cap?.winRate != null ? `${cap.winRate.toFixed(2)}%` : "—"}
        sub={`${cap?.closed ?? 0} closed trades`}
        cls="text-zinc-100"
      />
    </section>
  );
}
