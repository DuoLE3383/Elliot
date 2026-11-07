"use client";

// ─── /ai — AI & Settings hub ─────────────────────────────────────────────────
// Answers three questions:
//   1. Is the system healthy — live engine config + LLM Risk Officer status
//   2. How much data has the AI learned (DB runs + dry-run lessons)
//   3. System settings — IN A POPUP (header "Settings" button, 0.2.76):
//      tab "System" = params.ts safe set edited in place (db/params-override.json,
//      effective next tick) · tab "LLM" = Risk Officer connection (URL/model/
//      timeout/fail-closed). Nothing editable sits in the long page body anymore.
// 0.2.76 cleanup: status cards lead the page, static education collapsed into
// "About" at the bottom, evo + stats-dive share a row (xl), sticky header keeps
// Settings / Refresh / lang reachable on the long scroll. 0.2.83: page
// background is now the GLOBAL animated TechBackground (circuit-tech navy) —
// this root is transparent, header tints navy translucent for the blur.
// Data: GET /api/ai-info — read-only, manual refresh + auto every 60s.

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ParamsEditor } from "@/components/params-editor";
import { t, type Lang } from "@/lib/i18n";
import { loadAutoConfig, saveAutoConfig } from "@/lib/autotrade";
import { fetchDiveReports, type DiveReportRow } from "@/lib/history";
import { DEFAULT_SETTINGS, migratePairsTo, type EngineSettings } from "@/lib/types";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  BrainCircuit,
  ChevronDown,
  ChevronUp,
  Crown,
  Database,
  Dna,
  FlaskConical,
  History,
  Loader2,
  RefreshCw,
  ShieldCheck,
  ShieldX,
  SlidersHorizontal,
  Target,
  UploadCloud,
  ScrollText,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

interface RunRow {
  id: string;
  symbol: string;
  interval: string;
  kind: string;
  samples: number;
  valSamples: number;
  acc: number;
  auc: number;
  logloss: number;
  trees: number;
  horizon: number;
  params: { lr?: number; depth?: number; lambda?: number } | null;
  applied: boolean;
  createdAt: string;
}

interface ChampionRow {
  symbol: string;
  interval: string;
  acc: number;
  auc: number;
  params: { lr?: number; depth?: number; lambda?: number } | null;
  createdAt: string;
}

interface LlmTestInfo {
  ok: boolean;
  verdict: { verdict: "go" | "skip"; confidence: number; reasons: string[]; ms: number } | null;
  raw: string;
  detail: string;
  prompt: string;
  url: string;
  model: string;
  ms: number;
  bodySnippet?: string;
  /** setup dùng cho lần test này — THẬT (top scan engine) hay GIẢ mẫu */
  setupSource?: string;
}

interface KnobGroup {
  name: string;
  note: string;
  items: [string, unknown][];
}

interface RelBucket {
  label: string;
  n: number;
  wins: number;
  /** win rate %, -1 = chưa có mẫu */
  wr: number;
}

interface AutopsyRow {
  symbol: string;
  interval: string;
  side: string;
  exitKind: string | null;
  pnlPct: number | null;
  exitTime: string | null;
  tag: string;
  why: string[];
  lesson: string;
  ev: { mfePct?: number; maePct?: number; rMultiple?: number; durMin?: number } | null;
}

interface AiInfo {
  runs: RunRow[];
  champions: ChampionRow[];
  autoStats: { opened: number; closed: number; wins: number; lessonSamples: number; lessonWeight: number };
  /** giải phẫu lệnh (0.2.28) — tổng + 8 bài gần nhất, win lẫn loss */
  autopsies?: { n: number; recent: AutopsyRow[]; error: boolean };
  reliability: {
    trades: { n: number; buckets: RelBucket[] };
    phe: { n: number; buckets: RelBucket[] };
    errors: { trades: boolean; phe: boolean };
  };
  db: { runsError: boolean };
  build: string;
  engine: {
    synced: boolean;
    syncedAt: number | null;
    pairs: number;
    cfg: {
      minAuc: number;
      minAcc: number;
      minScore: number;
      leverage: number;
      /** AutoConfig.riskPct — % equity mỗi lệnh */
      riskPct: number;
      dcaMax: number;
      cooldownMin: number;
      llmUrl: string;
      llmModel: string;
      whaleFilter: boolean;
      broadcast: boolean;
      runTf: string[];
    } | null;
    workers: { pool: number; bundled: boolean };
    telegram: boolean;
    leverage: number;
    llmLast: { symbol: string; interval: string; side: string; verdict: string; reason: string; ms: number; at: number } | null;
    cycle: { lastAt: number; status: string; nextAt: number };
  } | null;
  llm: {
    url: string;
    /** "env" | "engine" | "default" — URL đang ăn từ nguồn nào */
    urlSource?: string;
    ping: { ok: boolean; ms: number; detail?: string };
    failClosed: boolean;
  };
  knobs: KnobGroup[];
}

interface EvoMetrics {
  trades: number;
  winRate: number;
  expectancy: number;
  maxDd: number;
}

interface EvoLabCfg {
  slPct: number;
  tpPct: number;
  atrKey: number;
  atrPeriod: number;
  smaFilter: boolean;
  smaPeriod: number;
}

interface EvoInfo {
  on: boolean;
  llmLane: boolean;
  roundMin: number;
  cooldownH: number;
  watchN: number;
  minTrades: number;
  margin: number;
  active: {
    id: string;
    at: string;
    combo: string;
    name: string;
    detail: string;
    cfgBefore: EvoLabCfg | null;
    cfgAfter: EvoLabCfg | null;
    metrics: { base?: EvoMetrics; best?: EvoMetrics } | null;
  } | null;
  watch: { n: number; need: number } | null;
  history: { at: string; combo: string; decision: string; name: string; detail: string; cfgAfter: string; cfgBefore: string; metrics: string | null }[];
}

/** LabConfig → 1 dòng gọn cho UI */
const evoCfg = (c: EvoLabCfg | null): string =>
  c ? `SL ${c.slPct}% · TP ${c.tpPct}% · UT ${c.atrKey}·${c.atrPeriod} · SMA${c.smaFilter ? c.smaPeriod : "off"}` : "—";

const evoBadge = (d: string): string =>
  d === "promote"
    ? "border-emerald-800 bg-emerald-950/40 text-emerald-300"
    : d === "revert"
      ? "border-amber-800 bg-amber-950/40 text-amber-300"
      : d === "confirm"
        ? "border-teal-800 bg-teal-950/40 text-teal-300"
        : d === "error"
          ? "border-rose-800 bg-rose-950/40 text-rose-300"
          : "border-zinc-700 bg-zinc-900 text-zinc-400";

const hyper = (p: { lr?: number; depth?: number; lambda?: number } | null): string =>
  p ? `lr ${p.lr ?? "—"} · d${p.depth ?? "—"} · λ${p.lambda ?? "—"}` : "—";

/** màu verdict: go = xanh, skip = đỏ, unreachable = vàng */
const verdictCls = (v: string): string =>
  v === "go" ? "text-emerald-400" : v === "skip" ? "text-rose-400" : "text-amber-400";

/** 300000ms → "300s" — đọc nhanh hơn ms thô trên dòng "Latest review" */
const fmtMs = (ms: number): string => (ms >= 1000 ? `${(ms / 1000).toFixed(ms % 1000 ? 1 : 0)}s` : `${ms}ms`);

/** ẨN đường dẫn LLM trên UI (ảnh chụp sẽ lộ IP nội bộ) — chỉ hiện local/remote */
const llmScope = (url: string): string => {
  if (!url) return "—";
  try {
    const host = new URL(url).hostname;
    return /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|localhost|::1)$/i.test(host) ? "local" : "remote";
  } catch {
    return "remote";
  }
};

export default function AiPage() {
  const [lang, setLang] = useState<Lang>("en");
  const [data, setData] = useState<AiInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [at, setAt] = useState(0);
  const [syncState, setSyncState] = useState<"idle" | "sending" | "ok" | "fail">("idle");
  const [champAll, setChampAll] = useState(false);
  const [llmTest, setLlmTest] = useState<LlmTestInfo | null>(null);
  const [llmTestBusy, setLlmTestBusy] = useState(false);
  // editable LLM setup (synced to engine via /api/engine) — 0.2.76 sống trong
  // tab "LLM" của popup Settings (giá trị vẫn seed từ localStorage + engine)
  const [llmDraftUrl, setLlmDraftUrl] = useState("");
  const [llmDraftModel, setLlmDraftModel] = useState("local");
  const [llmDraftTimeout, setLlmDraftTimeout] = useState(90);
  const [llmDraftFailClosed, setLlmDraftFailClosed] = useState(false);
  const [llmSaveState, setLlmSaveState] = useState<"idle" | "saving" | "ok" | "fail">("idle");

  // 0.2.76 — Settings popup: tab mặc định là tham số hệ thống; card LLM bấm
  // "Cấu hình LLM" thì mở thẳng tab LLM.
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<"system" | "llm">("system");
  // phần giải thích tĩnh (2 lớp AI + Prob) gấp gọn mặc định — dọn dãy dọc
  const [aboutOpen, setAboutOpen] = useState(false);

  // seed LLM form from localStorage + engine snapshot
  useEffect(() => {
    try {
      const c = loadAutoConfig();
      setLlmDraftUrl(c.llmUrl || "");
      setLlmDraftModel(c.llmModel || "local");
      setLlmDraftTimeout(c.llmTimeoutSec || 300);
      setLlmDraftFailClosed(c.llmFailClosed === true);
    } catch {
      /* ignore */
    }
  }, [data?.engine?.syncedAt]);

  // ── Tự tiến hoá (0.2.54) — trạng thái vòng + lịch sử quyết định ──────────
  const [evo, setEvo] = useState<EvoInfo | null>(null);
  const [evoBusy, setEvoBusy] = useState(false);
  const [evoMsg, setEvoMsg] = useState("");

  useEffect(() => {
    const f = async (): Promise<void> => {
      try {
        const r = await fetch("/api/evolve", { cache: "no-store" });
        if (r.ok) setEvo((await r.json()) as EvoInfo);
      } catch {
        /* giữ data cũ */
      }
    };
    void f();
    const iv = setInterval(() => void f(), 60_000);
    return () => clearInterval(iv);
  }, []);

  const runEvolve = useCallback(async () => {
    setEvoBusy(true);
    try {
      const r = await fetch("/api/evolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "run" }),
      });
      if (r.ok) {
        const j = (await r.json()) as { decision: string; note: string };
        setEvoMsg(`${j.decision}: ${j.note.slice(0, 140)}`);
        const g = await fetch("/api/evolve", { cache: "no-store" });
        if (g.ok) setEvo((await g.json()) as EvoInfo);
      } else {
        setEvoMsg(`http-${r.status}`);
      }
    } catch {
      setEvoMsg("error");
    } finally {
      setEvoBusy(false);
    }
  }, []);


  // 0.2.32 — "phân tích nguyên nhân gốc": LLM đọc snapshot thống kê (/api/stats) và chỉ
  // ra điểm yếu/mâu thuẫn — cùng nguồn số liệu nên không thể lệch bảng /stats
  const [statsDive, setStatsDive] = useState<{ ok: boolean; text: string; detail: string; ms: number } | null>(null);
  const [statsDiveBusy, setStatsDiveBusy] = useState(false);
  // 0.2.36 — lịch sử các lần dive ĐÃ LƯU trong DB (DiveReport) — đối chiếu theo
  // thời gian: LLM kết luận gì hôm nay, có đổi ý so với đợt trước không.
  const [diveHistory, setDiveHistory] = useState<DiveReportRow[] | null>(null);
  const [diveHistoryOpen, setDiveHistoryOpen] = useState(false);

  const loadDiveHistory = useCallback(async () => {
    try {
      const rows = await fetchDiveReports(8);
      setDiveHistory(rows);
    } catch {
      setDiveHistory((prev) => prev ?? []);
    }
  }, []);

  useEffect(() => {
    void loadDiveHistory();
  }, [loadDiveHistory]);

  useEffect(() => {
    // English is the app's main language (0.2.58): boot EN every visit — the
    // VI/EN toggle still works for the current session only.
    setLang("en");
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/ai-info", { cache: "no-store" });
      if (r.ok) {
        setData((await r.json()) as AiInfo);
        setAt(Date.now());
      }
    } catch {
      // giữ data cũ — trang chỉ đọc
    } finally {
      setLoading(false);
    }
  }, []);

  const saveLlmSetup = useCallback(async () => {
    setLlmSaveState("saving");
    try {
      const prev = loadAutoConfig();
      const url = llmDraftUrl.trim().replace(/\/+$/, "");
      if (!/^https?:\/\/\S{3,120}$/.test(url)) {
        setLlmSaveState("fail");
        return;
      }
      const next = {
        ...prev,
        llmUrl: url,
        llmModel: (llmDraftModel.trim() || "local").slice(0, 60),
        llmTimeoutSec: Math.max(10, Math.min(600, Math.round(llmDraftTimeout) || 300)),
        llmFailClosed: llmDraftFailClosed,
      };
      saveAutoConfig(next);
      let settings = DEFAULT_SETTINGS;
      let pairs: string[] = [];
      let leverage = 1;
      try {
        const s = localStorage.getItem("utp.settings");
        if (s) settings = { ...DEFAULT_SETTINGS, ...JSON.parse(s) };
        leverage = settings.leverage ?? 1;
        const pr = localStorage.getItem("utp.pairs");
        if (pr) pairs = migratePairsTo(JSON.parse(pr));
      } catch {
        /* keep defaults */
      }
      const res = await fetch("/api/engine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sync", cfg: next, settings, pairs, leverage }),
      });
      setLlmSaveState(res.ok ? "ok" : "fail");
      if (res.ok) void load();
    } catch {
      setLlmSaveState("fail");
    }
  }, [llmDraftUrl, llmDraftModel, llmDraftTimeout, llmDraftFailClosed, load]);


  useEffect(() => {
    void load();
    const iv = setInterval(() => void load(), 60_000);
    return () => clearInterval(iv);
  }, [load]);

  // ── sync cfg từ TRÌNH DUYỆT NÀY lên backend engine (giống Auto panel) ──────
  // Nguồn = localStorage cùng origin (utp.auto / utp.settings / utp.pairs) —
  // đọc đúng như dashboard hydration: settings gộp DEFAULT_SETTINGS + bản vá
  // gate.v2 (không ghi localStorage), pairs chạy migratePairsTo. Server tự kẹp
  // giá trị (sanitizeFloors/sanitizeRunTf) nên payload thô cũng an toàn.
  const syncNow = useCallback(async () => {
    setSyncState("sending");
    try {
      let settings: EngineSettings = { ...DEFAULT_SETTINGS };
      try {
        const raw = localStorage.getItem("utp.settings");
        if (raw) {
          let parsed = JSON.parse(raw) as Partial<EngineSettings>;
          if (localStorage.getItem("utp.gate.v2") !== "1") parsed = { ...parsed, smaFilter: false };
          settings = { ...DEFAULT_SETTINGS, ...parsed };
        }
      } catch {
        // settings hỏng → gửi default
      }
      let pairs: string[] = [];
      try {
        const raw = localStorage.getItem("utp.pairs");
        const arr = raw ? (JSON.parse(raw) as unknown) : [];
        if (Array.isArray(arr)) {
          pairs = migratePairsTo(arr.filter((x): x is string => typeof x === "string")).slice(0, 200);
        }
      } catch {
        // pairs hỏng → gửi rỗng (server giữ nguyên pairs cũ)
      }
      const res = await fetch("/api/engine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sync", cfg: loadAutoConfig(), settings, pairs, leverage: settings.leverage }),
      });
      setSyncState(res.ok ? "ok" : "fail");
      if (res.ok) void load();
    } catch {
      setSyncState("fail");
    }
  }, [load]);

  // ── duyệt thử 1 lệnh GIẢ qua đúng đường llmReview production ───────────────
  // llama-server là inference-only — không có gì để "train"; nút này cho xem
  // model nói gì với một setup giả, prompt thật và phản hồi thô của nó.
  const runLlmTest = useCallback(async () => {
    setLlmTestBusy(true);
    try {
      const r = await fetch("/api/llm/test", { method: "POST", headers: { "Content-Type": "application/json" } });
      if (r.ok) {
        setLlmTest((await r.json()) as LlmTestInfo);
      } else {
        setLlmTest({ ok: false, verdict: null, raw: "", detail: `http-${r.status}`, prompt: "", url: "", model: "", ms: 0 });
      }
    } catch {
      setLlmTest({ ok: false, verdict: null, raw: "", detail: "network", prompt: "", url: "", model: "", ms: 0 });
    } finally {
      setLlmTestBusy(false);
    }
  }, []);

  // ── phân tích nguyên nhân gốc: LLM kiểm toán toàn bộ snapshot thống kê ──
  // llama-server 7B cần 30-120s sinh văn bản dài — busy state phải rõ ràng.
  const runStatsDive = useCallback(async () => {
    setStatsDiveBusy(true);
    try {
      const r = await fetch("/api/llm/stats-dive", { method: "POST" });
      const j = (await r.json().catch(() => null)) as { ok?: boolean; text?: string; detail?: string; ms?: number } | null;
      setStatsDive({ ok: !!j?.ok, text: j?.text ?? "", detail: j?.detail ?? `http-${r.status}`, ms: j?.ms ?? 0 });
    } catch {
      setStatsDive({ ok: false, text: "", detail: "network", ms: 0 });
    } finally {
      setStatsDiveBusy(false);
      // POST vừa rồi đã lưu 1 DiveReport (nền) — nạp lại lịch sử
      void loadDiveHistory();
    }
  }, [loadDiveHistory]);

  const switchLang = () => {
    const next: Lang = lang === "vi" ? "en" : "vi";
    setLang(next);
    localStorage.setItem("utp.lang", next);
  };

  const cfg = data?.engine?.cfg ?? null;
  const winRate = data && data.autoStats.closed > 0 ? (data.autoStats.wins / data.autoStats.closed) * 100 : null;
  const unsynced = data?.engine ? !data.engine.synced : false;

  return (
    <div className="min-h-screen bg-transparent text-zinc-200">
      {/* sticky header — Settings / Refresh / lang luôn trong tầm tay trên trang dài */}
      <header className="sticky top-0 z-30 border-b border-zinc-800/60 bg-[#020617]/85 backdrop-blur">
        {/* 0.2.80 — FULL WIDTH: bỏ mx-auto max-w-6xl cho khớp body bên dưới */}
        <div className="flex flex-wrap items-center gap-2 px-3 py-2.5 sm:px-5">
          <Button size="sm" variant="outline" className="h-8 gap-1.5 border-zinc-700 px-2.5 text-xs text-zinc-300 hover:bg-zinc-800" asChild>
            <Link href="/">
              <ArrowLeft className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{t(lang, "ai.back")}</span>
            </Link>
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="flex items-center gap-2 text-base font-bold text-zinc-100 sm:text-lg">
              <BrainCircuit className="h-5 w-5 text-teal-400" />
              {t(lang, "ai.title")}
            </h1>
            <p className="truncate text-[11px] text-zinc-500">{t(lang, "ai.sub")}</p>
            {at > 0 && (
              <p className="truncate text-[10px] text-zinc-600">
                {t(lang, "ai.updated")}: {new Date(at).toLocaleTimeString(lang === "vi" ? "vi-VN" : "en-GB")}
                {data?.build && data.build !== "unknown" ? (
                  <>
                    {" · "}
                    {t(lang, "ai.build")}: <span className="font-mono">{data.build}</span>
                  </>
                ) : null}
              </p>
            )}
          </div>
          <Button
            size="sm"
            className="h-8 gap-1.5 bg-teal-600 px-3 text-xs font-semibold text-white hover:bg-teal-500"
            onClick={() => {
              setSettingsTab("system");
              setSettingsOpen(true);
            }}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            {t(lang, "ai.settings")}
          </Button>
          <Button size="sm" variant="outline" className="h-8 border-zinc-700 px-2.5 text-xs text-zinc-300 hover:bg-zinc-800" onClick={switchLang}>
            {lang === "vi" ? "EN" : "VI"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 border-zinc-700 px-2.5 text-xs text-zinc-300 hover:bg-zinc-800"
            disabled={loading}
            onClick={() => void load()}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            <span className="hidden sm:inline">{t(lang, "ai.refresh")}</span>
          </Button>
        </div>
      </header>

      {/* 0.2.80 — FULL WIDTH: bỏ max-w-6xl — trang dài nhiều card, màn lớn
          hiển thị được trọn vẹn các cặp card trạng thái mà không phải cuộn */}
      <div className="space-y-4 p-3 sm:p-5">
        {/* 1 — trạng thái vận hành: engine + LLM Risk Officer (2 cột trên xl) */}
        <div className="grid gap-4 xl:grid-cols-2">
          {/* 1a — engine hiện hành */}
          <Card className="border-zinc-800/80 bg-zinc-900/60">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-1.5 text-sm font-semibold text-zinc-100">
                <Activity className="h-4 w-4 text-teal-400" />
                {t(lang, "ai.engine.title")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 pt-0">
              {data?.engine && unsynced && (
                <div className="rounded-lg border border-amber-800/60 bg-amber-950/20 p-2.5 text-[11px] leading-relaxed text-amber-200/90">
                  <p className="flex items-start gap-1.5 font-bold text-amber-300">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    {t(lang, "ai.engine.idle")}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      className="h-7 gap-1.5 bg-amber-400 px-2.5 text-[11px] font-bold text-zinc-950 hover:bg-amber-300"
                      disabled={syncState === "sending"}
                      onClick={() => void syncNow()}
                    >
                      <UploadCloud className={`h-3.5 w-3.5 ${syncState === "sending" ? "animate-pulse" : ""}`} />
                      {syncState === "sending" ? t(lang, "ai.engine.syncing") : t(lang, "ai.engine.syncbtn")}
                    </Button>
                    <span className="text-[10px] text-amber-200/70">
                      {syncState === "ok" ? t(lang, "ai.engine.syncok") : syncState === "fail" ? t(lang, "ai.engine.syncfail") : ""}
                    </span>
                  </div>
                </div>
              )}
              {!cfg || !data?.engine ? (
                <p className="text-[11px] text-zinc-600">{t(lang, "ai.engine.notsynced")}</p>
              ) : (
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] sm:grid-cols-3">
                  {[
                    ["minScore", cfg.minScore],
                    ["minAuc", cfg.minAuc],
                    ["minAcc", `${cfg.minAcc}%`],
                    ["leverage", `×${data.engine.leverage}`],
                    ["stakePct", `${cfg.riskPct}%`],
                    ["dcaMax", cfg.dcaMax],
                    ["cooldownMin", `${cfg.cooldownMin}m`],
                    ["runTf", cfg.runTf?.join(" ") || "—"],
                    ["whaleFilter", cfg.whaleFilter ? "ON" : "OFF"],
                    ["broadcast", cfg.broadcast ? "ON" : "OFF"],
                    [t(lang, "ai.workers"), `${data.engine.workers.pool}${data.engine.workers.bundled ? "" : " (inline)"}`],
                    ["telegram", data.engine.telegram ? "ON" : "OFF"],
                    ["pairs", data.engine.pairs],
                  ].map(([k, v]) => (
                    <div key={String(k)} className="flex items-center justify-between gap-2 border-b border-zinc-800/60 py-0.5">
                      <span className="shrink-0 truncate text-zinc-500">{k}</span>
                      {/* min-w-0 + break-words — giá trị dài (runTf "5m 15m … 1w")
                          từng tràn mép phải trên mobile 390px */}
                      <span className="min-w-0 break-words text-right font-mono font-bold text-zinc-200">{String(v)}</span>
                    </div>
                  ))}
                </div>
              )}
              {data?.engine && (
                <p className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-2.5 text-[11px]">
                  <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                    <span className="flex items-center gap-1 text-zinc-500">
                      <Activity className="h-3 w-3" />
                      {t(lang, "ai.engine.status")}: <span className="font-mono text-zinc-300">{data.engine.cycle?.status || "—"}</span>
                    </span>
                    {data.engine.syncedAt ? (
                      <span className="text-zinc-500">
                        {t(lang, "ai.engine.syncedAt")}: <span className="font-mono text-zinc-300">{new Date(data.engine.syncedAt).toLocaleString(lang === "vi" ? "vi-VN" : "en-GB")}</span>
                      </span>
                    ) : null}
                  </span>
                </p>
              )}
              <p className="mt-2 text-[10px] text-zinc-600">{data?.engine?.synced ? t(lang, "ai.engine.synced") : t(lang, "ai.engine.notsynced")}</p>
            </CardContent>
          </Card>

          {/* 1b — LLM Risk Officer status */}
          <Card className="border-zinc-800/80 bg-zinc-900/60">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-1.5 text-sm font-semibold text-zinc-100">
                {data?.llm.ping.ok ? <ShieldCheck className="h-4 w-4 text-emerald-400" /> : <ShieldX className="h-4 w-4 text-rose-400" />}
                {t(lang, "ai.llm.title")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 pt-0">
              <div className="flex flex-wrap items-center gap-2 text-[11px]">
                <Badge variant="outline" className={data?.llm.ping.ok ? "border-emerald-700 bg-emerald-950/40 text-emerald-300" : "border-rose-700 bg-rose-950/40 text-rose-300"}>
                  {data?.llm.ping.ok ? t(lang, "ai.llm.ok") : t(lang, "ai.llm.down")}
                  {data ? ` · ${data.llm.ping.ms}ms` : ""}
                  {!data?.llm.ping.ok && data?.llm.ping.detail ? ` · ${data.llm.ping.detail}` : ""}
                </Badge>
                {!data?.llm.ping.ok && data && (
                  <Badge variant="outline" className="border-amber-700 bg-amber-950/40 text-amber-300">
                    {data.llm.failClosed ? t(lang, "ai.llm.failclosed") : t(lang, "ai.llm.failopen")}
                  </Badge>
                )}
                <Badge variant="outline" className="border-zinc-700 bg-zinc-950/40 text-zinc-400">
                  {llmScope(data?.llm.url ?? "")}
                </Badge>
                {data?.llm.urlSource && (
                  <Badge variant="outline" className="border-zinc-800 bg-zinc-950/40 text-zinc-500">
                    {data.llm.urlSource}
                  </Badge>
                )}
                {cfg?.llmModel && <span className="font-mono text-zinc-500">· {cfg.llmModel}</span>}
              </div>

              {data?.engine?.llmLast ? (
                <p className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-2.5 text-[11px]">
                  {/* 0.2.53 — llmLast được persist sống qua restart: không có mốc thời
                      gian thì bản ghi cũ 1 ngày trước vẫn đứng im như thể vừa xảy ra */}
                  <span className="flex flex-wrap items-center gap-x-2">
                    <span className="font-bold text-zinc-200">{t(lang, "ai.llm.last")}</span>
                    <span className="ml-auto font-mono text-[10px] text-zinc-500">
                      {new Date(data.engine.llmLast.at).toLocaleString(lang === "vi" ? "vi-VN" : "en-GB", {
                        day: "2-digit",
                        month: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </span>
                  <span className="mt-0.5 block font-mono text-zinc-300">
                    #{data.engine.llmLast.symbol} {data.engine.llmLast.interval} {data.engine.llmLast.side} →{" "}
                    <span className={verdictCls(data.engine.llmLast.verdict)}>{data.engine.llmLast.verdict}</span>{" "}
                    ({fmtMs(data.engine.llmLast.ms)})
                  </span>
                  <span className="mt-0.5 block truncate text-zinc-500">{data.engine.llmLast.reason}</span>
                </p>
              ) : (
                <p className="text-[11px] text-zinc-600">{t(lang, "ai.llm.none")}</p>
              )}
              {/* duyệt thử 1 lệnh giả — test kết nối + xem prompt/phản hồi thô;
                  chỉnh connection (URL/model/timeout) mở popup Settings tab LLM */}
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1.5 border-zinc-700 px-2.5 text-[11px] text-zinc-300 hover:bg-zinc-800"
                  disabled={llmTestBusy}
                  onClick={() => void runLlmTest()}
                >
                  {llmTestBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FlaskConical className="h-3.5 w-3.5 text-teal-400" />}
                  {t(lang, "ai.llm.test")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1.5 border-zinc-700 px-2.5 text-[11px] text-zinc-300 hover:bg-zinc-800"
                  onClick={() => {
                    setSettingsTab("llm");
                    setSettingsOpen(true);
                  }}
                >
                  <SlidersHorizontal className="h-3.5 w-3.5 text-teal-400" />
                  {t(lang, "ai.llm.setup")}
                </Button>
                <span className="text-[10px] text-zinc-600">
                  {llmTestBusy ? t(lang, "ai.llm.test.busy") : t(lang, "ai.llm.test.hint")}
                </span>
              </div>
              {llmTest && (
                <div className="rail-scroll space-y-1.5 rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5 font-mono text-[10px]">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      variant="outline"
                      className={
                        llmTest.verdict?.verdict === "go"
                          ? "border-emerald-700 bg-emerald-950/40 text-emerald-300"
                          : llmTest.verdict?.verdict === "skip"
                            ? "border-rose-700 bg-rose-950/40 text-rose-300"
                            : "border-amber-700 bg-amber-950/40 text-amber-300"
                      }
                    >
                      {llmTest.verdict
                        ? `${llmTest.verdict.verdict} · ${Math.round(llmTest.verdict.confidence * 100)}%`
                        : t(lang, "ai.llm.test.fail")}
                    </Badge>
                    <span className="text-zinc-400">{llmScope(llmTest.url)}</span>
                    {llmTest.model && <span className="text-zinc-600">· {llmTest.model}</span>}
                    <span className="ml-auto text-zinc-500">{llmTest.ms}ms</span>
                    {llmTest.detail !== "ok" && <span className="text-amber-400">{llmTest.detail}</span>}
                  </div>
                  {llmTest.setupSource && <p className="text-zinc-500">{llmTest.setupSource}</p>}
                  {llmTest.detail === "http-404" && !llmTest.prompt && (
                    <p className="text-amber-400">{t(lang, "ai.llm.test.h404")}</p>
                  )}
                  {llmTest.detail === "http-404" && !!llmTest.prompt && (
                    <p className="text-amber-400">{t(lang, "ai.llm.test.h404llm")}</p>
                  )}
                  {llmTest.detail.startsWith("http-") && llmTest.bodySnippet && (
                    <p className="text-zinc-500">↳ {llmTest.bodySnippet}</p>
                  )}
                  {llmTest.verdict?.reasons.map((rs, i) => (
                    <p key={i} className="text-zinc-300">
                      • {rs}
                    </p>
                  ))}
                  {llmTest.prompt && (
                    <div>
                      <p className="text-zinc-600">{t(lang, "ai.llm.test.prompt")}</p>
                      <pre className="mt-0.5 max-h-28 overflow-y-auto whitespace-pre-wrap text-zinc-400">{llmTest.prompt}</pre>
                    </div>
                  )}
                  <div>
                    <p className="text-zinc-600">{t(lang, "ai.llm.test.raw")}</p>
                    <pre className="mt-0.5 max-h-28 overflow-y-auto whitespace-pre-wrap text-zinc-300">{llmTest.raw || "—"}</pre>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* 2 — độ tin cậy prob trên dữ liệu THẬT */}
        <Card className="border-zinc-800/80 bg-zinc-900/60">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-1.5 text-sm font-semibold text-zinc-100">
              <Target className="h-4 w-4 text-teal-400" />
              {t(lang, "ai.reliab.title")}
            </CardTitle>
            <p className="text-[11px] text-zinc-500">{t(lang, "ai.reliab.sub")}</p>
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            <div className="grid gap-3 md:grid-cols-2">
              {([
                [t(lang, "ai.reliab.trades"), data?.reliability?.trades],
                [t(lang, "ai.reliab.phe"), data?.reliability?.phe],
              ] as const).map(([name, table], idx) => (
                <div key={name} className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
                  <p className="flex items-center justify-between text-xs font-bold text-zinc-200">
                    <span>{name}</span>
                    <span className="font-mono text-[10px] font-normal text-zinc-500">n = {table?.n ?? 0}</span>
                  </p>
                  {data?.reliability && (idx === 0 ? data.reliability.errors.trades : data.reliability.errors.phe) ? (
                    <p className="mt-2 text-[11px] text-rose-400">{t(lang, "ai.db.error")}</p>
                  ) : !table || table.n === 0 ? (
                    <p className="mt-2 text-[11px] text-zinc-600">{t(lang, "ai.reliab.empty")}</p>
                  ) : (
                    <table className="mt-2 w-full text-[11px]">
                      <thead>
                        <tr className="text-zinc-500">
                          <th className="text-left font-normal">{t(lang, "ai.reliab.bucket")}</th>
                          <th className="text-right font-normal">{t(lang, "ai.reliab.n")}</th>
                          <th className="text-right font-normal">{t(lang, "ai.reliab.wr")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {table.buckets.map((b) => (
                          <tr key={b.label} className="border-t border-zinc-800/60">
                            <td className="py-0.5 font-mono text-zinc-300">{b.label}</td>
                            <td className="py-0.5 text-right font-mono text-zinc-500">{b.n}</td>
                            <td className={`py-0.5 text-right font-mono font-bold ${b.wr >= 50 ? "text-emerald-400" : b.wr >= 0 ? "text-rose-400" : "text-zinc-600"}`}>
                              {b.wr >= 0 ? `${b.wr.toFixed(1)}%` : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              ))}
            </div>
            <p className="text-[10px] leading-relaxed text-zinc-600">{t(lang, "ai.reliab.note")}</p>
          </CardContent>
        </Card>

        {/* 3 — đã học bao nhiêu dữ liệu */}
        <Card className="border-zinc-800/80 bg-zinc-900/60">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-1.5 text-sm font-semibold text-zinc-100">
              <Database className="h-4 w-4 text-teal-400" />
              {t(lang, "ai.data.title")}
            </CardTitle>
            <p className="text-[11px] text-zinc-500">{t(lang, "ai.data.sub")}</p>
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            {data && data.autoStats.closed > 0 && (
              <p className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-2.5 font-mono text-[11px] text-teal-300">
                {t(lang, "ai.data.lessons", {
                  closed: String(data.autoStats.closed),
                  w: String(data.autoStats.lessonWeight),
                  n: String(data.autoStats.lessonSamples),
                  wins: String(data.autoStats.wins),
                })}
                {winRate !== null ? ` · WR ${winRate.toFixed(0)}%` : ""}
              </p>
            )}
            {!data || data.runs.length === 0 ? (
              <p className="text-[11px] text-zinc-600">
                {data?.db?.runsError ? t(lang, "ai.db.error") : t(lang, "ai.data.empty")}
              </p>
            ) : (
              <div className="rail-scroll max-h-80 space-y-1 overflow-y-auto pr-0.5">
                {data.runs.slice(0, 80).map((r) => (
                  <div key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded-md border border-zinc-800/80 bg-zinc-950/40 px-2 py-1.5 text-[11px]">
                    <Badge variant="outline" className={`shrink-0 px-1.5 text-[9px] uppercase ${r.kind === "finetune" ? "border-teal-800 bg-teal-950/40 text-teal-300" : "border-zinc-700 bg-zinc-900 text-zinc-400"}`}>
                      {r.kind}
                    </Badge>
                    <span className="shrink-0 font-mono font-bold text-zinc-200">#{r.symbol}</span>
                    <span className="shrink-0 font-mono text-zinc-500">{r.interval}</span>
                    <span className="shrink-0 font-mono text-zinc-400">{r.samples}/{r.valSamples}</span>
                    <span className={`shrink-0 font-mono ${r.acc >= 55 ? "text-emerald-400" : "text-zinc-300"}`}>{r.acc.toFixed(1)}%</span>
                    <span className="shrink-0 font-mono text-zinc-500">AUC {r.auc.toFixed(2)}</span>
                    <span className="hidden shrink-0 font-mono text-zinc-600 sm:inline">L {r.logloss.toFixed(3)}</span>
                    <span className="ml-auto max-w-full shrink-0 truncate font-mono text-[10px] text-zinc-500" title={hyper(r.params)}>{hyper(r.params)}</span>
                    <span className="shrink-0 font-mono text-[10px] text-zinc-600">
                      {new Date(r.createdAt).toLocaleTimeString(lang === "vi" ? "vi-VN" : "en-GB", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* 4 — giải phẫu lệnh (autopsy): tại sao thắng, tại sao thua */}
        <Card className="border-zinc-800/80 bg-zinc-900/60">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-1.5 text-sm font-semibold text-zinc-100">
              <FlaskConical className="h-4 w-4 text-teal-400" />
              {t(lang, "ai.autopsy.title")}
            </CardTitle>
            <p className="text-[11px] text-zinc-500">{t(lang, "ai.autopsy.sub")}</p>
          </CardHeader>
          <CardContent className="space-y-2 pt-0">
            {data?.autopsies && data.autopsies.n > 0 ? (
              <>
                <p className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-2.5 font-mono text-[11px] text-teal-300">
                  {t(lang, "ai.autopsy.count", {
                    n: String(data.autopsies.n),
                    win: String(data.autopsies.recent.filter((a) => (a.pnlPct ?? 0) > 0).length),
                    loss: String(data.autopsies.recent.filter((a) => (a.pnlPct ?? 0) <= 0).length),
                  })}
                </p>
                <div className="rail-scroll max-h-96 space-y-1.5 overflow-y-auto pr-0.5">
                  {data.autopsies.recent.map((a, i) => (
                    <div key={`${a.symbol}-${a.exitTime ?? i}-${i}`} className="rounded-md border border-zinc-800/80 bg-zinc-950/40 px-2.5 py-2 text-[11px]">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <Badge variant="outline" className={`shrink-0 px-1.5 text-[9px] uppercase ${(a.pnlPct ?? 0) > 0 ? "border-emerald-800 bg-emerald-950/40 text-emerald-300" : "border-rose-800 bg-rose-950/40 text-rose-300"}`}>
                          {(a.pnlPct ?? 0) > 0 ? "win" : "loss"}
                        </Badge>
                        <span className="shrink-0 font-mono font-bold text-zinc-200">#{a.symbol}</span>
                        <span className="shrink-0 font-mono text-zinc-500">{a.interval}</span>
                        <span className={`shrink-0 font-mono ${a.side === "LONG" ? "text-emerald-400" : "text-rose-400"}`}>{a.side}</span>
                        <span className={`shrink-0 font-mono font-bold ${(a.pnlPct ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                          {(a.pnlPct ?? 0) >= 0 ? "+" : ""}{(a.pnlPct ?? 0).toFixed(2)}%
                        </span>
                        {a.ev?.rMultiple != null && (
                          <span className="shrink-0 font-mono text-zinc-500">R {a.ev.rMultiple >= 0 ? "+" : ""}{a.ev.rMultiple.toFixed(2)}x</span>
                        )}
                        <span className="shrink-0 rounded border border-teal-800/60 bg-teal-950/30 px-1.5 py-0.5 font-mono text-[9px] text-teal-300">{a.tag || "—"}</span>
                        <span className="ml-auto shrink-0 font-mono text-[10px] text-zinc-600">
                          {a.exitTime ? new Date(a.exitTime).toLocaleTimeString(lang === "vi" ? "vi-VN" : "en-GB", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : ""}
                        </span>
                      </div>
                      {a.why.length > 0 && (
                        <ul className="mt-1 space-y-0.5 text-zinc-400">
                          {a.why.map((w, j) => (
                            <li key={j} className="leading-relaxed">• {w}</li>
                          ))}
                        </ul>
                      )}
                      <p className="mt-1 leading-relaxed text-amber-200/90">
                        💡 {t(lang, "ai.autopsy.lesson")}: {a.lesson}
                      </p>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-[11px] text-zinc-600">
                {data?.autopsies?.error ? t(lang, "ai.db.error") : t(lang, "ai.autopsy.empty")}
              </p>
            )}
          </CardContent>
        </Card>

        {/* 5 — champion mỗi combo */}
        {data && data.champions.length > 0 && (
          <Card className="border-zinc-800/80 bg-zinc-900/60">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-1.5 text-sm font-semibold text-zinc-100">
                <Crown className="h-4 w-4 text-amber-400" />
                {t(lang, "ai.champ.title")}
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="grid gap-1.5 sm:grid-cols-2">
                {/* mặc định top 10 — bấm nút dưới để mở hết (danh sách có thể
                    dài hơn khung nhìn khi đã train nhiều combo) */}
                {data.champions.slice(0, champAll ? undefined : 10).map((c) => (
                  <div key={`${c.symbol}-${c.interval}`} className="flex min-w-0 flex-wrap items-center gap-2 rounded-md border border-amber-800/40 bg-amber-950/10 px-2 py-1.5 text-[11px]">
                    <Crown className="h-3 w-3 shrink-0 text-amber-400" />
                    <span className="shrink-0 font-mono font-bold text-zinc-200">#{c.symbol}</span>
                    <span className="shrink-0 font-mono text-zinc-500">{c.interval}</span>
                    <span className={`shrink-0 font-mono ${c.acc >= 55 ? "text-emerald-400" : "text-zinc-300"}`}>{c.acc.toFixed(1)}%</span>
                    <span className="shrink-0 font-mono text-zinc-500">AUC {c.auc.toFixed(2)}</span>
                    {/* max-w-full + truncate — hyper(params) ~300px từng đẩy row
                        champion tràn ngang mobile (390px); đủ xem trong title */}
                    <span className="ml-auto max-w-full shrink-0 truncate font-mono text-[10px] text-zinc-500" title={hyper(c.params)}>{hyper(c.params)}</span>
                  </div>
                ))}
              </div>
              {data.champions.length > 10 && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="mt-2 h-7 w-full gap-1 text-[11px] text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200"
                  onClick={() => setChampAll((v) => !v)}
                >
                  {champAll ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  {champAll ? t(lang, "ai.champ.less") : t(lang, "ai.champ.more", { n: data.champions.length })}
                </Button>
              )}
            </CardContent>
          </Card>
        )}

        {/* 6 — công cụ: Tự tiến hoá + Phân tích nguyên nhân gốc (2 cột trên xl) */}
        <div className="grid gap-4 xl:grid-cols-2">
          {/* 6a — Tự tiến hoá (0.2.54): đề xuất → backtest → áp → theo dõi → hoàn tác */}
          <Card className="border-zinc-800/80 bg-zinc-900/60">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-1.5 text-sm font-semibold text-zinc-100">
                <Dna className="h-4 w-4 text-emerald-400" />
                {t(lang, "ai.evo.title")}
              </CardTitle>
              <p className="text-[11px] leading-relaxed text-zinc-500">{t(lang, "ai.evo.sub")}</p>
            </CardHeader>
            <CardContent className="space-y-2 pt-0">
              {evo && !evo.on && (
                <Badge variant="outline" className="border-amber-700 bg-amber-950/40 text-amber-300">
                  {t(lang, "ai.evo.off")}
                </Badge>
              )}
              {evo?.active && (
                <p className="rounded-lg border border-emerald-900/50 bg-emerald-950/20 p-2.5 text-[11px]">
                  <span className="font-bold text-emerald-300">
                    {t(lang, "ai.evo.active")}: {evo.active.name}
                  </span>
                  <span className="mt-0.5 block font-mono text-[10px] text-zinc-400">
                    {evo.active.combo} · {evoCfg(evo.active.cfgAfter)}
                    {evo.active.metrics?.best ? ` · exp ${evo.active.metrics.best.expectancy.toFixed(3)}%/lệnh` : ""}
                  </span>
                  {evo.watch && (
                    <span className="mt-0.5 block text-zinc-500">⏳ {t(lang, "ai.evo.watch", { n: evo.watch.n, need: evo.watch.need })}</span>
                  )}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1.5 border-zinc-700 px-2.5 text-[11px] text-zinc-300 hover:bg-zinc-800"
                  disabled={evoBusy}
                  onClick={() => void runEvolve()}
                >
                  {evoBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Dna className="h-3.5 w-3.5 text-emerald-400" />}
                  {evoBusy ? t(lang, "ai.evo.running") : t(lang, "ai.evo.run")}
                </Button>
                {evoMsg && <span className="text-[10px] text-zinc-500">{evoMsg}</span>}
              </div>
              {evo && evo.history.length > 0 ? (
                <div className="rail-scroll max-h-60 space-y-1 overflow-y-auto pr-0.5">
                  {evo.history.slice(0, 10).map((h, i) => (
                    <div key={`${h.at}-${i}`} className="rounded-md border border-zinc-800/80 bg-zinc-950/40 px-2 py-1.5 text-[10px]">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <Badge variant="outline" className={`px-1.5 text-[9px] uppercase ${evoBadge(h.decision)}`}>
                          {h.decision}
                        </Badge>
                        <span className="shrink-0 font-mono text-zinc-600">
                          {new Date(h.at).toLocaleString(lang === "vi" ? "vi-VN" : "en-GB", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                        </span>
                        <span className="shrink-0 font-mono text-zinc-500">{h.combo}</span>
                        {h.name && <span className="truncate text-zinc-300">{h.name}</span>}
                      </span>
                      {h.detail && (
                        <span className="mt-0.5 block truncate text-zinc-500" title={h.detail}>
                          {h.detail}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[11px] text-zinc-600">{t(lang, "ai.evo.none")}</p>
              )}
            </CardContent>
          </Card>

          {/* 6b — Phân tích nguyên nhân gốc: LLM kiểm toán snapshot thống kê (/stats) */}
          <Card className="border-zinc-800/80 bg-zinc-900/60">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-1.5 text-sm font-semibold text-zinc-100">
                <ScrollText className="h-4 w-4 text-teal-400" />
                {t(lang, "ai.dive.title")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 pt-0">
              <p className="text-[11px] leading-relaxed text-zinc-400">{t(lang, "ai.dive.hint")}</p>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1.5 border-zinc-700 px-2.5 text-[11px] text-zinc-300 hover:bg-zinc-800"
                  disabled={statsDiveBusy}
                  onClick={() => void runStatsDive()}
                >
                  {statsDiveBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ScrollText className="h-3.5 w-3.5 text-teal-400" />}
                  {t(lang, "ai.dive.run")}
                </Button>
                <Link href="/stats" className="text-[10px] text-zinc-500 underline decoration-dotted hover:text-zinc-300">
                  {t(lang, "ai.dive.statsLink")}
                </Link>
                <span className="text-[10px] text-zinc-600">{statsDiveBusy ? t(lang, "ai.dive.busy") : t(lang, "ai.dive.hint2")}</span>
              </div>
              {statsDive && (
                <div className="rail-scroll space-y-1.5 rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5 text-[11px]">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      variant="outline"
                      className={statsDive.ok ? "border-emerald-700 bg-emerald-950/40 text-emerald-300" : "border-amber-700 bg-amber-950/40 text-amber-300"}
                    >
                      {statsDive.ok ? t(lang, "ai.dive.ok") : t(lang, "ai.dive.fail")}
                    </Badge>
                    <span className="ml-auto font-mono text-zinc-500">{statsDive.ms}ms</span>
                    {!statsDive.ok && <span className="text-amber-400">{statsDive.detail}</span>}
                  </div>
                  <pre className="max-h-96 overflow-y-auto whitespace-pre-wrap text-zinc-300">{statsDive.ok ? statsDive.text : "—"}</pre>
                </div>
              )}

              {/* 0.2.36 — lịch sử các lần dive đã lưu trong DB */}
              <div className="border-t border-zinc-800 pt-2">
                {diveHistory != null && diveHistory.length > 0 ? (
                  <>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 gap-1.5 px-1.5 text-[11px] text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                      onClick={() => setDiveHistoryOpen((o) => !o)}
                    >
                      <History className="h-3 w-3" />
                      {diveHistoryOpen ? t(lang, "ai.dive.history.hide") : t(lang, "ai.dive.history.show", { n: diveHistory.length })}
                      {diveHistoryOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                    </Button>
                    {diveHistoryOpen && (
                      <div className="rail-scroll mt-1.5 max-h-96 space-y-2 overflow-y-auto">
                        {diveHistory.map((rep) => (
                          <details key={rep.id} className="group rounded-lg border border-zinc-800 bg-zinc-950/60 p-2">
                            <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 text-[11px]">
                              <Badge
                                variant="outline"
                                className={rep.ok ? "border-emerald-800 text-emerald-400" : "border-amber-800 text-amber-400"}
                              >
                                {rep.ok ? t(lang, "ai.dive.ok") : t(lang, "ai.dive.history.fail")}
                              </Badge>
                              <span className="font-mono text-zinc-500">{rep.ms}ms</span>
                              <span className="text-zinc-600">{rep.model}</span>
                              <span className="ml-auto text-zinc-500">
                                {new Date(rep.createdAt).toLocaleString(lang === "vi" ? "vi-VN" : "en-US")}
                              </span>
                            </summary>
                            <pre className="mt-2 max-h-72 overflow-y-auto whitespace-pre-wrap border-t border-zinc-800 pt-2 text-[11px] text-zinc-300">
                              {rep.ok ? rep.text : rep.detail || "—"}
                            </pre>
                          </details>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-[10px] leading-relaxed text-zinc-600">{t(lang, "ai.dive.history.empty")}</p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* 7 — About: 2 lớp AI + cách đọc Prob — gấp gọn mặc định (0.2.76 dọn
            trang: giải thích tĩnh xuống đáy, dữ liệu sống lên trên) */}
        <Card className="border-zinc-800/80 bg-zinc-900/60">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-1.5 text-sm font-semibold text-zinc-100">
              <BookOpen className="h-4 w-4 text-teal-400" />
              {t(lang, "ai.about.title")}
            </CardTitle>
          </CardHeader>
          {aboutOpen ? (
            <CardContent className="space-y-3 pt-0">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-lg border border-teal-800/60 bg-teal-950/20 p-3">
                  <p className="text-xs font-bold text-teal-300">{t(lang, "ai.layers.xgb.t")}</p>
                  <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-400">{t(lang, "ai.layers.xgb.d")}</p>
                </div>
                <div className="rounded-lg border border-amber-800/60 bg-amber-950/20 p-3">
                  <p className="text-xs font-bold text-amber-300">{t(lang, "ai.layers.llm.t")}</p>
                  <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-400">{t(lang, "ai.layers.llm.d")}</p>
                </div>
                <div className="md:col-span-2 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
                  <p className="text-xs font-bold text-zinc-200">❓ {t(lang, "ai.finetune.q")}</p>
                  <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-400">{t(lang, "ai.finetune.a")}</p>
                </div>
              </div>
              <div className="space-y-2">
                <p className="text-[11px] leading-relaxed text-zinc-400">{t(lang, "ai.prob.d")}</p>
                <p className="rounded-lg border border-amber-800/60 bg-amber-950/20 p-2.5 text-[11px] leading-relaxed text-amber-200/90">{t(lang, "ai.prob.warn")}</p>
              </div>
            </CardContent>
          ) : null}
          <div className="px-6 pb-4">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-full gap-1 text-[11px] text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200"
              onClick={() => setAboutOpen((v) => !v)}
            >
              {aboutOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              {aboutOpen ? t(lang, "ai.about.less") : t(lang, "ai.about.more")}
            </Button>
          </div>
        </Card>
      </div>

      {/* ── Settings popup (0.2.76) — mọi thứ chỉnh được sống ở đây, không còn
          trải dài trong trang. Tab System = params-override (ParamsEditor);
          tab LLM = connection Risk Officer. Radix unmount content khi đóng →
          ParamsEditor không fetch/poll nền khi popup tắt. */}
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="flex max-h-[88dvh] flex-col gap-3 border-zinc-800 bg-zinc-900 p-4 text-zinc-100 sm:max-w-3xl sm:p-5">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-1.5 text-base">
              <SlidersHorizontal className="h-4 w-4 text-teal-400" />
              {t(lang, "ai.settings")}
            </DialogTitle>
            <DialogDescription className="text-[11px] leading-relaxed text-zinc-500">
              {t(lang, "ai.settings.note")}
            </DialogDescription>
          </DialogHeader>
          <Tabs value={settingsTab} onValueChange={(v) => setSettingsTab(v as "system" | "llm")}>
            <TabsList className="h-8 w-full justify-start gap-1 rounded-lg border border-zinc-800 bg-zinc-950/60 p-1">
              <TabsTrigger
                value="system"
                className="h-6 flex-none gap-1.5 rounded-md px-3 text-[11px] text-zinc-400 data-[state=active]:bg-zinc-800 data-[state=active]:text-zinc-100"
              >
                <SlidersHorizontal className="h-3 w-3" />
                {t(lang, "ai.knobs.title")}
              </TabsTrigger>
              <TabsTrigger
                value="llm"
                className="h-6 flex-none gap-1.5 rounded-md px-3 text-[11px] text-zinc-400 data-[state=active]:bg-zinc-800 data-[state=active]:text-zinc-100"
              >
                <ShieldCheck className="h-3 w-3" />
                {t(lang, "ai.settings.tabLlm")}
              </TabsTrigger>
            </TabsList>
            <TabsContent value="system" className="rail-scroll max-h-[62dvh] overflow-y-auto pt-2">
              <p className="mb-2 text-[10px] leading-relaxed text-zinc-600">{t(lang, "ai.knobs.sub")}</p>
              <ParamsEditor lang={lang} />
            </TabsContent>
            <TabsContent value="llm" className="rail-scroll max-h-[62dvh] overflow-y-auto pt-2">
              <div className="space-y-2.5 rounded-lg border border-zinc-800 bg-zinc-950/50 p-3">
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="block space-y-1 sm:col-span-2">
                    <span className="flex items-center justify-between text-[10px] uppercase tracking-wide text-zinc-500">
                      <span>{t(lang, "ai.llm.url")}</span>
                      <span className="font-mono normal-case text-zinc-600">{llmScope(llmDraftUrl)}</span>
                    </span>
                    <input
                      type="password"
                      autoComplete="off"
                      value={llmDraftUrl}
                      onChange={(e) => setLlmDraftUrl(e.target.value)}
                      placeholder="http://127.0.0.1:8080"
                      className="h-8 w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 font-mono text-[11px] text-zinc-200 placeholder:text-zinc-600"
                    />
                    <span className="text-[10px] text-zinc-600">{t(lang, "ai.llm.urlHint")}</span>
                  </label>
                  <label className="block space-y-1">
                    <span className="text-[10px] uppercase tracking-wide text-zinc-500">{t(lang, "ai.llm.model")}</span>
                    <input
                      type="text"
                      value={llmDraftModel}
                      onChange={(e) => setLlmDraftModel(e.target.value)}
                      placeholder="local"
                      className="h-8 w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 font-mono text-[11px] text-zinc-200"
                    />
                  </label>
                  <label className="block space-y-1">
                    <span className="text-[10px] uppercase tracking-wide text-zinc-500">{t(lang, "ai.llm.timeout")}</span>
                    <input
                      type="number"
                      min={10}
                      max={600}
                      value={llmDraftTimeout}
                      onChange={(e) => setLlmDraftTimeout(Number(e.target.value))}
                      title="15–180 recommended"
                      className="h-8 w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 font-mono text-[11px] text-zinc-200"
                    />
                  </label>
                  <label className="flex items-center gap-2 pt-5">
                    <input
                      type="checkbox"
                      checked={llmDraftFailClosed}
                      onChange={(e) => setLlmDraftFailClosed(e.target.checked)}
                      className="h-3.5 w-3.5 rounded border-zinc-600"
                    />
                    <span className="text-[11px] text-zinc-300">{t(lang, "ai.llm.failClosedLabel")}</span>
                  </label>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    className="h-7 gap-1.5 bg-teal-600 px-3 text-[11px] font-bold text-white hover:bg-teal-500"
                    disabled={llmSaveState === "saving"}
                    onClick={() => void saveLlmSetup()}
                  >
                    {llmSaveState === "saving" ? t(lang, "ai.llm.saving") : t(lang, "ai.llm.save")}
                  </Button>
                  <span className="text-[10px] text-zinc-500">
                    {llmSaveState === "ok" ? t(lang, "ai.llm.saveOk") : llmSaveState === "fail" ? t(lang, "ai.llm.saveFail") : t(lang, "ai.llm.saveNote")}
                  </span>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>
    </div>
  );
}
