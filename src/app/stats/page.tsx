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
// 0.2.84 — gom 8 section dàn trải thành 5 chương + FlowMap (hàng pill nối line
// 20px — quá bé, không thấy "line chạy").
// 0.2.85 — LÀM LẠI THEO FEEDBACK "kết quả khá tệ · line phải CHẠY rõ · nội
// dung vẫn dàn trải":
//   (1) PipeMap (components/pipe-map.tsx): sơ đồ chữ S 2 hàng SVG thật —
//       node toạ độ cố định, connector elbow có DÒNG ĐIỆN CHẠY (dash trượt)
//       + mũi tên hướng suy diễn, line tô màu node ĐÍCH; node đang xử lý
//       glow + halo; bấm node → trạm liên quan TỰ MỞ + cuộn + phát sáng.
//   (2) Stage accordion (components/stage-panel.tsx): 9 trạm gọn — hàng tiêu
//       đề có dot trạng thái + 2 số headline + badge ok/warn, bấm mới mở
//       metrics/charts/basis → trang mặc định vừa 1-2 màn hình, hết dàn trải.
//   (3) Nút "Mở tất cả / Thu gọn" + node "LLM dive → /ai" nhảy trang.
// 0.3.4 — DASHBOARD REDESIGN (tham chiếu flow-map monitoring dashboard):
//   (1) SIDEBAR trái (lg+) điều hướng trạm — bấm item dùng đúng logic goTo
//       (tự mở trạm + cuộn + phát sáng); mobile đổi thành dải chip cuộn ngang.
//   (2) KPI "Net result" (3 thẻ: vốn paper / lệnh dry-run / đề xuất PHE) — số
//       từ khối `flow` cấu trúc mới của /api/stats (không parse chuỗi metrics).
//   (3) RAIL phải: Sự kiện gần đây (10 lệnh thoát mới nhất + vị thế đang mở),
//       Kiểm tra sức khoẻ (5 trạng thái section), Bảng điểm thoát lệnh
//       (TP/SL/Trail/Flip/Manual/Legacy — trail = TP1 partial → runner 0.3.3).
//   TOÀN BỘ nội dung audit + PipeMap + Stage accordion + tabs + công tắc DQF
//   GIỮ NGUYÊN — chỉ thay lớp vỏ bố cục và nền dashboard tối.

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ChartBox } from "@/components/stat-charts";
import { Journal } from "@/components/journal";
import { DeepAnalysis } from "@/components/analysis";
import { StrategyPies } from "@/components/strategy-pies";
import { StrategyLab } from "@/components/strategy-lab";
import { SuggestionHistory } from "@/components/suggestions";
import { PipeMap, type PipeNodeDef } from "@/components/pipe-map";
import { Stage } from "@/components/stage-panel";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fmtPct, t, type Lang } from "@/lib/i18n";
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
  ArrowLeft,
  Bot,
  CheckCircle2,
  Crosshair,
  FlaskConical,
  Globe,
  HelpCircle,
  History,
  Layers,
  LayoutDashboard,
  Radar,
  RefreshCw,
  ScrollText,
  Sparkles,
  Target,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";

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
  /** 0.3.2 — công tắc DQF (sàn chất lượng động) */
  dqfOn?: boolean;
  /** 0.3.4 — khối số liệu cấu trúc cho KPI + rail (khớp src/lib/stats.ts) */
  flow: StatsFlow;
  sections: StatSection[];
}

/** khối flow — hình dạng khớp StatsFlow của src/lib/stats.ts (khai tại chỗ để
 *  trang client không kéo db/engine vào bundle trình duyệt) */
interface StatsFlow {
  universePairs: number;
  scanRows: number;
  scanAgeMin: number | null;
  scanStale: boolean;
  gatePass: number;
  gateBest: string | null;
  bcastPass: number;
  bcastTotal: number;
  open: { symbol: string; side: string; interval: string; hours: number; roe: number | null } | null;
  exits: { tp: number; sl: number; trail: number; flip: number; manual: number; legacy: number };
  closed: number;
  wins: number;
  netPnlPct: number;
  capital: number | null;
  winRateLb: number;
  last7d: number;
  sg: { total: number; win: number; loss: number; flat: number; hitRate: number | null };
  recent: { symbol: string; interval: string; side: string; exitKind: string | null; pnlPct: number | null; exitTime: string | null }[];
}

const PICK_TFS = ["5m", "15m", "1h", "4h"];
// 0.2.38: dùng đúng danh sách cặp tiêu chuẩn của engine (SYMBOLS — 11 staples)
// + giá trị đặc biệt "ALL" = journal gộp mọi cặp qua /api/journal
const PICK_ALL = "ALL";
const PICK_SYMBOLS: readonly string[] = SYMBOLS;

// ─── 0.3.4 — dashboard redesign: bảng màu + điều hướng + helper ─────────────
const APP_VERSION = "0.3.4";
const C = {
  ok: "#34d399", // đạt / xanh lục
  warn: "#fbbf24", // chờ / cần rà soát
  bad: "#f87171", // bị chặn / cắt SL
  info: "#22d3ee", // trail (TP1→Runner)
  flip: "#a78bfa", // đảo chiều
  idle: "#475569", // trống / legacy
};
/** sidebar + chip mobile — key = id trạm (giữ đúng logic goTo mở + cuộn + flash) */
const NAV: { key: string; icon: LucideIcon }[] = [
  { key: "overview", icon: LayoutDashboard },
  { key: "st-market", icon: Activity },
  { key: "st-universe", icon: Globe },
  { key: "st-combo", icon: Target },
  { key: "st-dock", icon: Radar },
  { key: "st-auto", icon: Bot },
  { key: "st-dqf", icon: Layers },
  { key: "st-open", icon: Crosshair },
  { key: "st-hist", icon: History },
  { key: "st-journal", icon: ScrollText },
  { key: "st-lab", icon: FlaskConical },
];

function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (m < 60) return `${Math.max(1, m)}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}
const signed = (v: number, digits = 2): string => `${v >= 0 ? "+" : ""}${v.toFixed(digits)}`;

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
/** 0.2.85 — nền chip headline trên hàng Stage (cùng họ màu với field) */
const TONE_CHIP: Record<StatTone, string> = {
  ok: "bg-emerald-950/70 text-emerald-300",
  warn: "bg-amber-950/70 text-amber-300",
  bad: "bg-rose-950/70 text-rose-300",
  info: "bg-teal-950/70 text-teal-300",
  dim: "bg-zinc-900 text-zinc-400",
};
const toneText = (tone?: StatTone): string => (tone ? TONE_TEXT[tone] : "text-zinc-100");
const toneEdge = (tone?: StatTone): string => (tone ? TONE_EDGE[tone] : "border-l-zinc-800/80");
const toneChip = (tone?: StatTone): string => (tone ? TONE_CHIP[tone] : "bg-zinc-900 text-zinc-300");

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
  /** 0.2.80 — papers nối liền mọi cặp cho bảng tương tác */
  papers: Paper[];
}
/** 0.2.52 — response 1 cặp của /api/journal (chỉ cần kpi + basis)
 *  0.2.80 — thêm papers: bảng journal tương tác cùng nguồn với KPI */
type JournalOneResp = { kpi: KpiStats; basis: number; papers: Paper[] };

// 0.2.85 — 9 trạm của pipeline + id element tương ứng (node PipeMap bấm vào
// đây); thứ tự = luồng suy diễn: thị trường → gate → lệnh → lịch sử → lab
const STAGE_IDS = [
  "st-market",
  "st-universe",
  "st-combo",
  "st-dock",
  "st-auto",
  "st-open",
  "st-hist",
  "st-journal",
  "st-lab",
] as const;
type StageId = (typeof STAGE_IDS)[number];

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
  /** 0.2.80 — danh sách lệnh giấy của card journal (bảng tương tác + CSV) */
  const [journalPapers, setJournalPapers] = useState<Paper[] | null>(null);
  /** 0.2.82 — toàn bộ /api/view của combo đang chọn (pies/n/gate cho tab
   *  Analysis; trước đây chỉ giữ view.analysis cho card Deep analysis cũ) */
  const [view, setView] = useState<ViewPayload | null>(null);
  const [clientBusy, setClientBusy] = useState(false);
  /** 0.2.82 — biến thể Lab áp dụng gần nhất (note xác nhận trong tab) */
  const [labApplied, setLabApplied] = useState<{ name: string; sl: number; tp: number; key: number; period: number } | null>(null);
  /** 0.2.82 — bumped khi bấm Refresh → tab Suggestions/Lab tải lại theo combo */
  const [tabsRefresh, setTabsRefresh] = useState(0);
  /** 0.2.85 — trạm đang mở (accordion) + trạm đang phát vòng sáng */
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [flash, setFlash] = useState<string | null>(null);
  /** 0.3.4 — item sidebar/chip đang hoạt động (đổi khi bấm điều hướng) */
  const [nav, setNav] = useState("overview");
  /** 0.3.2 — công tắc DQF (sàn chất lượng động học từ toàn bộ Elliott session) */
  const [dqfOn, setDqfOn] = useState<boolean>(true);
  const [dqfBusy, setDqfBusy] = useState(false);

  // đồng bộ công tắc DQF từ snapshot (nguồn thật = file server)
  useEffect(() => {
    if (typeof snap?.dqfOn === "boolean") setDqfOn(snap.dqfOn);
  }, [snap?.dqfOn]);

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
        setDqfOn(!on); // lỗi → rollback, giữ nguyên giá trị cũ
      } finally {
        setDqfBusy(false);
      }
    },
    [],
  );

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
          setJournalPapers(j.papers ?? []);
          setView(null);
        } catch {
          if (alive) {
            setJournal(null);
            setJournalPer(null);
            setJournalPapers(null);
            setView(null);
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
      setJournalPapers(j ? j.papers : null);
      setView(v);
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

  /** toggle 1 trạm accordion */
  const toggleStage = useCallback((id: string) => {
    setOpen((o) => ({ ...o, [id]: !o[id] }));
  }, []);

  /** 0.2.85 — bấm node trên PipeMap: TỰ MỞ trạm liên quan → cuộn tới → phát
   *  vòng sáng; node "dive" đặc biệt — nhảy sang /ai (root-cause của LLM nằm
   *  ở đó). rAF: đợi trạm render xong (đã mở) rồi mới đo vị trí cuộn. */
  const goTo = useCallback((id: string) => {
    if (id === "dive") {
      window.location.assign("/ai");
      return;
    }
    setOpen((o) => ({ ...o, [id]: true }));
    requestAnimationFrame(() => {
      const el = document.getElementById(id);
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      setFlash(id);
      window.setTimeout(() => setFlash((f) => (f === id ? null : f)), 1600);
    });
  }, []);

  /** 0.3.4 — điều hướng sidebar/chip: đánh dấu item + dùng đúng goTo (mở trạm
   *  + cuộn + flash); "overview" cuộn lên đầu; "dive" đi thẳng /ai qua goTo. */
  const goNav = useCallback(
    (id: string) => {
      setNav(id);
      if (id === "overview") {
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
      goTo(id);
    },
    [goTo],
  );

  /** 0.2.82 — Lab (dời từ terminal): nạp config biến thể vào utp.settings
   *  (localStorage, merge qua cấu hình ĐÃ LƯU — giữ leverage/utOn của người
   *  dùng). StrategyLab đã markVariantApplied ở DB trước khi onApply chạy;
   *  trang chủ đọc lại cấu hình này ở lần tải kế tiếp (note trong tab nói rõ). */
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
  if (journal) counts[journal.closed > 0 && journal.winRate >= 50 ? "ok" : "warn"] += 1;
  if (view?.analysis) counts.ok += 1;

  // section theo key (0.2.85 — dùng cho Stage trạm, không còn Chapter)
  const byKey: Record<string, StatSection | undefined> = {};
  for (const s of snap?.sections ?? []) byKey[s.key] = s;

  // node PipeMap — id = element id của trạm; active = đang nạp/xử lý
  const pipeNodes: PipeNodeDef[] = [
    { id: "st-market", label: t(lang, "stats.node.market.t"), sub: t(lang, "stats.node.market.sub"), tone: "cyan", active: loading },
    { id: "st-universe", label: t(lang, "stats.node.universe.t"), sub: t(lang, "stats.node.universe.sub"), tone: "sky", active: loading },
    { id: "st-combo", label: t(lang, "stats.node.gate.t"), sub: t(lang, "stats.node.gate.sub"), tone: "amber", active: loading },
    { id: "st-dock", label: t(lang, "stats.node.dock.t"), sub: t(lang, "stats.node.dock.sub"), tone: "violet", active: loading },
    { id: "st-auto", label: t(lang, "stats.node.auto.t"), sub: t(lang, "stats.node.auto.sub"), tone: "emerald", active: loading },
    { id: "st-dqf", label: t(lang, "stats.node.dqf.t"), sub: t(lang, "stats.node.dqf.sub"), tone: "teal", active: loading },
    { id: "st-open", label: t(lang, "stats.node.open.t"), sub: t(lang, "stats.node.open.sub"), tone: "rose", active: loading },
    { id: "st-hist", label: t(lang, "stats.node.hist.t"), sub: t(lang, "stats.node.hist.sub"), tone: "orange", active: loading },
    { id: "st-journal", label: t(lang, "stats.node.journal.t"), sub: t(lang, "stats.node.journal.sub"), tone: "fuchsia", active: clientBusy },
    { id: "st-lab", label: t(lang, "stats.node.lab.t"), sub: t(lang, "stats.node.lab.sub"), tone: "blue", active: clientBusy },
    { id: "dive", label: t(lang, "stats.node.dive.t"), sub: t(lang, "stats.node.dive.sub"), tone: "teal" },
  ];

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

  /** 0.2.85 — chip headline trên hàng trạm: 2 số đầu của section (số được tác
   *  giả đặt đầu luôn là chỉ số nhận diện) + badge ok/warn + độ chính xác */
  const stageAside = (s?: StatSection) =>
    s ? (
      <>
        {s.metrics.slice(0, 2).map((m, i) => (
          <span
            key={i}
            title={lang === "vi" ? m.hintVi ?? m.hint : m.hint}
            className={`hidden items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10px] md:inline-flex ${toneChip(m.tone)}`}
          >
            <span className="text-zinc-500">{m.k}</span>
            <span className="font-semibold">{m.v}</span>
          </span>
        ))}
        {accBadge(s.accPct, s.accNote)}
        {stateBadge(s.state)}
      </>
    ) : null;

  /** nội dung 1 trạm (thay SectionCard cũ — bỏ Card lồng Card): grid metrics +
   *  charts + 2 dòng cơ sở/nhất quán. Field giữ tooltip hover/tap. */
  const secBody = (k: string): ReactNode => {
    const s = byKey[k];
    if (!s) {
      return (
        <p className="rounded-lg border border-dashed border-zinc-800 p-4 text-xs text-zinc-600">
          — {t(lang, "stats.chEmpty")}
        </p>
      );
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
      </div>
    );
  };

  const allOpen = STAGE_IDS.every((id) => open[id]);

  // 0.3.4 — thẻ sơ đồ dùng ở cả nhánh snap / !snap (giữ map hiển thị lúc nạp
  // như 0.3.3); onNodeClick đổi sang goNav để sidebar/chip đồng bộ highlight.
  const pipeCard = (
    <Card className="border-[#1d2433] bg-[#10151f]">
      <CardContent className="py-3">
        <div className="flex flex-wrap items-center justify-between gap-2 px-1 pb-1.5">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-zinc-100">{t(lang, "stats.flow.title")}</p>
            <p className="truncate text-[11px] text-zinc-500">{t(lang, "stats.flow.sub")}</p>
          </div>
          <span className="hidden text-[10px] text-zinc-500 md:inline">🖱️ {t(lang, "stats.hoverHint")}</span>
        </div>
        <PipeMap nodes={pipeNodes} onNodeClick={goNav} hint={t(lang, "flow.hint")} />
      </CardContent>
    </Card>
  );

  return (
    <div className="min-h-screen bg-[#0a0e15] text-zinc-200">
      <div className="mx-auto flex max-w-[1600px]">
        {/* ─── 0.3.4 — SIDEBAR điều hướng trạm (lg+); bấm item tự mở + cuộn + flash ── */}
        <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col justify-between border-r border-[#161c29] bg-[#0b0f17] px-3 py-4 lg:flex">
          <div>
            <div className="flex items-center gap-2 px-2 pb-5">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#16202f]">
                <Activity className="h-4 w-4 text-emerald-400" />
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-bold tracking-widest text-zinc-100">{t(lang, "stats.nav.brand")}</p>
                <p className="truncate text-[10px] uppercase tracking-wider text-zinc-500">{t(lang, "stats.nav.brandSub")}</p>
              </div>
            </div>
            <nav className="space-y-0.5">
              {NAV.map((n) => (
                <button
                  key={n.key}
                  onClick={() => goNav(n.key)}
                  className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors ${
                    nav === n.key ? "bg-[#16202f] text-zinc-100" : "text-zinc-500 hover:bg-[#131926] hover:text-zinc-300"
                  }`}
                >
                  <n.icon className={`h-3.5 w-3.5 shrink-0 ${nav === n.key ? "text-emerald-400" : ""}`} />
                  <span className="truncate text-xs font-medium">{t(lang, `stats.nav.${n.key}`)}</span>
                </button>
              ))}
            </nav>
          </div>
          <div className="space-y-1 px-2">
            <Link href="/" className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-medium text-zinc-500 transition-colors hover:bg-[#131926] hover:text-zinc-300">
              <ArrowLeft className="h-3.5 w-3.5" /> {t(lang, "stats.nav.terminal")}
            </Link>
            <Link href="/ai" className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-medium text-zinc-500 transition-colors hover:bg-[#131926] hover:text-zinc-300">
              <Sparkles className="h-3.5 w-3.5" /> {t(lang, "stats.nav.ai")}
            </Link>
            <p className="px-2.5 pb-1 pt-2 text-[10px] leading-relaxed text-zinc-600">
              v{APP_VERSION} · {t(lang, "stats.nav.paper")}
            </p>
          </div>
        </aside>

        <main className="min-w-0 flex-1 p-3 sm:p-5">
          <div className="space-y-4">
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
          <Button size="sm" className="h-8 gap-1.5 bg-zinc-100 px-2.5 text-xs text-zinc-900 hover:bg-zinc-200" disabled={loading} onClick={() => { setTabsRefresh((k) => k + 1); void load(); }}>
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

        {/* dải chip điều hướng cho mobile (0.3.4) */}
        <div className="flex gap-1.5 overflow-x-auto pb-1 lg:hidden">
          {NAV.map((n) => (
            <button
              key={n.key}
              onClick={() => goNav(n.key)}
              className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                nav === n.key
                  ? "border-[#233149] bg-[#16202f] text-zinc-100"
                  : "border-[#1d2433] bg-[#10151f] text-zinc-500 hover:text-zinc-300"
              }`}
            >
              <n.icon className={`h-3 w-3 ${nav === n.key ? "text-emerald-400" : ""}`} />
              {t(lang, `stats.nav.${n.key}`)}
            </button>
          ))}
        </div>

        {/* ── 0.3.4 — dashboard row: PipeMap + KPI “Net result” trái · Events/Health/Scorecard phải.
            Khi chưa có snap: chỉ hiện thẻ sơ đồ như 0.3.3 (kèm skeleton trạm phía dưới). ── */}
        {snap ? (
          <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_300px]">
            <div className="min-w-0 space-y-3">
              {pipeCard}
              <div className="grid gap-3 sm:grid-cols-3">
                <KpiCard
                  title={t(lang, "stats.kpi.equity")}
                  big={snap.flow.capital != null ? `$${snap.flow.capital.toFixed(2)}` : "—"}
                  bigColor={snap.flow.netPnlPct > 0 ? C.ok : snap.flow.netPnlPct < 0 ? C.bad : "#e2e8f0"}
                  sub="start $1000"
                  rows={[
                    { k: "Net ROE sum", v: signed(snap.flow.netPnlPct) + "%", color: snap.flow.netPnlPct > 0 ? C.ok : snap.flow.netPnlPct < 0 ? C.bad : C.idle },
                    { k: t(lang, "stats.kpi.wilson"), v: `${snap.flow.winRateLb.toFixed(0)}%`, color: snap.flow.winRateLb >= 50 ? C.ok : snap.flow.winRateLb >= 30 ? C.warn : C.bad },
                  ]}
                />
                <KpiCard
                  title={t(lang, "stats.kpi.trades")}
                  big={String(snap.flow.closed)}
                  bigColor="#e2e8f0"
                  sub={`${snap.flow.wins} ${t(lang, "stats.kpi.wins")} · ${Math.max(0, snap.flow.closed - snap.flow.wins)} ${t(lang, "stats.kpi.losses")}`}
                  rows={[
                    { k: "TP / SL", v: `${snap.flow.exits.tp} / ${snap.flow.exits.sl}` },
                    { k: "Trail / Flip", v: `${snap.flow.exits.trail} / ${snap.flow.exits.flip}` },
                    { k: t(lang, "stats.kpi.last7d"), v: `${snap.flow.last7d}`, color: C.info },
                  ]}
                />
                <KpiCard
                  title={t(lang, "stats.kpi.signals")}
                  big={snap.flow.sg.hitRate != null ? `${snap.flow.sg.hitRate.toFixed(0)}%` : "—"}
                  bigColor={snap.flow.sg.hitRate == null ? "#e2e8f0" : snap.flow.sg.hitRate >= 50 ? C.ok : snap.flow.sg.hitRate >= 40 ? C.warn : C.bad}
                  sub="side-aware hit-rate"
                  rows={[
                    { k: `${t(lang, "stats.kpi.wins")} / ${t(lang, "stats.kpi.losses")}`, v: `${snap.flow.sg.win} / ${snap.flow.sg.loss}` },
                    { k: t(lang, "stats.kpi.flat"), v: `${snap.flow.sg.flat}`, color: C.idle },
                    { k: t(lang, "stats.kpi.await"), v: `${snap.flow.sg.total - snap.flow.sg.win - snap.flow.sg.loss - snap.flow.sg.flat}`, color: C.warn },
                  ]}
                />
              </div>
            </div>
            <div className="min-w-0 space-y-3">
              <EventsCard flow={snap.flow} lang={lang} />
              <HealthCard sections={snap.sections} lang={lang} warnCount={counts.warn} />
              <ScoreCard flow={snap.flow} lang={lang} />
            </div>
          </div>
        ) : (
          pipeCard
        )}

        {err && !snap && (
          <Card className="border-rose-900 bg-rose-950/30">
            <CardContent className="flex items-center gap-2 p-4 text-sm text-rose-300">
              <TriangleAlert className="h-4 w-4" /> {err}
            </CardContent>
          </Card>
        )}

        {!snap && !err && (
          <div className="space-y-2">
            {STAGE_IDS.map((id) => (
              <Skeleton key={id} className="h-12 rounded-xl border border-zinc-800 bg-zinc-900" />
            ))}
          </div>
        )}

        {snap && (
          <div className="space-y-2">
            {/* nút gom/mở toàn bộ — mặc định trang thu gọn cho hết dàn trải */}
            <div className="flex items-center justify-end">
              <Button
                size="sm"
                variant="ghost"
                className="h-7 gap-1 px-2 text-[11px] text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200"
                onClick={() => {
                  const next: Record<string, boolean> = {};
                  if (!allOpen) for (const id of STAGE_IDS) next[id] = true;
                  setOpen(next);
                }}
              >
                {allOpen ? t(lang, "ui.collapseAll") : t(lang, "ui.expandAll")}
              </Button>
            </div>

            {/* ── 9 trạm theo luồng suy diễn ── */}
            <Stage
              id="st-market"
              tone="cyan"
              title={t(lang, "stats.section.market")}
              note={t(lang, "stats.ch1.note")}
              active={loading}
              open={!!open["st-market"]}
              flashing={flash === "st-market"}
              onToggle={() => toggleStage("st-market")}
              aside={stageAside(byKey.market)}
            >
              {secBody("market")}
            </Stage>

            <Stage
              id="st-universe"
              tone="sky"
              title={t(lang, "stats.section.universe")}
              note={t(lang, "stats.ch1.note")}
              active={loading}
              open={!!open["st-universe"]}
              flashing={flash === "st-universe"}
              onToggle={() => toggleStage("st-universe")}
              aside={stageAside(byKey.universe)}
            >
              {secBody("universe")}
            </Stage>

            <Stage
              id="st-combo"
              tone="amber"
              title={t(lang, "stats.section.combo")}
              note={t(lang, "stats.ch2.note")}
              active={loading}
              open={!!open["st-combo"]}
              flashing={flash === "st-combo"}
              onToggle={() => toggleStage("st-combo")}
              aside={stageAside(byKey.combo)}
            >
              {secBody("combo")}
            </Stage>

            <Stage
              id="st-dock"
              tone="violet"
              title={t(lang, "stats.section.dock")}
              note={t(lang, "stats.ch2.note")}
              active={loading}
              open={!!open["st-dock"]}
              flashing={flash === "st-dock"}
              onToggle={() => toggleStage("st-dock")}
              aside={stageAside(byKey.dock)}
            >
              {secBody("dock")}
            </Stage>

            <Stage
              id="st-auto"
              tone="emerald"
              title={t(lang, "stats.section.auto")}
              note={t(lang, "stats.ch3.note")}
              active={loading}
              open={!!open["st-auto"]}
              flashing={flash === "st-auto"}
              onToggle={() => toggleStage("st-auto")}
              aside={stageAside(byKey.auto)}
            >
              {secBody("auto")}
            </Stage>

            {/* 0.3.2 — DQF: sàn chất lượng động học từ toàn bộ Elliott session */}
            <Stage
              id="st-dqf"
              tone="teal"
              title={t(lang, "stats.section.dqf")}
              note={t(lang, "stats.ch3.note")}
              active={loading}
              open={!!open["st-dqf"]}
              flashing={flash === "st-dqf"}
              onToggle={() => toggleStage("st-dqf")}
              aside={stageAside(byKey.dqf)}
            >
              <div className="mb-2.5 flex items-center justify-between gap-3 rounded-md border border-zinc-800 bg-zinc-950/40 px-3 py-2">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-zinc-200">{t(lang, "stats.dqf.toggle")}</p>
                  <p className="text-[10px] leading-snug text-zinc-500">{t(lang, "stats.dqf.toggle.sub")}</p>
                </div>
                <Switch
                  checked={dqfOn}
                  disabled={dqfBusy}
                  onCheckedChange={(v) => void toggleDqf(v)}
                  aria-label={t(lang, "stats.dqf.toggle")}
                />
              </div>
              {secBody("dqf")}
            </Stage>

            <Stage
              id="st-open"
              tone="rose"
              title={t(lang, "stats.section.open")}
              note={t(lang, "stats.ch3.note")}
              active={loading}
              open={!!open["st-open"]}
              flashing={flash === "st-open"}
              onToggle={() => toggleStage("st-open")}
              aside={stageAside(byKey.open)}
            >
              {secBody("open")}
            </Stage>

            {/* hist + sg gom 1 trạm — cùng là "kết quả đã chốt" */}
            <Stage
              id="st-hist"
              tone="orange"
              title={`${t(lang, "stats.section.hist")} · ${t(lang, "stats.section.sg")}`}
              note={t(lang, "stats.ch4.note")}
              active={loading}
              open={!!open["st-hist"]}
              flashing={flash === "st-hist"}
              onToggle={() => toggleStage("st-hist")}
              aside={stageAside(byKey.hist)}
            >
              <div className="grid gap-3 xl:grid-cols-2">
                {secBody("hist")}
                {secBody("sg")}
              </div>
            </Stage>

            {/* ── Trade journal — tính Ở SERVER, luôn qua /api/journal (200 nến, 0.2.52) ── */}
            <Stage
              id="st-journal"
              tone="fuchsia"
              title={`${t(lang, "stats.section.journal")} · ${pickSym === PICK_ALL ? t(lang, "stats.pick.all") : pickSym.replace("USDT", "")} ${pickTf}`}
              note={t(lang, "stats.ch4.note")}
              active={clientBusy}
              open={!!open["st-journal"]}
              flashing={flash === "st-journal"}
              onToggle={() => toggleStage("st-journal")}
              aside={
                journal ? (
                  <>
                    <span className={`hidden rounded px-1.5 py-0.5 font-mono text-[10px] md:inline ${TONE_CHIP[journal.closed > 0 && journal.winRate >= 50 ? "ok" : "warn"]}`}>
                      WR {journal.winRate.toFixed(0)}%
                    </span>
                    {accBadge(journal.closed > 0 ? journal.winRate : 0, `${journal.closed} closed`)}
                  </>
                ) : null
              }
            >
              <div className="space-y-2.5">
                {journal ? (
                  <>
                    <div className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
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
                    {/* 0.2.80 — bảng journal tương tác: CÙNG nguồn /api/journal với
                        các ô KPI phía trên nên số liệu khớp 1:1 (cùng cửa sổ 200
                        nến, cùng default settings). ALL: trộn mọi cặp + cột Symbol
                        + bảng con theo cặp phía dưới vẫn giữ nguyên. */}
                    <div className="border-t border-zinc-800/70 pt-2.5">
                      <Journal
                        lang={lang}
                        papers={journalPapers ?? []}
                        symbol={pickSym}
                        interval={pickTf}
                        bare
                        showSymbol={pickSym === PICK_ALL}
                        maxListClass="max-h-[26rem]"
                      />
                    </div>
                  </>
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
              </div>
            </Stage>

            {/* ── Lab & Phân tích: bộ chọn combo + 3 tab terminal ── */}
            <Stage
              id="st-lab"
              tone="blue"
              title={t(lang, "stats.section.analysis")}
              note={t(lang, "stats.ch5.note")}
              active={clientBusy}
              open={!!open["st-lab"]}
              flashing={flash === "st-lab"}
              onToggle={() => toggleStage("st-lab")}
            >
              {/* combo picker cho 2 section client-side */}
              <div className="mb-2.5 flex flex-wrap items-center gap-2">
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
              </div>

              {/* 0.2.82 — TERMINAL TABS (dời từ trang chủ): Suggestions / Lab /
                  Analysis — cùng bộ chọn pickSym/pickTf phía trên điều khiển;
                  ALL: Suggestions khoá scope "all" (forceAll), Lab + Analysis
                  yêu cầu cặp cụ thể. Lab Apply ghi utp.settings → trang chủ đọc
                  ở lần tải kế tiếp (note xác nhận ngay trong tab). */}
              <Tabs defaultValue="suggest">
                <TabsList className="h-8 w-full justify-start overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-900 p-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  <TabsTrigger
                    value="suggest"
                    className="h-7 shrink-0 rounded-md px-3 text-xs data-[state=active]:bg-zinc-800 data-[state=active]:text-zinc-100"
                  >
                    {t(lang, "tabs.suggest")}
                  </TabsTrigger>
                  <TabsTrigger
                    value="lab"
                    className="h-7 shrink-0 rounded-md px-3 text-xs data-[state=active]:bg-zinc-800 data-[state=active]:text-zinc-100"
                  >
                    {t(lang, "tabs.lab")}
                  </TabsTrigger>
                  <TabsTrigger
                    value="analysis"
                    className="h-7 shrink-0 rounded-md px-3 text-xs data-[state=active]:bg-zinc-800 data-[state=active]:text-zinc-100"
                  >
                    {t(lang, "tabs.analysis")}
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="suggest" className="mt-2.5">
                  <SuggestionHistory
                    lang={lang}
                    symbol={pickSym}
                    interval={pickTf}
                    refreshKey={tabsRefresh}
                    forceAll={pickSym === PICK_ALL}
                  />
                </TabsContent>
                <TabsContent value="lab" className="mt-2.5">
                  {pickSym === PICK_ALL ? (
                    <p className="rounded-lg border border-dashed border-zinc-800 p-6 text-center text-xs text-zinc-500">
                      {t(lang, "stats.labAll")}
                    </p>
                  ) : (
                    <>
                      {labApplied && (
                        <p className="mb-2.5 rounded-lg border border-teal-800/60 bg-teal-950/30 px-3 py-2 text-[11px] leading-relaxed text-teal-300">
                          {t(lang, "sl.applyToast", {
                            name: labApplied.name,
                            sl: labApplied.sl.toFixed(1),
                            tp: labApplied.tp.toFixed(1),
                            key: String(labApplied.key),
                            period: String(labApplied.period),
                          })}{" "}
                          · {t(lang, "stats.labApplied")}
                        </p>
                      )}
                      <StrategyLab
                        lang={lang}
                        symbol={pickSym}
                        interval={pickTf}
                        refreshKey={tabsRefresh}
                        onApply={applyVariantStats}
                      />
                    </>
                  )}
                </TabsContent>
                <TabsContent value="analysis" className="mt-2.5">
                  {pickSym === PICK_ALL ? (
                    <p className="text-xs leading-relaxed text-zinc-500">— {t(lang, "stats.analysisAll")}</p>
                  ) : view ? (
                    <div className="space-y-2.5">
                      {/* 0.2.82 — DeepAnalysis + pies thay card Deep analysis cũ:
                          cùng /api/view + DEFAULT_SETTINGS (một nguồn sự thật với
                          cửa sổ journal), thêm ô cổng SMA + 3 donut preset —
                          giữ basis note của card cũ. */}
                      <DeepAnalysis
                        lang={lang}
                        a={view.analysis}
                        smaFilter={DEFAULT_SETTINGS.smaFilter}
                        smaPeriod={DEFAULT_SETTINGS.smaPeriod}
                        gateLong={view.gate.long}
                        gateShort={view.gate.short}
                        smaValue={view.gate.sma}
                      />
                      <StrategyPies
                        lang={lang}
                        pies={view.pies}
                        n={view.n}
                        leverage={DEFAULT_SETTINGS.leverage}
                      />
                      <div className="space-y-1.5 rounded-md border border-zinc-800 bg-zinc-950/40 p-2.5">
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
            </Stage>
          </div>
        )}
          </div>
        </main>
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

// ─── 0.3.4 — KPI "Net result" (thẻ số lớn + hàng nhỏ, số từ flow cấu trúc) ───
function KpiCard({ title, big, bigColor, sub, rows }: {
  title: string;
  big: string;
  bigColor: string;
  sub: string;
  rows: { k: string; v: string; color?: string }[];
}) {
  return (
    <div className="rounded-xl border border-[#1d2433] bg-[#10151f] px-4 py-3">
      <p className="truncate text-[10px] uppercase tracking-wide text-zinc-500">{title}</p>
      <p className="mt-1 font-mono text-2xl font-bold" style={{ color: bigColor }}>{big}</p>
      <p className="truncate text-[10px] text-zinc-500">{sub}</p>
      <div className="mt-2.5 space-y-1.5 border-t border-[#1a2130] pt-2.5">
        {rows.map((r, i) => (
          <div key={i} className="flex items-center justify-between gap-2 text-[11px]">
            <span className="truncate text-zinc-500">{r.k}</span>
            <span className="shrink-0 font-mono font-semibold" style={{ color: r.color ?? "#e2e8f0" }}>{r.v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── 0.3.4 — Rail: Sự kiện gần đây (vị thế đang mở + 10 lệnh thoát mới nhất) ──
function EventsCard({ flow, lang }: { flow: StatsFlow; lang: Lang }) {
  const kindColor = (kind: string | null): string =>
    kind === "tp" ? C.ok : kind === "sl" ? C.bad : kind === "trail" ? C.info : kind === "flip" ? C.flip : kind === "manual" ? C.warn : C.idle;
  const rows: { color: string; line1: string; line2: string; time: string }[] = [];
  if (flow.open) {
    rows.push({
      color: C.warn,
      line1: `${t(lang, "stats.flow.pos.open")} · ${flow.open.side} ${flow.open.symbol.replace("USDT", "")} ${flow.open.interval}`,
      line2: `${flow.open.hours.toFixed(1)}h${flow.open.roe != null ? ` · ROE ${signed(flow.open.roe)}%` : ""}`,
      time: "now",
    });
  }
  for (const r of flow.recent) {
    rows.push({
      color: kindColor(r.exitKind),
      line1: `${(r.exitKind ?? "—").toUpperCase()} · ${r.symbol.replace("USDT", "")} ${r.interval}`,
      line2: `${r.side}${r.pnlPct != null ? ` · ${signed(r.pnlPct)}%` : ""}`,
      time: timeAgo(r.exitTime),
    });
  }
  return (
    <div className="rounded-xl border border-[#1d2433] bg-[#10151f] px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-300">{t(lang, "stats.rail.events")}</p>
        <span className="flex h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
      </div>
      <div className="mt-2 max-h-[200px] space-y-1.5 overflow-y-auto pr-1">
        {rows.length === 0 ? (
          <p className="py-3 text-center text-[11px] leading-relaxed text-zinc-600">{t(lang, "stats.rail.noEvents")}</p>
        ) : (
          rows.slice(0, 12).map((e, i) => (
            <div key={i} className="flex items-start gap-2 rounded-md px-1 py-0.5 hover:bg-[#131926]">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: e.color }} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[11px] font-medium text-zinc-200">{e.line1}</p>
                <p className="truncate font-mono text-[10px] text-zinc-500">{e.line2}</p>
              </div>
              <span className="shrink-0 text-[10px] text-zinc-600">{e.time}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ─── 0.3.4 — Rail: Kiểm tra sức khoẻ (trạng thái section, server gắn state) ──
function HealthCard({ sections, lang, warnCount }: { sections: StatSection[]; lang: Lang; warnCount: number }) {
  const stateOf = (key: string): "ok" | "warn" | "na" => sections.find((s) => s.key === key)?.state ?? "na";
  const items: { key: string; label: string }[] = [
    { key: "market", label: t(lang, "stats.health.market") },
    { key: "universe", label: t(lang, "stats.health.universe") },
    { key: "dock", label: t(lang, "stats.health.scan") },
    { key: "auto", label: t(lang, "stats.health.equity") },
    { key: "dqf", label: t(lang, "stats.health.dqf") },
  ];
  const pill = (state: "ok" | "warn" | "na") => (
    <span
      className={`shrink-0 rounded-full px-2 py-0.5 font-mono text-[9px] font-semibold uppercase ${
        state === "ok" ? "bg-emerald-950 text-emerald-400" : state === "warn" ? "bg-amber-950 text-amber-400" : "bg-zinc-800 text-zinc-400"
      }`}
    >
      {state === "ok" ? "OK" : state === "warn" ? "WARN" : "N/A"}
    </span>
  );
  return (
    <div className="rounded-xl border border-[#1d2433] bg-[#10151f] px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-300">{t(lang, "stats.rail.health")}</p>
        {warnCount > 0 && (
          <span className="rounded-full bg-amber-950 px-2 py-0.5 text-[9px] font-semibold uppercase text-amber-400">
            {t(lang, "stats.rail.warnCount", { n: warnCount })}
          </span>
        )}
      </div>
      <div className="mt-2 space-y-1.5">
        {items.map((it) => (
          <div key={it.key} className="flex items-center justify-between gap-2">
            <span className="truncate text-[11px] text-zinc-400">{it.label}</span>
            {pill(stateOf(it.key))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── 0.3.4 — Rail: Bảng điểm thoát lệnh (trail = TP1 partial → runner 0.3.3) ──
function ScoreCard({ flow, lang }: { flow: StatsFlow; lang: Lang }) {
  const e = flow.exits;
  const rows: { label: string; n: number; color: string }[] = [
    { label: t(lang, "stats.score.tp"), n: e.tp, color: C.ok },
    { label: t(lang, "stats.score.sl"), n: e.sl, color: C.bad },
    { label: t(lang, "stats.score.trail"), n: e.trail, color: C.info },
    { label: t(lang, "stats.score.flip"), n: e.flip, color: C.flip },
    { label: t(lang, "stats.score.manual"), n: e.manual, color: C.warn },
    { label: t(lang, "stats.score.legacy"), n: e.legacy, color: C.idle },
  ];
  const total = Math.max(1, flow.closed);
  return (
    <div className="rounded-xl border border-[#1d2433] bg-[#10151f] px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-300">{t(lang, "stats.rail.scorecard")}</p>
        <span className="font-mono text-[10px] text-zinc-500">{flow.closed} closed</span>
      </div>
      <div className="mt-2 space-y-2">
        {rows.map((r) => (
          <div key={r.label}>
            <div className="flex items-center justify-between gap-2 text-[10px]">
              <span className="truncate text-zinc-400">{r.label}</span>
              <span className="shrink-0 font-mono text-zinc-300">
                {r.n} · {Math.round((r.n / total) * 100)}%
              </span>
            </div>
            <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-[#161c29]">
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${r.n > 0 ? Math.max(3, (r.n / total) * 100) : 0}%`, background: r.color }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
