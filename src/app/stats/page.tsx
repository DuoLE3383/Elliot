"use client";

// ─── /stats — Thống kê & đối chiếu logic ─────────────────────────────────────
// Trả lời 3 câu hỏi cho MỖI phần của app (sessions, win rate pair/TF, universe
// scan, auto dry-run, signal dock, lệnh đang mở, auto history, suggestion
// history, trade journal, deep analysis):
//   1. CƠ SỞ LOGIC — số liệu được đưa ra từ nguồn nào, công thức nào
//      (i18n stats.basis.* — khớp chữ với code thật).
//   2. NHẤT QUAN với logic engine chưa — kiểm chéo chạy THẬT trên server
//      (hai đường tính độc lập, chấm lại outcome từ giá, đối chiếu sổ vốn…).
//   3. CHUẨN XÁC bao nhiêu % — Wilson 95% cận dưới cho tỉ lệ (độ tin cậy của
//      con số), 100% cho số đếm/mô tả; note nói rõ vì sao.
// Hai section cuối (journal + analysis) tính ngay trong trình duyệt bằng đúng
// hàm papersFrom/analyze của app trên nến /api/klines cho combo người dùng
// chọn — "sổ giấy" không persist server-side nên phải tính client-side.
// Từ đó nút "Vạch lá tìm sâu" trên /ai bắn CÙNG snapshot server vào LLM.

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { fmtPct, fmtPrice, t, type Lang } from "@/lib/i18n";
import { analyze, type Analysis } from "@/lib/analysis";
import { signalsFrom } from "@/lib/signals";
import { kpiFrom, papersFrom, type KpiStats } from "@/lib/papers";
import { DEFAULT_SETTINGS, type Kline } from "@/lib/types";
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
const PICK_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "LINKUSDT", "DOGEUSDT"];

export default function StatsPage() {
  const [lang, setLang] = useState<Lang>("vi");
  const [snap, setSnap] = useState<StatsSnapshot | null>(null);
  const [at, setAt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  // combo picker cho 2 section client-side
  const [pickSym, setPickSym] = useState("BTCUSDT");
  const [pickTf, setPickTf] = useState("15m");
  const [journal, setJournal] = useState<(KpiStats & { basis: string }) | null>(null);
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

  // 2 section client-side — nến thật + đúng hàm của app, setting MẶC ĐỊNH
  useEffect(() => {
    let alive = true;
    setClientBusy(true);
    (async () => {
      try {
        const res = await fetch(`/api/klines?symbol=${encodeURIComponent(pickSym)}&interval=${pickTf}&limit=500`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const { klines } = (await res.json()) as { klines: Kline[] };
        if (!alive) return;
        const s = DEFAULT_SETTINGS;
        const { signals, sma } = signalsFrom(klines, s.atrKey, s.atrPeriod, s.smaPeriod);
        const papers = papersFrom(klines, signals, sma, pickSym, pickTf, s.slPct, s.tpPct, s.leverage, s.smaFilter);
        setJournal({ ...kpiFrom(papers.papers), basis: `${signals.length}` });
        setAnalysis(analyze(klines));
      } catch {
        if (alive) {
          setJournal(null);
          setAnalysis(null);
        }
      } finally {
        if (alive) setClientBusy(false);
      }
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
            /ai → Vạch lá tìm sâu (LLM)
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

            {/* ── Trade journal — client-side papersFrom ─────────────────── */}
            <Card className="border-zinc-800 bg-zinc-900/60">
              <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-2">
                <CardTitle className="text-sm font-semibold text-zinc-100">
                  {t(lang, "stats.section.journal")} · {pickSym.replace("USDT", "")} {pickTf}
                </CardTitle>
                {journal && accBadge(journal.closed > 0 ? journal.winRate : 0, `${journal.closed} lệnh đã đóng`)}
              </CardHeader>
              <CardContent className="space-y-2.5 pt-0">
                {journal ? (
                  <div className="grid gap-1.5 sm:grid-cols-2">
                    <Metric k="Lệnh (khung 500 nến)" v={String(journal.total)} sub={`${journal.closed} đóng · ${journal.open} mở`} />
                    <Metric k="Win rate" v={`${journal.winRate.toFixed(0)}%`} sub={`${journal.wins} thắng / ${journal.losses} thua`} />
                    <Metric k="TP / SL" v={`${journal.tpCount} / ${journal.slCount}`} />
                    <Metric k="Lật chiều" v={String(journal.flipCount)} sub={`net ${fmtPct(journal.flipNetPnl)}`} />
                    <Metric k="Net ROE cộng" v={fmtPct(journal.netPnlPct)} />
                    <Metric k="Tín hiệu UT-Bot" v={journal.basis} />
                  </div>
                ) : (
                  <p className="text-xs text-zinc-500">— {clientBusy ? "…" : "không tải được nến"}</p>
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

            {/* ── Deep analysis — client-side analyze() ──────────────────── */}
            <Card className="border-zinc-800 bg-zinc-900/60">
              <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-2">
                <CardTitle className="flex items-center gap-1.5 text-sm font-semibold text-zinc-100">
                  <Search className="h-4 w-4 text-teal-400" />
                  {t(lang, "stats.section.analysis")} · {pickSym.replace("USDT", "")} {pickTf}
                </CardTitle>
                {analysis && accBadge(100, "chỉ số mô tả từ nến đã đóng — đúng 100% theo công thức")}
              </CardHeader>
              <CardContent className="space-y-2.5 pt-0">
                {analysis ? (
                  <div className="grid gap-1.5 sm:grid-cols-2">
                    <Metric k="Trend (EMA50/200)" v={analysis.trend} sub={analysis.ema50 != null ? `EMA50 ${fmtPrice(analysis.ema50)}` : undefined} />
                    <Metric k="RSI(14)" v={analysis.rsi14 != null ? analysis.rsi14.toFixed(1) : "—"} />
                    <Metric k="Volume vs TB20" v={analysis.volRatio != null ? `${analysis.volRatio.toFixed(2)}×` : "—"} />
                    <Metric k="ATR% (đối chiếu TB50)" v={analysis.atrPct != null ? `${analysis.atrPct.toFixed(2)}%` : "—"} sub={analysis.atrRel != null ? `${analysis.atrRel.toFixed(2)}× trung bình` : undefined} />
                    <Metric k="Cấu trúc" v={analysis.structure ?? "—"} sub={analysis.rangePos != null ? `vị trí trong vùng ${analysis.rangePos.toFixed(0)}%` : undefined} />
                    <Metric k="Vùng swing" v={analysis.rangeLow != null && analysis.rangeHigh != null ? `${fmtPrice(analysis.rangeLow)} – ${fmtPrice(analysis.rangeHigh)}` : "—"} />
                  </div>
                ) : (
                  <p className="text-xs text-zinc-500">— {clientBusy ? "…" : "không tải được nến"}</p>
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
                      ? "Cùng một hàm analyze() đang vẽ panel Phân tích sâu trên trang chính — nhất quan theo cấu trúc (cùng nguồn nến, cùng công thức)."
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
