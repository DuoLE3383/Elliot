"use client";

// ─── UniverseCard (0.2.97) — universe 8h nằm ở WATCHLIST (dashboard) ─────────
// "universe không phải nằm trong auto mà nằm ở watch list mới đúng": bảng xếp
// hạng ATR + trending (scan 8h của engine) dời từ AutoPanel sang đây — người
// dùng duyệt pair được đề xuất rồi tự BỎ VÀO watchlist (không còn tự nhồi
// top-30 vào watchlist như 0.2.9x cũ).
// Nguồn: GET /api/engine → snapshot.universe (rows vẫn tính server-side 8h);
// poll 5 phút là đủ — bảng chỉ đổi mỗi 8h.

import { useCallback, useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { t, type Lang } from "@/lib/i18n";
import type { UniverseRow } from "@/lib/universe";
import { Plus, ScanLine } from "lucide-react";

interface Props {
  lang: Lang;
  /** các pair đã có trong watchlist (defaults + custom) — nút thêm ẩn đi */
  existing: string[];
  /** thêm pair vào watchlist (page tự validate + set symbol) */
  onAddSymbol: (sym: string) => void;
}

interface EngineLite {
  universe?: { rows: UniverseRow[]; at: number } | null;
}

const trendCls = (t: number): string => (t > 0.15 ? "text-emerald-400" : t < -0.15 ? "text-rose-400" : "text-zinc-500");

export function UniverseCard({ lang, existing, onAddSymbol }: Props) {
  const [rows, setRows] = useState<UniverseRow[]>([]);
  const [at, setAt] = useState<number | null>(null);
  const aliveRef = useRef(true);

  const load = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch("/api/engine", { cache: "no-store" });
      if (!res.ok) return;
      const j = (await res.json()) as EngineLite;
      if (!aliveRef.current) return;
      setRows(j.universe?.rows ?? []);
      setAt(j.universe?.at ?? null);
    } catch {
      /* giữ cũ */
    }
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    // bọc load trong hàm nội bộ của effect (giống auto-panel) — gọi lần đầu
    // ngay khi mount, rồi lặp 5 phút
    const poll = async (): Promise<void> => {
      await load();
    };
    void poll();
    const id = window.setInterval(() => void poll(), 5 * 60_000);
    return () => {
      aliveRef.current = false;
      window.clearInterval(id);
    };
  }, [load]);

  return (
    <Card className="min-w-0 border-zinc-800 bg-zinc-900/60">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-1.5 text-base font-semibold text-zinc-100">
            <ScanLine className="h-4 w-4 text-sky-400" />
            {t(lang, "uni.title")}
          </CardTitle>
          <span className="font-mono text-[10px] text-zinc-600">
            {at ? `8h · ${new Date(at).toLocaleString(lang === "vi" ? "vi-VN" : "en-GB", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })}` : "8h"}
          </span>
        </div>
        <p className="text-[11px] leading-relaxed text-zinc-500">{t(lang, "uni.sub")}</p>
      </CardHeader>
      <CardContent className="px-3 pt-0">
        {rows.length === 0 ? (
          <p className="rounded-lg border border-transparent border-zinc-800 p-4 text-center text-xs text-zinc-500">{t(lang, "uni.empty")}</p>
        ) : (
          <div className="max-h-64 space-y-0.5 overflow-y-auto pr-0.5">
            {rows.slice(0, 15).map((r, i) => {
              const inList = existing.includes(r.symbol);
              return (
                <div key={r.symbol} className="group flex min-w-0 items-center gap-2 rounded-lg px-1.5 py-1 transition hover:bg-zinc-800/40">
                  <button
                    type="button"
                    onClick={() => onAddSymbol(r.symbol)}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    title={t(lang, "uni.pick")}
                  >
                    <span className="w-5 shrink-0 font-mono text-[10px] text-zinc-600">{i + 1}.</span>
                    <span className="w-14 shrink-0 whitespace-normal leading-snug text-xs font-bold text-zinc-300">{r.symbol.replace("USDT", "")}</span>
                    <span className="font-mono text-[10px] text-zinc-500">ATR {r.atrPct.toFixed(2)}%</span>
                    <span className={`font-mono text-[10px] ${trendCls(r.trend)}`}>
                      {r.trend >= 0 ? "+" : ""}
                      {(r.trend * 100).toFixed(0)}%
                    </span>
                    <span className="ml-auto font-mono text-[10px] text-zinc-500">
                      24h {(r.ret24h * 100).toFixed(1)}% · 10d {(r.ret10d * 100).toFixed(1)}%
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label={t(lang, "uni.add")}
                    title={inList ? t(lang, "uni.inList") : t(lang, "uni.add")}
                    disabled={inList}
                    onClick={() => onAddSymbol(r.symbol)}
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${inList ? "text-zinc-700" : "text-zinc-500 hover:bg-zinc-800 hover:text-sky-400"}`}
                  >
                    <Plus className="h-3 w-3" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
