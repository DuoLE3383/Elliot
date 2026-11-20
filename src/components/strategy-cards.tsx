"use client";

// ─── StrategyCards (v0.3.12 redesign) — Strategy Control Center trên /auto ────
// Theo mockup: section header (icon + tiêu đề + legend + nút Auto-Flip), 4 card
// A/B/C/D — badge chữ cái, tên + mô tả, pill trạng thái (● ON / ⏸ STANDBY),
// 3 hàng số (Net ROE · WR Closed · Closed/Open), sparkline đường vốn thật,
// nút STOP/START viền màu. LOGIC GIỮ NGUYÊN 0.2.98: cờ A/C hydrate từ engine,
// sổ B theo cfg.on, toggleBook POST sync riêng, LIVE mirror không đụng tới.
// START ALL / STOP ALL đã dời lên Topbar (trang sở hữu setAll).

import { useCallback, useEffect, useRef, useState } from "react";
import { Play, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { t, type Lang } from "@/lib/i18n";
import type { BookStats, EquityPoint } from "@/lib/arena";

interface ArenaLite {
  a: BookStats;
  b: BookStats;
  c: BookStats;
  live: { on: boolean; nClosed: number; nOpen: number; wr: number; netRoe: number };
  aEquity?: EquityPoint[];
  bEquity?: EquityPoint[];
  cEquity?: EquityPoint[];
}

interface EngineLite {
  cfg: { on: boolean };
  books?: { a: boolean; c: boolean };
  live?: { on: boolean; confirmedAt: number | null; keys: boolean };
  wyckoff?: { breadth: number | null; status: string; tickAt: number };
}

interface Props {
  lang: Lang;
  cfgOn: boolean;
  /** patch cfg bất kỳ (autoFlip...) — cùng nguồn patchCfg của trang */
  onCfgPatch: (patch: Record<string, unknown>) => void;
  /** bật/tắt sổ B (cfg.on) — dùng cho nút START/STOP card B */
  onCfgToggle: (on: boolean) => void;
  books: { a: boolean; c: boolean };
  onToggleBooks: (patch: { a?: boolean; c?: boolean }) => void;
  onPushToast: (toast: { kind: "entry" | "flip" | "error" | "wy" | "xgb"; text: string }) => void;
}

const num = (x: number | null | undefined, d = 1): string => (x == null ? "—" : String(Math.round(x * 10 ** d) / 10 ** d));

/** Đề xuất chiến lược — heuristic thuần từ số thật (giữ nguyên 0.2.97). */
export function strategyAdvice(
  books: Array<{ id: "a" | "b" | "c"; s: BookStats }>,
): Array<{ id: "a" | "b" | "c"; action: "on" | "off" | "hold"; reason: string }> {
  const active = books.filter((b) => b.s.nClosed >= 3);
  const out: Array<{ id: "a" | "b" | "c"; action: "on" | "off" | "hold"; reason: string }> = books.map((b) => ({ id: b.id, action: "hold", reason: "" }));
  for (const b of active) {
    const idx = out.findIndex((o) => o.id === b.id);
    if (b.s.netRoe <= -10 && b.s.wr < 35) {
      out[idx] = { id: b.id, action: "off", reason: `net ${num(b.s.netRoe)}% · WR ${num(b.s.wr)}% — dừng để sổ khác chạy` };
    } else if (b.s.netRoe >= 5 && b.s.wr >= 40) {
      out[idx] = { id: b.id, action: "on", reason: `net +${num(b.s.netRoe)}% · WR ${num(b.s.wr)}% trên ${b.s.nClosed} lệnh` };
    }
  }
  const ons = out.filter((o) => o.action === "on");
  if (ons.length > 1) {
    const best = books.filter((b) => ons.some((o) => o.id === b.id)).sort((x, y) => y.s.netRoe - x.s.netRoe)[0];
    for (const o of out) {
      if (o.action === "on" && o.id !== best.id) {
        o.action = "hold";
        o.reason = "";
      }
    }
  }
  return out;
}

/** sparkline vùng theo màu accent — từ đường vốn sổ (thật) hoặc phẳng. */
function CardSpark({ equity, color }: { equity: EquityPoint[] | undefined; color: string }) {
  const pts = (equity ?? []).map((p) => p.capital).slice(-40);
  if (pts.length < 2) {
    return (
      <svg viewBox="0 0 200 36" className="h-9 w-full" aria-hidden>
        <path d="M2,26 L198,26" stroke={color} strokeOpacity="0.22" strokeWidth="1.4" strokeDasharray="4 4" fill="none" />
      </svg>
    );
  }
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const W = 200;
  const H = 36;
  const d = pts
    .map((p, i) => {
      const x = (i / (pts.length - 1)) * W;
      const y = H - 3 - ((p - min) / (max - min || 1)) * (H - 8);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-9 w-full" aria-hidden>
      <path d={`${d} L${W},${H} L0,${H} Z`} fill={color} fillOpacity="0.13" />
      <path d={d} fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

interface CardSpec {
  id: "a" | "b" | "c" | "d";
  letter: string;
  name: string;
  sub: string;
  accent: string; // hex cho sparkline
  badge: string; // classes badge chữ cái
  border: string;
  title: string;
  pillOn: string;
  icon: React.ReactNode;
}

export function StrategyCards({ lang, cfgOn, onCfgPatch, onCfgToggle, books, onToggleBooks, onPushToast }: Props) {
  const [arena, setArena] = useState<ArenaLite | null>(null);
  const [eng, setEng] = useState<EngineLite | null>(null);
  const aliveRef = useRef(true);
  const toastRef = useRef(onPushToast);
  useEffect(() => {
    toastRef.current = onPushToast;
  }, [onPushToast]);

  useEffect(() => {
    aliveRef.current = true;
    const loadArena = async (): Promise<void> => {
      try {
        const res = await fetch("/api/arena", { cache: "no-store" });
        if (res.ok && aliveRef.current) setArena((await res.json()) as ArenaLite);
      } catch {
        /* giữ cũ */
      }
    };
    const loadEng = async (): Promise<void> => {
      try {
        const res = await fetch("/api/engine", { cache: "no-store" });
        if (res.ok && aliveRef.current) setEng((await res.json()) as EngineLite);
      } catch {
        /* giữ cũ */
      }
    };
    void loadArena();
    void loadEng();
    const a = window.setInterval(() => void loadArena(), 45_000);
    const e = window.setInterval(() => void loadEng(), 5_000);
    return () => {
      aliveRef.current = false;
      window.clearInterval(a);
      window.clearInterval(e);
    };
  }, []);

  const liveOn = eng?.live?.on === true;

  /** Bật/tắt sổ — POST sync {books}; toast kết quả. (giữ nguyên 0.2.98) */
  const toggleBook = useCallback(
    async (patch: { a?: boolean; c?: boolean }) => {
      onToggleBooks(patch);
      try {
        const res = await fetch("/api/engine", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "sync", books: { ...books, ...patch } }),
        });
        if (!res.ok) toastRef.current({ kind: "error", text: t(lang, "strat.syncFail") });
      } catch {
        toastRef.current({ kind: "error", text: t(lang, "strat.syncFail") });
      }
    },
    [books, onToggleBooks, lang],
  );

  const statsOf = (id: "a" | "b" | "c" | "d"): BookStats | null => {
    if (!arena) return null;
    const byKey: Record<string, BookStats | undefined> = { a: arena.a, b: arena.b, c: arena.c };
    return byKey[id] ?? null;
  };
  const advice = arena ? strategyAdvice([{ id: "a", s: arena.a }, { id: "b", s: arena.b }, { id: "c", s: arena.c }]) : [];

  // ── mô tả 4 sổ — text theo ngôn ngữ, giữ key i18n cũ
  const SPECS: CardSpec[] = [
    {
      id: "a",
      letter: "A",
      name: t(lang, "strat.a.name"),
      sub: t(lang, "strat.a.sub"),
      accent: "#f59e0b",
      badge: "border-amber-600/60 bg-amber-950/50 text-amber-300",
      border: "border-amber-500/30 hover:border-amber-500/60",
      title: "text-amber-300",
      pillOn: "border-emerald-600/70 bg-emerald-950/40 text-emerald-300",
      icon: (
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden>
          <path d="M3 20 L9 8 L13 15 L16 10 L21 20 Z" fill="none" stroke="#f59e0b" strokeWidth="1.8" strokeLinejoin="round" />
        </svg>
      ),
    },
    {
      id: "b",
      letter: "B",
      name: t(lang, "strat.b.name"),
      sub: t(lang, "strat.b.sub"),
      accent: "#22d3ee",
      badge: "border-cyan-600/60 bg-cyan-950/50 text-cyan-300",
      border: "border-cyan-500/30 hover:border-cyan-500/60",
      title: "text-cyan-300",
      pillOn: "border-emerald-600/70 bg-emerald-950/40 text-emerald-300",
      icon: (
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden>
          <rect x="4" y="12" width="3" height="8" rx="1" fill="#22d3ee" fillOpacity="0.8" />
          <rect x="10.5" y="7" width="3" height="13" rx="1" fill="#22d3ee" fillOpacity="0.8" />
          <rect x="17" y="3" width="3" height="17" rx="1" fill="#22d3ee" fillOpacity="0.8" />
        </svg>
      ),
    },
    {
      id: "c",
      letter: "C",
      name: t(lang, "strat.c.name"),
      sub: t(lang, "strat.c.sub"),
      accent: "#a855f7",
      badge: "border-violet-600/60 bg-violet-950/50 text-violet-300",
      border: "border-violet-500/30 hover:border-violet-500/60",
      title: "text-violet-300",
      pillOn: "border-emerald-600/70 bg-emerald-950/40 text-emerald-300",
      icon: (
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden>
          <circle cx="12" cy="5" r="2.2" fill="#a855f7" fillOpacity="0.85" />
          <circle cx="5" cy="17" r="2.2" fill="#a855f7" fillOpacity="0.85" />
          <circle cx="19" cy="17" r="2.2" fill="#a855f7" fillOpacity="0.85" />
          <path d="M12 7.2 L6 15 M12 7.2 L18 15 M7.2 17 H16.8" stroke="#a855f7" strokeWidth="1.4" />
        </svg>
      ),
    },
    {
      id: "d",
      letter: "D",
      name: t(lang, "strat.d.name"),
      sub: t(lang, "strat.d.sub"),
      accent: "#14b8a6",
      badge: "border-teal-600/60 bg-teal-950/50 text-teal-300",
      border: "border-teal-500/30 hover:border-teal-500/60",
      title: "text-rose-300",
      pillOn: "border-emerald-600/70 bg-emerald-950/40 text-emerald-300",
      icon: (
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden>
          <path d="M12 3 C12 3 6 10 6 14.5 A6 6 0 0 0 18 14.5 C18 10 12 3 12 3 Z" fill="none" stroke="#14b8a6" strokeWidth="1.8" strokeLinejoin="round" />
          <path d="M9.5 15 A2.5 2.5 0 0 0 12 17.5" fill="none" stroke="#14b8a6" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      ),
    },
  ];

  const equityOf = (id: "a" | "b" | "c"): EquityPoint[] | undefined =>
    id === "a" ? arena?.aEquity : id === "b" ? arena?.bEquity : arena?.cEquity;

  /** trạng thái mỗi sổ: on → "● ON"; off → "⏸ STANDBY" (theo mockup) */
  const isOn = (id: "a" | "b" | "c" | "d"): boolean => {
    if (id === "b") return cfgOn || liveOn;
    if (id === "d") return ((books as Record<string, boolean | undefined>).d ?? true) === true;
    return (books as Record<string, boolean | undefined>)[id] === true;
  };

  const adviceMap = new Map(advice.map((x) => [x.id, x]));

  return (
    <section className="rounded-2xl border border-[#1e2d4d]/70 bg-[#0a0f1e]/80 p-4">
      {/* section header — icon + title + legend + Auto-Flip */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-sky-700/50 bg-sky-950/40">
            {/* crosshair */}
            <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden>
              <circle cx="12" cy="12" r="7.5" fill="none" stroke="#38bdf8" strokeWidth="1.6" />
              <path d="M12 2 V7 M12 17 V22 M2 12 H7 M17 12 H22" stroke="#38bdf8" strokeWidth="1.6" strokeLinecap="round" />
              <circle cx="12" cy="12" r="1.6" fill="#38bdf8" />
            </svg>
          </span>
          <div>
            <h2 className="text-[15px] font-bold leading-tight text-white">
              {lang === "vi" ? "Trung tâm điều khiển chiến lược" : "Strategy Control Center"}
            </h2>
            <p className="text-[11px] leading-tight text-zinc-500">
              {lang === "vi" ? "Bốn chiến lược — một engine thông minh" : "Four strategies — one intelligent engine"}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {/* legend */}
          <div className="hidden items-center gap-3 text-[10px] text-zinc-500 sm:flex">
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" /> Running</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-500" /> Standby</span>
          </div>
          {/* Auto-Flip toggle — cfg.autoFlip thật */}
          <div className="flex items-center gap-2 rounded-full border border-[#24365c] bg-[#0b1424] px-2.5 py-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Auto-Flip</span>
            <AutoFlipSwitch lang={lang} onCfgPatch={onCfgPatch} />
          </div>
        </div>
      </div>

      {/* 4 card chiến lược */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {SPECS.map((spec) => {
          const st = statsOf(spec.id);
          const on = isOn(spec.id);
          const hasData = st != null && st.nClosed > 0;
          const netRoe = st?.netRoe ?? 0;
          const adv = adviceMap.get(spec.id as "a" | "b" | "c");
          return (
            <article
              key={spec.id}
              className={`group relative flex flex-col overflow-hidden rounded-xl border bg-gradient-to-b from-[#101a30]/90 via-[#0c1424]/90 to-[#0a0f1e] p-3.5 transition-colors ${spec.border}`}
              style={{ boxShadow: on ? `0 0 18px ${spec.accent}22` : undefined }}
            >
              {/* header card: badge chữ + tên + pill trạng thái */}
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border font-mono text-[12px] font-black ${spec.badge}`}>
                    {spec.letter}
                  </span>
                  <div className="min-w-0">
                    <h3 className={`truncate text-[13px] font-bold leading-tight ${spec.title}`}>{spec.name}</h3>
                    <p className="truncate text-[10px] leading-tight text-zinc-500" title={spec.sub}>{spec.sub}</p>
                  </div>
                </div>
                {on ? (
                  <span className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-bold ${spec.pillOn}`}>
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" aria-hidden />
                    ON
                  </span>
                ) : (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-700/60 bg-amber-950/30 px-2 py-0.5 text-[9px] font-bold text-amber-300">
                    ⏸ STANDBY
                  </span>
                )}
              </div>

              {/* icon accent + sparkline */}
              <div className="mt-2.5 flex items-center gap-2">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-zinc-800 bg-[#0b1424]">{spec.icon}</span>
                <div className="min-w-0 flex-1">
                  <CardSpark equity={equityOf(spec.id as "a" | "b" | "c")} color={spec.accent} />
                </div>
              </div>

              {/* metric rows */}
              <dl className="mt-2 grid grid-cols-2 gap-x-2 gap-y-1 font-mono text-[11px]">
                <dt className="text-zinc-500">Net ROE</dt>
                <dd className={`text-right font-bold ${hasData ? (netRoe >= 0 ? "text-emerald-400" : "text-rose-400") : "text-zinc-500"}`}>
                  {hasData ? `${netRoe >= 0 ? "+" : ""}${num(netRoe)}%` : "—"}
                </dd>
                <dt className="text-zinc-500">WR (Closed)</dt>
                <dd className="text-right font-bold text-zinc-200">{hasData ? `${num(st!.wr)}%` : "—"}</dd>
                <dt className="text-zinc-500">Closed / Open</dt>
                <dd className="text-right font-bold text-zinc-200">{st ? `${st.nClosed} / ${st.nOpen}` : "0 / 0"}</dd>
              </dl>

              {/* đề xuất (nếu có) — một dòng nhỏ */}
              {adv && adv.action !== "hold" && (
                <p className={`mt-1.5 truncate rounded-md border px-1.5 py-1 text-[9px] leading-snug ${adv.action === "on" ? "border-emerald-800/60 bg-emerald-950/30 text-emerald-300" : "border-rose-800/60 bg-rose-950/30 text-rose-300"}`} title={adv.reason}>
                  {adv.action === "on" ? (lang === "vi" ? "Đề xuất: BẬT" : "Advice: ON") : lang === "vi" ? "Đề xuất: TẮT" : "Advice: OFF"} — {adv.reason}
                </p>
              )}

              {/* dòng trạng thái engine (C/D breadth) */}
              {spec.id === "c" && eng?.wyckoff?.status && (
                <p className="mt-1.5 truncate font-mono text-[9px] text-zinc-600" title={eng.wyckoff.status}>
                  {eng.wyckoff.breadth != null ? `breadth ${num(eng.wyckoff.breadth, 0)}% · ` : ""}{eng.wyckoff.status}
                </p>
              )}

              {/* nút START/STOP */}
              <div className="mt-auto pt-2.5">
                {spec.id === "b" ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onCfgToggle(!cfgOn)}
                    className={`h-8 w-full rounded-lg text-[11px] font-bold ${
                      cfgOn
                        ? "border-rose-700/70 bg-rose-950/20 text-rose-300 hover:bg-rose-950/40"
                        : "border-emerald-600/70 bg-emerald-950/20 text-emerald-300 hover:bg-emerald-950/40"
                    }`}
                  >
                    {cfgOn ? <Square className="h-3 w-3 fill-current" /> : <Play className="h-3 w-3 fill-current" />}
                    {cfgOn ? t(lang, "auto.stop") : t(lang, "auto.start")}
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void toggleBook({ [spec.id]: !on } as { a?: boolean; c?: boolean })}
                    className={`h-8 w-full rounded-lg text-[11px] font-bold ${
                      on
                        ? "border-rose-700/70 bg-rose-950/20 text-rose-300 hover:bg-rose-950/40"
                        : "border-emerald-600/70 bg-emerald-950/20 text-emerald-300 hover:bg-emerald-950/40"
                    }`}
                  >
                    {on ? <Square className="h-3 w-3 fill-current" /> : <Play className="h-3 w-3 fill-current" />}
                    {on ? t(lang, "auto.stop") : t(lang, "auto.start")}
                  </Button>
                )}
              </div>
            </article>
          );
        })}
      </div>

      {/* trạng thái live — một dòng ngắn */}
      {liveOn && (
        <p className="mt-3 rounded-lg border border-emerald-800/60 bg-emerald-950/30 px-3 py-1.5 text-[11px] text-emerald-300">
          {t(lang, "strat.liveOn")}
        </p>
      )}
    </section>
  );
}

/** Switch Auto-Flip thật — tách component để giữ state cục bộ gọn. */
function AutoFlipSwitch({ lang, onCfgPatch }: { lang: Lang; onCfgPatch: (patch: Record<string, unknown>) => void }) {
  const [on, setOn] = useState<boolean | null>(null);
  // sau khi user bấm, bỏ qua poll ~15s — tránh flip hình do engine trả giá trị
  // cũ trước khi sync POST của trang kịp tới (đẩy lên qua useEffect cfg).
  const patchedAtRef = useRef(0);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/engine", { cache: "no-store" });
        if (!res.ok || !alive) return;
        const j = (await res.json()) as { cfg?: { autoFlip?: boolean } };
        if (alive && typeof j.cfg?.autoFlip === "boolean") {
          if (Date.now() - patchedAtRef.current < 15_000) return; // vừa bấm — giữ lựa chọn user
          setOn(j.cfg.autoFlip);
        }
      } catch {
        /* giữ cũ */
      }
    };
    void load();
    const id = window.setInterval(() => void load(), 10_000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);
  const cur = on === true;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={cur}
      aria-label="Auto-Flip"
      title={t(lang, "auto.flip.tip", { s: 0, a: "0", c: "0" })}
      onClick={() => {
        const next = !cur;
        patchedAtRef.current = Date.now();
        setOn(next);
        onCfgPatch({ autoFlip: next });
      }}
      className={`relative h-[18px] w-[34px] rounded-full transition-colors ${cur ? "bg-emerald-500" : "bg-zinc-700"}`}
    >
      <span className={`absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white transition-all ${cur ? "left-[18px]" : "left-[2px]"}`} />
    </button>
  );
}
