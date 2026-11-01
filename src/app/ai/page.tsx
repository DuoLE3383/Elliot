"use client";

// ─── /ai — Trung tâm AI & Cài đặt ────────────────────────────────────────────
// Trang riêng trả lời 3 câu hỏi của user:
//   1. Prob là gì, AI suy luận được bao nhiêu % ở lệnh này (đọc theo phía PHE)
//   2. AI đã học bao nhiêu dữ liệu (runs từ DB + bài học dry-run)
//   3. Cài đặt hệ thống (toàn bộ knob params.ts, read-only) + trạng thái
//      llama-server (Risk Officer) — và nó KHÔNG được dùng để finetune.
// Dữ liệu: GET /api/ai-info — read-only, refresh tay + tự động mỗi 60s.

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { t, type Lang } from "@/lib/i18n";
import { loadAutoConfig } from "@/lib/autotrade";
import { DEFAULT_SETTINGS, migratePairsTo, type EngineSettings } from "@/lib/types";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  BrainCircuit,
  Bot,
  ChevronDown,
  ChevronUp,
  Crown,
  Database,
  FlaskConical,
  Loader2,
  RefreshCw,
  ShieldCheck,
  ShieldX,
  SlidersHorizontal,
  Target,
  UploadCloud,
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

interface AiInfo {
  runs: RunRow[];
  champions: ChampionRow[];
  autoStats: { opened: number; closed: number; wins: number; lessonSamples: number; lessonWeight: number };
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
  llm: { url: string; ping: { ok: boolean; ms: number }; failClosed: boolean };
  knobs: KnobGroup[];
}

const hyper = (p: { lr?: number; depth?: number; lambda?: number } | null): string =>
  p ? `lr ${p.lr ?? "—"} · d${p.depth ?? "—"} · λ${p.lambda ?? "—"}` : "—";

/** màu verdict: go = xanh, skip = đỏ, unreachable = vàng */
const verdictCls = (v: string): string =>
  v === "go" ? "text-emerald-400" : v === "skip" ? "text-rose-400" : "text-amber-400";

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
  const [lang, setLang] = useState<Lang>("vi");
  const [data, setData] = useState<AiInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [at, setAt] = useState(0);
  const [syncState, setSyncState] = useState<"idle" | "sending" | "ok" | "fail">("idle");
  const [champAll, setChampAll] = useState(false);
  const [llmTest, setLlmTest] = useState<LlmTestInfo | null>(null);
  const [llmTestBusy, setLlmTestBusy] = useState(false);

  useEffect(() => {
    const lg = localStorage.getItem("utp.lang");
    if (lg === "en" || lg === "vi") setLang(lg);
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

  const switchLang = () => {
    const next: Lang = lang === "vi" ? "en" : "vi";
    setLang(next);
    localStorage.setItem("utp.lang", next);
  };

  const cfg = data?.engine?.cfg ?? null;
  const winRate = data && data.autoStats.closed > 0 ? (data.autoStats.wins / data.autoStats.closed) * 100 : null;
  const unsynced = data?.engine ? !data.engine.synced : false;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-200">
      <div className="mx-auto max-w-6xl space-y-4 p-3 sm:p-5">
        {/* header */}
        <header className="flex flex-wrap items-center gap-2">
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
          </div>
          <Button size="sm" variant="outline" className="h-8 border-zinc-700 px-2.5 text-xs text-zinc-300 hover:bg-zinc-800" onClick={switchLang}>
            {lang === "vi" ? "EN" : "VI"}
          </Button>
          <Button
            size="sm"
            className="h-8 gap-1.5 bg-zinc-100 px-2.5 text-xs text-zinc-900 hover:bg-zinc-200"
            disabled={loading}
            onClick={() => void load()}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            <span className="hidden sm:inline">{t(lang, "ai.refresh")}</span>
          </Button>
        </header>
        {at > 0 && (
          <p className="text-right text-[10px] text-zinc-600">
            {t(lang, "ai.updated")}: {new Date(at).toLocaleTimeString(lang === "vi" ? "vi-VN" : "en-GB")}
            {data?.build && data.build !== "unknown" ? (
              <>
                {" · "}
                {t(lang, "ai.build")}: <span className="font-mono">{data.build}</span>
              </>
            ) : null}
          </p>
        )}

        {/* 1 — hai lớp AI */}
        <Card className="border-zinc-800 bg-zinc-900/60">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-1.5 text-sm font-semibold text-zinc-100">
              <Bot className="h-4 w-4 text-teal-400" />
              {t(lang, "ai.layers.title")}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 pt-0 md:grid-cols-2">
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
          </CardContent>
        </Card>

        {/* 2 — prob là gì */}
        <Card className="border-zinc-800 bg-zinc-900/60">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-1.5 text-sm font-semibold text-zinc-100">
              <BookOpen className="h-4 w-4 text-teal-400" />
              {t(lang, "ai.prob.title")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 pt-0">
            <p className="text-[11px] leading-relaxed text-zinc-400">{t(lang, "ai.prob.d")}</p>
            <p className="rounded-lg border border-amber-800/60 bg-amber-950/20 p-2.5 text-[11px] leading-relaxed text-amber-200/90">{t(lang, "ai.prob.warn")}</p>
          </CardContent>
        </Card>

        {/* 2b — độ tin cậy prob trên dữ liệu THẬT */}
        <Card className="border-zinc-800 bg-zinc-900/60">
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
        <Card className="border-zinc-800 bg-zinc-900/60">
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
                    <span className="ml-auto shrink-0 font-mono text-[10px] text-zinc-500">{hyper(r.params)}</span>
                    <span className="shrink-0 font-mono text-[10px] text-zinc-600">
                      {new Date(r.createdAt).toLocaleTimeString(lang === "vi" ? "vi-VN" : "en-GB", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* 4 — champion mỗi combo */}
        {data && data.champions.length > 0 && (
          <Card className="border-zinc-800 bg-zinc-900/60">
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
                  <div key={`${c.symbol}-${c.interval}`} className="flex items-center gap-2 rounded-md border border-amber-800/40 bg-amber-950/10 px-2 py-1.5 text-[11px]">
                    <Crown className="h-3 w-3 shrink-0 text-amber-400" />
                    <span className="shrink-0 font-mono font-bold text-zinc-200">#{c.symbol}</span>
                    <span className="shrink-0 font-mono text-zinc-500">{c.interval}</span>
                    <span className={`shrink-0 font-mono ${c.acc >= 55 ? "text-emerald-400" : "text-zinc-300"}`}>{c.acc.toFixed(1)}%</span>
                    <span className="shrink-0 font-mono text-zinc-500">AUC {c.auc.toFixed(2)}</span>
                    <span className="ml-auto shrink-0 font-mono text-[10px] text-zinc-500">{hyper(c.params)}</span>
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

        {/* 5 — LLM Risk Officer status */}
        <Card className="border-zinc-800 bg-zinc-900/60">
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
              </Badge>
              {!data?.llm.ping.ok && data && (
                <Badge variant="outline" className="border-amber-700 bg-amber-950/40 text-amber-300">
                  {data.llm.failClosed ? t(lang, "ai.llm.failclosed") : t(lang, "ai.llm.failopen")}
                </Badge>
              )}
              <Badge variant="outline" className="border-zinc-700 bg-zinc-950/40 text-zinc-400">
                {llmScope(data?.llm.url ?? "")}
              </Badge>
              {cfg?.llmModel && <span className="font-mono text-zinc-500">· {cfg.llmModel}</span>}
            </div>
            {data?.engine?.llmLast ? (
              <p className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-2.5 text-[11px]">
                <span className="font-bold text-zinc-200">{t(lang, "ai.llm.last")}: </span>
                <span className="font-mono text-zinc-300">
                  #{data.engine.llmLast.symbol} {data.engine.llmLast.interval} {data.engine.llmLast.side} →{" "}
                  <span className={verdictCls(data.engine.llmLast.verdict)}>{data.engine.llmLast.verdict}</span>{" "}
                  ({data.engine.llmLast.ms}ms)
                </span>
                <span className="mt-0.5 block truncate text-zinc-500">{data.engine.llmLast.reason}</span>
              </p>
            ) : (
              <p className="text-[11px] text-zinc-600">{t(lang, "ai.llm.none")}</p>
            )}
            {/* duyệt thử 1 lệnh giả — test kết nối + xem prompt/phản hồi thô */}
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

        {/* 6 — engine hiện hành */}
        <Card className="border-zinc-800 bg-zinc-900/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-zinc-100">{t(lang, "ai.engine.title")}</CardTitle>
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
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] sm:grid-cols-3 lg:grid-cols-4">
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
                    <span className="truncate text-zinc-500">{k}</span>
                    <span className="shrink-0 font-mono font-bold text-zinc-200">{String(v)}</span>
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

        {/* 7 — knobs read-only */}
        <Card className="border-zinc-800 bg-zinc-900/60">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-1.5 text-sm font-semibold text-zinc-100">
              <SlidersHorizontal className="h-4 w-4 text-teal-400" />
              {t(lang, "ai.knobs.title")}
            </CardTitle>
            <p className="text-[11px] text-zinc-500">{t(lang, "ai.knobs.sub")}</p>
          </CardHeader>
          <CardContent className="grid gap-3 pt-0 md:grid-cols-2">
            {(data?.knobs ?? []).map((g) => (
              <div key={g.name} className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
                <p className="text-xs font-bold text-zinc-200">{g.name}</p>
                <p className="mt-0.5 text-[10px] text-zinc-500">{g.note}</p>
                <div className="mt-1.5 space-y-0.5">
                  {g.items.map(([k, v]) => (
                    <div key={k} className="flex items-center justify-between gap-3 text-[11px]">
                      <span className="truncate font-mono text-zinc-500">{k}</span>
                      <span className="shrink-0 font-mono font-bold text-zinc-300">{typeof v === "object" && v !== null ? JSON.stringify(v) : String(v)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
