"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { fmtCompact, sessionOf } from "@/lib/market";
import type { SessionStat, WhaleDelta } from "@/lib/market";
import type { Analysis } from "@/lib/analysis";
import { t, type Lang } from "@/lib/i18n";
import type { Paper, Signal } from "@/lib/types";
import { Compass, Waves } from "lucide-react";

const SESSION_LABEL: Record<string, string> = {
  sydney: "sess.sydney",
  tokyo: "sess.tokyo",
  london: "sess.london",
  newyork: "sess.newyork",
};

interface Props {
  lang: Lang;
  /** analyze(klines) đã tính Ở SERVER (/api/view) */
  a: Analysis;
  /** sessionStats(klines) đã tính Ở SERVER */
  stats: SessionStat[];
  /** whaleDelta(klines) đã tính Ở SERVER */
  whale: WhaleDelta | null;
  openPaper?: Paper;
  /** newest CONFIRMED signal (closed candle) */
  confirmed?: Signal;
}

/**
 * Right-rail context card — Elliott-style compact read-out:
 * status (position/signal side + EMA trend), open sessions with Bull%/drift,
 * and the whale (taker delta) summary. Pure read-only — no controls here.
 * 0.2.35: nhận kết quả tính sẵn từ /api/view, không còn chạy analyze trên nến.
 */
export function RailContext({ lang, a, stats, whale, openPaper, confirmed }: Props) {
  // SSR-safe clock
  const [fallback] = useState(() => Date.now());
  const [live, setLive] = useState<number | null>(null);
  useEffect(() => {
    setLive(Date.now());
    const id = window.setInterval(() => setLive(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  const now = live ?? fallback;

  const openSet = useMemo(() => new Set(sessionOf(now)), [now]);

  const side = openPaper?.side ?? (confirmed ? (confirmed.dir === "BUY" ? "LONG" : "SHORT") : undefined);
  const sideClass = side === "LONG" ? "text-emerald-400" : side === "SHORT" ? "text-rose-400" : "text-zinc-500";
  const trendLine =
    a.trend === "up" ? t(lang, "rail.trendUp") : a.trend === "down" ? t(lang, "rail.trendDown") : "EMA89 ≈ EMA200";

  const openSessions = stats.filter((s) => openSet.has(s.key));

  return (
    <Card className="border-zinc-800 bg-zinc-900/60">
      <CardContent className="space-y-2.5 p-3">
        {/* status */}
        <div>
          <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            <Compass className="h-3 w-3" />
            {t(lang, "rail.status")}
          </p>
          <p className={`font-mono text-2xl font-black leading-tight ${sideClass}`}>{side ?? t(lang, "rail.wait")}</p>
          <p className="text-[11px] leading-snug text-zinc-400">{trendLine}</p>
        </div>

        {/* sessions now */}
        <div className="border-t border-zinc-800 pt-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            {t(lang, "rail.sessOpen")}
          </p>
          {openSessions.length === 0 ? (
            <p className="mt-0.5 text-[11px] text-zinc-500">{t(lang, "rail.sessNone")}</p>
          ) : (
            <div className="mt-1 flex flex-wrap gap-1">
              {openSessions.map((s) => (
                <span
                  key={s.key}
                  className="inline-flex items-center gap-1 rounded border border-zinc-700 bg-zinc-950/60 px-1.5 py-0.5 text-[10px]"
                >
                  <b className="font-semibold text-zinc-200">{t(lang, SESSION_LABEL[s.key])}</b>
                  {s.bullPct != null && (
                    <span className={`font-mono ${s.bullPct >= 50 ? "text-emerald-400" : "text-rose-400"}`}>
                      {s.bullPct.toFixed(2)}%
                    </span>
                  )}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* whale near price */}
        <div className="border-t border-zinc-800 pt-2">
          <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            <Waves className="h-3 w-3" />
            {t(lang, "rail.whaleNear")}
          </p>
          {whale ? (
            <div className="mt-1 grid grid-cols-2 gap-x-2 gap-y-0.5 text-[11px]">
              <span className="text-zinc-500">{t(lang, "whale.net", { n: whale.n })}</span>
              <span className={`text-right font-mono font-bold ${whale.net >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                {fmtCompact(whale.net)}
              </span>
              <span className="text-zinc-500">{t(lang, "whale.strongBuy")}</span>
              <span className="text-right font-mono text-emerald-400">{fmtCompact(whale.strongBuy)}</span>
              <span className="text-zinc-500">{t(lang, "whale.strongSell")}</span>
              <span className="text-right font-mono text-rose-400">{fmtCompact(whale.strongSell)}</span>
              <span className="text-zinc-500">{t(lang, "whale.last")}</span>
              <span className={`text-right font-mono ${whale.last >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                {fmtCompact(whale.last)}
              </span>
            </div>
          ) : (
            <p className="mt-0.5 text-[11px] text-zinc-500">{t(lang, "whale.none")}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
