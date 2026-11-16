"use client";

// ─── Tune2Card (0.3.0) — ô "NÂNG CẤP CẤP 2" cạnh ô setting phần dry-run (/auto)
// Đề xuất RR + Quality floor cho CẢ BA sổ A/B/C, sinh từ số thật của từng sổ
// (GET /api/tune2 — file db/tune2-proposal.json, sống qua restart) và hiển thị
// kèm LÝ DO rõ ràng (WR, payoff, expectancy, net, phí round-trip). Áp một sổ =
// POST apply: núm runtime qua setOverride (hiệu lực tick kế tiếp), floor sổ B
// qua syncEngine (cfg) — trang cha còn patch cfg localStorage cho khớp.

import { useCallback, useEffect, useRef, useState } from "react";
import { SlidersHorizontal, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { t, type Lang } from "@/lib/i18n";
// THUẦN types — tune2.ts (server-only: fs/prisma) KHÔNG được import từ client
import { TUNE2_MIN_N, type BookId, type Tune2Cur, type Tune2Item, type Tune2Stats } from "@/lib/tune2-types";

interface Tune2Response {
  ok: boolean;
  computedAt: string;
  books: Record<BookId, Tune2Stats | null>;
  items: Tune2Item[];
  current: Record<BookId, Tune2Cur>;
  applied?: number;
  cfgPatch?: Record<string, number>;
  note?: string;
  error?: string;
}

interface Props {
  lang: Lang;
  /** sổ B áp floor xong → trang cha patch cfg (localStorage + sync) khớp engine */
  onBcfgApplied?: (patch: Record<string, number>) => void;
  pushToast: (toast: { kind: "entry" | "flip" | "error" | "warn" | "wy" | "xgb"; text: string }) => void;
}

const BOOK_THEME: Record<BookId, { border: string; title: string; chip: string; name: string }> = {
  a: { border: "border-amber-900/50", title: "text-amber-300", chip: "border-amber-800 bg-amber-950/40 text-amber-300", name: "A" },
  b: { border: "border-sky-900/50", title: "text-sky-300", chip: "border-sky-800 bg-sky-950/40 text-sky-300", name: "B" },
  c: { border: "border-violet-900/50", title: "text-violet-300", chip: "border-violet-800 bg-violet-950/40 text-violet-300", name: "C" },
};

const num = (v: number | undefined, d = 2): string => (v == null || !Number.isFinite(v) ? "—" : String(Math.round(v * 10 ** d) / 10 ** d));

/** Lý do hiển thị: ghép f2seg/f3seg client-side (label theo ngôn ngữ). */
function reasonOf(lang: Lang, item: Tune2Item): string {
  const vars: Record<string, string | number> = { ...item.args };
  const seg = (i: number, key: string) => {
    const e = item.extras[i];
    if (!e) return "";
    // segment 1 → prefix "f2", segment 2 → prefix "f3" (khớp template i18n)
    const p = i === 0 ? "f2" : "f3";
    const dec = (v: number): number => (Number.isInteger(v) ? 0 : 2);
    return t(lang, key, { [`${p}param`]: t(lang, `tune2.param.${e.param}`), [`${p}from`]: num(e.from, dec(e.from)), [`${p}to`]: num(e.to, dec(e.to)) });
  };
  vars.f2seg = seg(0, "tune2.f2seg");
  vars.f3seg = seg(1, "tune2.f3seg");
  return t(lang, item.reasonKey, vars);
}

export function Tune2Card({ lang, onBcfgApplied, pushToast }: Props) {
  const [data, setData] = useState<Tune2Response | null>(null);
  const [busy, setBusy] = useState<"refresh" | BookId | null>(null);
  const aliveRef = useRef(true);
  const toastRef = useRef(pushToast);
  const bcfgRef = useRef(onBcfgApplied);
  const langRef = useRef(lang);
  useEffect(() => {
    toastRef.current = pushToast;
    bcfgRef.current = onBcfgApplied;
    langRef.current = lang;
  }, [pushToast, onBcfgApplied, lang]);

  const load = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch("/api/tune2", { cache: "no-store" });
      const j = (await res.json()) as Tune2Response;
      if (aliveRef.current && res.ok && j.ok) setData(j);
    } catch {
      /* giữ cũ */
    }
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    void load();
    const id = window.setInterval(() => void load(), 60_000);
    return () => {
      aliveRef.current = false;
      window.clearInterval(id);
    };
  }, [load]);

  const post = useCallback(async (body: Record<string, unknown>, busyId: "refresh" | BookId): Promise<void> => {
    setBusy(busyId);
    try {
      const res = await fetch("/api/tune2", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = (await res.json()) as Tune2Response;
      if (res.ok && j.ok) {
        setData(j);
        if (busyId !== "refresh") {
          toastRef.current({ kind: "xgb", text: j.note ?? t(langRef.current, "tune2.title") });
          if (j.cfgPatch && Object.keys(j.cfgPatch).length > 0) bcfgRef.current?.(j.cfgPatch);
        }
      } else {
        toastRef.current({ kind: "error", text: j.error ?? t(langRef.current, "tune2.fail") });
      }
    } catch {
      toastRef.current({ kind: "error", text: t(langRef.current, "tune2.fail") });
    } finally {
      setBusy(null);
    }
  }, []);

  const itemsOf = (book: BookId): Tune2Item[] => data?.items.filter((i) => i.book === book) ?? [];
  const pendingOf = (book: BookId): number => itemsOf(book).filter((i) => i.status === "pending").length;

  const fmtVal = (item: Tune2Item): string => num(item.to, Number.isInteger(item.to) ? 0 : 2);

  return (
    <Card className="border-violet-800/60 bg-zinc-900/60">
      <CardHeader className="px-3 pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-1.5 text-base font-semibold text-zinc-100">
              <SlidersHorizontal className="h-4 w-4 text-violet-400" />
              {t(lang, "tune2.title")}
            </CardTitle>
            <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500">{t(lang, "tune2.sub")}</p>
          </div>
          <div className="flex items-center gap-2">
            {data && (
              <span className="font-mono text-[10px] text-zinc-600">
                {t(lang, "tune2.computedAt", {
                  t: new Date(data.computedAt).toLocaleTimeString(lang === "vi" ? "vi-VN" : "en-GB", { hour: "2-digit", minute: "2-digit" }),
                })}
              </span>
            )}
            <Button
              size="sm"
              variant="outline"
              disabled={busy != null}
              className="h-7 rounded-full border-zinc-700 bg-transparent px-3 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
              onClick={() => void post({ action: "refresh" }, "refresh")}
            >
              <Sparkles className="mr-1 h-3 w-3 text-violet-400" />
              {busy === "refresh" ? t(lang, "tune2.refreshing") : t(lang, "tune2.refresh")}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 px-3 pt-0">
        {!data && <p className="rounded-lg border border-dashed border-zinc-800 p-4 text-center text-xs text-zinc-500">…</p>}
        {data &&
          ([ "a", "b", "c" ] as BookId[]).map((book) => {
            const theme = BOOK_THEME[book];
            const stats = data.books[book];
            const items = itemsOf(book);
            const pending = pendingOf(book);
            return (
              <div key={book} className={`rounded-lg border ${theme.border} bg-zinc-950/40 px-3 py-2`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className={`text-xs font-bold ${theme.title}`}>{theme.name} · {t(lang, `strat.${book}.name`)}</span>
                  {stats && stats.n >= TUNE2_MIN_N ? (
                    <span className="font-mono text-[10px] text-zinc-500">
                      {t(lang, "tune2.stats", { n: stats.n, wr: num(stats.wr, 0), pay: num(stats.payoff), exp: num(stats.expectancy), net: num(stats.netRoe) })}
                    </span>
                  ) : (
                    <span className="font-mono text-[10px] text-zinc-600">{t(lang, "tune2.noData", { min: TUNE2_MIN_N, n: stats?.n ?? 0 })}</span>
                  )}
                </div>
                {stats && stats.n >= TUNE2_MIN_N && items.length === 0 && (
                  <p className="mt-1 text-[11px] text-zinc-500">{t(lang, "tune2.none")}</p>
                )}
                {items.length > 0 && (
                  <ul className="mt-1.5 space-y-1.5">
                    {items.map((item) => (
                      <li key={`${item.kind}:${item.param}`} className="rounded-md border border-zinc-800 bg-zinc-900/60 px-2.5 py-1.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className={`rounded border px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase ${theme.chip}`}>
                            {item.kind === "rr" ? t(lang, "tune2.kind.rr") : t(lang, "tune2.kind.floor")}
                          </span>
                          <span className="text-[11px] font-semibold text-zinc-200">{t(lang, `tune2.param.${item.param}`)}</span>
                          <span className="font-mono text-[11px] text-zinc-400">
                            {num(item.from, Number.isInteger(item.from) ? 0 : 2)} → <span className="font-bold text-teal-300">{fmtVal(item)}</span>
                          </span>
                          {item.extras.map((e) => (
                            <span key={e.param} className="font-mono text-[10px] text-zinc-500">
                              · {t(lang, `tune2.param.${e.param}`)} {num(e.from, Number.isInteger(e.from) ? 0 : 2)} → {num(e.to, Number.isInteger(e.to) ? 0 : 2)}
                            </span>
                          ))}
                          {item.status !== "pending" && (
                            <Badge variant="outline" className={`font-mono text-[9px] ${item.status === "applied" ? "border-emerald-700 text-emerald-400" : "border-zinc-700 text-zinc-500"}`}>
                              {item.status === "applied" ? t(lang, "tune2.applied") : t(lang, "tune2.dismissed")}
                            </Badge>
                          )}
                        </div>
                        <p className="mt-1 text-[11px] leading-snug text-zinc-400">{reasonOf(lang, item)}</p>
                        <p className="mt-0.5 font-mono text-[10px] text-zinc-600">
                          {t(lang, "tune2.cur", {
                            v: num(
                              item.kind === "rr" ? data.current[book].rr : data.current[book].floor,
                              Number.isInteger(data.current[book][item.kind === "rr" ? "rr" : "floor"]) ? 0 : 2,
                            ),
                          })}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
                {pending > 0 && (
                  <div className="mt-2 flex items-center gap-2">
                    <Button
                      size="sm"
                      disabled={busy != null}
                      className="h-7 bg-emerald-700 px-2.5 text-[11px] text-white hover:bg-emerald-600 disabled:opacity-40"
                      onClick={() => void post({ action: "apply", book }, book)}
                    >
                      {busy === book ? "…" : t(lang, "tune2.apply")}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy != null}
                      className="h-7 border-zinc-700 px-2.5 text-[11px] text-zinc-400 hover:bg-zinc-800 disabled:opacity-40"
                      onClick={() => void post({ action: "dismiss", book }, book)}
                    >
                      {t(lang, "tune2.dismiss")}
                    </Button>
                    <span className="font-mono text-[10px] text-zinc-600">{pending}× {t(lang, "tune2.pending")}</span>
                  </div>
                )}
              </div>
            );
          })}
      </CardContent>
    </Card>
  );
}
