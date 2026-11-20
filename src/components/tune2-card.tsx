"use client";

// ─── Tune2Card (v0.3.12 redesign) — Level-2 Upgrade trên /auto ────────────────
// Theo mockup: header tím + nút Recompute; thân 3 khối ngang:
//   1) card trạng thái dữ liệu (Đủ dữ liệu: N trades · Cập nhật)
//   2) bảng Strategy | Current RR | Quality Floor | Recommendation (A/B/C/D)
//   3) card Key Insight (RR hợp lý · Quality Floor · Ưu tiên)
// LOGIC GIỮ NGUYÊN 0.3.0: GET /api/tune2 (db/tune2-proposal.json), POST
// refresh/apply/dismiss; apply sổ B → cfgPatch lên trang. D không có trong
// engine tune2 → hiện hàng "—" và pill "Chờ dữ liệu" (trung thực, không bịa).
// Recommendation: sổ có đề xuất pending → "Nâng nhẹ"; hết/không có → "Giữ".

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { t, type Lang } from "@/lib/i18n";
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

const num = (v: number | undefined, d = 2): string => (v == null || !Number.isFinite(v) ? "—" : String(Math.round(v * 10 ** d) / 10 ** d));

const BOOK_META: Record<string, { letter: string; nameKey: string; badge: string }> = {
  a: { letter: "A", nameKey: "strat.a.name", badge: "border-amber-600/60 bg-amber-950/50 text-amber-300" },
  b: { letter: "B", nameKey: "strat.b.name", badge: "border-cyan-600/60 bg-cyan-950/50 text-cyan-300" },
  c: { letter: "C", nameKey: "strat.c.name", badge: "border-violet-600/60 bg-violet-950/50 text-violet-300" },
  d: { letter: "D", nameKey: "strat.d.name", badge: "border-teal-600/60 bg-teal-950/50 text-teal-300" },
};

export function Tune2Card({ lang, onBcfgApplied, pushToast }: Props) {
  const [data, setData] = useState<Tune2Response | null>(null);
  const [busy, setBusy] = useState<"refresh" | BookId | null>(null);
  const aliveRef = useRef(true);
  const toastRef = useRef(pushToast);
  const bcfgRef = useRef(onBcfgApplied);
  useEffect(() => {
    toastRef.current = pushToast;
    bcfgRef.current = onBcfgApplied;
  }, [pushToast, onBcfgApplied]);

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
          toastRef.current({ kind: "xgb", text: j.note ?? t(lang, "tune2.title") });
          if (j.cfgPatch && Object.keys(j.cfgPatch).length > 0) bcfgRef.current?.(j.cfgPatch);
        }
      } else {
        toastRef.current({ kind: "error", text: j.error ?? t(lang, "tune2.fail") });
      }
    } catch {
      toastRef.current({ kind: "error", text: t(lang, "tune2.fail") });
    } finally {
      setBusy(null);
    }
  }, [lang]);

  const itemsOf = (book: BookId): Tune2Item[] => data?.items.filter((i) => i.book === book) ?? [];
  const pendingOf = (book: BookId): number => itemsOf(book).filter((i) => i.status === "pending").length;

  // tổng trades đã đóng của các sổ có dữ liệu tune2 (a/b/c)
  const totalTrades = data ? (["a", "b", "c"] as BookId[]).reduce((s, b) => s + (data.books[b]?.n ?? 0), 0) : 0;
  const enoughData = totalTrades >= TUNE2_MIN_N;

  // dải RR / floor hiện hành (bỏ sổ chưa có số)
  const curVals = data ? (["a", "b", "c"] as BookId[]).map((b) => data.current[b]) : [];
  const rrs = curVals.map((c) => c.rr).filter((v) => Number.isFinite(v) && v > 0);
  const floors = curVals.map((c) => c.floor).filter((v) => Number.isFinite(v) && v > 0);
  const rrRange = rrs.length ? `${num(Math.min(...rrs))} – ${num(Math.max(...rrs))}` : "—";
  const floorRange = floors.length ? `${num(Math.min(...floors))} – ${num(Math.max(...floors))}` : "—";

  // sổ ưu tiên = sổ có đề xuất pending (engine đang gợi ý chỉnh) — thật, không bịa
  const priorityBooks = data ? (["a", "b", "c"] as BookId[]).filter((b) => pendingOf(b) > 0) : [];

  const updatedAt = data
    ? new Date(data.computedAt).toLocaleString(lang === "vi" ? "vi-VN" : "en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      })
    : null;

  return (
    <section className="rounded-2xl border border-violet-900/50 bg-gradient-to-b from-[#120f22]/80 to-[#0a0f1e]/90 p-4">
      {/* header */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-violet-700/50 bg-violet-950/40">
            <SlidersHorizontal className="h-4 w-4 text-violet-400" />
          </span>
          <div>
            <h2 className="text-[15px] font-bold leading-tight text-white">{t(lang, "tune2.title")}</h2>
            <p className="text-[11px] leading-tight text-zinc-500">{t(lang, "tune2.sub")}</p>
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          <span className="hidden text-right sm:block">
            <span className="block text-[9px] uppercase tracking-wide text-zinc-500">Last Update</span>
            <span className="block font-mono text-[11px] font-bold text-zinc-300">{updatedAt ?? "—"}</span>
          </span>
          <Button
            size="sm"
            disabled={busy != null}
            onClick={() => void post({ action: "refresh" }, "refresh")}
            className="h-8 gap-1.5 rounded-lg border border-violet-400/40 bg-gradient-to-b from-violet-500 to-violet-700 px-3.5 text-[11px] font-bold text-white shadow-[0_0_12px_rgba(168,85,247,0.3)] hover:from-violet-400 hover:to-violet-600 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${busy === "refresh" ? "animate-spin" : ""}`} />
            {busy === "refresh" ? t(lang, "tune2.refreshing") : "Recompute"}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[220px_minmax(0,1fr)_240px]">
        {/* 1) card trạng thái dữ liệu */}
        <div className="flex flex-col justify-center rounded-xl border border-violet-800/50 bg-gradient-to-b from-violet-950/50 to-[#0d1526] p-3.5">
          <span className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-xl border border-violet-600/40 bg-[#0b1424] shadow-[0_0_14px_rgba(139,92,246,0.25)]">
            {/* brain icon */}
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>
              <path d="M9.5 3.5 A3 3 0 0 0 6.6 7.2 A3.2 3.2 0 0 0 5 10.2 A3 3 0 0 0 6.4 13 A3 3 0 0 0 8.5 17 A2.8 2.8 0 0 0 12 19.2 V4.8 A2.4 2.4 0 0 0 9.5 3.5 Z" fill="none" stroke="#a78bfa" strokeWidth="1.5" />
              <path d="M14.5 3.5 A3 3 0 0 1 17.4 7.2 A3.2 3.2 0 0 1 19 10.2 A3 3 0 0 1 17.6 13 A3 3 0 0 1 15.5 17 A2.8 2.8 0 0 1 12 19.2 V4.8 A2.4 2.4 0 0 1 14.5 3.5 Z" fill="none" stroke="#818cf8" strokeWidth="1.5" />
            </svg>
          </span>
          <p className="text-center text-[11px] leading-snug text-zinc-400">
            {enoughData ? t(lang, "tune2.enough") : t(lang, "tune2.noData", { min: TUNE2_MIN_N, n: totalTrades })}
            {enoughData && <span className="font-bold text-cyan-300"> {totalTrades.toLocaleString("en-US")} trades</span>}
          </p>
          {enoughData && <span className="mt-0.5 text-center text-[10px] text-emerald-400">✓</span>}
          {updatedAt && <p className="mt-1 text-center font-mono text-[9px] text-zinc-600">Cập nhật: {updatedAt}</p>}
        </div>

        {/* 2) bảng Strategy | Current RR | Quality Floor | Recommendation */}
        <div className="overflow-hidden rounded-xl border border-[#1e2d4d]/80 bg-[#0b1222]/80">
          <div className="grid grid-cols-[minmax(0,1.4fr)_0.8fr_1fr_1.3fr] gap-x-2 border-b border-[#1e2d4d]/70 bg-[#0d1526] px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-zinc-500">
            <span>→ {lang === "vi" ? "Chiến lược" : "Strategy"}</span>
            <span className="text-right">Current RR</span>
            <span className="text-right">Quality Floor</span>
            <span className="text-center">{lang === "vi" ? "Khuyến nghị" : "Recommendation"}</span>
          </div>
          {(["a", "b", "c", "d"] as const).map((book) => {
            const meta = BOOK_META[book];
            const isReal = book !== "d";
            const cur = isReal ? data?.current[book] : undefined;
            const stats = isReal ? data?.books[book] : null;
            const pending = isReal ? pendingOf(book) : 0;
            const rec: "keep" | "up" | "wait" = !isReal || !stats || (stats.n ?? 0) < TUNE2_MIN_N ? "wait" : pending > 0 ? "up" : "keep";
            return (
              <div key={book} className="grid grid-cols-[minmax(0,1.4fr)_0.8fr_1fr_1.3fr] items-center gap-x-2 border-b border-[#16233f]/60 px-3 py-2.5 last:border-b-0">
                <span className="flex min-w-0 items-center gap-2">
                  <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border font-mono text-[11px] font-black ${meta.badge}`}>{meta.letter}</span>
                  <span className="whitespace-normal leading-snug text-[12px] font-semibold text-zinc-100">{t(lang, meta.nameKey)}</span>
                </span>
                <span className="text-right font-mono text-[13px] font-bold text-white">{isReal ? num(cur?.rr) : "—"}</span>
                <span className="text-right font-mono text-[13px] font-bold text-white">{isReal ? num(cur?.floor) : "—"}</span>
                <span className="flex items-center justify-center gap-1.5">
                  {rec === "keep" && (
                    <span className="rounded-full border border-emerald-500/50 bg-emerald-500/15 px-2.5 py-0.5 text-[10px] font-bold text-emerald-300">
                      {lang === "vi" ? "Giữ" : "Keep"}
                    </span>
                  )}
                  {rec === "up" && (
                    <span className="rounded-full border border-cyan-500/50 bg-cyan-500/15 px-2.5 py-0.5 text-[10px] font-bold text-cyan-300">
                      {lang === "vi" ? "Nâng nhẹ" : "Slightly Up"}
                    </span>
                  )}
                  {rec === "wait" && (
                    <span className="rounded-full border border-zinc-700 bg-zinc-900/60 px-2.5 py-0.5 text-[10px] font-bold text-zinc-500">
                      {lang === "vi" ? "Chờ dữ liệu" : "Waiting data"}
                    </span>
                  )}
                  {/* nút apply/dismiss gọn khi có đề xuất pending */}
                  {pending > 0 && isReal && (
                    <>
                      <button
                        type="button"
                        disabled={busy != null}
                        onClick={() => void post({ action: "apply", book }, book)}
                        className="rounded-md border border-emerald-700/60 bg-emerald-950/40 px-1.5 py-0.5 text-[9px] font-bold text-emerald-300 hover:bg-emerald-950/70 disabled:opacity-40"
                        title={t(lang, "tune2.apply")}
                      >
                        {busy === book ? "…" : "✓"}
                      </button>
                      <button
                        type="button"
                        disabled={busy != null}
                        onClick={() => void post({ action: "dismiss", book }, book)}
                        className="rounded-md border border-zinc-700 px-1.5 py-0.5 text-[9px] font-bold text-zinc-400 hover:bg-zinc-800 disabled:opacity-40"
                        title={t(lang, "tune2.dismiss")}
                      >
                        ✕
                      </button>
                    </>
                  )}
                </span>
              </div>
            );
          })}
        </div>

        {/* 3) Key Insight */}
        <div className="flex flex-col justify-center rounded-xl border border-amber-800/40 bg-gradient-to-b from-[#171207]/70 to-[#0d1526] p-3.5">
          <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold text-zinc-200">
            {/* lightbulb */}
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden>
              <path d="M9 18h6 M10 21h4 M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1.1 2.1h4.8c.1-.9.5-1.6 1.1-2.1A6 6 0 0 0 12 3Z" fill="none" stroke="#fbbf24" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Key Insight
          </p>
          <ul className="space-y-1 text-[11px] leading-snug text-zinc-400">
            <li className="flex items-start gap-1.5">
              <span className="text-emerald-400">✓</span>
              RR {lang === "vi" ? "hợp lý" : "range"}: <span className="font-mono font-bold text-zinc-200">{rrRange}</span>
            </li>
            <li className="flex items-start gap-1.5">
              <span className="text-emerald-400">✓</span>
              Quality Floor: <span className="font-mono font-bold text-zinc-200">{floorRange}</span>
            </li>
            <li className="flex items-start gap-1.5">
              <span className="text-emerald-400">✓</span>
              {lang === "vi" ? "Ưu tiên" : "Priority"}:{" "}
              {priorityBooks.length > 0 ? (
                <span className="font-bold text-cyan-300">{priorityBooks.map((b) => BOOK_META[b].letter).join(", ")}</span>
              ) : (
                <span className="text-zinc-500">—</span>
              )}
            </li>
          </ul>
          {data && priorityBooks.length > 0 && (
            <p className="mt-2 border-t border-zinc-800/60 pt-1.5 text-[10px] leading-snug text-zinc-600">
              {priorityBooks.map((b) => `${BOOK_META[b].letter}: ${pendingOf(b)}× ${t(lang, "tune2.pending")}`).join(" · ")}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
