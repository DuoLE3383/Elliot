"use client";

// ─── /stats — Thống kê & đối chiếu logic ─────────────────────────────────────
// Trả lời 3 câu hỏi cho MỖI phần của app (sessions, win rate pair/TF, universe
// scan, auto dry-run, signal dock, lệnh đang mở, auto history, suggestion
// history, trade journal, deep analysis):
//   1. CƠ SỞ LOGIC — số liệu được đưa ra từ nguồn nào, công thức nào
//      (i18n stats.basis.* — khớp chữ với code thật).
//   2. NHẤT QUÁN với logic engine chưa — kiểm chéo chạy THẬT trên server
//      (hai đường tính độc lập, chấm lại outcome từ giá, đối chiếu sổ vốn…).
//   3. CHUẨN XÁC bao nhiêu % — Wilson 95% cận dưới cho tỉ lệ (độ tin cậy của
//      con số), 100% cho số đếm/mô tả; note nói rõ vì sao.
// Hai section cuối (journal + analysis) từ 0.2.35 cũng tính Ở SERVER qua
// /api/view (papersFrom/analyze + thiết lập MẶC ĐỊNH) cho combo người dùng
// chọn — trình duyệt chỉ render. 0.2.38: chọn “Tất cả cặp” → journal GỘP 11
// cặp tiêu chuẩn tính qua /api/journal (kèm bảng con theo từng cặp); phân tích
// sâu vẫn theo từng cặp nên khi ALL card đó hiện ghi chú hướng dẫn.
// Nút "Root-cause dive" trên /ai vẫn gửi CÙNG snapshot server vào LLM.

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { fmtPct, fmtPrice, t, type Lang } from "@/lib/i18n";
import type { Analysis } from "@/lib/analysis";
import type { KpiStats } from "@/lib/papers";
import { fetchView } from "@/lib/view";
import { DEFAULT_SETTINGS, DEFAULT_WYCKOFF, SYMBOLS } from "@/lib/types";
import {
  ArrowLeft,
  CheckCircle2,
  FlaskConical,
  HelpCircle,
  RefreshCw,
  ScrollText,
  Search,
  TriangleAlert,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

// ─── hình dạng snapshot (khớp src/lib/stats.ts — khai tại chỗ để trang client
// không kéo db/engine vào bundle trình duyệt) ─────────────────────────────────
interface StatMetric { k: string; v: string; sub?: string }
interface StatSection {
  key: string;
  state: "ok" | "warn" | "na";
  note: string;
  accPct: number;
  accNote: string;
  metrics: StatMetric[];
}
interface StatsSnapshot {
  at: number;
  sections: StatSection[];
}

const PICK_TFS = ["5m", "15m", "1h", "4h"];
// 0.2.38: dùng đúng danh sách cặp tiêu chuẩn của engine (SYMBOLS — 11 staples)
// + giá trị đặc biệt "ALL" = journal gộp mọi cặp qua /api/journal
const PICK_ALL = "ALL";
const PICK_SYMBOLS: readonly string[] = SYMBOLS;

/** một dòng bảng con theo cặp của /api/journal?symbol=ALL */
interface PerPair {
  symbol: string;
  kpi: KpiStats;
  signals: number;
}
interface JournalAllResp {
  kpi: KpiStats;
  basis: number;
  per: PerPair[] | null;
  failed: string[];
}

export default function StatsPage() {
  const [lang, setLang] = useState<Lang>("en");
  const [snap, setSnap] = useState<StatsSnapshot | null>(null);
  const [at, setAt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  // combo picker cho 2 section client-side
  const [pickSym, setPickSym] = useState<string>("BTCUSDT");
  const [pickTf, setPickTf] = useState("15m");
  const [journal, setJournal] = useState<(KpiStats & { basis: string }) | null>(null);
  const [journalPer, setJournalPer] = useState<{ per: PerPair[]; failed: string[] } | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [clientBusy, setClientBusy] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("utp.lang");
    if (saved === "vi" || saved === "en") setLang(saved);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/stats", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = (await res.json()) as StatsSnapshot;
      setSnap(j);
      setAt(Date.now());
      setErr("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "network");
    } finally {
      setLoading(false);
    }
  }, []);

  // 2 section client-side — 0.2.35: tính Ở SERVER qua /api/view (setting MẶC ĐỊNH)
  // 0.2.38: pickSym = ALL → journal gộp 11 cặp qua /api/journal (phân tích sâu ẩn)
  useEffect(() => {
    let alive = true;
    setClientBusy(true);
    (async () => {
      if (pickSym === PICK_ALL) {
        try {
          const res = await fetch(`/api/journal?interval=${encodeURIComponent(pickTf)}&symbol=ALL`, { cache: "no-store" });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const j = (await res.json()) as JournalAllResp;
          if (!alive) return;
          setJournal({ ...j.kpi, basis: String(j.basis) });
          setJournalPer({ per: j.per ?? [], failed: j.failed ?? [] });
          setAnalysis(null);
        } catch {
          if (alive) {
            setJournal(null);
            setJournalPer(null);
            setAnalysis(null);
          }
        }
        setClientBusy(false);
        return;
      }
      setJournalPer(null);
      const v = await fetchView({
        symbol: pickSym,
        interval: pickTf,
        s: DEFAULT_SETTINGS,
        w: DEFAULT_WYCKOFF,
        pairs: [],
      });
      if (!alive) return;
      if (v) {
        setJournal({ ...v.kpi, basis: `${v.signals.length}` });
        setAnalysis(v.analysis);
      } else {
        setJournal(null);
        setAnalysis(null);
      }
      setClientBusy(false);
    })();
    return () => {
      alive = false;
    };
  }, [pickSym, pickTf]);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(id);
  }, [load]);

  const switchLang = () => {
    const next: Lang = lang === "vi" ? "en" : "vi";
    setLang(next);
    localStorage.setItem("utp.lang", next);
  };

  const counts = { ok: 0, warn: 0, na: 0 };
  for (const s of snap?.sections ?? []) counts[s.state] += 1;
  if (journal) counts[journal.closed > 0 && journal.winRate >= 50 ? "ok" : "warn"] += 1;
  if (analysis) counts.ok += 1;

  const stateBadge = (state: "ok" | "warn" | "na") =>
    state === "ok" ? (
      <Badge className="gap-1 border-0 bg-emerald-950 text-emerald-400 hover:bg-emerald-950">
        <CheckCircle2 className="h-3 w-3" /> {t(lang, "stats.ok")}
      </Badge>
    ) : state === "warn" ? (
      <Badge className="gap-1 border-0 bg-amber-950 text-amber-400 hover:bg-amber-950">
        <TriangleAlert className="h-3 w-3" /> {t(lang, "stats.warn")}
      </Badge>
    ) : (
      <Badge className="gap-1 border-0 bg-zinc-800 text-zinc-400 hover:bg-zinc-800">
        <HelpCircle className="h-3 w-3" /> {t(lang, "stats.na")}
      </Badge>
    );

  const accBadge = (accPct: number, accNote: string) => (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold ${
        accPct >= 70 ? "bg-teal-950 text-teal-300" : accPct >= 40 ? "bg-amber-950 text-amber-300" : "bg-rose-950 text-rose-300"
      }`}
      title={accNote}
    >
      {t(lang, "stats.acc")} ≈ {accPct.toFixed(0)}%
    </span>
  );

  const SectionCard = ({ s }: { s: StatSection }) => (
    <Card className="border-zinc-800 bg-zinc-900/60">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-2">
        <CardTitle className="text-sm font-semibold text-zinc-100">
          {t(lang, `stats.section.${s.key}`)}
        </CardTitle>
        <div className="flex items-center gap-1.5">
          {accBadge(s.accPct, s.accNote)}
          {stateBadge(s.state)}
        </div>
      </CardHeader>
      <CardContent className="space-y-2.5 pt-0">
        <div className="grid gap-1.5 sm:grid-cols-2">
          {s.metrics.map((m, i) => (
            <div key={i} className="min-w-0 rounded-md border border-zinc-800/80 bg-zinc-950/50 px-2.5 py-1.5">
              <p className="truncate text-[10px] uppercase tracking-wide text-zinc-500">{m.k}</p>
              <p className="truncate font-mono text-[13px] font-semibold text-zinc-100">{m.v}</p>
              {m.sub && <p className="truncate text-[10px] text-zinc-500">{m.sub}</p>}
            </div>
          ))}
        </div>
        <div className="space-y-1.5 rounded-md border border-zinc-800 bg-zinc-950/40 p-2.5">
          <p className="text-[11px] leading-relaxed text-zinc-400">
            <span className="font-semibold text-zinc-300">📌 {t(lang, "stats.basis")}: </span>
            {t(lang, `stats.basis.${s.key}`)}
          </p>
          <p className="text-[11px] leading-relaxed text-zinc-400">
            <span className="font-semibold text-zinc-300">⚖️ {t(lang, "stats.consist")}: </span>
            <span className={s.state === "warn" ? "text-amber-300" : ""}>{s.note}</span>
          </p>
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-200">
      <div className="mx-auto max-w-6xl space-y-4 p-3 sm:p-5">
        <header className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" className="h-8 gap-1.5 border-zinc-700 px-2.5 text-xs text-zinc-300 hover:bg-zinc-800" asChild>
            <Link href="/">
              <ArrowLeft className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">← Terminal</span>
            </Link>
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="flex items-center gap-2 text-base font-bold text-zinc-100 sm:text-lg">
              <ScrollText className="h-5 w-5 text-teal-400" />
              {t(lang, "stats.title")}
            </h1>
            <p className="truncate text-[11px] text-zinc-500">{t(lang, "stats.sub")}</p>
          </div>
          <Button size="sm" variant="outline" className="h-8 border-zinc-700 px-2.5 text-xs text-zinc-300 hover:bg-zinc-800" onClick={switchLang}>
            {lang === "vi" ? "EN" : "VI"}
          </Button>
          <Button size="sm" className="h-8 gap-1.5 bg-zinc-100 px-2.5 text-xs text-zinc-900 hover:bg-zinc-200" disabled={loading} onClick={() => void load()}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            <span className="hidden sm:inline">{t(lang, "stats.refresh")}</span>
          </Button>
        </header>

        <p className="text-[10px] text-zinc-600">
          {at > 0 && (
            <>
              {t(lang, "stats.updated")}: {new Date(at).toLocaleTimeString(lang === "vi" ? "vi-VN" : "en-GB")} ·{" "}
            </>
          )}
          {t(lang, "stats.summary", counts)}
          {" · "}
          <Link href="/ai" className="underline decoration-dotted hover:text-zinc-400">
            /ai → Root-cause dive (LLM)
          </Link>
        </p>

        {err && !snap && (
          <Card className="border-rose-900 bg-rose-950/30">
            <CardContent className="flex items-center gap-2 p-4 text-sm text-rose-300">
              <TriangleAlert className="h-4 w-4" /> {err}
            </CardContent>
          </Card>
        )}

        {!snap && !err && (
          <div className="grid gap-3 md:grid-cols-2">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-40 rounded-lg border border-zinc-800 bg-zinc-900" />
            ))}
          </div>
        )}

        {snap && (
          <>
            <div className="grid gap-3 md:grid-cols-2">
              {snap.sections.map((s) => (
                <SectionCard key={s.key} s={s} />
              ))}
            </div>

            {/* combo picker cho 2 section client-side */}
            <Card className="border-zinc-800 bg-zinc-900/60">
              <CardContent className="flex flex-wrap items-center gap-2 py-3">
                <span className="text-[11px] font-medium text-zinc-400">{t(lang, "stats.pick")}:</span>
                <select
                  value={pickSym}
                  onChange={(e) => setPickSym(e.target.value)}
                  className="h-7 rounded-md border border-zinc-700 bg-zinc-950 px-2 font-mono text-xs text-zinc-200"
                >
                  <option value={PICK_ALL}>{t(lang, "stats.pick.all")}</option>
                  {PICK_SYMBOLS.map((s) => (
                    <option key={s} value={s}>
                      {s.replace("USDT", "")}
                    </option>
                  ))}
                </select>
                {PICK_TFS.map((tf) => (
                  <Button
                    key={tf}
                    size="sm"
                    variant="outline"
                    className={`h-7 px-2 font-mono text-xs ${
                      pickTf === tf ? "border-zinc-500 bg-zinc-800 text-zinc-100" : "border-zinc-800 text-zinc-400 hover:bg-zinc-800"
                    }`}
                    onClick={() => setPickTf(tf)}
                  >
                    {tf}
                  </Button>
                ))}
                {clientBusy && <RefreshCw className="h-3.5 w-3.5 animate-spin text-zinc-500" />}
              </CardContent>
            </Card>

            {/* ── Trade journal — tính Ở SERVER (/api/view | /api/journal) ── */}
            <Card className="border-zinc-800 bg-zinc-900/60">
              <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-2">
                <CardTitle className="text-sm font-semibold text-zinc-100">
                  {t(lang, "stats.section.journal")} ·{" "}
                  {pickSym === PICK_ALL ? t(lang, "stats.pick.all") : pickSym.replace("USDT", "")} {pickTf}
                </CardTitle>
                {journal && accBadge(journal.closed > 0 ? journal.winRate : 0, `${journal.closed} closed`)}
              </CardHeader>
              <CardContent className="space-y-2.5 pt-0">
                {journal ? (
                  <div className="grid gap-1.5 sm:grid-cols-2">
                    <Metric k={t(lang, "stats.j.trades")} v={String(journal.total)} sub={`${journal.closed} closed · ${journal.open} open`} />
                    <Metric k="Win rate" v={`${journal.winRate.toFixed(0)}%`} sub={`${journal.wins} wins / ${journal.losses} losses`} />
                    <Metric k="TP / SL" v={`${journal.tpCount} / ${journal.slCount}`} />
                    <Metric k={t(lang, "stats.j.flips")} v={String(journal.flipCount)} sub={`net ${fmtPct(journal.flipNetPnl)}`} />
                    <Metric k={t(lang, "stats.j.net")} v={fmtPct(journal.netPnl)} />
                    <Metric k="UT-Bot signals" v={journal.basis} />
                  </div>
                ) : (
                  <p className="text-xs text-zinc-500">— {clientBusy ? "…" : "failed to load candles"}</p>
                )}

                {/* bảng con theo cặp — chỉ khi chọn “Tất cả cặp” */}
                {journalPer && journalPer.per.length > 0 && (
                  <div className="space-y-1.5 rounded-md border border-zinc-800 bg-zinc-950/40 p-2.5">
                    <p className="text-[11px] font-semibold text-zinc-300">{t(lang, "stats.journal.per")}</p>
                    <div className="overflow-x-auto">
                      <table className="w-full border-collapse text-left font-mono text-[11px]">
                        <thead>
                          <tr className="text-[10px] uppercase tracking-wide text-zinc-500">
                            <th className="py-1 pr-2 font-medium">{t(lang, "stats.journal.perPair")}</th>
                            <th className="py-1 pr-2 text-right font-medium">{t(lang, "stats.journal.perClosed")}</th>
                            <th className="py-1 pr-2 text-right font-medium">{t(lang, "stats.journal.perWr")}</th>
                            <th className="py-1 text-right font-medium">{t(lang, "stats.journal.perNet")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {journalPer.per.map((p) => (
                            <tr key={p.symbol} className="border-t border-zinc-800/70">
                              <td className="py-1 pr-2 text-zinc-200">{p.symbol.replace("USDT", "")}</td>
                              <td className="py-1 pr-2 text-right text-zinc-400">{p.kpi.closed}</td>
                              <td className={`py-1 pr-2 text-right ${p.kpi.closed > 0 && p.kpi.winRate >= 50 ? "text-emerald-400" : "text-zinc-400"}`}>
                                {p.kpi.closed > 0 ? `${p.kpi.winRate.toFixed(0)}%` : "—"}
                              </td>
                              <td className={`py-1 text-right ${p.kpi.netPnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                                {fmtPct(p.kpi.netPnl)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p className="text-[10px] text-zinc-500">{t(lang, "stats.journal.perNote")}</p>
                    {journalPer.failed.length > 0 && (
                      <p className="text-[10px] text-amber-300/80">
                        {t(lang, "stats.journal.failed", { pairs: journalPer.failed.join(", ") })}
                      </p>
                    )}
                  </div>
                )}

                <div className="space-y-1.5 rounded-md border border-zinc-800 bg-zinc-950/40 p-2.5">
                  <p className="text-[11px] leading-relaxed text-zinc-400">
                    <span className="font-semibold text-zinc-300">📌 {t(lang, "stats.basis")}: </span>
                    {t(lang, "stats.basis.journal")}
                  </p>
                  <p className="text-[11px] leading-relaxed text-amber-300/80">⚠️ {t(lang, "stats.journalNote")}</p>
                </div>
              </CardContent>
            </Card>

            {/* ── Deep analysis — tính Ở SERVER, theo từng cặp ───────────── */}
            <Card className="border-zinc-800 bg-zinc-900/60">
              <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-2">
                <CardTitle className="flex items-center gap-1.5 text-sm font-semibold text-zinc-100">
                  <Search className="h-4 w-4 text-teal-400" />
                  {t(lang, "stats.section.analysis")} ·{" "}
                  {pickSym === PICK_ALL ? t(lang, "stats.pick.all") : pickSym.replace("USDT", "")} {pickTf}
                </CardTitle>
                {analysis && accBadge(100, "descriptive metrics from closed candles — 100% formula-true")}
              </CardHeader>
              <CardContent className="space-y-2.5 pt-0">
                {pickSym === PICK_ALL ? (
                  <p className="text-xs leading-relaxed text-zinc-500">— {t(lang, "stats.analysisAll")}</p>
                ) : analysis ? (
                  <div className="grid gap-1.5 sm:grid-cols-2">
                    <Metric k="Trend (EMA50/200)" v={analysis.trend} sub={analysis.ema50 != null ? `EMA50 ${fmtPrice(analysis.ema50)}` : undefined} />
                    <Metric k="RSI(14)" v={analysis.rsi14 != null ? analysis.rsi14.toFixed(1) : "—"} />
                    <Metric k="Volume vs TB20" v={analysis.volRatio != null ? `${analysis.volRatio.toFixed(2)}×` : "—"} />
                    <Metric k="ATR% (vs TB50)" v={analysis.atrPct != null ? `${analysis.atrPct.toFixed(2)}%` : "—"} sub={analysis.atrRel != null ? `${analysis.atrRel.toFixed(2)}× average` : undefined} />
                    <Metric k="Structure" v={analysis.structure ?? "—"} sub={analysis.rangePos != null ? `range position ${analysis.rangePos.toFixed(0)}%` : undefined} />
                    <Metric k="Swing range" v={analysis.rangeLow != null && analysis.rangeHigh != null ? `${fmtPrice(analysis.rangeLow)} – ${fmtPrice(analysis.rangeHigh)}` : "—"} />
                  </div>
                ) : (
                  <p className="text-xs text-zinc-500">— {clientBusy ? "…" : "failed to load candles"}</p>
                )}
                <div className="space-y-1.5 rounded-md border border-zinc-800 bg-zinc-950/40 p-2.5">
                  <p className="text-[11px] leading-relaxed text-zinc-400">
                    <span className="font-semibold text-zinc-300">📌 {t(lang, "stats.basis")}: </span>
                    {t(lang, "stats.basis.analysis")}
                  </p>
                  <p className="text-[11px] leading-relaxed text-zinc-400">
                    <span className="font-semibold text-zinc-300">⚖️ {t(lang, "stats.consist")}: </span>
                    <FlaskConical className="mr-1 inline h-3 w-3" />
                    {lang === "vi"
                      ? "Same analyze() used on the main Deep analysis panel — identical candle source and formulas."
                      : "The same analyze() powering the main page's Deep analysis panel — consistent by construction (same candles, same formulas)."}
                  </p>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

function Metric({ k, v, sub }: { k: string; v: string; sub?: string }) {
  return (
    <div className="min-w-0 rounded-md border border-zinc-800/80 bg-zinc-950/50 px-2.5 py-1.5">
      <p className="truncate text-[10px] uppercase tracking-wide text-zinc-500">{k}</p>
      <p className="truncate font-mono text-[13px] font-semibold text-zinc-100">{v}</p>
      {sub && <p className="truncate text-[10px] text-zinc-500">{sub}</p>}
    </div>
  );
}
