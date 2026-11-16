"use client";

// ─── StrategyCards (0.2.97 · 0.2.98) — bộ chọn chiến lược + đề xuất trên /auto
// Ba sổ paper-trading song song, mỗi sổ một card MỘT NÚT START/STOP RIÊNG —
// bật/tắt từng sổ độc lập, KHÔNG phải đi qua sổ nào làm “master” (0.2.98: cờ
// A/C hydrate từ engine lúc mount nên toggle dính vĩnh viễn qua reload).
// Hàng đầu tiên: START ALL / STOP ALL — bật hoặc tắt CẢ 3 sổ một lượt (một
// POST sync duy nhất kèm cfg.on + books; LIVE mirror KHÔNG bị đụng tới).
// Thống kê thực từ /api/arena; trạng thái LIVE + breadth. Kèm dòng ĐỀ XUẤT tính
// từ số thật: sổ nào net ROE cao + WR đạt → bật/giữ; sổ nào máu chảy → tắt/chờ.
// Sổ B đi theo cfg.on (START/STOP dùng chung nguồn cfg của trang — nút ở card
// và switch ở AutoPanel cùng đổi một state).

import { useCallback, useEffect, useRef, useState } from "react";
import { Play, Square } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { t, type Lang } from "@/lib/i18n";
import type { BookStats } from "@/lib/arena";

interface ArenaLite {
  a: BookStats;
  b: BookStats;
  c: BookStats;
  live: { on: boolean; nClosed: number; nOpen: number; wr: number; netRoe: number };
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
  onCfgToggle: (on: boolean) => void;
  books: { a: boolean; c: boolean };
  onToggleBooks: (patch: { a?: boolean; c?: boolean }) => void;
  onPushToast: (toast: { kind: "entry" | "flip" | "error" | "wy" | "xgb"; text: string }) => void;
}

const num = (x: number | null | undefined, d = 1): string => (x == null ? "—" : String(Math.round(x * 10 ** d) / 10 ** d));

/** Đề xuất chiến lược — heuristic thuần từ số thật (test được). Trả {book, action,
 *  reason} với action "on" | "off" | "hold". Ưu tiên: net ROE âm sâu → off; net
 *  cao + WR ≥ 40% + ≥3 lệnh → on; còn lại → hold. */
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
  // một đề xuất "on" duy nhất — chọn net cao nhất nếu nhiều
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

export function StrategyCards({ lang, cfgOn, onCfgToggle, books, onToggleBooks, onPushToast }: Props) {
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

  /** Bật/tắt sổ — POST sync {books}; toast kết quả. */
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

  /** 0.2.98 — START ALL / STOP ALL: cả 3 sổ A/B/C một lượt. Một POST sync duy
   *  nhất kèm cfg.on (sổ B) + books (sổ A/C); state trang đổi ngay, LIVE mirror
   *  không đụng tới (liveStart/liveStop là hành động riêng, có dải xác nhận). */
  const setAll = useCallback(
    async (on: boolean) => {
      onToggleBooks({ a: on, c: on });
      onCfgToggle(on);
      try {
        const res = await fetch("/api/engine", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "sync", books: { a: on, c: on }, cfg: { on } }),
        });
        if (!res.ok) toastRef.current({ kind: "error", text: t(lang, "strat.syncFail") });
      } catch {
        toastRef.current({ kind: "error", text: t(lang, "strat.syncFail") });
      }
    },
    [onToggleBooks, onCfgToggle, lang],
  );

  const statsOf = (id: "a" | "b" | "c"): BookStats | null => (arena ? arena[id] : null);
  const advice = arena ? strategyAdvice([{ id: "a", s: arena.a }, { id: "b", s: arena.b }, { id: "c", s: arena.c }]) : [];

  const badge = (on: boolean, live?: boolean) =>
    live ? (
      <Badge variant="outline" className="border-emerald-600 bg-emerald-950/50 font-mono text-[10px] font-bold text-emerald-300">
        LIVE
      </Badge>
    ) : on ? (
      <Badge variant="outline" className="border-emerald-700 bg-emerald-950/40 font-mono text-[10px] text-emerald-400">
        ON
      </Badge>
    ) : (
      <Badge variant="outline" className="border-zinc-700 font-mono text-[10px] text-zinc-500">
        OFF
      </Badge>
    );

  return (
    <div className="space-y-2">
      {/* 0.2.98 — START ALL / STOP ALL: cả 3 sổ một lượt, không phải bấm 3 card */}
      <div className="flex items-center gap-2" title={t(lang, "strat.all.tip")}>
        <Button
          size="sm"
          onClick={() => void setAll(true)}
          className="h-7 flex-1 gap-1.5 bg-emerald-700 text-[11px] text-white hover:bg-emerald-600"
        >
          <Play className="h-3 w-3" />
          {t(lang, "strat.all.start")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void setAll(false)}
          className="h-7 flex-1 gap-1.5 border-rose-800 bg-transparent text-[11px] text-rose-300 hover:bg-rose-950/40"
        >
          <Square className="h-3 w-3" />
          {t(lang, "strat.all.stop")}
        </Button>
      </div>

      {/* đề xuất — từ số thật của ba sổ */}
      {advice.some((a) => a.action !== "hold") && (
        <div className="rounded-lg border border-violet-800/60 bg-violet-950/30 px-3 py-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-violet-300">{t(lang, "strat.advice.title")}</p>
          <ul className="mt-1 space-y-0.5">
            {advice
              .filter((a) => a.action !== "hold")
              .map((a) => (
                <li key={a.id} className="text-[11px] leading-snug text-zinc-300">
                  <span className={a.action === "on" ? "font-semibold text-emerald-300" : "font-semibold text-rose-300"}>
                    {a.action === "on" ? t(lang, "strat.advice.on") : t(lang, "strat.advice.off")} {t(lang, `strat.${a.id}.name`)}
                  </span>
                  {" — "}
                  {a.reason}
                </li>
              ))}
          </ul>
          <p className="mt-1 text-[10px] text-zinc-500">{t(lang, "strat.advice.hint")}</p>
        </div>
      )}

      <div className="grid gap-2 sm:grid-cols-3">
        {/* A — Vulcan/Donchian */}
        <Card className="border-amber-900/50 bg-zinc-900/60">
          <CardHeader className="px-3 pb-1.5 pt-2.5">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold text-amber-300">A · {t(lang, "strat.a.name")}</CardTitle>
              {badge(books.a)}
            </div>
            <p className="text-[10px] leading-snug text-zinc-500">{t(lang, "strat.a.sub")}</p>
          </CardHeader>
          <CardContent className="px-3 pb-2.5 pt-0">
            <dl className="grid grid-cols-2 gap-x-2 gap-y-0.5 font-mono text-[11px]">
              <dt className="text-zinc-500">{t(lang, "strat.net")}</dt>
              <dd className={`text-right ${((statsOf("a")?.netRoe ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400")}`}>{statsOf("a") ? `${statsOf("a")!.netRoe >= 0 ? "+" : ""}${num(statsOf("a")!.netRoe)}%` : "—"}</dd>
              <dt className="text-zinc-500">WR</dt>
              <dd className="text-right text-zinc-300">{statsOf("a") ? `${num(statsOf("a")!.wr)}%` : "—"}</dd>
              <dt className="text-zinc-500">{t(lang, "strat.trades")}</dt>
              <dd className="text-right text-zinc-300">{statsOf("a") ? `${statsOf("a")!.nClosed}/${statsOf("a")!.nOpen}` : "—"}</dd>
            </dl>
            <Button
              size="sm"
              variant={books.a ? "outline" : "default"}
              onClick={() => void toggleBook({ a: !books.a })}
              title={books.a ? t(lang, "strat.turnOff") : t(lang, "strat.turnOn")}
              className={`mt-2 h-7 w-full text-[11px] ${books.a ? "border-rose-800 bg-transparent text-rose-300 hover:bg-rose-950/40" : "bg-emerald-700 text-white hover:bg-emerald-600"}`}
            >
              {books.a ? t(lang, "auto.stop") : t(lang, "auto.start")}
            </Button>
          </CardContent>
        </Card>

        {/* B — Elliott (điều khiển START/STOP dùng chung cfg) */}
        <Card className="border-sky-900/50 bg-zinc-900/60">
          <CardHeader className="px-3 pb-1.5 pt-2.5">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold text-sky-300">B · {t(lang, "strat.b.name")}</CardTitle>
              {badge(cfgOn, liveOn)}
            </div>
            <p className="text-[10px] leading-snug text-zinc-500">{t(lang, "strat.b.sub")}</p>
          </CardHeader>
          <CardContent className="px-3 pb-2.5 pt-0">
            <dl className="grid grid-cols-2 gap-x-2 gap-y-0.5 font-mono text-[11px]">
              <dt className="text-zinc-500">{t(lang, "strat.net")}</dt>
              <dd className={`text-right ${((statsOf("b")?.netRoe ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400")}`}>{statsOf("b") ? `${statsOf("b")!.netRoe >= 0 ? "+" : ""}${num(statsOf("b")!.netRoe)}%` : "—"}</dd>
              <dt className="text-zinc-500">WR</dt>
              <dd className="text-right text-zinc-300">{statsOf("b") ? `${num(statsOf("b")!.wr)}%` : "—"}</dd>
              <dt className="text-zinc-500">{t(lang, "strat.trades")}</dt>
              <dd className="text-right text-zinc-300">{statsOf("b") ? `${statsOf("b")!.nClosed}/${statsOf("b")!.nOpen}` : "—"}</dd>
            </dl>
            <Button
              size="sm"
              variant={cfgOn ? "outline" : "default"}
              onClick={() => onCfgToggle(!cfgOn)}
              className={`mt-2 h-7 w-full text-[11px] ${cfgOn ? "border-rose-800 bg-transparent text-rose-300 hover:bg-rose-950/40" : "bg-emerald-700 text-white hover:bg-emerald-600"}`}
            >
              {cfgOn ? t(lang, "auto.stop") : t(lang, "auto.start")}
            </Button>
          </CardContent>
        </Card>

        {/* C — Wyckoff gốc */}
        <Card className="border-violet-900/50 bg-zinc-900/60">
          <CardHeader className="px-3 pb-1.5 pt-2.5">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold text-violet-300">C · {t(lang, "strat.c.name")}</CardTitle>
              {badge(books.c)}
            </div>
            <p className="text-[10px] leading-snug text-zinc-500">{t(lang, "strat.c.sub")}</p>
          </CardHeader>
          <CardContent className="px-3 pb-2.5 pt-0">
            <dl className="grid grid-cols-2 gap-x-2 gap-y-0.5 font-mono text-[11px]">
              <dt className="text-zinc-500">{t(lang, "strat.net")}</dt>
              <dd className={`text-right ${((statsOf("c")?.netRoe ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400")}`}>{statsOf("c") ? `${statsOf("c")!.netRoe >= 0 ? "+" : ""}${num(statsOf("c")!.netRoe)}%` : "—"}</dd>
              <dt className="text-zinc-500">WR</dt>
              <dd className="text-right text-zinc-300">{statsOf("c") ? `${num(statsOf("c")!.wr)}%` : "—"}</dd>
              <dt className="text-zinc-500">{t(lang, "strat.trades")}</dt>
              <dd className="text-right text-zinc-300">{statsOf("c") ? `${statsOf("c")!.nClosed}/${statsOf("c")!.nOpen}` : "—"}</dd>
            </dl>
            <p className="mt-1 truncate font-mono text-[10px] text-zinc-500" title={eng?.wyckoff?.status}>
              {eng?.wyckoff?.breadth != null ? `breadth ${num(eng.wyckoff.breadth, 0)}% · ` : ""}
              {eng?.wyckoff?.status ? eng.wyckoff.status : t(lang, "strat.c.boot")}
            </p>
            <Button
              size="sm"
              variant={books.c ? "outline" : "default"}
              onClick={() => void toggleBook({ c: !books.c })}
              title={books.c ? t(lang, "strat.turnOff") : t(lang, "strat.turnOn")}
              className={`mt-1.5 h-7 w-full text-[11px] ${books.c ? "border-rose-800 bg-transparent text-rose-300 hover:bg-rose-950/40" : "bg-emerald-700 text-white hover:bg-emerald-600"}`}
            >
              {books.c ? t(lang, "auto.stop") : t(lang, "auto.start")}
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* trạng thái live — một dòng ngắn, mọi thao tác nằm ở khối điều khiển B */}
      {liveOn && (
        <p className="rounded-lg border border-emerald-800/60 bg-emerald-950/30 px-3 py-1.5 text-[11px] text-emerald-300">
          {t(lang, "strat.liveOn")}
        </p>
      )}
      {!liveOn && eng?.live && !eng.live.keys && (
        <p className="rounded-lg border border-zinc-800 bg-zinc-950/40 px-3 py-1.5 text-[11px] text-zinc-500">{t(lang, "strat.liveKeysHint")}</p>
      )}
    </div>
  );
}
