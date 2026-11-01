"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { t, type Lang } from "@/lib/i18n";
import { cycleForecast, dowExtremes } from "@/lib/cycles";
import type { CycleStats } from "@/lib/cycles";
import {
  SESSIONS,
  fmtCompact,
  gmtLabel,
  nextSessionOpen,
  sessionBar,
  sessionHours,
  sessionHoursLocal,
  sessionOf,
} from "@/lib/market";
import type { SessionStat, WhaleDelta } from "@/lib/market";
import type { MarketPulse } from "@/lib/market-pulse";
import { cyclePhase } from "@/lib/market-pulse";
import { Activity, CalendarDays, Clock, Gauge, Radar, Waves } from "lucide-react";

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
 * Bull% / drift + whale read-out. 0.2.35: sessionStats/whaleDelta/cycleStats
 * tính Ở SERVER (/api/view) — component nhận kết quả, chỉ render + giữ đồng hồ
 * phiên (sessionOf/nextSessionOpen là phép lịch nhỏ, không phải engine).
 */
export function SessionsPanel({
  lang,
  stats,
  whale,
  cycles,
}: {
  lang: Lang;
  stats: SessionStat[];
  whale: WhaleDelta | null;
  cycles: CycleStats | null;
}) {
  // SSR-safe clock: a stable per-mount fallback first, then live every 30s
  const [fallback] = useState(() => Date.now());
  const [live, setLive] = useState<number | null>(null);
  useEffect(() => {
    setLive(Date.now());
    const id = window.setInterval(() => setLive(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  const now = live ?? fallback;
  const openSet = useMemo(() => new Set(sessionOf(now)), [now]);
  const byKey = useMemo(() => new Map(stats.map((s) => [s.key, s])), [stats]);
  const nowFrac = new Date(now).getUTCHours() / 24 + new Date(now).getUTCMinutes() / 1440;

  // next session open — shared by the session-lean and calendar-cycle blocks
  const nx = useMemo(() => nextSessionOpen(now), [now]);

  // market pulse (F&G, BTC.D, derivatives) — independent of pair/TF view
  const [pulse, setPulse] = useState<MarketPulse | null>(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/market-pulse", { cache: "no-store" });
        if (!res.ok) return;
        const j = (await res.json()) as MarketPulse;
        if (alive) setPulse(j);
      } catch {
        // keep previous
      }
    };
    void load();
    const id = window.setInterval(() => void load(), 5 * 60_000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

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
          // range label: UTC hours + the viewer's local shift (VN devices → GMT+7)
          const tzOffsetMin = new Date(now).getTimezoneOffset();
          const hoursLabel = `${sessionHours(s)} · ${sessionHoursLocal(s, tzOffsetMin)} ${gmtLabel(tzOffsetMin)}`;
          return (
            <div key={s.key}>
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-zinc-300">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${SESSION_TINT[s.key]} ${isOpen ? "" : "opacity-30"}`} />
                    {t(lang, SESSION_LABEL[s.key])}
                  </span>
                  <span className="ml-3.5 block font-mono text-[10px] leading-tight text-zinc-600">{hoursLabel}</span>
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

        {/* ── Session forecast — frequentist lean from the same closed candles ── */}
        {(() => {
          const valid = stats.filter((s) => s.bullPct != null && s.candles >= 5);
          if (valid.length === 0) return null;
          const best = valid.reduce((a, b) => ((b.bullPct ?? 0) > (a.bullPct ?? 0) ? b : a));
          const worst = valid.reduce((a, b) => ((b.bullPct ?? 100) < (a.bullPct ?? 100) ? b : a));
          const nxStat = nx ? byKey.get(nx.key) : undefined;
          const inLabel =
            nx == null
              ? ""
              : nx.inMin >= 60
                ? `${Math.floor(nx.inMin / 60)}h${nx.inMin % 60 ? ` ${nx.inMin % 60}m` : ""}`
                : `${nx.inMin}m`;
          return (
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-2.5">
              <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                <Radar className="h-3.5 w-3.5" />
                {t(lang, "sess.forecast.title")}
              </p>
              {nx && nxStat?.bullPct != null && (() => {
                const bull = nxStat.bullPct!;
                // Thresholds: <40 BEAR, >60 BULL, else NEUTRAL (user request)
                const call = bull < 40 ? "BEAR" : bull > 60 ? "BULL" : "NEUTRAL";
                const callCls =
                  call === "BULL"
                    ? "bg-emerald-950/60 text-emerald-300 border-emerald-800"
                    : call === "BEAR"
                      ? "bg-rose-950/60 text-rose-300 border-rose-800"
                      : "bg-zinc-800/80 text-zinc-300 border-zinc-700";
                const conf = call === "NEUTRAL" ? Math.abs(50 - bull) : Math.max(bull, 100 - bull);
                return (
                  <div className="mt-1.5 space-y-1.5">
                    <p className="text-[11px] text-zinc-400">
                      {t(lang, "sess.forecast.next", { sess: t(lang, SESSION_LABEL[nx.key]), in: inLabel })}
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-md border px-2 py-0.5 font-mono text-sm font-bold ${callCls}`}>
                        {call}
                      </span>
                      <span className="font-mono text-[12px] text-zinc-300">
                        Bull {bull.toFixed(0)}%
                        {nxStat.driftPct != null && (
                          <span className={nxStat.driftPct >= 0 ? " text-emerald-400" : " text-rose-400"}>
                            {" · drift "}
                            {nxStat.driftPct >= 0 ? "+" : ""}
                            {nxStat.driftPct.toFixed(3)}%
                          </span>
                        )}
                      </span>
                      <span className="text-[10px] text-zinc-500">
                        n={nxStat.candles} · {t(lang, "sess.forecast.conf", { p: conf.toFixed(0) })}
                      </span>
                    </div>
                    <p className="text-[10px] text-zinc-600">
                      {t(lang, "sess.forecast.rule")}
                    </p>
                  </div>
                );
              })()}
              <p className="mt-1 text-[11px] text-zinc-400">
                {t(lang, "sess.forecast.best", {
                  hi: t(lang, SESSION_LABEL[best.key]),
                  hip: (best.bullPct ?? 0).toFixed(0),
                  lo: t(lang, SESSION_LABEL[worst.key]),
                  lop: (worst.bullPct ?? 0).toFixed(0),
                })}
              </p>
              <p className="mt-1 text-[10px] leading-relaxed text-zinc-600">{t(lang, "sess.forecast.note")}</p>
            </div>
          );
        })()}

        {/* ── Calendar cycles — weekday / month / quarter frequencies (1d) ── */}
        {cycles &&
          (() => {
            const target = now + (nx?.inMin ?? 0) * 60_000; // the next session's open moment
            const fc = cycleForecast(target, cycles);
            const volTxt =
              fc.volUp == null
                ? t(lang, "sess.cycle.volFlat")
                : t(lang, "sess.cycle.vol", {
                    vol: t(lang, fc.volUp ? "vol.up" : "vol.down"),
                    p: (fc.volUp ? (fc.dow.volUpPct ?? 50) : 100 - (fc.dow.volUpPct ?? 50)).toFixed(0),
                  });
            const inLabel2 =
              nx == null
                ? ""
                : nx.inMin >= 60
                  ? t(lang, "sess.in", { t: `${Math.floor(nx.inMin / 60)}h${nx.inMin % 60 ? ` ${nx.inMin % 60}m` : ""}` })
                  : t(lang, "sess.in", { t: `${nx.inMin}m` });
            const ext = dowExtremes(cycles);
            return (
              <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-2.5">
                <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                  <CalendarDays className="h-3.5 w-3.5" />
                  {t(lang, "sess.cycle.title", { days: cycles.days })}
                </p>
                <p className="mt-1.5 text-[11px] text-zinc-300">
                  {t(lang, "sess.cycle.next", {
                    dow: t(lang, `dow.${fc.dowIndex}`),
                    in: inLabel2,
                    n: fc.dow.n,
                  })}
                </p>
                <p className="mt-0.5 flex flex-wrap gap-x-3 font-mono text-[11px]">
                  <span className={fc.dirUp ? "text-emerald-400" : "text-rose-400"}>
                    {t(lang, "sess.cycle.dir", {
                      dir: t(lang, fc.dirUp ? "dir.up" : "dir.down"),
                      p: Math.max(fc.dow.upPct ?? 50, 100 - (fc.dow.upPct ?? 50)).toFixed(0),
                    })}
                  </span>
                  <span className={fc.volUp == null ? "text-zinc-500" : fc.volUp ? "text-emerald-400" : "text-rose-400"}>
                    {volTxt}
                  </span>
                </p>
                {fc.special && fc.special.bucket.upPct != null && (
                  <p className="mt-1 text-[11px] text-zinc-400">
                    {t(lang, "sess.cycle.special", {
                      label: t(lang, `cycle.${fc.special.label}`),
                      n: fc.special.bucket.n,
                      dir: t(lang, fc.special.bucket.upPct >= 50 ? "dir.up" : "dir.down"),
                      p: Math.max(fc.special.bucket.upPct, 100 - fc.special.bucket.upPct).toFixed(0),
                      vol: fc.special.bucket.volUpPct == null ? "—" : t(lang, fc.special.bucket.volUpPct >= 50 ? "vol.up" : "vol.down"),
                      vp: fc.special.bucket.volUpPct == null ? "—" : Math.max(fc.special.bucket.volUpPct, 100 - fc.special.bucket.volUpPct).toFixed(0),
                    })}
                  </p>
                )}
                {ext.best && ext.worst && (
                  <p className="mt-1 text-[11px] text-zinc-400">
                    {t(lang, "sess.cycle.extremes", {
                      hi: t(lang, `dow.${ext.best.i}`),
                      hip: (ext.best.b.upPct ?? 0).toFixed(0),
                      lo: t(lang, `dow.${ext.worst.i}`),
                      lop: (ext.worst.b.upPct ?? 0).toFixed(0),
                    })}
                  </p>
                )}
                <p className="mt-1 text-[10px] leading-relaxed text-zinc-600">{t(lang, "sess.cycle.note")}</p>
              </div>
            );
          })()}


        {/* ── Market pulse: F&G + cycle + derivatives ─────────────────── */}
        {pulse && (pulse.fearGreed || pulse.global || pulse.derivatives) && (() => {
          const fg = pulse.fearGreed;
          const g = pulse.global;
          const d = pulse.derivatives;
          const phase = cyclePhase(fg, g);
          const fgDelta = fg?.prev ? fg.now.value - fg.prev.value : null;
          const fgColor =
            (fg?.now.value ?? 50) <= 25
              ? "text-rose-400"
              : (fg?.now.value ?? 50) <= 45
                ? "text-amber-400"
                : (fg?.now.value ?? 50) <= 55
                  ? "text-zinc-200"
                  : (fg?.now.value ?? 50) <= 75
                    ? "text-emerald-400"
                    : "text-lime-400";
          const phaseKey = `pulse.phase.${phase.key}` as const;
          const fmtUsd = (n: number) =>
            n >= 1e12
              ? `$${(n / 1e12).toFixed(2)}T`
              : n >= 1e9
                ? `$${(n / 1e9).toFixed(1)}B`
                : n >= 1e6
                  ? `$${(n / 1e6).toFixed(0)}M`
                  : `$${n.toFixed(0)}`;
          const week = fg?.week ?? [];
          const minV = week.length ? Math.min(...week.map((x) => x.value)) : 0;
          const maxV = week.length ? Math.max(...week.map((x) => x.value)) : 100;
          const span = Math.max(1, maxV - minV);
          return (
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-2.5">
              <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                <Gauge className="h-3.5 w-3.5" />
                {t(lang, "pulse.title")}
              </p>

              {/* Fear & Greed */}
              {fg && (
                <div className="mt-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[11px] text-zinc-500">{t(lang, "pulse.fg")}</span>
                    <span className={`font-mono text-sm font-bold ${fgColor}`}>
                      {fg.now.value}
                      <span className="ml-1 text-[11px] font-semibold text-zinc-400">{fg.now.label}</span>
                      {fgDelta != null && (
                        <span className={`ml-1.5 text-[10px] font-medium ${fgDelta >= 0 ? "text-emerald-500" : "text-rose-500"}`}>
                          {fgDelta >= 0 ? "+" : ""}
                          {fgDelta}
                        </span>
                      )}
                    </span>
                  </div>
                  {/* 7-day mini bars */}
                  {week.length >= 3 && (
                    <div className="mt-1.5 flex h-8 items-end gap-0.5">
                      {week.map((pt, i) => {
                        const h = 20 + ((pt.value - minV) / span) * 80;
                        const c =
                          pt.value <= 25
                            ? "bg-rose-500/80"
                            : pt.value <= 45
                              ? "bg-amber-500/70"
                              : pt.value <= 55
                                ? "bg-zinc-500/70"
                                : pt.value <= 75
                                  ? "bg-emerald-500/70"
                                  : "bg-lime-400/80";
                        return (
                          <div
                            key={i}
                            className={`min-w-0 flex-1 rounded-t-sm ${c}`}
                            style={{ height: `${h}%` }}
                            title={`${pt.value} · ${pt.label}`}
                          />
                        );
                      })}
                    </div>
                  )}
                  <p className="mt-1 text-[10px] text-zinc-600">{t(lang, "pulse.fg.note")}</p>
                </div>
              )}

              {/* Cycle phase + global */}
              <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                <span className="text-zinc-500">{t(lang, "pulse.phase")}</span>
                <span className="text-right font-semibold text-zinc-200">
                  {t(lang, phaseKey)}
                  <span className="ml-1 font-mono text-[10px] text-zinc-500">({phase.score})</span>
                </span>
                {g && (
                  <>
                    <span className="text-zinc-500">{t(lang, "pulse.btcDom")}</span>
                    <span className="text-right font-mono font-semibold text-zinc-200">
                      {g.btcDominance.toFixed(1)}%
                    </span>
                    <span className="text-zinc-500">{t(lang, "pulse.mcap")}</span>
                    <span className="text-right font-mono text-zinc-200">
                      {fmtUsd(g.marketCapUsd)}
                      <span className={`ml-1 text-[10px] ${g.marketCapChange24h >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                        {g.marketCapChange24h >= 0 ? "+" : ""}
                        {g.marketCapChange24h.toFixed(1)}%
                      </span>
                    </span>
                    <span className="text-zinc-500">{t(lang, "pulse.vol")}</span>
                    <span className="text-right font-mono text-zinc-200">
                      {fmtUsd(g.volume24hUsd)}
                      <span className={`ml-1 text-[10px] ${g.volumeChange24h >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                        {g.volumeChange24h >= 0 ? "+" : ""}
                        {g.volumeChange24h.toFixed(1)}%
                      </span>
                    </span>
                    {g.mcapFromAthPct != null && (
                      <>
                        <span className="text-zinc-500">{t(lang, "pulse.fromAth")}</span>
                        <span className="text-right font-mono text-zinc-300">
                          {g.mcapFromAthPct.toFixed(1)}%
                        </span>
                      </>
                    )}
                  </>
                )}
              </div>

              {/* Derivatives / liquidation proxy */}
              {d && (
                <div className="mt-2 border-t border-zinc-800/80 pt-2">
                  <p className="mb-1 flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                    <Activity className="h-3 w-3" />
                    {t(lang, "pulse.deriv")} · {d.symbol.replace("USDT", "")}
                  </p>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                    {d.longAccountPct != null && (
                      <>
                        <span className="text-zinc-500">{t(lang, "pulse.longShort")}</span>
                        <span className="text-right font-mono text-zinc-200">
                          <span className="text-emerald-400">{d.longAccountPct.toFixed(0)}%L</span>
                          {" / "}
                          <span className="text-rose-400">{(100 - d.longAccountPct).toFixed(0)}%S</span>
                        </span>
                      </>
                    )}
                    {d.topLongPct != null && (
                      <>
                        <span className="text-zinc-500">{t(lang, "pulse.topLong")}</span>
                        <span className="text-right font-mono text-zinc-200">
                          {d.topLongPct.toFixed(0)}%L
                        </span>
                      </>
                    )}
                    {d.openInterest != null && (
                      <>
                        <span className="text-zinc-500">{t(lang, "pulse.oi")}</span>
                        <span className="text-right font-mono text-zinc-200">
                          {fmtCompact(d.openInterest)}
                        </span>
                      </>
                    )}
                    {d.fundingRatePct != null && (
                      <>
                        <span className="text-zinc-500">{t(lang, "pulse.funding")}</span>
                        <span
                          className={`text-right font-mono font-semibold ${
                            d.fundingRatePct >= 0 ? "text-emerald-400" : "text-rose-400"
                          }`}
                        >
                          {d.fundingRatePct >= 0 ? "+" : ""}
                          {d.fundingRatePct.toFixed(4)}%
                        </span>
                      </>
                    )}
                  </div>
                  <p className="mt-1 text-[10px] leading-relaxed text-zinc-600">{t(lang, "pulse.deriv.note")}</p>
                </div>
              )}

              <p className="mt-1.5 text-[10px] leading-relaxed text-zinc-600">
                {t(lang, "pulse.note")}
                {pulse.sources.length > 0 && (
                  <span className="text-zinc-700"> · {pulse.sources.join(", ")}</span>
                )}
              </p>
            </div>
          );
        })()}

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
