"use client";

import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { fmtPct, fmtPrice, fmtTime, symbolLabel, t, type Lang } from "@/lib/i18n";
import { fetchSuggestions, type SuggestionRow } from "@/lib/history";
import { BrainCircuit, CheckCircle2, Clock3, Database, History, Sparkles } from "lucide-react";

type Scope = "pair" | "all";
type Filter = "all" | "pending" | "win" | "loss" | "flat";

interface Props {
  lang: Lang;
  symbol: string;
  interval: string;
  /** bumped by the parent after save / apply / resolve mutations */
  refreshKey: number;
}

const biasClass = (bias: string) =>
  bias === "LONG" ? "text-emerald-400" : bias === "SHORT" ? "text-rose-400" : "text-zinc-300";

function outcomeBadge(s: SuggestionRow, lang: Lang) {
  if (s.outcome == null) {
    return (
      <Badge variant="outline" className="border-zinc-600 text-zinc-400">
        <Clock3 className="mr-1 h-3 w-3" />
        {t(lang, "sg.outcome.pending")}
      </Badge>
    );
  }
  if (s.outcome === "win") {
    return (
      <Badge className="border-0 bg-emerald-950 text-emerald-400 hover:bg-emerald-950">
        {t(lang, "sg.outcome.win")}
      </Badge>
    );
  }
  if (s.outcome === "loss") {
    return (
      <Badge className="border-0 bg-rose-950 text-rose-400 hover:bg-rose-950">
        {t(lang, "sg.outcome.loss")}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="border-zinc-700 text-zinc-400">
      {t(lang, "sg.outcome.flat")}
    </Badge>
  );
}

function StatTile({ icon, label, value, valueClass }: { icon: React.ReactNode; label: string; value: string; valueClass?: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-zinc-800 bg-zinc-950/40 p-2.5">
      <p className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-zinc-500">
        {icon}
        {label}
      </p>
      <p className={`mt-0.5 truncate font-mono text-sm font-bold ${valueClass ?? "text-zinc-100"}`}>{value}</p>
    </div>
  );
}

export function SuggestionHistory({ lang, symbol, interval, refreshKey }: Props) {
  const [scope, setScope] = useState<Scope>("pair");
  const [filter, setFilter] = useState<Filter>("all");
  const [rows, setRows] = useState<SuggestionRow[] | null>(null);

  useEffect(() => {
    let alive = true;
    // stale-while-revalidate: keep the previous list visible until the fresh
    // query resolves — avoids a skeleton flash on scope/pair switches
    const load = async () => {
      try {
        const list =
          scope === "pair"
            ? await fetchSuggestions({ symbol, interval, limit: 150 })
            : await fetchSuggestions({ limit: 300 });
        if (alive) setRows(list);
      } catch {
        if (alive && rows == null) setRows([]);
      }
    };
    void load();
    return () => {
      alive = false;
    };
  }, [scope, symbol, interval, refreshKey]);

  const stats = useMemo(() => {
    const scored = rows?.filter((r) => r.outcome === "win" || r.outcome === "loss") ?? [];
    const wins = scored.filter((r) => r.outcome === "win").length;
    const pending = rows?.filter((r) => r.outcome == null).length ?? 0;
    const applied = rows?.filter((r) => r.applied).length ?? 0;
    return {
      scored: scored.length,
      winRate: scored.length ? (wins / scored.length) * 100 : null,
      pending,
      applied,
    };
  }, [rows]);

  const filtered = useMemo(() => {
    const list = rows ?? [];
    if (filter === "all") return list;
    if (filter === "pending") return list.filter((r) => r.outcome == null);
    return list.filter((r) => r.outcome === filter);
  }, [rows, filter]);

  const chips: { key: Filter; label: string }[] = [
    { key: "all", label: t(lang, "sg.filter.all") },
    { key: "pending", label: t(lang, "sg.filter.pending") },
    { key: "win", label: t(lang, "sg.filter.win") },
    { key: "loss", label: t(lang, "sg.filter.loss") },
    { key: "flat", label: t(lang, "sg.filter.flat") },
  ];

  return (
    <Card className="border-zinc-800 bg-zinc-900/60">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-1.5 text-base font-semibold text-zinc-100">
              <History className="h-4 w-4 text-teal-400" />
              {t(lang, "sg.title")}
              {rows && (
                <span className="ml-1 text-xs font-normal text-zinc-500">
                  {t(lang, "sg.count", { n: filtered.length })}
                </span>
              )}
            </CardTitle>
            <p className="mt-0.5 text-[11px] text-zinc-500">{t(lang, "sg.subtitle")}</p>
          </div>
          <div className="flex items-center gap-1.5">
            {(["pair", "all"] as Scope[]).map((sc) => (
              <Button
                key={sc}
                size="sm"
                variant={scope === sc ? "default" : "outline"}
                className={
                  scope === sc
                    ? "h-7 rounded-full border-zinc-700 bg-zinc-100 px-3 text-xs text-zinc-900 hover:bg-zinc-200"
                    : "h-7 rounded-full border-zinc-700 bg-transparent px-3 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                }
                onClick={() => setScope(sc)}
              >
                {t(lang, sc === "pair" ? "sg.scope.pair" : "sg.scope.all")}
              </Button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        {/* summary tiles */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatTile
            icon={<Sparkles className="h-3 w-3 text-teal-400" />}
            label={t(lang, "sg.winrate", { pct: stats.winRate == null ? "—" : `${stats.winRate.toFixed(0)}%` })}
            value={t(lang, "sg.scored", { n: stats.scored })}
            valueClass={stats.winRate != null && stats.winRate >= 50 ? "text-emerald-400" : undefined}
          />
          <StatTile
            icon={<Clock3 className="h-3 w-3 text-amber-400" />}
            label={t(lang, "sg.pending", { n: stats.pending })}
            value={String(stats.pending)}
          />
          <StatTile
            icon={<CheckCircle2 className="h-3 w-3 text-emerald-400" />}
            label={t(lang, "sg.appliedN", { n: stats.applied })}
            value={String(stats.applied)}
          />
          <StatTile
            icon={<Database className="h-3 w-3 text-zinc-400" />}
            label={scope === "pair" ? `${symbolLabel(symbol)} · ${interval}` : t(lang, "sg.scope.all")}
            value={rows ? String(rows.length) : "…"}
          />
        </div>

        {/* filter chips */}
        <div className="flex flex-wrap items-center gap-1.5">
          {chips.map((c) => (
            <Button
              key={c.key}
              size="sm"
              variant={filter === c.key ? "default" : "outline"}
              className={
                filter === c.key
                  ? "h-7 rounded-full border-zinc-700 bg-zinc-100 px-3 text-xs text-zinc-900 hover:bg-zinc-200"
                  : "h-7 rounded-full border-zinc-700 bg-transparent px-3 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
              }
              onClick={() => setFilter(c.key)}
            >
              {c.label}
            </Button>
          ))}
        </div>

        {rows == null ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }, (_, k) => (
              <Skeleton key={k} className="h-10 rounded-lg border border-zinc-800 bg-zinc-900" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <p className="rounded-lg border border-dashed border-zinc-800 p-6 text-center text-xs text-zinc-500">
            {rows.length === 0 ? t(lang, "sg.empty") : t(lang, "sg.filter.empty")}
          </p>
        ) : (
          <>
            {/* Desktop table */}
            <div className="rail-scroll hidden max-h-48 overflow-y-auto rounded-lg border border-zinc-800 md:block">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-zinc-900 text-[11px] uppercase tracking-wide text-zinc-500">
                  <tr>
                    <th className="px-3 py-2 font-medium">{t(lang, "sg.col.time")}</th>
                    {scope === "all" && <th className="px-3 py-2 font-medium">{t(lang, "sg.col.pair")}</th>}
                    <th className="px-3 py-2 font-medium">{t(lang, "sg.col.bias")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t(lang, "sg.col.prob")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t(lang, "sg.col.sltp")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t(lang, "sg.col.ut")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t(lang, "sg.col.result")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/80">
                  {filtered.map((s) => (
                    <tr key={s.id} className="text-zinc-300 hover:bg-zinc-900/70">
                      <td className="whitespace-nowrap px-3 py-2 text-zinc-400">
                        {fmtTime(new Date(s.createdAt).getTime(), lang)}
                        {s.applied && <Database className="ml-1.5 inline h-3 w-3 text-teal-500" title={t(lang, "sg.appliedBadge")} />}
                      </td>
                      {scope === "all" && (
                        <td className="whitespace-nowrap px-3 py-2 font-mono text-zinc-300">
                          {symbolLabel(s.symbol)}
                          <span className="ml-1 text-[10px] text-zinc-600">{s.interval}</span>
                        </td>
                      )}
                      <td className={`px-3 py-2 font-mono font-semibold ${biasClass(s.bias)}`}>
                        {s.bias}
                        <span className="ml-1.5 text-[10px] font-normal text-zinc-500">
                          {t(lang, "sg.horizonAt", { n: s.horizonBars })}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right font-mono">{(s.prob * 100).toFixed(1)}%</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right font-mono">
                        <span className="text-rose-300">{s.slPct.toFixed(1)}</span>
                        <span className="text-zinc-600"> / </span>
                        <span className="text-emerald-300">{s.tpPct.toFixed(1)}</span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-zinc-400">
                        {s.atrKey}·{s.atrPeriod}
                        {s.smaFilter && <span className="ml-1 text-[10px]">SMA{s.smaPeriod}</span>}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {s.pnlPct != null && (
                            <span
                              className={`font-mono font-semibold ${
                                s.pnlPct > 0 ? "text-emerald-400" : s.pnlPct < 0 ? "text-rose-400" : "text-zinc-500"
                              }`}
                            >
                              {fmtPct(s.pnlPct)}
                            </span>
                          )}
                          {outcomeBadge(s, lang)}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="rail-scroll max-h-72 space-y-2 overflow-y-auto md:hidden">
              {filtered.map((s) => (
                <div key={s.id} className="rounded-lg border border-zinc-800 bg-zinc-900 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`font-mono text-sm font-bold ${biasClass(s.bias)}`}>
                      {s.bias}
                      {scope === "all" && (
                        <span className="ml-1.5 text-[11px] font-normal text-zinc-400">
                          {symbolLabel(s.symbol)} · {s.interval}
                        </span>
                      )}
                    </span>
                    {outcomeBadge(s, lang)}
                  </div>
                  <p className="mt-1 font-mono text-[11px] text-zinc-400">
                    P {(s.prob * 100).toFixed(1)}% · SL {s.slPct.toFixed(1)}% / TP {s.tpPct.toFixed(1)}% · UT {s.atrKey}·{s.atrPeriod}
                    {s.smaFilter ? ` · SMA${s.smaPeriod}` : ""}
                  </p>
                  <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-zinc-600">
                    {fmtTime(new Date(s.createdAt).getTime(), lang)}
                    <span>· {t(lang, "sg.horizonAt", { n: s.horizonBars })}</span>
                    {s.pnlPct != null && (
                      <span className={s.pnlPct > 0 ? "text-emerald-400" : s.pnlPct < 0 ? "text-rose-400" : ""}>
                        · {fmtPct(s.pnlPct)}
                      </span>
                    )}
                    {s.applied && (
                      <span className="inline-flex items-center gap-0.5 text-teal-500">
                        · <Database className="h-2.5 w-2.5" /> {t(lang, "sg.appliedBadge")}
                      </span>
                    )}
                  </p>
                </div>
              ))}
            </div>
          </>
        )}

        <p className="flex items-center gap-1.5 border-t border-zinc-800 pt-2 text-[10px] leading-relaxed text-zinc-600">
          <BrainCircuit className="h-3 w-3 shrink-0" />
          {t(lang, "sg.subtitle")}
        </p>
      </CardContent>
    </Card>
  );
}
