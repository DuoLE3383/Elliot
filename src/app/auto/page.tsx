"use client";

// ─── /auto — Elliott AI Trading Engine console (v0.3.12 redesign) ────────────
// Redesign theo mockup: sidebar trái + topbar (Binance pill · LIVE/DRY-RUN ·
// session · START/STOP ALL) + 4 metric tiles + Strategy Control Center +
// Level-2 Upgrade + AI Agents & Auto Settings (tab) + Positions + Recent
// Trades. LOGIC TRANG GIỮ NGUYÊN từ 0.2.95–0.3.11:
//   · settings/pairs  = localStorage (utp.settings / utp.pairs — cùng nguồn
//     với dashboard, đổi ở đây → dashboard đọc lại lần sau)
//   · cfg sổ B + books A/C = một nguồn dùng chung AutoPanel ↔ StrategyCards;
//     START ALL / STOP ALL dời lên Topbar (một POST sync kèm cfg.on + books)
//   · tickers = /api/ticker?symbols=... (30s) · lang = boot EN, toggle utp.lang
//   · tiles = /api/arena (45s) + /api/autotrade (30s) — LIVE bật thì lấy sổ
//     live, không thì gộp sổ dry-run A+B+C+D
// onPickPair: ghi utp.symbol/utp.interval rồi đưa về dashboard mở đúng cặp.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeftRight, Bot, BrainCircuit, Landmark } from "lucide-react";
import { AutoSidebar } from "@/components/auto/sidebar";
import { AutoTopbar } from "@/components/auto/topbar";
import { MetricTiles, type TilesData } from "@/components/auto/metric-tiles";
import { AutoAnalytics } from "@/components/auto-analytics";
import { AutoPanel } from "@/components/auto-panel";
import { BinanceApiCard } from "@/components/binance-api-card";
import { StrategyCards } from "@/components/strategy-cards";
import { Tune2Card } from "@/components/tune2-card";
import { t, type Lang } from "@/lib/i18n";
import { fetchAutoState, loadAutoConfig, saveAutoConfig, AUTO_DEFAULTS, type AutoConfig, type AutoState } from "@/lib/autotrade";
import type { BookStats, EquityPoint, LiveStats } from "@/lib/arena";
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
  kind: "entry" | "flip" | "error" | "warn" | "wy" | "xgb" | "success";
  side?: "LONG" | "SHORT";
  text: string;
}

/** bản thu gọn của GET /api/arena — đủ cho tiles */
interface ArenaTiles {
  a: BookStats;
  b: BookStats;
  c: BookStats;
  live: LiveStats;
  aEquity?: EquityPoint[];
  bEquity?: EquityPoint[];
  cEquity?: EquityPoint[];
}

interface EngineLite {
  cfg?: { on?: boolean };
  books?: { a: boolean; c: boolean };
  live?: { on: boolean; keys: boolean };
  wyckoff?: { breadth: number | null; status: string };
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
          // migrate legacy spot names → perp listing, bỏ pair hết perp
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

  // ── cfg sổ B — NGUỒN DUY NHẤT ở trang: AutoPanel + StrategyCards + Topbar
  // cùng đổi một state; persist utp.auto như cũ (cùng key với dashboard).
  // `on` được HYDRATE từ engine lúc mount (engine là nguồn thật của start/stop).
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
  // khi AutoPanel sync lần đầu (0.2.98). interactedRef giữ lựa chọn user.
  const [books, setBooks] = useState<{ a: boolean; c: boolean }>({ a: true, c: true });
  const [booksReady, setBooksReady] = useState(false);
  const [engLite, setEngLite] = useState<EngineLite | null>(null);
  useEffect(() => {
    let alive = true;
    const hydrate = async (): Promise<void> => {
      try {
        const res = await fetch("/api/engine", { cache: "no-store" });
        if (res.ok && alive) {
          const j = (await res.json()) as EngineLite;
          if (alive) setEngLite(j);
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
    // poll nhẹ 10s — giữ pill LIVE/DRY-RUN + breadth trên Topbar tươi
    const id = window.setInterval(() => void hydrate(), 10_000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);
  const patchBooks = useCallback((patch: { a?: boolean; c?: boolean }) => {
    interactedRef.current = true;
    setBooks((prev) => ({ ...prev, ...patch }));
  }, []);

  // ── toasts — cùng kiểu dáng với dashboard ──────────────────────────
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastSeq = useRef(0);
  const pushToast = useCallback((toast: Omit<Toast, "id">) => {
    const id = ++toastSeq.current;
    setToasts((list) => [...list.slice(-3), { ...toast, id }]);
    window.setTimeout(() => {
      setToasts((list) => list.filter((x) => x.id !== id));
    }, 7000);
  }, []);
  // refs cho setAll / hiệu ứng — tránh stale closure
  const pushToastRef = useRef(pushToast);
  useEffect(() => {
    pushToastRef.current = pushToast;
  }, [pushToast]);
  const langRef = useRef(lang);
  useEffect(() => {
    langRef.current = lang;
  }, [lang]);

  // ── START ALL / STOP ALL (0.2.98 logic, dời lên Topbar): cả 3 sổ A/B/C một
  // lượt — một POST sync duy nhất kèm cfg.on (sổ B) + books (sổ A/C); LIVE
  // mirror không đụng tới (liveStart/liveStop là hành động riêng).
  const setAll = useCallback(
    async (on: boolean) => {
      interactedRef.current = true;
      patchBooks({ a: on, c: on });
      patchCfg({ on });
      try {
        const res = await fetch("/api/engine", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "sync", books: { a: on, c: on }, cfg: { on } }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } catch {
        pushToastRef.current({ kind: "error", text: t(langRef.current, "strat.syncFail") });
      }
    },
    [patchBooks, patchCfg],
  );

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

  // ── dữ liệu tiles: arena (45s) + autotrade (30s) ───────────────────────────
  const [arena, setArena] = useState<ArenaTiles | null>(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/arena", { cache: "no-store" });
        if (res.ok && alive) setArena((await res.json()) as ArenaTiles);
      } catch {
        /* giữ cũ */
      }
    };
    void load();
    const id = window.setInterval(() => void load(), 45_000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

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

  const tilesData: TilesData = {
    a: arena?.a ?? null,
    b: arena?.b ?? null,
    c: arena?.c ?? null,
    live: arena?.live ?? null,
    capital: auto?.capital ?? cfg.capital,
    aEquity: arena?.aEquity ?? [],
    bEquity: arena?.bEquity ?? [],
    cEquity: arena?.cEquity ?? [],
  };

  // ── thẻ cấu hình Binance API — mở/đóng từ pill ở Topbar ────────────────────
  const [apiCardOpen, setApiCardOpen] = useState(false);
  const toggleApiCard = useCallback(() => setApiCardOpen((v) => !v), []);

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

  const liveOn = engLite?.live?.on === true;
  const breadth = engLite?.wyckoff?.breadth ?? null;
  const opensCount = auto?.opens?.length ?? (auto?.open ? 1 : 0);

  return (
    <div
      className="flex min-h-screen bg-[#060a14] text-zinc-200"
      style={{
        backgroundImage:
          "linear-gradient(rgba(30,45,77,0.16) 1px, transparent 1px), linear-gradient(90deg, rgba(30,45,77,0.16) 1px, transparent 1px)",
        backgroundSize: "34px 34px",
      }}
    >
      <AutoSidebar />

      <div className="flex min-w-0 flex-1 flex-col">
        <AutoTopbar
          lang={lang}
          liveOn={liveOn}
          dryOn={cfg.on}
          breadth={breadth}
          notifCount={opensCount}
          onToggleLang={toggleLang}
          onStartAll={() => void setAll(true)}
          onStopAll={() => void setAll(false)}
          onToggleApiCard={toggleApiCard}
          apiCardOpen={apiCardOpen}
        />

        <main className="mx-auto w-full max-w-[1240px] flex-1 space-y-4 px-3 py-4 sm:px-5">
          {/* Setting Binance API — mở từ pill "Binance API" trên Topbar */}
          {apiCardOpen && (
            <BinanceApiCard lang={lang} />
          )}

          {/* 4 chỉ số chính — Total Equity · Net ROI · Win Rate · Total Trades */}
          <MetricTiles data={tilesData} lang={lang} />

          {/* Strategy Control Center — 4 card A/B/C/D + Auto-Flip */}
          <StrategyCards
            lang={lang}
            cfgOn={cfg.on}
            onCfgPatch={(patch) => patchCfg(patch as Partial<AutoConfig>)}
            onCfgToggle={(on) => patchCfg({ on })}
            books={books}
            onToggleBooks={patchBooks}
            onPushToast={pushToast}
          />

          {/* Level-2 Upgrade — RR & Quality Floor */}
          <Tune2Card
            lang={lang}
            onBcfgApplied={(patch) => patchCfg(patch as Partial<AutoConfig>)}
            pushToast={pushToast}
          />

          {/* AI Agents & Auto Settings (tab) + Positions & Performance */}
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

          {/* analytics chi tiết sổ B */}
          <AutoAnalyticsSection lang={lang} />
        </main>
      </div>

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
