"use client";

// ─── /stats — APM CONTROL ROOM (0.3.4, thiết kế lại theo ảnh tham chiếu) ────
// User yêu cầu "thiết kế lại Y NHƯ" ảnh NetGitFinancial (Dribbble — giao diện
// Application Performance Monitoring): shell APM 3 vùng:
//   • TOP BAR — ☰ + brand + pill phải (Dive /ai · EN/VI · Refresh lime)
//   • SIDEBAR TRÁI — điều hướng từng "trạm" (icon + nhãn, active sáng)
//   • CENTER — "Trading Flow Map": sơ đồ phễu Sankey 2 cột node nối bằng
//     dải băng cong DÀY THEO SỐ LƯỢNG, MÀU THEO TÌNH TRẠNG (lime Success /
//     đỏ Error / xám Normal / đỏ đứt Pending) + cột "Net result" bên phải map
//     + tabs đáy (Equity / Win rate / Exits) — y cấu trúc "Application Flow
//     Map + Net result + Load/Response/Errors" của ảnh.
//   • RAIL PHẢI — Events · Gate Health · Engine Health · Session Health ·
//     Trade Scorecard (bar + count) — y cấu trúc Events/Business Transaction
//     Health/Nodes Health/Server Health/Transaction Scorecard của ảnh.
// Bấm node/side bar → CENTER đổi sang trang chi tiết trạm (metrics + charts +
// cơ sở logic + nhất quán + độ tin cậy Wilson — GIỮ NGUYÊN 100% nội dung kiểm
// toán của các bản 0.2.x/0.3.x, chỉ đổi lớp vỏ). DQF giữ công tắc riêng.
// Dữ liệu: /api/stats (snapshot 9 section + khối `flow` số liệu thô 0.3.4) +
// /api/journal + /api/view cho 2 trạm client (journal/lab) — không đổi API.

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ChartBox } from "@/components/stat-charts";
import { ApmFlowMap, type ApmFlowCounts } from "@/components/apm-flow";
import { Journal } from "@/components/journal";
import { DeepAnalysis } from "@/components/analysis";
import { StrategyPies } from "@/components/strategy-pies";
import { StrategyLab } from "@/components/strategy-lab";
import { SuggestionHistory } from "@/components/suggestions";
import { fmtPct, t, type Lang } from "@/lib/i18n";
import { SESSIONS } from "@/lib/market";
import type { VariantRow } from "@/lib/history";
import type { KpiStats } from "@/lib/papers";
import type { Paper } from "@/lib/types";
// 0.2.67 — chỉ import TYPE (erased lúc build) nên bundle trình duyệt không kéo
// db/engine của stats.ts vào; màu do SERVER gắn qua field tone, client chỉ tô.
import type { StatChart, StatTone } from "@/lib/stats";
import { fetchView, type ViewPayload } from "@/lib/view";
import { DEFAULT_SETTINGS, DEFAULT_WYCKOFF, SYMBOLS, type EngineSettings } from "@/lib/types";
import {
  Activity,
  Bot,
  CheckCircle2,
  Crosshair,
  FlaskConical,
  Globe,
  HelpCircle,
  History,
  Layers,
  Lightbulb,
  Menu,
  Percent,
  Radar,
  RefreshCw,
  ScrollText,
  SlidersHorizontal,
  TriangleAlert,
  X,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

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
  charts?: StatChart[];
}
interface StatsSnapshot {
  at: number;
  dqfOn?: boolean;
  flow?: import("@/lib/stats").StatsFlow | null;
  sections: StatSection[];
}

const PICK_TFS = ["5m", "15m", "1h", "4h"];
const PICK_ALL = "ALL";
const PICK_SYMBOLS: readonly string[] = SYMBOLS;

// 0.2.67 — màu ngữ nghĩa cho MỌI field: server gắn tone theo ngưỡng thật,
// client chỉ tra bảng — không tự suy từ chữ nên không bao giờ lệch màu.
const TONE_TEXT: Record<StatTone, string> = {
  ok: "text-emerald-400",
  warn: "text-amber-300",
  bad: "text-rose-400",
  info: "text-teal-300",
  dim: "text-zinc-400",
};
const TONE_EDGE: Record<StatTone, string> = {
  ok: "border-l-emerald-500/60",
  warn: "border-l-amber-500/60",
  bad: "border-l-rose-500/60",
  info: "border-l-teal-500/60",
  dim: "border-l-zinc-600/50",
};
const toneText = (tone?: StatTone): string => (tone ? TONE_TEXT[tone] : "text-zinc-100");
const toneEdge = (tone?: StatTone): string => (tone ? TONE_EDGE[tone] : "border-l-zinc-800/80");

// ── bảng màu APM khớp ảnh tham chiếu ──
const LIME = "#34d399";
const GREY = "#9aa0a6";

/** một dòng bảng con theo cặp của /api/journal?symbol=ALL */
interface PerPair { symbol: string; kpi: KpiStats; signals: number }
interface JournalAllResp { kpi: KpiStats; basis: number; per: PerPair[] | null; failed: string[]; papers: Paper[] }
type JournalOneResp = { kpi: KpiStats; basis: number; papers: Paper[] };

// ─── điều hướng sidebar — 12 trạm (flow = tổng quan, còn lại = chi tiết) ────
const NAV = [
  { id: "flow", key: "apm.nav.flow", icon: Activity },
  { id: "market", key: "apm.nav.market", icon: Globe },
  { id: "universe", key: "apm.nav.universe", icon: Layers },
  { id: "combo", key: "apm.nav.combo", icon: Percent },
  { id: "dock", key: "apm.nav.dock", icon: Radar },
  { id: "auto", key: "apm.nav.auto", icon: Bot },
  { id: "dqf", key: "apm.nav.dqf", icon: SlidersHorizontal },
  { id: "open", key: "apm.nav.open", icon: Crosshair },
  { id: "hist", key: "apm.nav.hist", icon: History },
  { id: "sg", key: "apm.nav.sg", icon: Lightbulb },
  { id: "journal", key: "apm.nav.journal", icon: ScrollText },
  { id: "lab", key: "apm.nav.lab", icon: FlaskConical },
] as const;
type ViewId = (typeof NAV)[number]["id"];

const SESS_NAME: Record<string, string> = {
  sydney: "Sydney", tokyo: "Tokyo", london: "London", newyork: "New York",
};

/** ô field có tooltip — React state (mouseenter + tap), không CSS :hover
 *  (Tailwind 4 bọc group-hover trong @media(hover:hover) — state chạy mọi nơi).
 *  Đặt ở MODULE LEVEL để state tooltip không bị reset khi trang re-render. */
function Field({ m, lang }: { m: StatMetric; lang: Lang }) {
  const [show, setShow] = useState(false);
  const hint = lang === "vi" ? m.hintVi ?? m.hint : m.hint;
  return (
    <div
      className={`relative min-w-0 rounded-lg border border-l-2 border-[#232329] bg-[#0b0b0e] px-2.5 py-1.5 ${m.wide ? "sm:col-span-2" : ""} ${toneEdge(m.tone)}`}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      onClick={() => setShow((v) => !v)}
    >
      <p className="whitespace-normal leading-snug text-[10px] uppercase tracking-wide text-zinc-500">{m.k}</p>
      <p className={`font-mono text-[13px] font-semibold ${toneText(m.tone)} ${m.wide ? "" : "whitespace-normal leading-snug"}`}>{m.v}</p>
      {m.sub && <p className={`text-[10px] text-zinc-500 ${m.wide ? "" : "whitespace-normal leading-snug"}`}>{m.sub}</p>}
      {hint && show && (
        <div className="pointer-events-none absolute bottom-full left-0 z-50 mb-1 w-64 rounded-md border border-[#3a3a42] bg-[#15151a] px-2.5 py-1.5 text-[10px] leading-snug text-zinc-300 shadow-xl">
          {hint}
        </div>
      )}
    </div>
  );
}

/** Metric cho trạm client-side (journal) — wrapper của Field */
function Metric({ lang, k, v, sub, tone, hint, hintVi }: { lang: Lang; k: string; v: string; sub?: string; tone?: StatTone; hint?: string; hintVi?: string }) {
  return <Field m={{ k, v, sub, tone, hint, hintVi }} lang={lang} />;
}

export default function StatsPage() {
  const [lang, setLang] = useState<Lang>("en");
  const [snap, setSnap] = useState<StatsSnapshot | null>(null);
  const [at, setAt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  // trạm đang xem — mặc định Flow Overview (màn hình chính của ảnh tham chiếu)
  const [view, setView] = useState<ViewId>("flow");
  const router = useRouter();
  const [navOpen, setNavOpen] = useState(false); // drawer mobile

  // combo picker cho 2 trạm client-side
  const [pickSym, setPickSym] = useState<string>("BTCUSDT");
  const [pickTf, setPickTf] = useState("15m");
  const [journal, setJournal] = useState<(KpiStats & { basis: string }) | null>(null);
  const [journalPer, setJournalPer] = useState<{ per: PerPair[]; failed: string[] } | null>(null);
  const [journalPapers, setJournalPapers] = useState<Paper[] | null>(null);
  const [viewPayload, setViewPayload] = useState<ViewPayload | null>(null);
  const [clientBusy, setClientBusy] = useState(false);
  const [labApplied, setLabApplied] = useState<{ name: string; sl: number; tp: number; key: number; period: number } | null>(null);
  const [tabsRefresh, setTabsRefresh] = useState(0);
  // 0.3.2 — công tắc DQF (sàn chất lượng động học từ toàn bộ Elliott session)
  const [dqfOn, setDqfOn] = useState<boolean>(true);
  const [dqfBusy, setDqfBusy] = useState(false);

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

  // 2 trạm client-side — tính Ở SERVER qua /api/journal (200 nến) + /api/view
  // (500 nến deep analysis) — giữ nguyên cơ chế 0.2.52/0.2.80/0.2.82.
  useEffect(() => {
    let alive = true;
    if (view !== "journal" && view !== "lab") return;
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
          setJournalPapers(j.papers ?? []);
          setViewPayload(null);
        } catch {
          if (alive) {
            setJournal(null);
            setJournalPer(null);
            setJournalPapers(null);
            setViewPayload(null);
          }
        }
        setClientBusy(false);
        return;
      }
      setJournalPer(null);
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
      setJournalPapers(j ? j.papers : null);
      setViewPayload(v);
      setClientBusy(false);
    })();
    return () => {
      alive = false;
    };
  }, [pickSym, pickTf, view]);

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

  /** 0.3.2 — công tắc DQF */
  const toggleDqf = useCallback(
    async (on: boolean) => {
      setDqfBusy(true);
      setDqfOn(on); // optimistic — snapshot kế sẽ xác nhận lại
      try {
        const res = await fetch("/api/dqf", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ on }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } catch {
        setDqfOn(!on); // lỗi → rollback
      } finally {
        setDqfBusy(false);
      }
    },
    [],
  );
  useEffect(() => {
    if (typeof snap?.dqfOn === "boolean") setDqfOn(snap.dqfOn);
  }, [snap?.dqfOn]);

  // 0.2.82 — Lab apply variant → utp.settings (giữ nguyên cơ chế cũ)
  const applyVariantStats = useCallback((v: VariantRow) => {
    try {
      const raw = localStorage.getItem("utp.settings");
      const prev: Partial<EngineSettings> = raw ? (JSON.parse(raw) as Partial<EngineSettings>) : {};
      const next: EngineSettings = {
        ...DEFAULT_SETTINGS,
        ...prev,
        slPct: v.config.slPct,
        tpPct: v.config.tpPct,
        atrKey: v.config.atrKey,
        atrPeriod: v.config.atrPeriod,
        smaFilter: v.config.smaFilter,
        smaPeriod: v.config.smaPeriod,
      };
      localStorage.setItem("utp.settings", JSON.stringify(next));
    } catch {
      // storage blocked — biến thể vẫn được đánh dấu applied ở DB
    }
    setLabApplied({
      name: v.name,
      sl: v.config.slPct,
      tp: v.config.tpPct,
      key: v.config.atrKey,
      period: v.config.atrPeriod,
    });
  }, []);

  const counts = { ok: 0, warn: 0, na: 0 };
  for (const s of snap?.sections ?? []) counts[s.state] += 1;
  if (journal && (view === "journal" || view === "lab")) counts[journal.closed > 0 && journal.winRate >= 50 ? "ok" : "warn"] += 1;

  const byKey: Record<string, StatSection | undefined> = {};
  for (const s of snap?.sections ?? []) byKey[s.key] = s;

  const flow = snap?.flow ?? null;
  // bấm node trên sơ đồ → mở trạm chi tiết tương ứng (st-root → /ai, dive LLM)
  const nodeToView = (id: string): ViewId =>
    id === "st-universe" ? "universe"
    : id === "st-dock" ? "dock"
    : id === "st-open" ? "open"
    : id === "st-autopsy" ? "journal"
    : id === "st-evo" ? "sg"
    : id === "st-param" ? "lab"
    : "hist";
  const onFlowNode = useCallback(
    (id: string) => {
      if (id === "st-root") {
        router.push("/ai");
        return;
      }
      setView(nodeToView(id));
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    [router],
  );

  // ── số liệu thô cho sơ đồ (flow null → khung số 0, trang vẫn sống) ──
  const fc: ApmFlowCounts = {
    universePool: flow?.universePool ?? 0,
    publishedTop: flow?.publishedTop ?? 0,
    uptrend: flow?.uptrend ?? 0,
    scanCombos: flow?.scanCombos ?? 0,
    scanAgeMin: flow?.scanAgeMin ?? null,
    gatePass: flow?.gatePass ?? 0,
    neutral: flow?.neutral ?? 0,
    tradesTotal: flow?.tradesTotal ?? 0,
    closedTrades: flow?.closedTrades ?? 0,
    tp: flow?.tp ?? 0,
    sl: flow?.sl ?? 0,
    flip: flow?.flip ?? 0,
    manual: flow?.manual ?? 0,
    open: flow?.open ?? null,
    openPositions: (flow as any)?.openPositions ?? (flow?.open ? [flow.open] : []),
  };

  const stateBadge = (state: "ok" | "warn" | "na") =>
    state === "ok" ? (
      <Badge className="gap-1 border-0 bg-[#101a08] text-emerald-400 hover:bg-[#101a08]">
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
      {t(lang, "stats.acc")} ≈ {accPct.toFixed(2)}%
    </span>
  );

  /** nội dung 1 trạm server: metrics + charts + basis/consistency */
  const secBody = (k: string): ReactNode => {
    const s = byKey[k];
    if (!s) {
      return <p className="rounded-lg border border-transparent border-[#2a2a31] p-4 text-xs text-zinc-600">— {t(lang, "stats.chEmpty")}</p>;
    }
    return (
      <div className="space-y-2.5">
        <div className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
          {s.metrics.map((m, i) => (
            <Field key={i} m={m} lang={lang} />
          ))}
        </div>
        {s.charts?.map((c, i) => (
          <ChartBox key={i} chart={c} lang={lang} />
        ))}
        <div className="space-y-1.5 rounded-lg border border-[#232329] bg-[#0b0b0e] p-2.5">
          <p className="text-[11px] leading-relaxed text-zinc-400">
            <span className="font-semibold text-zinc-300">📌 {t(lang, "stats.basis")}: </span>
            {t(lang, `stats.basis.${s.key}`)}
          </p>
          <p className="text-[11px] leading-relaxed text-zinc-400">
            <span className="font-semibold text-zinc-300">⚖️ {t(lang, "stats.consist")}: </span>
            <span className={s.state === "warn" ? "text-amber-300" : ""}>{s.note}</span>
          </p>
        </div>
      </div>
    );
  };

  /** khung panel APM dùng chung */
  const Panel = ({ children, className = "" }: { children: ReactNode; className?: string }) => (
    <div className={`rounded-2xl border border-[#232329] bg-[#101014]/95 shadow-[0_1px_0_rgba(255,255,255,0.03)_inset] ${className}`}>{children}</div>
  );

  /** thanh tiêu đề panel: chấm màu + nhãn + phần phải tuỳ ý */
  const PanelHead = ({ label, right, dot = "#8b8b94" }: { label: string; right?: ReactNode; dot?: string }) => (
    <div className="flex items-center justify-between gap-2 border-b border-[#1d1d23] px-4 py-2.5">
      <p className="flex min-w-0 items-center gap-2 text-[12.5px] font-semibold text-zinc-100">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: dot }} />
        <span className="whitespace-normal leading-snug">{label}</span>
      </p>
      {right}
    </div>
  );

  /** hàng thanh %-dùng chung cho 3 widget Health (kiểu Latency/Capacity/Conversion) */
  const BarRow = ({ label, sub, pct, color, badge }: { label: string; sub?: string; pct: number; color: string; badge?: ReactNode }) => (
    <div className="flex items-center gap-2.5 px-4 py-1.5">
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className="whitespace-normal leading-snug text-[11px] text-zinc-300">{label}</p>
          {sub && <p className="shrink-0 font-mono text-[9.5px] text-zinc-500">{sub}</p>}
        </div>
        <div className="mt-1 flex items-center gap-1">
          {[0, 1, 2].map((seg) => {
            const segPct = Math.min(1, Math.max(0, pct * 3 - seg));
            return (
              <span key={seg} className="h-[5px] flex-1 overflow-hidden rounded-full bg-[#1c1c22]">
                <span className="block h-full rounded-full" style={{ width: `${segPct * 100}%`, background: color, opacity: seg === 0 ? 1 : seg === 1 ? 0.75 : 0.5 }} />
              </span>
            );
          })}
        </div>
      </div>
      {badge}
    </div>
  );

  // ── RAIL PHẢI — Events / Gate Health / Engine Health / Session Health / Scorecard
  // (đọc snap + byKey qua closure của component — KHÔNG nhận prop)
  const Rail = () => {
    // Events tổng hợp từ snapshot (toàn bộ số liệu do server cung cấp)
    const ev: { dot: string; text: string; right?: string; dim?: boolean }[] = [];
    if (flow) {
      if (flow.scanAgeMin == null) ev.push({ dot: GREY, text: t(lang, "apm.ev.never"), dim: true });
      else if (flow.scanAgeMin > 15) ev.push({ dot: "#fbbf24", text: t(lang, "apm.ev.staleScan"), right: `${flow.scanAgeMin}m` });
      else ev.push({ dot: LIME, text: t(lang, "apm.ev.scan"), right: `${flow.scanAgeMin}m` });
      ev.push({
        dot: flow.universeAgeMin != null && flow.universeAgeMin <= 480 ? "#38bdf8" : "#fbbf24",
        text: t(lang, "apm.ev.universe"),
        right: flow.universeAgeMin != null ? `${flow.universeAgeMin}m` : t(lang, "apm.ev.never"),
      });
      ev.push({
        dot: flow.activeSessions.length ? LIME : "#8b8b94",
        text: flow.activeSessions.length
          ? t(lang, "apm.ev.session", { s: flow.activeSessions.join(" + ") })
          : t(lang, "apm.ev.quiet"),
        right: `${flow.nextSession} ${Math.round(flow.nextInMin / 60)}h`,
        dim: flow.activeSessions.length === 0,
      });
      ev.push(
        flow.open
          ? { dot: "#fb7185", text: t(lang, "apm.ev.openpos", { sym: flow.open.symbol.replace("USDT", ""), side: flow.open.side, h: flow.open.ageH.toFixed(2) }), right: flow.open.roi != null ? `${flow.open.roi >= 0 ? "+" : ""}${flow.open.roi.toFixed(2)}%` : undefined }
          : { dot: "#8b8b94", text: t(lang, "apm.ev.flat"), dim: true },
      );
      ev.push({ dot: snap?.dqfOn ? LIME : "#8b8b94", text: snap?.dqfOn ? t(lang, "apm.ev.dqfOn") : t(lang, "apm.ev.dqfOff"), right: "DQF" });
      ev.push(
        flow.warn > 0
          ? { dot: "#fbbf24", text: t(lang, "apm.ev.warn", { n: flow.warn }), right: `${flow.warn}/${flow.ok + flow.warn + flow.na}` }
          : { dot: LIME, text: t(lang, "apm.ev.allOk"), right: `${flow.ok}` },
      );
      if (flow.last7d > 0) ev.push({ dot: "#a78bfa", text: t(lang, "apm.ev.last7d", { n: flow.last7d }), right: "7d" });
    }
    // Gate Health 3 thanh
    const freshPct = flow?.scanAgeMin != null ? Math.max(0, 1 - flow.scanAgeMin / 15) : 0;
    const passPct = flow && flow.scanCombos > 0 ? flow.gatePass / flow.scanCombos : 0;
    const bcPct = flow && flow.bcastTotal > 0 ? flow.bcastPass / flow.bcastTotal : 0;
    // Engine Health — 3 kiểm chéo chính (state section do server chấm)
    const engRows = [
      { label: t(lang, "apm.eng.chain"), sub: t(lang, "apm.eng.chainSub"), state: byKey.auto?.state ?? "na" },
      { label: t(lang, "apm.eng.labels"), sub: t(lang, "apm.eng.labelsSub", { n: flow?.unlabeled ?? 0 }), state: byKey.hist?.state ?? "na" },
      { label: t(lang, "apm.eng.outcomes"), sub: t(lang, "apm.eng.outcomesSub"), state: byKey.sg?.state ?? "na" },
    ];
    // Session Health — phiên theo timestamp server (snap.at) để SSR = client
    const activeSet = new Set((flow?.activeSessions ?? []).map((x) => x));
    // Trade Scorecard
    const sc = [
      { label: t(lang, "apm.score.tp"), n: fc.tp, color: LIME },
      { label: t(lang, "apm.score.sl"), n: fc.sl, color: "#fb7185" },
      { label: t(lang, "apm.score.flip"), n: fc.flip, color: "#fbbf24" },
      { label: t(lang, "apm.score.manual"), n: fc.manual, color: "#8b8b94" },
    ];
    const scMax = Math.max(...sc.map((r) => r.n), fc.closedTrades, 1);
    return (
      <div className="space-y-3">
        <Panel>
          <PanelHead label={t(lang, "apm.rail.events")} dot="#a78bfa" right={<span className="rounded-full bg-[#1a1a20] px-2 py-0.5 font-mono text-[10px] text-zinc-400">{ev.length}</span>} />
          <div className="divide-y divide-[#1a1a20]">
            {ev.length === 0 && <p className="px-4 py-3 text-[11px] text-zinc-600">—</p>}
            {ev.map((e, i) => (
              <div key={i} className={`flex items-center gap-2.5 px-4 py-2 ${e.dim ? "opacity-60" : ""}`}>
                <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: e.dot }} />
                <p className="min-w-0 flex-1 whitespace-normal leading-snug text-[11px] leading-snug text-zinc-300">{e.text}</p>
                {e.right && <span className="shrink-0 font-mono text-[10px] text-zinc-500">{e.right}</span>}
              </div>
            ))}
          </div>
        </Panel>

        <Panel>
          <PanelHead label={t(lang, "apm.rail.gate")} dot={LIME} right={<span className="rounded-full bg-[#1a1a20] px-2 py-0.5 font-mono text-[10px] text-zinc-400">3</span>} />
          <div className="py-1">
            <BarRow label={t(lang, "apm.gate.fresh")} sub={t(lang, "apm.gate.freshSub", { n: flow?.scanAgeMin ?? 0 })} pct={freshPct} color={LIME} />
            <BarRow label={t(lang, "apm.gate.pass")} sub={t(lang, "apm.gate.passSub", { n: flow?.gatePass ?? 0, m: flow?.scanCombos ?? 0 })} pct={passPct} color={LIME} />
            <BarRow label={t(lang, "apm.gate.bcast")} sub={t(lang, "apm.gate.bcastSub", { n: flow?.bcastPass ?? 0, m: flow?.bcastTotal ?? 0 })} pct={bcPct} color={LIME} />
          </div>
        </Panel>

        <Panel>
          <PanelHead label={t(lang, "apm.rail.engine")} dot="#38bdf8" right={<span className="rounded-full bg-[#1a1a20] px-2 py-0.5 font-mono text-[10px] text-zinc-400">3</span>} />
          <div className="divide-y divide-[#1a1a20]">
            {engRows.map((r, i) => (
              <div key={i} className="flex items-center gap-2.5 px-4 py-2">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: r.state === "ok" ? LIME : r.state === "warn" ? "#fbbf24" : "#8b8b94" }} />
                <div className="min-w-0 flex-1">
                  <p className="whitespace-normal leading-snug text-[11px] text-zinc-300">{r.label}</p>
                  <p className="whitespace-normal leading-snug text-[9.5px] text-zinc-500">{r.sub}</p>
                </div>
                <div className="w-16 shrink-0">
                  <span className="block h-[5px] overflow-hidden rounded-full bg-[#1c1c22]">
                    <span className="block h-full rounded-full" style={{ width: r.state === "ok" ? "100%" : r.state === "warn" ? "45%" : "8%", background: r.state === "ok" ? LIME : r.state === "warn" ? "#fbbf24" : "#8b8b94" }} />
                  </span>
                </div>
              </div>
            ))}
          </div>
        </Panel>

        <Panel>
          <PanelHead label={t(lang, "apm.rail.sessions")} dot="#22d3ee" right={<span className="rounded-full bg-[#1a1a20] px-2 py-0.5 font-mono text-[10px] text-zinc-400">{activeSet.size}/4</span>} />
          <div className="divide-y divide-[#1a1a20]">
            {SESSIONS.map((s) => {
              const on = activeSet.has(SESS_NAME[s.key]);
              return (
                <div key={s.key} className="flex items-center gap-2.5 px-4 py-2">
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${on ? "animate-pulse" : ""}`} style={{ background: on ? LIME : "#3a3a42" }} />
                  <p className={`min-w-0 flex-1 whitespace-normal leading-snug text-[11px] ${on ? "text-zinc-200" : "text-zinc-500"}`}>{SESS_NAME[s.key]}</p>
                  <span className="shrink-0 font-mono text-[9.5px] text-zinc-600">{s.from}–{s.to}h</span>
                  <span className="w-14 shrink-0">
                    <span className="block h-[5px] overflow-hidden rounded-full bg-[#1c1c22]">
                      <span className="block h-full rounded-full" style={{ width: on ? "100%" : "10%", background: on ? LIME : "#3a3a42" }} />
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
        </Panel>

        <Panel>
          <PanelHead
            label={t(lang, "apm.rail.score")}
            dot="#fb7185"
            right={<span className="rounded-full bg-[#1a1a20] px-2 py-0.5 font-mono text-[10px] text-zinc-400">{t(lang, "apm.score.totalSub", { n: fc.closedTrades })}</span>}
          />
          <div className="divide-y divide-[#1a1a20]">
            {sc.map((r, i) => (
              <div key={i} className="flex items-center gap-2.5 px-4 py-2">
                <p className="w-24 shrink-0 whitespace-normal leading-snug text-[11px] text-zinc-300">{r.label}</p>
                <span className="h-[6px] min-w-0 flex-1 overflow-hidden rounded-full bg-[#1c1c22]">
                  <span className="block h-full rounded-full" style={{ width: `${(r.n / scMax) * 100}%`, background: r.color }} />
                </span>
                <span className="w-8 shrink-0 text-right font-mono text-[11px] font-semibold" style={{ color: r.color }}>{r.n}</span>
              </div>
            ))}
            <div className="flex items-center gap-2.5 px-4 py-2">
              <p className="w-24 shrink-0 whitespace-normal leading-snug text-[11px] text-zinc-300">{t(lang, "apm.score.open")}</p>
              <span className="h-[6px] min-w-0 flex-1 overflow-hidden rounded-full bg-[#1c1c22] border border-transparent border-[rose-40055]">
                <span className="block h-full rounded-full" style={{ width: fc.open ? "100%" : "0%", background: "#fb7185" }} />
              </span>
              <span className="w-8 shrink-0 text-right font-mono text-[11px] font-semibold text-rose-400">{fc.open ? 1 : 0}</span>
            </div>
          </div>
        </Panel>
      </div>
    );
  };

  // ── cột "Net result" (bên phải sơ đồ — y ảnh tham chiếu) ──
  const NetCard = ({ label, value, sub, color = "#e9e9ec" }: { label: string; value: string; sub?: string; color?: string }) => (
    <div className="rounded-xl border border-[#232329] bg-[#101014]/95 px-3 py-2.5">
      <p className="text-[9.5px] uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="mt-0.5 whitespace-normal leading-snug font-mono text-[19px] font-bold leading-tight" style={{ color }}>{value}</p>
      {sub && <p className="mt-0.5 whitespace-normal leading-snug text-[9.5px] text-zinc-500">{sub}</p>}
    </div>
  );
  // ── dãy "Net result" — DÃY NGANG full-width dưới sơ đồ (1 hàng 6 ô trên xl) ──
  // Trước đây nằm ở cột dọc 180px cạnh sơ đồ → dính chùm, chữ nhỏ khó đọc.
  const netCardsData = () => {
    const eq = flow?.equity ?? null;
    const openRoi = flow?.open?.roi ?? null;
    const wilson = flow?.wilson ?? 0;
    return [
      { key: "eq", label: t(lang, "apm.net.label"), value: eq != null ? `$${eq.toFixed(2)}` : "—", sub: t(lang, "apm.net.startSub"), color: eq != null && eq >= 1000 ? LIME : "#e9e9ec" },
      { key: "roi", label: t(lang, "apm.net.netroi"), value: `${(flow?.netRoi ?? 0) >= 0 ? "+" : ""}${(flow?.netRoi ?? 0).toFixed(2)}%`, sub: `${fc.closedTrades} ${t(lang, "apm.net.closed").toLowerCase()}`, color: (flow?.netRoi ?? 0) >= 0 ? LIME : "#fb7185" },
      { key: "wr", label: t(lang, "apm.net.winrate"), value: `${(flow?.winRate ?? 0).toFixed(2)}%`, sub: t(lang, "apm.net.wilsonSub", { n: wilson.toFixed(2) }), color: "#e9e9ec" },
      { key: "closed", label: t(lang, "apm.net.closed"), value: `${fc.closedTrades}`, sub: `${flow?.wins ?? 0} wins · ${fc.sl} SL`, color: "#e9e9ec" },
      { key: "avg", label: t(lang, "apm.net.avg"), value: `${(flow?.avgRoi ?? 0) >= 0 ? "+" : ""}${(flow?.avgRoi ?? 0).toFixed(2)}%`, sub: undefined, color: (flow?.avgRoi ?? 0) >= 0 ? LIME : "#fb7185" },
      { key: "unreal", label: t(lang, "apm.net.unreal"), value: openRoi != null ? `${openRoi >= 0 ? "+" : ""}${openRoi.toFixed(2)}%` : "—", sub: flow?.open ? t(lang, "apm.net.openSub", { sym: flow.open.symbol.replace("USDT", ""), side: flow.open.side, h: flow.open.ageH.toFixed(2) }) : t(lang, "apm.band.flat"), color: openRoi != null ? (openRoi >= 0 ? LIME : "#fb7185") : "#8b8b94" },
    ];
  };
  const netRow = (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
      {netCardsData().map((x) => (
        <NetCard key={x.key} label={x.label} value={x.value} sub={x.sub} color={x.color} />
      ))}
    </div>
  );

  // ── tabs đáy view flow: Equity / Win rate / Exits (y cấu trúc Load/Response/Errors)
  // Equity curve nằm ở section auto (line $); Win rate ở combo (bars max 100);
  // Exit mix ở hist (stack) — tra theo kind cho chắc, không theo index.
  const eqChart = byKey.auto?.charts?.find((c) => c.kind === "line");
  const wrChart = byKey.combo?.charts?.find((c) => c.kind === "bars" && c.max === 100);
  const exChart = byKey.hist?.charts?.find((c) => c.kind === "stack");

  const bottomTabs = (
    <Panel>
      <Tabs defaultValue="equity">
        <div className="border-b border-[#1d1d23] px-3 py-2">
          <TabsList className="h-8 justify-start rounded-lg border border-[#232329] bg-[#0b0b0e] p-0.5">
            {[
              { v: "equity", label: t(lang, "apm.tab.equity") },
              { v: "wr", label: t(lang, "apm.tab.wr") },
              { v: "exits", label: t(lang, "apm.tab.exits") },
            ].map((tb) => (
              <TabsTrigger key={tb.v} value={tb.v} className="h-7 rounded-md px-3 text-xs data-[state=active]:bg-[#1c1c22] data-[state=active]:text-white">
                {tb.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <div className="p-3">
          <TabsContent value="equity" className="mt-0">
            {eqChart ? <ChartBox chart={eqChart} lang={lang} /> : <p className="p-4 text-xs text-zinc-600">— {t(lang, "apm.tab.empty")}</p>}
          </TabsContent>
          <TabsContent value="wr" className="mt-0">
            {wrChart ? <ChartBox chart={wrChart} lang={lang} /> : <p className="p-4 text-xs text-zinc-600">— {t(lang, "apm.tab.empty")}</p>}
          </TabsContent>
          <TabsContent value="exits" className="mt-0">
            {exChart ? <ChartBox chart={exChart} lang={lang} /> : <p className="p-4 text-xs text-zinc-600">— {t(lang, "apm.tab.empty")}</p>}
          </TabsContent>
        </div>
      </Tabs>
    </Panel>
  );

  // ── bộ chọn combo (journal + lab) ──
  const comboPicker = (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[11px] font-medium text-zinc-400">{t(lang, "stats.pick")}:</span>
      <select
        value={pickSym}
        onChange={(e) => setPickSym(e.target.value)}
        className="h-7 rounded-md border border-[#2a2a31] bg-[#0b0b0e] px-2 font-mono text-xs text-zinc-200"
      >
        <option value={PICK_ALL}>{t(lang, "stats.pick.all")}</option>
        {PICK_SYMBOLS.map((s) => (
          <option key={s} value={s}>{s.replace("USDT", "")}</option>
        ))}
      </select>
      {PICK_TFS.map((tf) => (
        <Button
          key={tf}
          size="sm"
          variant="outline"
          className={`h-7 px-2 font-mono text-xs ${pickTf === tf ? "border-zinc-500 bg-[#1c1c22] text-zinc-100" : "border-[#232329] text-zinc-400 hover:bg-[#1c1c22]"}`}
          onClick={() => setPickTf(tf)}
        >
          {tf}
        </Button>
      ))}
      {clientBusy && <RefreshCw className="h-3.5 w-3.5 animate-spin text-zinc-500" />}
    </div>
  );

  // ── trang chi tiết trạm (center khi view != flow) ──
  const navItem = NAV.find((n) => n.id === view);
  const stationView = () => {
    if (view === "journal") {
      return (
        <Panel>
          <PanelHead
            label={`${t(lang, "stats.section.journal")} · ${pickSym === PICK_ALL ? t(lang, "stats.pick.all") : pickSym.replace("USDT", "")} ${pickTf}`}
            dot="#e879f9"
            right={journal ? accBadge(journal.closed > 0 ? journal.winRate : 0, `${journal.closed} closed`) : undefined}
          />
          <div className="space-y-2.5 p-3">
            {comboPicker}
            {journal ? (
              <>
                <div className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
                  <Metric lang={lang} k={t(lang, "stats.j.trades")} v={String(journal.total)} sub={`${journal.closed} closed · ${journal.open} open`} tone="info"
                    hint="UT-Bot signals inside the 200-candle journal window; sub = closed vs still-open paper trades."
                    hintVi="Tín hiệu UT-Bot trong cửa sổ 200 nến; dòng dưới = số đã đóng và số chưa chốt." />
                  <Metric lang={lang} k="Win rate" v={`${journal.winRate.toFixed(2)}%`} sub={`${journal.wins} wins / ${journal.losses} losses`}
                    tone={journal.closed === 0 ? "dim" : journal.winRate >= 50 ? "ok" : journal.winRate >= 40 ? "warn" : "bad"} />
                  <Metric lang={lang} k="TP / SL" v={`${journal.tpCount} / ${journal.slCount}`}
                    tone={journal.tpCount > journal.slCount ? "ok" : journal.tpCount < journal.slCount ? "bad" : "info"} />
                  <Metric lang={lang} k={t(lang, "stats.j.flips")} v={String(journal.flipCount)} sub={`net ${fmtPct(journal.flipNetPnl)}`} tone="info" />
                  <Metric lang={lang} k={t(lang, "stats.j.net")} v={fmtPct(journal.netPnl)} tone={journal.netPnl > 0 ? "ok" : journal.netPnl < 0 ? "bad" : "dim"} />
                  <Metric lang={lang} k="UT-Bot signals" v={journal.basis} tone="info" />
                </div>
                <ChartBox lang={lang} chart={{ kind: "stack", items: [{ label: "TP", n: journal.tpCount }, { label: "SL", n: journal.slCount }, { label: "flip", n: journal.flipCount }] }} />
                <div className="border-t border-[#1d1d23] pt-2.5">
                  <Journal lang={lang} papers={journalPapers ?? []} symbol={pickSym} interval={pickTf} bare showSymbol={pickSym === PICK_ALL} maxListClass="max-h-[26rem]" />
                </div>
                {journalPer && journalPer.per.length > 0 && (
                  <div className="space-y-1.5 rounded-lg border border-[#232329] bg-[#0b0b0e] p-2.5">
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
                            <tr key={p.symbol} className="border-t border-[#1d1d23]">
                              <td className="py-1 pr-2 text-zinc-200">{p.symbol.replace("USDT", "")}</td>
                              <td className="py-1 pr-2 text-right text-zinc-400">{p.kpi.closed}</td>
                              <td className={`py-1 pr-2 text-right ${p.kpi.closed > 0 && p.kpi.winRate >= 50 ? "text-emerald-400" : "text-zinc-400"}`}>
                                {p.kpi.closed > 0 ? `${p.kpi.winRate.toFixed(2)}%` : "—"}
                              </td>
                              <td className={`py-1 text-right ${p.kpi.netPnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{fmtPct(p.kpi.netPnl)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p className="text-[10px] text-zinc-500">{t(lang, "stats.journal.perNote")}</p>
                    {journalPer.failed.length > 0 && (
                      <p className="text-[10px] text-amber-300/80">{t(lang, "stats.journal.failed", { pairs: journalPer.failed.join(", ") })}</p>
                    )}
                  </div>
                )}
                <div className="space-y-1.5 rounded-lg border border-[#232329] bg-[#0b0b0e] p-2.5">
                  <p className="text-[11px] leading-relaxed text-zinc-400">
                    <span className="font-semibold text-zinc-300">📌 {t(lang, "stats.basis")}: </span>
                    {t(lang, "stats.basis.journal")}
                  </p>
                  <p className="text-[11px] leading-relaxed text-amber-300/80">⚠️ {t(lang, "stats.journalNote")}</p>
                </div>
              </>
            ) : (
              <p className="text-xs text-zinc-500">— {clientBusy ? "…" : "failed to load candles"}</p>
            )}
          </div>
        </Panel>
      );
    }
    if (view === "lab") {
      return (
        <Panel>
          <PanelHead label={t(lang, "stats.section.analysis")} dot="#60a5fa" />
          <div className="space-y-2.5 p-3">
            {comboPicker}
            <Tabs defaultValue="suggest">
              <TabsList className="h-8 w-full justify-start overflow-x-auto rounded-lg border border-[#232329] bg-[#0b0b0e] p-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {[
                  { v: "suggest", label: t(lang, "tabs.suggest") },
                  { v: "lab", label: t(lang, "tabs.lab") },
                  { v: "analysis", label: t(lang, "tabs.analysis") },
                ].map((tb) => (
                  <TabsTrigger key={tb.v} value={tb.v} className="h-7 shrink-0 rounded-md px-3 text-xs data-[state=active]:bg-[#1c1c22] data-[state=active]:text-white">
                    {tb.label}
                  </TabsTrigger>
                ))}
              </TabsList>
              <TabsContent value="suggest" className="mt-2.5">
                <SuggestionHistory lang={lang} symbol={pickSym} interval={pickTf} refreshKey={tabsRefresh} forceAll={pickSym === PICK_ALL} />
              </TabsContent>
              <TabsContent value="lab" className="mt-2.5">
                {pickSym === PICK_ALL ? (
                  <p className="rounded-lg border border-transparent border-[#2a2a31] p-6 text-center text-xs text-zinc-500">{t(lang, "stats.labAll")}</p>
                ) : (
                  <>
                    {labApplied && (
                      <p className="mb-2.5 rounded-lg border border-teal-800/60 bg-teal-950/30 px-3 py-2 text-[11px] leading-relaxed text-teal-300">
                        {t(lang, "sl.applyToast", {
                          name: labApplied.name,
                          sl: labApplied.sl.toFixed(2),
                          tp: labApplied.tp.toFixed(2),
                          key: String(labApplied.key),
                          period: String(labApplied.period),
                        })}{" "}
                        · {t(lang, "stats.labApplied")}
                      </p>
                    )}
                    <StrategyLab lang={lang} symbol={pickSym} interval={pickTf} refreshKey={tabsRefresh} onApply={applyVariantStats} />
                  </>
                )}
              </TabsContent>
              <TabsContent value="analysis" className="mt-2.5">
                {pickSym === PICK_ALL ? (
                  <p className="text-xs leading-relaxed text-zinc-500">— {t(lang, "stats.analysisAll")}</p>
                ) : viewPayload ? (
                  <div className="space-y-2.5">
                    <DeepAnalysis
                      lang={lang}
                      a={viewPayload.analysis}
                      smaFilter={DEFAULT_SETTINGS.smaFilter}
                      smaPeriod={DEFAULT_SETTINGS.smaPeriod}
                      gateLong={viewPayload.gate.long}
                      gateShort={viewPayload.gate.short}
                      smaValue={viewPayload.gate.sma}
                    />
                    <StrategyPies lang={lang} pies={viewPayload.pies} n={viewPayload.n} leverage={DEFAULT_SETTINGS.leverage} />
                    <div className="space-y-1.5 rounded-lg border border-[#232329] bg-[#0b0b0e] p-2.5">
                      <p className="text-[11px] leading-relaxed text-zinc-400">
                        <span className="font-semibold text-zinc-300">📌 {t(lang, "stats.basis")}: </span>
                        {t(lang, "stats.basis.analysis")}
                      </p>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-zinc-500">— {clientBusy ? "…" : "failed to load candles"}</p>
                )}
              </TabsContent>
            </Tabs>
          </div>
        </Panel>
      );
    }
    // các trạm server (market/universe/combo/dock/auto/dqf/open/hist/sg)
    const s = byKey[view];
    return (
      <Panel>
        <PanelHead
          label={t(lang, `stats.section.${view}`)}
          dot={view === "dqf" ? "#2dd4bf" : LIME}
          right={s ? (<span className="flex items-center gap-1.5">{accBadge(s.accPct, s.accNote)}{stateBadge(s.state)}</span>) : undefined}
        />
        <div className="space-y-2.5 p-3">
          {view === "dqf" && (
            <div className="mb-2.5 flex items-center justify-between gap-3 rounded-lg border border-[#232329] bg-[#0b0b0e] px-3 py-2">
              <div className="min-w-0">
                <p className="text-xs font-medium text-zinc-200">{t(lang, "stats.dqf.toggle")}</p>
                <p className="text-[10px] leading-snug text-zinc-500">{t(lang, "stats.dqf.toggle.sub")}</p>
              </div>
              <Switch checked={dqfOn} disabled={dqfBusy} onCheckedChange={(v) => void toggleDqf(v)} aria-label={t(lang, "stats.dqf.toggle")} />
            </div>
          )}
          {secBody(view)}
        </div>
      </Panel>
    );
  };

  // điều hướng bấm: đổi view + đóng drawer mobile + về đầu trang
  const go = (id: ViewId) => {
    setView(id);
    setNavOpen(false);
    window.scrollTo({ top: 0 });
  };

  return (
    <div className="min-h-screen text-zinc-200">
      {/* ── TOP BAR ── */}
      <header className="sticky top-0 z-40 border-b border-[#1d1d23] bg-[#0b0b0e]/95 backdrop-blur">
        <div className="flex h-12 items-center gap-2 px-3 sm:px-4">
          <button
            type="button"
            aria-label={t(lang, "apm.menu")}
            onClick={() => setNavOpen((v) => !v)}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#232329] text-zinc-400 hover:bg-[#1c1c22] hover:text-zinc-200 xl:hidden"
          >
            {navOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
          <div className="flex min-w-0 items-baseline gap-2">
            <p className="whitespace-normal leading-snug text-[15px] font-bold tracking-tight text-zinc-50">{t(lang, "apm.brand")}</p>
            <span className="hidden text-[10px] text-zinc-500 sm:inline">APM</span>
          </div>
          {/* điều hướng nhanh md–xl (xl+ đã có sidebar) */}
          <nav className="ml-3 hidden min-w-0 flex-1 items-center gap-1 overflow-x-auto md:flex xl:hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {NAV.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => go(n.id)}
                className={`shrink-0 rounded-lg px-2.5 py-1 text-[11px] transition-colors ${
                  view === n.id ? "bg-[#1c1c22] text-emerald-400" : "text-zinc-400 hover:bg-[#1c1c22] hover:text-zinc-200"
                }`}
              >
                {t(lang, n.key)}
              </button>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-1.5">
            <Link
              href="/ai"
              className="hidden h-8 items-center gap-1.5 rounded-lg border border-[#232329] px-2.5 text-[11px] text-zinc-300 hover:bg-[#1c1c22] sm:flex"
            >
              {t(lang, "apm.nav.back").replace("← ", "")} · Dive
            </Link>
            <Button size="sm" variant="outline" className="h-8 border-[#232329] px-2.5 text-xs text-zinc-300 hover:bg-[#1c1c22]" onClick={switchLang}>
              {lang === "vi" ? "EN" : "VI"}
            </Button>
            <button
              type="button"
              disabled={loading}
              onClick={() => { setTabsRefresh((k) => k + 1); void load(); }}
              className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-semibold text-black transition hover:brightness-110 disabled:opacity-60"
              style={{ background: LIME }}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              <span className="hidden sm:inline">{t(lang, "stats.refresh")}</span>
            </button>
          </div>
        </div>
      </header>

      <div className="flex">
        {/* ── SIDEBAR TRÁI (xl+ cố định; <xl overlay drawer) ── */}
        <aside
          className={`fixed inset-y-0 left-0 z-50 w-56 shrink-0 overflow-y-auto border-r border-[#1d1d23] bg-[#0c0c10] pt-3 transition-transform duration-200 xl:sticky xl:top-12 xl:z-0 xl:h-[calc(100vh-3rem)] xl:translate-x-0 ${
            navOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <div className="flex items-center justify-between px-3 pb-2 xl:hidden">
            <p className="text-[10px] uppercase tracking-widest text-zinc-600">{t(lang, "apm.mobileNav")}</p>
            <button type="button" onClick={() => setNavOpen(false)} className="text-zinc-500 hover:text-zinc-200">
              <X className="h-4 w-4" />
            </button>
          </div>
          <nav className="space-y-0.5 px-2 pb-6">
            {NAV.map((n) => {
              const Icon = n.icon;
              const active = view === n.id;
              const s = n.id in byKey && n.id !== "flow" && n.id !== "journal" && n.id !== "lab" ? byKey[n.id] : undefined;
              const dot = s ? (s.state === "ok" ? LIME : s.state === "warn" ? "#fbbf24" : "#8b8b94") : undefined;
              return (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => go(n.id)}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[12px] transition-colors ${
                    active ? "bg-[#1c1c22] font-semibold text-zinc-50" : "text-zinc-400 hover:bg-[#16161b] hover:text-zinc-200"
                  }`}
                >
                  <Icon className={`h-3.5 w-3.5 shrink-0 ${active ? "text-emerald-400" : "text-zinc-500"}`} />
                  <span className="min-w-0 flex-1 whitespace-normal leading-snug">{t(lang, n.key)}</span>
                  {dot && <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: dot }} />}
                  {active && <span className="h-4 w-0.5 rounded-full" style={{ background: LIME }} />}
                </button>
              );
            })}
            <div className="mt-3 border-t border-[#1d1d23] pt-3">
              <Link href="/" className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[12px] text-zinc-400 hover:bg-[#16161b] hover:text-zinc-200">
                <Crosshair className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
                {t(lang, "apm.nav.back")}
              </Link>
            </div>
          </nav>
        </aside>
        {navOpen && <div className="fixed inset-0 z-40 bg-black/60 xl:hidden" onClick={() => setNavOpen(false)} />}

        {/* ── CENTER + RAIL ── */}
        <main className="min-w-0 flex-1 w-full max-w-none p-4 sm:p-6 lg:p-8">
          {err && !snap && (
            <Panel className="mb-3">
              <div className="flex items-center gap-2 p-4 text-sm text-rose-300">
                <TriangleAlert className="h-4 w-4" /> {err}
              </div>
            </Panel>
          )}

          {!snap && !err && (
            <div className="space-y-3">
              <Skeleton className="h-[420px] rounded-2xl border border-[#232329] bg-[#101014]" />
              <div className="grid gap-3 md:grid-cols-2">
                {[0, 1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-24 rounded-2xl border border-[#232329] bg-[#101014]" />
                ))}
              </div>
            </div>
          )}

          {snap && view === "flow" && (
            <div className="space-y-3">
              {/* sơ đồ full-width + dãy Net result NGANG bên dưới (dãn hàng ngang) */}
              <div className="space-y-3">
                <Panel>
                  <PanelHead
                    label={t(lang, "apm.flow.title")}
                    dot={LIME}
                    right={
                      <span className="flex items-center gap-2">
                        {/* legend tình trạng — y các chip Normal/Success/Error/Pending ảnh ref */}
                        {[
                          { c: LIME, l: t(lang, "apm.band.success") },
                          { c: "#fb7185", l: t(lang, "apm.band.error") },
                          { c: "#9aa0a6", l: t(lang, "apm.band.normal") },
                          { c: "#fb7185", l: t(lang, "apm.band.pending"), dash: true },
                        ].map((x) => (
                          <span key={x.l} className="hidden items-center gap-1 text-[9.5px] text-zinc-500 sm:flex">
                            <span className="h-1.5 w-1.5 rounded-full" style={{ background: x.c, opacity: x.dash ? 0.6 : 1 }} />
                            {x.l}
                          </span>
                        ))}
                        <span className={`h-1.5 w-1.5 rounded-full ${loading ? "animate-pulse" : ""}`} style={{ background: loading ? "#fbbf24" : "#3a3a42" }} />
                      </span>
                    }
                  />
                  <div className="px-2 pb-1 pt-2 sm:px-3">
                    <ApmFlowMap lang={lang} f={fc} onNodeClick={onFlowNode} />
                  </div>
                  <div className="border-t border-[#1d1d23] px-4 py-2 text-[10px] leading-relaxed text-zinc-600">
                    {t(lang, "apm.flow.sub")}
                    {at > 0 && <> · {t(lang, "stats.updated")}: {new Date(at).toLocaleTimeString(lang === "vi" ? "vi-VN" : "en-GB")}</>}
                    {" · "}
                    <span>{t(lang, "stats.summary", counts)}</span>
                    {" · "}
                    <Link href="/ai" className="underline decoration-dotted hover:text-zinc-400">/ai → Root-cause dive (LLM)</Link>
                  </div>
                </Panel>
                {/* Net result — 1 hàng ngang 6 ô (xl), 2/3 ô màn nhỏ */}
                {netRow}
              </div>

              {/* tabs đáy — Equity / Win rate / Exits */}
              {bottomTabs}

              {/* Rail xếp chồng cho màn <2xl */}
              <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">{Rail()}</div>
            </div>
          )}

          {snap && view !== "flow" && (
            <div className="space-y-3">
              <p className="flex items-center gap-1.5 text-[11px] text-zinc-500">
                <button type="button" onClick={() => go("flow")} className="underline decoration-dotted hover:text-zinc-300">
                  {t(lang, "apm.flow.title")}
                </button>
                <span>/</span>
                <span className="text-zinc-300">{navItem ? t(lang, navItem.key) : ""}</span>
              </p>
              {stationView()}
            </div>
          )}
        </main>

        {/* ── RAIL PHẢI cố định (2xl+) — y cột phải ảnh tham chiếu ── */}
        <aside className="hidden">
          <Rail />
        </aside>
      </div>
    </div>
  );
}