"use client";

// ─── /auto — Auto Trade — trang riêng, tách khỏi dashboard ───────────────────
// 0.2.95 — AutoPanel trước đây nằm cuối cột phải dashboard (bị chật, phải cuộn
// dài). Trang riêng cho không gian đầy đủ; dashboard còn lối tắt mở trang này.
// 0.2.97 — trang CHỦ cfg + books (một nguồn dùng chung AutoPanel ↔
// StrategyCards: START/STOP ở card B và switch ở panel đổi cùng một state);
// thêm StrategyCards (A/B/C + đề xuất) + AutoAnalytics chi tiết. Universe đã
// dời về Watchlist (dashboard) — trang này chỉ còn trade.
// Data tự lo, KHÔNG cần /api/view nặng của dashboard:
//   · settings/pairs  = localStorage (utp.settings / utp.pairs — CÙNG NGUỒN với
//     dashboard, đổi ở đây → dashboard đọc lại lần sau)
//   · tickers         = /api/ticker?symbols=... (30s, giống TickerStrip)
//   · lang            = boot EN mỗi lượt (0.2.58), toggle lưu utp.lang
// onPickPair: ghi utp.symbol/utp.interval rồi đưa về dashboard — chart mở đúng
// cặp ngay (dashboard đọc 2 key này khi hydrate).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, ArrowLeftRight, Bot, BrainCircuit, Landmark } from "lucide-react";
import { AutoAnalytics } from "@/components/auto-analytics";
import { AutoPanel } from "@/components/auto-panel";
import { BinanceApiCard } from "@/components/binance-api-card";
import { StrategyCards } from "@/components/strategy-cards";
import { Button } from "@/components/ui/button";
import { t, type Lang } from "@/lib/i18n";
import { fetchAutoState, loadAutoConfig, saveAutoConfig, AUTO_DEFAULTS, type AutoConfig, type AutoState } from "@/lib/autotrade";
import {
  DEFAULT_SETTINGS,
  EngineSettings,
  INTERVALS,
  Interval,
  MAX_CUSTOM_PAIRS,
  MAX_LEVERAGE,
  SYMBOLS,
  Ticker,
  aliasFuturesSymbol,
  migratePairsTo,
} from "@/lib/types";

interface Toast {
  id: number;
  kind: "entry" | "flip" | "error" | "warn" | "wy" | "xgb";
  side?: "LONG" | "SHORT";
  text: string;
}

export default function AutoPage() {
  const router = useRouter();

  // ── ngôn ngữ: boot EN mỗi lượt (như dashboard + /ai), toggle lưu utp.lang ──
  const [lang, setLang] = useState<Lang>("en");
  const toggleLang = useCallback(() => {
    setLang((l) => {
      const next: Lang = l === "vi" ? "en" : "vi";
      try {
        localStorage.setItem("utp.lang", next);
      } catch {
        /* private mode */
      }
      return next;
    });
  }, []);

  // ── settings + custom pairs — cùng nguồn localStorage với dashboard ────────
  const [settings, setSettings] = useState<EngineSettings>(DEFAULT_SETTINGS);
  const [customPairs, setCustomPairs] = useState<string[]>([]);
  const hydratedRef = useRef(false);

  useEffect(() => {
    try {
      const s = localStorage.getItem("utp.settings");
      if (s) {
        let parsed = JSON.parse(s) as Partial<EngineSettings>;
        // one-time legacy fix (gate v2) — y hệt dashboard, giữ 2 trang đồng bộ
        if (localStorage.getItem("utp.gate.v2") !== "1") {
          localStorage.setItem("utp.gate.v2", "1");
          parsed = { ...parsed, smaFilter: false };
          localStorage.setItem("utp.settings", JSON.stringify(parsed));
        }
        setSettings({ ...DEFAULT_SETTINGS, ...parsed });
      }
      const p = localStorage.getItem("utp.pairs");
      if (p) {
        const arr = JSON.parse(p);
        if (Array.isArray(arr)) {
          // migrate legacy spot names → perp listing (PEPEUSDT→1000PEPEUSDT),
          // bỏ pair hết perp — tránh poll 400 vĩnh viễn như dashboard
          const migrated = migratePairsTo(
            arr.filter((x: unknown): x is string => typeof x === "string"),
          ).slice(0, MAX_CUSTOM_PAIRS);
          setCustomPairs(migrated);
          if (JSON.stringify(migrated) !== JSON.stringify(arr)) {
            localStorage.setItem("utp.pairs", JSON.stringify(migrated));
          }
        }
      }
    } catch {
      // localStorage hỏng → dùng DEFAULT, không chết trang
    } finally {
      hydratedRef.current = true;
    }
  }, []);

  // persist sau khi hydrate xong (đỪng ghi đè trước khi đọc)
  useEffect(() => {
    if (hydratedRef.current) localStorage.setItem("utp.settings", JSON.stringify(settings));
  }, [settings]);
  useEffect(() => {
    if (hydratedRef.current) localStorage.setItem("utp.pairs", JSON.stringify(customPairs));
  }, [customPairs]);

  // ── cfg sổ B — NGUỒN DUY NHẤT ở trang (0.2.97): AutoPanel + StrategyCards
  // cùng đổi một state; persist utp.auto như cũ (cùng key với dashboard).
  // 0.2.99 — `on` được HYDRATE từ engine lúc mount (engine là nguồn thật của
  // start/stop): localStorage cũ/pm2 restart không còn hồi sinh sổ B ngầm.
  const [cfg, setCfg] = useState<AutoConfig>(AUTO_DEFAULTS);
  useEffect(() => {
    try {
      setCfg(loadAutoConfig());
    } catch {
      setCfg(AUTO_DEFAULTS);
    }
  }, []);
  // đã có thao tác trước khi engine trả lời hydrate? → KHÔNG ghi đè lựa chọn
  const interactedRef = useRef(false);
  const patchCfg = useCallback((patch: Partial<AutoConfig>) => {
    interactedRef.current = true;
    setCfg((prev) => {
      const next = { ...prev, ...patch };
      saveAutoConfig(next);
      return next;
    });
  }, []);

  // ── books A/C — boot: đọc TRẠNG THÁI THẬT từ engine (GET /api/engine) trước
  //  khi AutoPanel sync lần đầu (0.2.98). Trước đây mặc định {a:true,c:true} →
  //  sync mount đè cờ engine, toggle sổ A/C không dính qua reload (phải đi qua
  //  START sổ giữa). Lỗi fetch → mở khoá sync luôn, dùng default như cũ.
  //  0.2.99 — hydrate CẢ cfg.on (sổ B) cùng lúc + guard: nếu user đã bấm gì đó
  //  trước khi engine trả lời thì giữ lựa chọn của user (không bị revert).
  const [books, setBooks] = useState<{ a: boolean; c: boolean }>({ a: true, c: true });
  const [booksReady, setBooksReady] = useState(false);
  useEffect(() => {
    let alive = true;
    const hydrate = async (): Promise<void> => {
      try {
        const res = await fetch("/api/engine", { cache: "no-store" });
        if (res.ok && alive) {
          const j = (await res.json()) as { cfg?: { on?: boolean }; books?: { a: boolean; c: boolean } };
          if (!interactedRef.current) {
            if (j.books) setBooks({ a: j.books.a === true, c: j.books.c === true });
            const on = j.cfg?.on;
            if (typeof on === "boolean") {
              setCfg((prev) => {
                if (prev.on === on) return prev;
                const next = { ...prev, on };
                saveAutoConfig(next);
                return next;
              });
            }
          }
        }
      } catch {
        /* engine chưa trả lời → giữ default */
      }
      if (alive) setBooksReady(true); // mở khoá sync kể cả khi fetch lỗi
    };
    void hydrate();
    return () => {
      alive = false;
    };
  }, []);
  const patchBooks = useCallback((patch: { a?: boolean; c?: boolean }) => {
    interactedRef.current = true;
    setBooks((prev) => ({ ...prev, ...patch }));
  }, []);

  const allPairs = useMemo(() => {
    const extra = customPairs.filter((c) => !(SYMBOLS as readonly string[]).includes(c));
    return [...SYMBOLS, ...extra];
  }, [customPairs]);

  // ── tickers 24h cho bảng universe của AutoPanel (30s) ─────────────────────
  const [tickers, setTickers] = useState<Record<string, Ticker>>({});
  const pairListKey = allPairs.join(",");
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch(`/api/ticker?symbols=${encodeURIComponent(pairListKey)}`);
        if (!res.ok) return;
        const json = (await res.json()) as { tickers: Ticker[] };
        if (!alive) return;
        const map: Record<string, Ticker> = {};
        for (const tk of json.tickers) map[tk.symbol] = tk;
        setTickers(map);
      } catch {
        // giữ giá trị cũ qua lỗi thoáng qua
      }
    };
    void load();
    const id = window.setInterval(() => void load(), 30000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [pairListKey]);

  // ── toasts — cùng kiểu dáng với dashboard ──────────────────────────────────
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastSeq = useRef(0);
  const pushToast = useCallback((toast: Omit<Toast, "id">) => {
    const id = ++toastSeq.current;
    setToasts((list) => [...list.slice(-3), { ...toast, id }]);
    window.setTimeout(() => {
      setToasts((list) => list.filter((x) => x.id !== id));
    }, 7000);
  }, []);

  // ── AutoPanel callbacks ────────────────────────────────────────────────────
  // onPickPair: chọn cặp ở panel → mở dashboard đúng cặp/khung ngay
  const handlePickPair = useCallback(
    (sym: string, itv: string) => {
      const alias = aliasFuturesSymbol(sym) ?? sym;
      try {
        if (alias && /^[A-Z0-9]{5,20}$/.test(alias)) localStorage.setItem("utp.symbol", alias);
        if ((INTERVALS as readonly string[]).includes(itv)) localStorage.setItem("utp.interval", itv as Interval);
      } catch {
        /* private mode */
      }
      router.push("/");
    },
    [router],
  );

  return (
    <div className="min-h-screen bg-transparent text-zinc-200">
      {/* sticky header — back / title / lang luôn trong tầm tay */}
      <header className="sticky top-0 z-30 border-b border-zinc-800/60 bg-[#020617]/85 backdrop-blur">
        <div className="flex flex-wrap items-center gap-2 px-3 py-2.5 sm:px-5">
          <Button size="sm" variant="outline" className="h-8 gap-1.5 border-zinc-700 px-2.5 text-xs text-zinc-300 hover:bg-zinc-800" asChild>
            <Link href="/">
              <ArrowLeft className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{t(lang, "auto.back")}</span>
            </Link>
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="flex items-center gap-2 text-base font-bold text-zinc-100 sm:text-lg">
              <Bot className="h-4 w-4 shrink-0 text-teal-400" />
              <span className="truncate">{t(lang, "auto.title")}</span>
            </h1>
            <p className="truncate text-[11px] text-zinc-500">{t(lang, "auto.sub")}</p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-8 border-zinc-700 px-2.5 text-xs text-zinc-300 hover:bg-zinc-800"
            onClick={toggleLang}
          >
            {lang === "vi" ? "EN" : "VI"}
          </Button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl space-y-3 px-3 py-3 sm:px-5">
        {/* Setting Binance API (0.2.96) — key server-side, test kết nối chỉ đọc */}
        <div className="mb-3">
          <BinanceApiCard lang={lang} />
        </div>
        {/* 0.2.97 — bộ chọn chiến lược A/B/C + đề xuất + trạng thái LIVE */}
        <StrategyCards
          lang={lang}
          cfgOn={cfg.on}
          onCfgToggle={(on) => patchCfg({ on })}
          books={books}
          onToggleBooks={patchBooks}
          onPushToast={pushToast}
        />
        {/* khối điều khiển + sổ B */}
        <AutoPanel
          lang={lang}
          pairs={allPairs}
          leverage={settings.leverage}
          onLeverageChange={(lev) =>
            setSettings((s) => ({ ...s, leverage: Math.max(1, Math.min(MAX_LEVERAGE, Math.round(lev) || 1)) }))
          }
          tickers={tickers}
          settings={settings}
          cfg={cfg}
          onCfgChange={patchCfg}
          books={books}
          syncReady={booksReady}
          onPickPair={handlePickPair}
          pushToast={pushToast}
        />
        {/* 0.2.97 — analytics chi tiết sổ B */}
        <AutoAnalyticsSection lang={lang} />
      </main>

      {/* ── Toasts — giống dashboard ─────────────────────────────────────── */}
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto rounded-lg border px-3.5 py-2.5 shadow-lg backdrop-blur ${
              toast.kind === "flip"
                ? "border-zinc-600 bg-[#020617]/90"
                : toast.kind === "warn"
                  ? "border-amber-600 bg-amber-950/90"
                  : toast.kind === "wy"
                    ? "border-violet-700 bg-violet-950/90"
                    : toast.kind === "xgb"
                      ? "border-teal-600 bg-teal-950/90"
                      : toast.kind === "error"
                        ? "border-rose-700 bg-rose-950/90"
                        : toast.side === "LONG"
                          ? "border-emerald-700 bg-emerald-950/90"
                          : "border-rose-700 bg-rose-950/90"
            }`}
            role="status"
          >
            <p className="flex items-start gap-2 text-xs leading-relaxed text-zinc-100">
              {toast.kind === "flip" && <ArrowLeftRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-400" />}
              {toast.kind === "warn" && <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />}
              {toast.kind === "wy" && <Landmark className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-400" />}
              {toast.kind === "xgb" && <BrainCircuit className="mt-0.5 h-3.5 w-3.5 shrink-0 text-teal-400" />}
              <span>{toast.text}</span>
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Analytics — fetch /api/autotrade riêng (30s): component thuần display
//    nhận AutoState; fetch tách khỏi AutoPanel để không poll kép.

function AutoAnalyticsSection({ lang }: { lang: Lang }) {
  const [auto, setAuto] = useState<AutoState | null>(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const st = await fetchAutoState();
        if (alive) setAuto(st);
      } catch {
        /* giữ cũ */
      }
    };
    void load();
    const id = window.setInterval(() => void load(), 30_000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);
  return <AutoAnalytics lang={lang} auto={auto} />;
}
