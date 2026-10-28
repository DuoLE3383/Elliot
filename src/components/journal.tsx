"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SIDE_COLOR } from "@/components/panels";
import { fmtPct, fmtPrice, fmtTime, t, type Lang } from "@/lib/i18n";
import type { Paper } from "@/lib/types";
import { Download } from "lucide-react";

type Filter = "all" | "tp" | "sl" | "flip" | "open";

interface Props {
  lang: Lang;
  papers: Paper[];
  symbol: string;
  interval: string;
}

const resultBadge = (p: Paper, lang: Lang) => {
  if (p.status === "open") {
    return (
      <Badge variant="outline" className="border-zinc-600 text-zinc-300">
        {t(lang, "result.open")}
      </Badge>
    );
  }
  if (p.liquidated) {
    return (
      <Badge className="border border-rose-700 bg-rose-900 text-rose-200 hover:bg-rose-900">
        {t(lang, "result.liq")}
      </Badge>
    );
  }
  if (p.exitKind === "flip") {
    return (
      <Badge className="border-0 bg-amber-950 text-amber-400 hover:bg-amber-950">
        {t(lang, "result.flip")}
      </Badge>
    );
  }
  if (p.exitKind === "tp") {
    return (
      <Badge className="border-0 bg-emerald-950 text-emerald-400 hover:bg-emerald-950">
        {t(lang, "result.tp")}
      </Badge>
    );
  }
  return (
    <Badge className="border-0 bg-rose-950 text-rose-400 hover:bg-rose-950">
      {t(lang, "result.sl")}
    </Badge>
  );
};

export function Journal({ lang, papers, symbol, interval }: Props) {
  const [filter, setFilter] = useState<Filter>("all");

  const filtered = useMemo(() => {
    const rows = papers.filter((p) => {
      if (filter === "all") return true;
      if (filter === "open") return p.status === "open";
      if (filter === "flip") return p.exitKind === "flip";
      return p.exitKind === filter;
    });
    return rows.sort((a, b) => (b.exitTime ?? b.entryTime) - (a.exitTime ?? a.entryTime));
  }, [papers, filter]);

  const exportCsv = () => {
    const header =
      "Symbol,Interval,Side,Leverage,Entry,Entry Time,Exit,Exit Time,Exit Kind,Liquidated,Price Move %,ROE %,Flipped From";
    const lines = papers.map((p) =>
      [
        p.symbol,
        p.interval,
        p.side,
        p.leverage,
        p.entry,
        new Date(p.entryTime).toISOString(),
        p.exit ?? "",
        p.exitTime ? new Date(p.exitTime).toISOString() : "",
        p.exitKind ?? "",
        p.liquidated ? "YES" : "",
        p.pricePnlPct?.toFixed(4) ?? "",
        p.pnlPct?.toFixed(4) ?? "",
        p.flippedFrom ?? "",
      ].join(","),
    );
    const blob = new Blob(["\uFEFF" + [header, ...lines].join("\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `journal-${symbol}-${interval}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const chips: { key: Filter; label: string }[] = [
    { key: "all", label: t(lang, "journal.all") },
    { key: "tp", label: t(lang, "journal.tp") },
    { key: "sl", label: t(lang, "journal.sl") },
    { key: "flip", label: t(lang, "journal.flip") },
    { key: "open", label: t(lang, "journal.openF") },
  ];

  return (
    <Card className="border-zinc-800 bg-zinc-900/60">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base font-semibold text-zinc-100">
            {t(lang, "journal.title")}{" "}
            <span className="ml-1 text-xs font-normal text-zinc-500">
              {t(lang, "journal.count", { n: filtered.length })}
            </span>
          </CardTitle>
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
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1.5 rounded-full border-zinc-700 px-3 text-xs text-zinc-300 hover:bg-zinc-800"
              onClick={exportCsv}
            >
              <Download className="h-3.5 w-3.5" />
              {t(lang, "journal.csv")}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {filtered.length === 0 ? (
          <p className="rounded-lg border border-dashed border-zinc-800 p-6 text-center text-xs text-zinc-500">
            {t(lang, "journal.empty")}
          </p>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden max-h-96 overflow-y-auto rounded-lg border border-zinc-800 md:block">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-zinc-900 text-[11px] uppercase tracking-wide text-zinc-500">
                  <tr>
                    <th className="px-3 py-2 font-medium">{t(lang, "journal.col.side")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t(lang, "journal.col.entry")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t(lang, "journal.col.exit")}</th>
                    <th className="px-3 py-2 font-medium">{t(lang, "journal.col.exitAt")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t(lang, "journal.col.pnl")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t(lang, "journal.col.result")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/80">
                  {filtered.map((p) => (
                    <tr key={p.id} className="text-zinc-300 hover:bg-zinc-900/70">
                      <td className={`px-3 py-2 font-mono font-semibold ${SIDE_COLOR(p.side)}`}>
                        {p.side}
                        {p.leverage > 1 && <span className="ml-1 text-[10px] text-amber-500">×{p.leverage}</span>}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">
                        {fmtPrice(p.entry)}
                        {p.flippedFrom && <span className="ml-1 text-amber-500" title={p.flippedFrom}>⇄</span>}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">
                        {p.exit != null ? fmtPrice(p.exit) : <span className="text-zinc-600">—</span>}
                      </td>
                      <td className="px-3 py-2 text-zinc-500">
                        {p.exitTime ? fmtTime(p.exitTime, lang) : "—"}
                      </td>
                      <td
                        className={`px-3 py-2 text-right font-mono font-semibold ${
                          p.status === "open" ? "text-zinc-500" : p.pnlPct! >= 0 ? "text-emerald-400" : "text-rose-400"
                        }`}
                      >
                        {p.status === "open" ? "—" : fmtPct(p.pnlPct!)}
                      </td>
                      <td className="px-3 py-2 text-right">{resultBadge(p, lang)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="max-h-96 space-y-2 overflow-y-auto md:hidden">
              {filtered.map((p) => (
                <div key={p.id} className="rounded-lg border border-zinc-800 bg-zinc-900 p-3">
                  <div className="flex items-center justify-between">
                    <span className={`font-mono text-sm font-bold ${SIDE_COLOR(p.side)}`}>
                      {p.side}
                      {p.leverage > 1 && <span className="ml-1 text-[10px] text-amber-500">×{p.leverage}</span>}
                    </span>
                    {resultBadge(p, lang)}
                  </div>
                  <p className="mt-1 text-[11px] text-zinc-400">
                    {p.status === "open"
                      ? t(lang, "journal.mobileOpen", { entry: fmtPrice(p.entry) })
                      : t(lang, "journal.mobileEntry", {
                          entry: fmtPrice(p.entry),
                          exit: fmtPrice(p.exit ?? 0),
                        })}
                    <span className="text-zinc-600"> · {fmtTime(p.exitTime ?? p.entryTime, lang)}</span>
                  </p>
                  {p.status === "closed" && (
                    <p
                      className={`mt-0.5 font-mono text-xs font-bold ${
                        p.pnlPct! >= 0 ? "text-emerald-400" : "text-rose-400"
                      }`}
                    >
                      {fmtPct(p.pnlPct!)}
                      {p.liquidated && <span className="ml-1.5 text-rose-400">· {t(lang, "result.liq")}</span>}
                      {p.flippedFrom && <span className="ml-1.5 text-amber-500">⇄ {t(lang, "result.flip")}</span>}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
