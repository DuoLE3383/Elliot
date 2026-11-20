"use client";

// ─── AutoAnalytics (0.2.97) — phân tích chi tiết sổ B ở trang /auto ───────────
// Nguồn: AutoState.analytics (tính server-side ở autostate.readAutoState — một
// nguồn cho UI + Telegram). Vẽ: hàng KPI (net/WR/expectancy/PF/maxDD/hold
// TB/streak), đường vốn SVG thuần, bảng theo lý do thoát / theo symbol / theo
// khung / theo chiều, và 12 lệnh đóng gần nhất.

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fmtPrice, t, type Lang } from "@/lib/i18n";
import type { AutoAnalytics, AutoState, BookKey } from "@/lib/autotrade";

const num = (x: number, d = 2): string => String(Math.round(x * 10 ** d) / 10 ** d);
const pctClass = (x: number): string => (x > 0 ? "text-emerald-400" : x < 0 ? "text-rose-400" : "text-zinc-400");

function EquitySpark({ equity, wallet, lang }: { equity: AutoAnalytics["equity"]; wallet: number | null; lang: Lang }) {
  const pts = useMemo(() => {
    const all = [...equity];
    if (wallet != null && wallet > 0 && all.length === 0) all.push({ t: new Date().toISOString(), capital: wallet });
    return all;
  }, [equity, wallet]);
  if (pts.length < 2) {
    return <p className="py-3 text-center text-[11px] text-zinc-600">{t(lang, "ana.equity.short")}</p>;
  }
  const caps = pts.map((p) => p.capital);
  const min = Math.min(...caps);
  const max = Math.max(...caps);
  const W = 560;
  const H = 110;
  const path = pts
    .map((p, i) => {
      const x = (i / (pts.length - 1)) * W;
      const y = H - 4 - ((p.capital - min) / (max - min || 1)) * (H - 10);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const up = caps[caps.length - 1] >= (wallet ?? caps[0]);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" aria-hidden>
      <path d={path} fill="none" stroke={up ? "#10b981" : "#f43f5e"} strokeWidth="1.6" />
      <text x="6" y="12" fontSize="10" fill="#71717a">
        {num(min, 0)} — {num(max, 0)} USDT
      </text>
    </svg>
  );
}

function MiniTable({ head, rows }: { head: string[]; rows: Array<Array<string | number>> }) {
  return (
    <table className="w-full font-mono text-[11px]">
      <thead>
        <tr className="text-left text-zinc-600">
          {head.map((h) => (
            <th key={h} className="py-0.5 pr-2 font-normal">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-t border-zinc-800/60">
            {r.map((c, j) => (
              <td key={j} className="py-0.5 pr-2 text-zinc-300">
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function AutoAnalytics({ lang, auto }: { lang: Lang; auto: AutoState | null }) {
  const [book, setBook] = useState<BookKey>('ALL');
  const a = auto?.analyticsByBook?.[book] ?? auto?.analytics;
  if (!a) return null;
  const closed = auto?.recentByBook?.[book] ?? auto?.trades.filter((x) => x.status === 'closed').slice(0, 12) ?? [];
  const tabs: Array<BookKey> = ['ALL', 'A', 'B', 'C', 'D'];
  const holdTxt = a.avgHoldMin >= 1440 ? `${(a.avgHoldMin / 1440).toFixed(1)}d` : a.avgHoldMin >= 60 ? `${(a.avgHoldMin / 60).toFixed(1)}h` : `${Math.round(a.avgHoldMin)}m`;

  const kpis: Array<{ label: string; value: string; cls?: string; tip?: string }> = [
    { label: t(lang, "ana.kpi.net"), value: `${(a.netPnlPct ?? 0) >= 0 ? "+" : ""}${num(a.netPnlPct ?? 0)}%`, cls: pctClass(a.netPnlPct ?? 0) },
    { label: t(lang, "ana.kpi.wr"), value: `${num(a.winRate ?? 0, 1)}%`, tip: `${a.wins ?? 0}/${a.closed ?? 0}` },
    { label: t(lang, "ana.kpi.exp"), value: `${a.expectancy >= 0 ? "+" : ""}${num(a.expectancy)}%`, cls: pctClass(a.expectancy), tip: t(lang, "ana.kpi.expTip") },
    { label: t(lang, "ana.kpi.pf"), value: num(a.profitFactor), cls: a.profitFactor >= 1 ? "text-emerald-400" : "text-rose-400", tip: t(lang, "ana.kpi.pfTip") },
    { label: t(lang, "ana.kpi.maxdd"), value: `−${num(a.maxDrawdownPct)}%`, cls: "text-rose-300", tip: t(lang, "ana.kpi.maxddTip") },
    { label: t(lang, "ana.kpi.hold"), value: holdTxt },
    {
      label: t(lang, "ana.kpi.streak"),
      value:
        a.streak.currentKind === "none"
          ? "—"
          : `${a.streak.currentKind === "win" ? "W" : "L"}${a.streak.current}`,
      cls: a.streak.currentKind === "win" ? "text-emerald-400" : a.streak.currentKind === "loss" ? "text-rose-400" : "",
      tip: `${t(lang, "ana.kpi.streakMax")}: W${a.streak.maxWin} / L${a.streak.maxLoss}`,
    },
  ];

  return (
    <Card className="border-zinc-800 bg-zinc-900/60">
      <CardHeader className="px-3 pb-2">
        <CardTitle className="text-base font-semibold text-zinc-100">{t(lang, "ana.title")}</CardTitle>
        <div className="mt-2 flex gap-1">
          {tabs.map((tb) => (
            <button key={tb} onClick={() => setBook(tb)} className={`rounded-md border px-2.5 py-1 font-mono text-xs ${book === tb ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-300' : 'border-zinc-700 text-zinc-400 hover:text-zinc-200'}`}>{tb === 'ALL' ? 'ALL' : `Book ${tb}`}</button>
          ))}
        </div>
        <div className="mt-2 flex gap-1">
          {tabs.map((tb) => (
            <button key={tb} onClick={() => setBook(tb)} className={`rounded-md border px-2.5 py-1 font-mono text-xs ${book === tb ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-300' : 'border-zinc-700 text-zinc-400 hover:text-zinc-200'}`}>{tb === 'ALL' ? 'ALL' : `Book ${tb}`}</button>
          ))}
        </div>
        <p className="text-[11px] text-zinc-500">{t(lang, "ana.sub")}</p>
      </CardHeader>
      <CardContent className="space-y-3 px-3 pt-0">
        {/* KPI row */}
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-7">
          {kpis.map((k) => (
            <div key={k.label} className="rounded-lg border border-zinc-800 bg-zinc-950/40 px-2 py-1.5" title={k.tip ?? ""}>
              <p className="text-[10px] uppercase tracking-wide text-zinc-600">{k.label}</p>
              <p className={`font-mono text-sm font-semibold ${k.cls ?? "text-zinc-200"}`}>{k.value}</p>
            </div>
          ))}
        </div>

        {/* đường vốn */}
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-2">
          <p className="mb-1 text-[10px] uppercase tracking-wide text-zinc-600">{t(lang, "ana.equity")}</p>
          <EquitySpark equity={a.equity} wallet={auto?.walletCapital ?? null} lang={lang} />
        </div>

        {/* bảng phân nhóm */}
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <p className="mb-1 text-[10px] uppercase tracking-wide text-zinc-600">{t(lang, "ana.byExit")}</p>
            <MiniTable
              head={[t(lang, "ana.col.kind"), "n", t(lang, "ana.col.net"), "WR"]}
              rows={a.byExitKind.map((x) => [x.kind, x.n, `${x.net >= 0 ? "+" : ""}${num(x.net)}%`, `${num(x.wr, 1)}%`])}
            />
          </div>
          <div>
            <p className="mb-1 text-[10px] uppercase tracking-wide text-zinc-600">{t(lang, "ana.bySymbol")}</p>
            <MiniTable
              head={[t(lang, "ana.col.sym"), "n", t(lang, "ana.col.net"), "WR"]}
              rows={a.bySymbol.map((x) => [x.symbol.replace("USDT", ""), x.n, `${x.net >= 0 ? "+" : ""}${num(x.net)}%`, `${num(x.wr, 1)}%`])}
            />
          </div>
          <div>
            <p className="mb-1 text-[10px] uppercase tracking-wide text-zinc-600">{t(lang, "ana.byInterval")}</p>
            <MiniTable
              head={[t(lang, "ana.col.tf"), "n", t(lang, "ana.col.net"), "WR"]}
              rows={a.byInterval.map((x) => [x.interval, x.n, `${x.net >= 0 ? "+" : ""}${num(x.net)}%`, `${num(x.wr, 1)}%`])}
            />
          </div>
          <div>
            <p className="mb-1 text-[10px] uppercase tracking-wide text-zinc-600">{t(lang, "ana.bySide")}</p>
            <MiniTable
              head={[t(lang, "ana.col.side"), "n", t(lang, "ana.col.net"), "WR"]}
              rows={a.bySide.map((x) => [x.side, x.n, `${x.net >= 0 ? "+" : ""}${num(x.net)}%`, `${num(x.wr, 1)}%`])}
            />
          </div>
        </div>

        {/* 12 lệnh đóng gần nhất */}
        {closed.length > 0 && (
          <div>
            <p className="mb-1 text-[10px] uppercase tracking-wide text-zinc-600">{t(lang, "ana.recent")}</p>
            <div className="rail-scroll max-h-48 space-y-0.5 overflow-y-auto pr-0.5">
              {closed.map((tr) => (
                <div key={tr.id} className="flex items-center gap-2 rounded px-1.5 py-0.5 font-mono text-[10px] hover:bg-zinc-800/60">
                  <span className="shrink-0 text-zinc-600">{new Date(tr.exitTime ?? tr.entryTime).toLocaleString(lang === "vi" ? "vi-VN" : "en-GB", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })}</span>
                  <span className="whitespace-normal leading-snug text-zinc-300">
                    {tr.symbol} {tr.interval}
                  </span>
                  <Badge variant="outline" className={`shrink-0 border-zinc-700 px-1 py-0 text-[9px] ${tr.side === "SHORT" ? "text-rose-400" : "text-emerald-400"}`}>
                    {tr.side}
                  </Badge>
                  <span className="shrink-0 text-zinc-500">{tr.exitKind ?? "—"}</span>
                  <span className={`ml-auto shrink-0 font-semibold ${(tr.pnlPct ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                    {(tr.pnlPct ?? 0) >= 0 ? "+" : ""}
                    {num(tr.pnlPct ?? 0)}%
                  </span>
                  <span className="w-16 shrink-0 text-right text-zinc-500">{fmtPrice(tr.entryPrice)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
