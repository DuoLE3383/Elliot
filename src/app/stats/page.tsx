"use client";

// ─── /stats — Thống kê & đối chiếu logic ─────────────────────────────────────
// Trả lời 3 câu hỏi cho MỖI phần của app (market model, win rate pair/TF,
// universe scan, auto dry-run, signal dock, lệnh đang mở, auto history,
// suggestion history, trade journal, deep analysis):
//   1. CƠ SỞ LOGIC — số liệu được đưa ra từ nguồn nào, công thức nào
//      (i18n stats.basis.* — khớp chữ với code thật).
//   2. NHẤT QUÁN với logic engine chưa — kiểm chéo chạy THẬT trên server
//      (hai đường tính độc lập, chấm lại outcome từ giá, đối chiếu sổ vốn…).
//   3. CHUẨN XÁC bao nhiêu % — Wilson 95% cận dưới cho tỉ lệ (độ tin cậy của
//      con số), 100% cho số đếm/mô tả; note nói rõ vì sao.
// 0.2.68 — trang có BIỂU ĐỒ (SVG tự vẽ, stat-charts.tsx), MỖI SECTION MỘT MÀU
// accent theo luồng (market→model→scan→trade→history) + FLOW CHIPS cho biết
// section nối vào giai đoạn nào, và MỌI FIELD/BIỂU ĐỒ có tooltip hover (hint
// EN + VI do server gắn) giải thích công thức/nguồn số liệu.

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ChartBox } from "@/components/stat-charts";
import { fmtPct, fmtPrice, t, type Lang } from "@/lib/i18n";
import type { Analysis } from "@/lib/analysis";
import type { KpiStats } from "@/lib/papers";
// 0.2.67 — chỉ import TYPE (erased lúc build) nên bundle trình duyệt không kéo
// db/engine của stats.ts vào; màu do SERVER gắn qua field tone, client chỉ tô.
import type { StatAccent, StatChart, StatTone } from "@/lib/stats";
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
interface StatMetric { k: string; v: string; sub?: string; wide?: boolean; tone?: StatTone; hint?: string; hintVi?: string }
interface StatSection {
  key: string;
  state: "ok" | "warn" | "na";
  note: string;
  accPct: number;
  accNote: string;
  metrics: StatMetric[];
  accent?: StatAccent;
  charts?: StatChart[];
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

// 0.2.67 — màu ngữ nghĩa cho MỌI field: server gắn tone theo ngưỡng thật,
// client chỉ tra bảng — không tự suy từ chữ nên không bao giờ lệch màu.
//   ok = xanh lá (tốt) · warn = vàng (cần chú ý) · bad = đỏ (xấu)
//   info = teal (mô tả/số liệu live) · dim = xám (không dữ liệu/chân trang)
const TONE_TEXT: Record<StatTone, string> = {
  ok: "text-emerald-400",
  warn: "text-amber-300",
  bad: "text-rose-400",
  info: "text-teal-300",
  dim: "text-zinc-400",
};
/** viền trái ô field cùng màu với giá trị — nhìn lướt là biết tình trạng */
const TONE_EDGE: Record<StatTone, string> = {
  ok: "border-l-emerald-500/60",
  warn: "border-l-amber-500/60",
  bad: "border-l-rose-500/60",
  info: "border-l-teal-500/60",
  dim: "border-l-zinc-600/50",
};
const toneText = (tone?: StatTone): string => (tone ? TONE_TEXT[tone] : "text-zinc-100");
const toneEdge = (tone?: StatTone): string => (tone ? TONE_EDGE[tone] : "border-l-zinc-800/80");

// 0.2.68 — MÀU NHẬN DIỆN SECTION theo luồng xử lý. Các section nối nhau trong
// pipeline chia sẻ cùng họ màu để "phân biệt các chức năng kết nối nhau":
//   market(cyan) → universe(sky) → combo(violet) → dock(amber) → auto(emerald)
//   → open(rose) → hist(orange) / sg(indigo) · journal(fuchsia) · analysis(blue)
const ACCENT: Record<StatAccent, { edge: string; text: string; dot: string }> = {
  cyan: { edge: "border-t-cyan-500/70", text: "text-cyan-300", dot: "bg-cyan-400" },
  sky: { edge: "border-t-sky-500/70", text: "text-sky-300", dot: "bg-sky-400" },
  violet: { edge: "border-t-violet-500/70", text: "text-violet-300", dot: "bg-violet-400" },
  emerald: { edge: "border-t-emerald-500/70", text: "text-emerald-300", dot: "bg-emerald-400" },
  amber: { edge: "border-t-amber-500/70", text: "text-amber-300", dot: "bg-amber-400" },
  rose: { edge: "border-t-rose-500/70", text: "text-rose-300", dot: "bg-rose-400" },
  orange: { edge: "border-t-orange-500/70", text: "text-orange-300", dot: "bg-orange-400" },
  indigo: { edge: "border-t-indigo-500/70", text: "text-indigo-300", dot: "bg-indigo-400" },
  fuchsia: { edge: "border-t-fuchsia-500/70", text: "text-fuchsia-300", dot: "bg-fuchsia-400" },
  blue: { edge: "border-t-blue-500/70", text: "text-blue-300", dot: "bg-blue-400" },
};

// 0.2.68 — FLOW CHIPS: mỗi section thuộc những giai đoạn nào của pipeline
// (thị trường → model → scan → lệnh → lịch sử) — chip của chính section được
// tô đậm, còn lại mờ; nhìn hàng chip là thấy "section này nối vào đâu".
const STAGES = ["market", "model", "scan", "trade", "history"] as const;
const FLOW: Record<string, readonly string[]> = {
  market: ["market", "model", "scan", "trade"],
  universe: ["market", "model", "scan", "trade"],
  combo: ["market", "model", "scan", "trade"],
  auto: ["model", "scan", "trade", "history"],
  dock: ["model", "scan", "trade"],
  open: ["scan", "trade", "history"],
  hist: ["trade", "history"],
  sg: ["model", "scan", "history"],
  journal: ["trade", "history"],
  analysis: ["market", "model"],
};
const STAGE_CHIP: Record<(typeof STAGES)[number], string> = {
  market: "bg-cyan-950 text-cyan-300",
  model: "bg-violet-950 text-violet-300",
  scan: "bg-amber-950 text-amber-300",
  trade: "bg-emerald-950 text-emerald-300",
  history: "bg-orange-950 text-orange-300",
};

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
/** 0.2.52 — response 1 cặp của /api/journal (chỉ cần kpi + basis) */
type JournalOneResp = { kpi: KpiStats; basis: number };

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
    // English is the app's main language (0.2.58): boot EN every visit — the
    // VI/EN toggle still works for the current session only.
    setLang("en");
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

  // 2 section client-side — 0.2.35: tính Ở SERVER (setting MẶC ĐỊNH)
  // 0.2.38: pickSym = ALL → journal gộp 11 cặp qua /api/journal (phân tích sâu ẩn)
  // 0.2.52: journal 1 cặp CŨNG qua /api/journal — cùng cửa sổ 200 nến với ALL
  // (fetchView chỉ còn phục vụ thẻ phân tích sâu — cửa sổ 500 nến của engine)
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
      // song song: journal 200 nến (/api/journal) + phân tích sâu 500 nến (/api/view)
      const jReq = fetch(
        `/api/journal?interval=${encodeURIComponent(pickTf)}&symbol=${encodeURIComponent(pickSym)}`,
        { cache: "no-store" },
      )
        .then(async (res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return (await res.json()) as JournalOneResp;
        })
        .catch(() => null);
      const [j, v] = await Promise.all([jReq, fetchView({
        symbol: pickSym,
        interval: pickTf,
        s: DEFAULT_SETTINGS,
        w: DEFAULT_WYCKOFF,
        pairs: [],
      })]);
      if (!alive) return;
      setJournal(j ? { ...j.kpi, basis: String(j.basis) } : null);
      setAnalysis(v ? v.analysis : null);
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

  /** hàng flow chips — chip của chính section tô đậm màu giai đoạn, còn lại mờ */
  const flowChips = (key: string) => {
    const mine = FLOW[key];
    if (!mine) return null;
    return (
      <div className="mt-1 flex flex-wrap items-center gap-0.5">
        {STAGES.map((st, idx) => {
          const on = mine.includes(st);
          return (
            <span key={st} className="inline-flex items-center">
              {idx > 0 && <span className="mx-0.5 text-[8px] text-zinc-600">→</span>}
              <span
                className={`rounded px-1 py-px text-[8px] font-semibold uppercase tracking-wide ${
                  on ? STAGE_CHIP[st] : "border border-zinc-800 text-zinc-600"
                }`}
              >
                {t(lang, `stats.flow.${st}`)}
              </span>
            </span>
          );
        })}
      </div>
    );
  };

  const SectionCard = ({ s }: { s: StatSection }) => {
    const acc = s.accent ? ACCENT[s.accent] : null;
    return (
      <Card className={`border-t-2 border-zinc-800 bg-zinc-900/60 ${acc ? acc.edge : "border-t-zinc-700"}`}>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 pb-2">
          <div className="min-w-0">
            <CardTitle className={`flex items-center gap-1.5 text-sm font-semibold ${acc ? acc.text : "text-zinc-100"}`}>
              <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${acc ? acc.dot : "bg-zinc-500"}`} />
              {t(lang, `stats.section.${s.key}`)}
            </CardTitle>
            {flowChips(s.key)}
          </div>
          <div className="flex items-center gap-1.5">
            {accBadge(s.accPct, s.accNote)}
            {stateBadge(s.state)}
          </div>
        </CardHeader>
        <CardContent className="space-y-2.5 pt-0">
          <div className="grid gap-1.5 sm:grid-cols-2">
            {s.metrics.map((m, i) => (
              <Field key={i} m={m} lang={lang} />
            ))}
          </div>
          {s.charts?.map((c, i) => (
            <ChartBox key={i} chart={c} lang={lang} />
          ))}
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
  };

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
          <span className="text-zinc-500">🖱️ {t(lang, "stats.hoverHint")}</span>
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

            {/* ── Trade journal — tính Ở SERVER, luôn qua /api/journal (200 nến, 0.2.52) ── */}
            <Card className="border-t-2 border-fuchsia-500/70 border-zinc-800 bg-zinc-900/60">
              <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-2">
                <div className="min-w-0">
                  <CardTitle className="flex items-center gap-1.5 text-sm font-semibold text-fuchsia-300">
                    <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-fuchsia-400" />
                    {t(lang, "stats.section.journal")} ·{" "}
                    {pickSym === PICK_ALL ? t(lang, "stats.pick.all") : pickSym.replace("USDT", "")} {pickTf}
                  </CardTitle>
                  {flowChips("journal")}
                </div>
                {journal && accBadge(journal.closed > 0 ? journal.winRate : 0, `${journal.closed} closed`)}
              </CardHeader>
              <CardContent className="space-y-2.5 pt-0">
                {journal ? (
                  <div className="grid gap-1.5 sm:grid-cols-2">
                    <Metric
                      lang={lang}
                      k={t(lang, "stats.j.trades")}
                      v={String(journal.total)}
                      sub={`${journal.closed} closed · ${journal.open} open`}
                      tone="info"
                      hint="UT-Bot signals inside the 200-candle journal window; sub = how many produced closed vs still-open paper trades."
                      hintVi="Tín hiệu UT-Bot trong cửa sổ 200 nến; dòng dưới = số đã đóng và số chưa chốt."
                    />
                    <Metric
                      lang={lang}
                      k="Win rate"
                      v={`${journal.winRate.toFixed(0)}%`}
                      sub={`${journal.wins} wins / ${journal.losses} losses`}
                      tone={journal.closed === 0 ? "dim" : journal.winRate >= 50 ? "ok" : journal.winRate >= 40 ? "warn" : "bad"}
                      hint="Wins ÷ closed trades inside the window. Tint: ≥50% green, 40–49% amber, <40% red."
                      hintVi="Thắng ÷ số lệnh đóng trong cửa sổ. Màu: ≥50% xanh, 40–49% vàng, <40% đỏ."
                    />
                    <Metric
                      lang={lang}
                      k="TP / SL"
                      v={`${journal.tpCount} / ${journal.slCount}`}
                      tone={journal.tpCount > journal.slCount ? "ok" : journal.tpCount < journal.slCount ? "bad" : "info"}
                      hint="TP hits vs SL hits among closed trades in the window — the raw exit mix."
                      hintVi="Số lệnh chạm TP so với chạm SL trong cửa sổ — cơ cấu kết thúc thô."
                    />
                    <Metric
                      lang={lang}
                      k={t(lang, "stats.j.flips")}
                      v={String(journal.flipCount)}
                      sub={`net ${fmtPct(journal.flipNetPnl)}`}
                      tone="info"
                      hint="Flip closes (engine reversed the side mid-trade); sub = their net PnL contribution."
                      hintVi="Lệnh đóng flip (engine đảo giữa chừng); dòng dưới = PnL ròng chúng đóng góp."
                    />
                    <Metric
                      lang={lang}
                      k={t(lang, "stats.j.net")}
                      v={fmtPct(journal.netPnl)}
                      tone={journal.netPnl > 0 ? "ok" : journal.netPnl < 0 ? "bad" : "dim"}
                      hint="Net ROE sum over closed trades in the window (leverage-inclusive, not compounded)."
                      hintVi="Tổng ROE ròng các lệnh đã đóng trong cửa sổ (đã gồm đòn bẩy, chưa compounding)."
                    />
                    <Metric
                      lang={lang}
                      k="UT-Bot signals"
                      v={journal.basis}
                      tone="info"
                      hint="Raw signal count the journal was computed from — the base for every number above."
                      hintVi="Số tín hiệu UT-Bot dùng để tính sổ — gốc của mọi số phía trên."
                    />
                  </div>
                ) : (
                  <p className="text-xs text-zinc-500">— {clientBusy ? "…" : "failed to load candles"}</p>
                )}

                {journal && (
                  <ChartBox
                    lang={lang}
                    chart={{
                      kind: "stack",
                      items: [
                        { label: "TP", n: journal.tpCount },
                        { label: "SL", n: journal.slCount },
                        { label: "flip", n: journal.flipCount },
                      ],
                      hint: "Exit mix inside the journal window: TP (green) vs SL (red) vs flip closes (amber).",
                      hintVi: "Cơ cấu kết thúc trong cửa sổ sổ lệnh: TP (xanh) vs SL (đỏ) vs đóng flip (vàng).",
                    }}
                  />
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
            <Card className="border-t-2 border-blue-500/70 border-zinc-800 bg-zinc-900/60">
              <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-2">
                <div className="min-w-0">
                  <CardTitle className="flex items-center gap-1.5 text-sm font-semibold text-blue-300">
                    <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-blue-400" />
                    <Search className="h-4 w-4" />
                    {t(lang, "stats.section.analysis")} ·{" "}
                    {pickSym === PICK_ALL ? t(lang, "stats.pick.all") : pickSym.replace("USDT", "")} {pickTf}
                  </CardTitle>
                  {flowChips("analysis")}
                </div>
                {analysis && accBadge(100, "descriptive metrics from closed candles — 100% formula-true")}
              </CardHeader>
              <CardContent className="space-y-2.5 pt-0">
                {pickSym === PICK_ALL ? (
                  <p className="text-xs leading-relaxed text-zinc-500">— {t(lang, "stats.analysisAll")}</p>
                ) : analysis ? (
                  <div className="grid gap-1.5 sm:grid-cols-2">
                    <Metric
                      lang={lang}
                      k="Trend (EMA50/200)"
                      v={analysis.trend}
                      sub={analysis.ema50 != null ? `EMA50 ${fmtPrice(analysis.ema50)}` : undefined}
                      tone={analysis.trend === "up" ? "ok" : analysis.trend === "down" ? "bad" : "dim"}
                      hint="EMA stack of the last closed candle: up = close > EMA50 > EMA200 (green), down = close < EMA50 < EMA200 (red)."
                      hintVi="Ngăn xếp EMA của nến đóng cuối: up = giá > EMA50 > EMA200 (xanh), down = giá < EMA50 < EMA200 (đỏ)."
                    />
                    <Metric
                      lang={lang}
                      k="RSI(14)"
                      v={analysis.rsi14 != null ? analysis.rsi14.toFixed(1) : "—"}
                      tone={analysis.rsi14 == null ? "dim" : analysis.rsi14 > 70 || analysis.rsi14 < 30 ? "warn" : "info"}
                      hint="Wilder RSI(14) on closed candles; >70 overbought, <30 oversold — either extreme shows amber."
                      hintVi="RSI(14) Wilder trên nến đóng; >70 quá mua, <30 quá bán — đạt cực trị nào cũng hiện vàng."
                    />
                    <Metric
                      lang={lang}
                      k="Volume vs TB20"
                      v={analysis.volRatio != null ? `${analysis.volRatio.toFixed(2)}×` : "—"}
                      tone={analysis.volRatio == null ? "dim" : analysis.volRatio > 2 ? "warn" : "info"}
                      hint="Last closed candle volume ÷ mean volume of the prior 20 closed candles; >2× = unusual activity (amber)."
                      hintVi="Volume nến đóng cuối ÷ volume TB 20 nến đóng trước; >2× = bất thường (vàng)."
                    />
                    <Metric
                      lang={lang}
                      k="ATR% (vs TB50)"
                      v={analysis.atrPct != null ? `${analysis.atrPct.toFixed(2)}%` : "—"}
                      sub={analysis.atrRel != null ? `${analysis.atrRel.toFixed(2)}× average` : undefined}
                      tone={analysis.atrPct == null ? "dim" : analysis.atrPct > 3 ? "warn" : "info"}
                      hint="ATR(14) as % of price — volatility. >3% = hot market (amber); sub = vs the 50-bar ATR% mean (>1 = stretched)."
                      hintVi="ATR(14) theo % giá — độ biến động. >3% = thị trường nóng (vàng); dòng dưới = so với TB 50 nến (>1 = đang căng)."
                    />
                    <Metric
                      lang={lang}
                      k="Structure"
                      v={analysis.structure ?? "—"}
                      sub={analysis.rangePos != null ? `range position ${analysis.rangePos.toFixed(0)}%` : undefined}
                      tone={analysis.structure === "breakout" ? "ok" : analysis.structure === "breakdown" ? "bad" : "info"}
                      hint="Position vs the pivot-5 swing range: breakout above the range (green), breakdown below (red), inside (teal). <0% or >100% = a fresh break."
                      hintVi="Vị trí so với vùng swing pivot-5: breakout vượt đỉnh (xanh), breakdown thủng đáy (đỏ), trong vùng (teal). <0% hoặc >100% = vừa thủng."
                    />
                    <Metric
                      lang={lang}
                      k="Swing range"
                      v={analysis.rangeLow != null && analysis.rangeHigh != null ? `${fmtPrice(analysis.rangeLow)} – ${fmtPrice(analysis.rangeHigh)}` : "—"}
                      tone="info"
                      hint="The most recent confirmed swing low → high (5 bars each side) — the range Structure is measured against."
                      hintVi="Đáy → đỉnh swing gần nhất đã xác nhận (5 nến mỗi bên) — vùng mà Structure đối chiếu."
                    />
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

/** ô field có tooltip — hiện bằng REACT STATE (mouseenter/mouseleave + tap để
 *  hỗ trợ cả cảm ứng), không dùng CSS :hover vì Tailwind 4 bọc group-hover
 *  trong @media (hover:hover) — variant bị tắt trên touch/headless. */
function Field({ m, lang }: { m: StatMetric; lang: Lang }) {
  const [show, setShow] = useState(false);
  const hint = lang === "vi" ? m.hintVi ?? m.hint : m.hint;
  return (
    <div
      className={`relative min-w-0 rounded-md border border-l-2 border-zinc-800/80 bg-zinc-950/50 px-2.5 py-1.5 ${m.wide ? "sm:col-span-2" : ""} ${toneEdge(m.tone)}`}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      onClick={() => setShow((v) => !v)} // cảm ứng: bấm bật/tắt hint
    >
      <p className="truncate text-[10px] uppercase tracking-wide text-zinc-500">{m.k}</p>
      <p className={`font-mono text-[13px] font-semibold ${toneText(m.tone)} ${m.wide ? "" : "truncate"}`}>{m.v}</p>
      {m.sub && <p className={`text-[10px] text-zinc-500 ${m.wide ? "" : "truncate"}`}>{m.sub}</p>}
      {hint && show && (
        <div className="pointer-events-none absolute bottom-full left-0 z-50 mb-1 w-64 rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-[10px] leading-snug text-zinc-300 shadow-xl">
          {hint}
        </div>
      )}
    </div>
  );
}

/** Metric cho 2 section client-side (journal + analysis) — wrapper của Field */
function Metric({
  lang,
  k,
  v,
  sub,
  tone,
  hint,
  hintVi,
}: {
  lang: Lang;
  k: string;
  v: string;
  sub?: string;
  tone?: StatTone;
  hint?: string;
  hintVi?: string;
}) {
  return <Field m={{ k, v, sub, tone, hint, hintVi }} lang={lang} />;
}
