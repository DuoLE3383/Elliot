"use client";

// ─── MetricTiles (v0.3.12) — dải 4 chỉ số đầu trang /auto redesign ────────────
// Theo mockup: Total Equity · Net ROE (Realized) · Win Rate (Closed) ·
// Total Trades — mỗi ô icon màu + số lớn + sparkline SVG.
// Số THẬT: LIVE bật → sổ live (/api/arena live.*); không → gộp cả 4 sổ
// dry-run A+B+C (ROE = (final-start)/start tren tong von, WR = theo tong lenh dong).
// Sparkline: đường vốn sổ tương ứng (bEquity / aEquity / cEquity), đủ 2 điểm
// mới vẽ — thiếu thì vẽ đường nền phẳng cho đúng khung mockup.

import { useMemo } from "react";
import type { BookStats, EquityPoint, LiveStats } from "@/lib/arena";

export interface TilesData {
  a: BookStats | null;
  b: BookStats | null;
  c: BookStats | null;
  live: LiveStats | null;
  /** vốn dry-run hiện tại (ví sổ B) — USDT */
  capital: number | null;
  aEquity: EquityPoint[];
  bEquity: EquityPoint[];
  cEquity: EquityPoint[];
}

const fmtUsd = (v: number): string =>
  "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtInt = (v: number): string => v.toLocaleString("en-US");

const fmtSignedUsd = (v: number): string => `${v >= 0 ? "+" : "-"}$${Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** sparkline vùng màu — points là dãy số (cũ → mới); normalize 0..1. */
function Spark({ points, stroke, fill }: { points: number[]; stroke: string; fill: string }) {
  const d = useMemo(() => {
    if (points.length < 2) return "";
    const min = Math.min(...points);
    const max = Math.max(...points);
    const W = 90;
    const H = 34;
    return points
      .map((p, i) => {
        const x = (i / (points.length - 1)) * W;
        const y = H - 3 - ((p - min) / (max - min || 1)) * (H - 8);
        return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(" ");
  }, [points]);
  if (!d) {
    // chưa đủ dữ liệu — đường nền phẳng (placeholder trung thực, không bịa hình)
    return (
      <svg viewBox="0 0 90 34" className="h-[34px] w-[90px]" aria-hidden>
        <path d="M2,24 L88,24" stroke={stroke} strokeOpacity="0.25" strokeWidth="1.5" strokeDasharray="3 3" fill="none" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 90 34" className="h-[34px] w-[90px]" aria-hidden>
      <path d={`${d} L90,34 L0,34 Z`} fill={fill} fillOpacity="0.16" />
      <path d={d} fill="none" stroke={stroke} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function Tile({
  label,
  value,
  valueClass,
  icon,
  iconClass,
  spark,
  sub,
}: {
  label: string;
  value: string;
  valueClass?: string;
  icon: React.ReactNode;
  iconClass: string;
  spark: React.ReactNode;
  sub?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-xl border border-[#1e2d4d]/80 bg-gradient-to-b from-[#0d1526] to-[#0a0f1e] px-3.5 py-3 shadow-sm">
      <div className="flex min-w-0 items-center gap-3">
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${iconClass}`}>{icon}</span>
        <div className="min-w-0">
          <p className="whitespace-normal leading-snug text-[10px] font-semibold uppercase tracking-wide text-zinc-500">{label}</p>
          <p className={`whitespace-normal leading-snug font-mono text-[17px] font-bold leading-tight ${valueClass ?? "text-white"}`}>{value}</p>
          {sub && <p className="whitespace-normal leading-snug text-[9px] text-zinc-600">{sub}</p>}
        </div>
      </div>
      <div className="shrink-0">{spark}</div>
    </div>
  );
}

export function MetricTiles({ data, lang }: { data: TilesData; lang: "vi" | "en" }) {
  const { a, b, c, live, capital } = data;
  const liveOn = live?.on === true && (live.nClosed > 0 || live.nOpen > 0);

  // ── equity: LIVE → balanceAfter; dry-run → ví sổ B
  const equity = liveOn && live.balanceAfter != null ? live.balanceAfter : (capital ?? 0);
  const equitySub = liveOn
    ? lang === "vi" ? "Binance Futures" : "live balance"
    : lang === "vi" ? "ví dry-run" : "dry-run wallet";

  // ── gộp số các sổ dry-run (hoặc sổ live khi LIVE)
  const books = liveOn ? null : [a, b, c].filter((x): x is BookStats => x != null);
  const nClosed = liveOn ? (live?.nClosed ?? 0) : (books?.reduce((s, x) => s + x.nClosed, 0) ?? 0);
  const nOpen = liveOn ? (live?.nOpen ?? 0) : (books?.reduce((s, x) => s + x.nOpen, 0) ?? 0);
  const wins = liveOn
    ? Math.round(((live?.wr ?? 0) / 100) * (live?.nClosed ?? 0))
    : (books?.reduce((s, x) => s + x.wins, 0) ?? 0);
  const wr = nClosed > 0 ? (wins / nClosed) * 100 : 0;
  const roeStart = liveOn ? (live?.balanceBefore ?? 0) : (books?.reduce((sum, x) => sum + (x.startCapital ?? 0), 0) ?? 0);
  const roeFinal = liveOn ? (live?.balanceAfter ?? 0) : (books?.reduce((sum, x) => sum + (x.finalCapital ?? x.startCapital ?? 0), 0) ?? 0);
  const netRoe = roeStart > 0 && roeFinal > 0 ? ((roeFinal - roeStart) / roeStart) * 100 : 0;

  const roeClass = netRoe > 0 ? "text-emerald-400" : netRoe < 0 ? "text-rose-400" : "text-white";
  const totalStart = liveOn ? (live?.balanceBefore ?? 0) : (books?.reduce((sum, x) => sum + (x.startCapital ?? 0), 0) ?? 0);
  const totalFinal = liveOn ? (live?.balanceAfter ?? 0) : (books?.reduce((sum, x) => sum + (x.finalCapital ?? x.startCapital ?? 0), 0) ?? 0);
  const totalPnl = totalStart > 0 && totalFinal > 0 ? totalFinal - totalStart : 0;
  const netPnlPct = totalStart > 0 ? (totalPnl / totalStart) * 100 : 0;
  const pnlClass = totalPnl > 0 ? "text-emerald-400" : totalPnl < 0 ? "text-rose-400" : "text-white";

  // sparkline: đường vốn sổ B (hoặc live khi có) — mỗi sổ một nguồn thật
  const eqB = data.bEquity.map((p) => p.capital);
  const eqA = data.aEquity.map((p) => p.capital);
  const eqC = data.cEquity.map((p) => p.capital);
  // trades tile: "cột" từ số lệnh đóng mỗi sổ (giữ dạng cột mini)
  const tradeBars = [a?.nClosed ?? 0, b?.nClosed ?? 0, c?.nClosed ?? 0];
  const maxBar = Math.max(1, ...tradeBars);

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <Tile
        label="Total Equity"
        value={equity > 0 ? fmtUsd(equity) : "—"}
        icon={
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
            <ellipse cx="12" cy="6.5" rx="7.5" ry="3.2" fill="#eab308" fillOpacity="0.9" />
            <path d="M4.5 6.5 V17.5 C4.5 19.3 7.9 20.7 12 20.7 S19.5 19.3 19.5 17.5 V6.5" fill="#eab308" fillOpacity="0.55" stroke="#facc15" strokeWidth="1" />
            <path d="M4.5 12 C4.5 13.8 7.9 15.2 12 15.2 S19.5 13.8 19.5 12" fill="none" stroke="#facc15" strokeWidth="1" />
          </svg>
        }
        iconClass="border-amber-700/50 bg-amber-950/40 text-amber-300"
        spark={<Spark points={eqB.length >= 2 ? eqB.slice(-40) : []} stroke="#10b981" fill="#10b981" />}
        sub={equitySub}
      />
      <Tile
        label="Net ROE (Realized)"
        value={nClosed + nOpen > 0 ? `${netRoe >= 0 ? "+" : ""}${netRoe.toFixed(2)}%` : "—"}
        valueClass={roeClass}
        icon={
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
            <path d="M4 17 L9 11 L13 14 L20 6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M14.5 6 H20 V11.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        }
        iconClass="border-emerald-700/50 bg-emerald-950/40 text-emerald-400"
        spark={<Spark points={eqC.length >= 2 ? eqC.slice(-40) : eqB.slice(-40)} stroke="#22c55e" fill="#22c55e" />}
      />
      <Tile
        label="Total PNL"
        value={nClosed + nOpen > 0 ? fmtSignedUsd(totalPnl) : "—"}
        valueClass={pnlClass}
        icon="$"
        iconClass="border-amber-700/50 bg-amber-950/40 text-amber-300"
        spark={<Spark points={eqB.length >= 2 ? eqB.slice(-40) : []} stroke="#eab308" fill="#eab308" />}
        sub={liveOn ? "live balance diff" : "sum(final - start) A+B+C"}
      />
      <Tile
        label="Net PNL"
        value={nClosed + nOpen > 0 ? `${netPnlPct >= 0 ? "+" : ""}${netPnlPct.toFixed(2)}%` : "—"}
        valueClass={pnlClass}
        icon="%"
        iconClass="border-emerald-700/50 bg-emerald-950/40 text-emerald-400"
        spark={<Spark points={eqB.length >= 2 ? eqB.slice(-40) : []} stroke="#10b981" fill="#10b981" />}
        sub="after fees, on total start capital"
      />
      <Tile
        label="Win Rate (Closed)"
        value={nClosed > 0 ? `${wr.toFixed(2)}%` : "—"}
        icon={
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
            <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeWidth="2" />
            <path d="M8 12.5 L10.8 15.2 L16 9.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        }
        iconClass="border-sky-700/50 bg-sky-950/40 text-sky-400"
        spark={<Spark points={eqA.length >= 2 ? eqA.slice(-40) : []} stroke="#3b82f6" fill="#3b82f6" />}
        sub={nClosed > 0 ? `${fmtInt(nClosed)} closed` : undefined}
      />
      <Tile
        label="Total Trades"
        value={nClosed + nOpen > 0 ? fmtInt(nClosed + nOpen) : "—"}
        icon={
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
            <rect x="4" y="13" width="3.4" height="7" rx="0.8" fill="currentColor" />
            <rect x="10.3" y="8" width="3.4" height="12" rx="0.8" fill="currentColor" />
            <rect x="16.6" y="4" width="3.4" height="16" rx="0.8" fill="currentColor" />
          </svg>
        }
        iconClass="border-violet-700/50 bg-violet-950/40 text-violet-400"
        spark={
          <svg viewBox="0 0 90 34" className="h-[34px] w-[90px]" aria-hidden>
            {tradeBars.map((v, i) => {
              const h = Math.max(3, (v / maxBar) * 28);
              return <rect key={i} x={10 + i * 28} y={32 - h} width={16} height={h} rx={2} fill="#a855f7" fillOpacity={0.75} />;
            })}
          </svg>
        }
        sub={`${fmtInt(nOpen)} open`}
      />
    </div>
  );
}
