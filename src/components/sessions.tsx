"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { t, type Lang } from "@/lib/i18n";
import {
  SESSIONS,
  fmtCompact,
  sessionBar,
  sessionOf,
  sessionStats,
  whaleDelta,
} from "@/lib/market";
import type { Kline } from "@/lib/types";
import { Clock, Waves } from "lucide-react";

const SESSION_LABEL: Record<string, string> = {
  sydney: "sess.sydney",
  tokyo: "sess.tokyo",
  london: "sess.london",
  newyork: "sess.newyork",
};

const SESSION_TINT: Record<string, string> = {
  sydney: "bg-sky-500/70",
  tokyo: "bg-violet-500/70",
  london: "bg-amber-500/70",
  newyork: "bg-emerald-500/70",
};

/**
 * "Phiên giao dịch" — 24h UTC strip per global session with open/closed state,
 * Bull% / drift computed from the loaded closed candles, plus the whale
 * (taker delta) read-out. Pure addition below the chart — nothing moves.
 */
export function SessionsPanel({ lang, klines }: { lang: Lang; klines: Kline[] }) {
  // SSR-safe clock: render with the kline fallback first, then go live
  const [live, setLive] = useState<number | null>(null);
  useEffect(() => {
    setLive(Date.now());
    const id = window.setInterval(() => setLive(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  const now = live ?? (klines.length ? klines[klines.length - 1].t + 60_000 : Date.now());
  const openSet = useMemo(() => new Set(sessionOf(now)), [now]);
  const stats = useMemo(() => sessionStats(klines), [klines]);
  const byKey = useMemo(() => new Map(stats.map((s) => [s.key, s])), [stats]);
  const nowFrac = new Date(now).getUTCHours() / 24 + new Date(now).getUTCMinutes() / 1440;

  const whale = useMemo(() => whaleDelta(klines), [klines]);

  const utcClock = new Date(now).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });

  return (
    <Card className="min-w-0 border-zinc-800 bg-zinc-900/60">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base font-semibold text-zinc-100">
            <Clock className="h-4 w-4 text-zinc-500" />
            {t(lang, "sess.title")}
          </CardTitle>
          <span className="font-mono text-[11px] text-zinc-500">
            {utcClock} {t(lang, "sess.utc")}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-2.5 pt-0">
        {SESSIONS.map((s) => {
          const st = byKey.get(s.key);
          const isOpen = openSet.has(s.key);
          const bar = sessionBar(s);
          return (
            <div key={s.key}>
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-xs font-semibold text-zinc-300">
                  <span className={`h-2 w-2 rounded-full ${SESSION_TINT[s.key]} ${isOpen ? "" : "opacity-30"}`} />
                  {t(lang, SESSION_LABEL[s.key])}
                </span>
                <span className="font-mono text-[11px]">
                  {st && st.bullPct != null ? (
                    <span className={st.bullPct >= 50 ? "text-emerald-400" : "text-rose-400"}>
                      {t(lang, "sess.bull", {
                        p: st.bullPct.toFixed(0),
                        d: st.driftPct != null ? `${st.driftPct >= 0 ? "+" : ""}${st.driftPct.toFixed(3)}` : "—",
                      })}
                    </span>
                  ) : (
                    <span className="text-zinc-600">{t(lang, "sess.nodata")}</span>
                  )}
                  <span
                    className={`ml-2 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                      isOpen ? "bg-emerald-950 text-emerald-400" : "bg-zinc-800 text-zinc-500"
                    }`}
                  >
                    {isOpen ? t(lang, "sess.open") : t(lang, "sess.closed")}
                  </span>
                </span>
              </div>
              {/* 24h strip */}
              <div className="relative mt-1 h-2 overflow-hidden rounded-full bg-zinc-800/70">
                <div
                  className={`absolute inset-y-0 rounded-full ${SESSION_TINT[s.key]} ${isOpen ? "" : "opacity-40"}`}
                  style={{ left: `${bar.left * 100}%`, width: `${bar.width * 100}%` }}
                />
                <div
                  className="absolute inset-y-[-2px] w-px bg-zinc-100/80"
                  style={{ left: `${nowFrac * 100}%` }}
                />
              </div>
            </div>
          );
        })}

        <p className="text-[10px] leading-relaxed text-zinc-600">{t(lang, "sess.note")}</p>

        {/* ── Whale / taker delta ─────────────────────────────────────── */}
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-2.5">
          <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
            <Waves className="h-3.5 w-3.5" />
            {t(lang, "whale.title")}
          </p>
          {whale ? (
            <>
              <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                <span className="text-zinc-500">{t(lang, "whale.net", { n: whale.n })}</span>
                <span
                  className={`text-right font-mono font-bold ${
                    whale.net >= 0 ? "text-emerald-400" : "text-rose-400"
                  }`}
                >
                  {fmtCompact(whale.net)}
                </span>
                <span className="text-zinc-500">{t(lang, "whale.strongBuy")}</span>
                <span className="text-right font-mono font-semibold text-emerald-400">
                  {fmtCompact(whale.strongBuy)}
                </span>
                <span className="text-zinc-500">{t(lang, "whale.strongSell")}</span>
                <span className="text-right font-mono font-semibold text-rose-400">
                  {fmtCompact(whale.strongSell)}
                </span>
                <span className="text-zinc-500">{t(lang, "whale.last")}</span>
                <span
                  className={`text-right font-mono font-semibold ${
                    whale.last >= 0 ? "text-emerald-400" : "text-rose-400"
                  }`}
                >
                  {fmtCompact(whale.last)}
                </span>
              </div>
              <p className="mt-1.5 text-[10px] leading-relaxed text-zinc-600">{t(lang, "whale.note")}</p>
            </>
          ) : (
            <p className="mt-1 text-[11px] text-zinc-500">{t(lang, "whale.none")}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
