"use client";

// ─── OpenPositionStrip — lệnh auto dry-run đang mở, luôn hiện ở ĐẦU trang ────
// "phần đầu của trang chủ thêm lệnh đang mở": poll NHẸ /api/autotrade?part=open
// mỗi 5s (chỉ 1 hàng DB, không kéo 200 lệnh lịch sử như /api/autotrade đầy
// đủ). ROE tạm tính tại chỗ từ giá 24h ticker mà trang đã có sẵn (prop
// tickers) — không thêm request giá nào. Bấm vào dải = chọn đúng cặp + khung
// của lệnh trên đồ thị. Không có lệnh mở → component tự ẩn (không chiếm chỗ).

import { useEffect, useState } from "react";
import { fmtPrice, t, type Lang } from "@/lib/i18n";
import type { AutoTradeRow } from "@/lib/autotrade";
import type { Ticker } from "@/lib/types";

/** ROE tạm thời % — cùng công thức roeOf của engine (lệch đòn bẩy đã nhân). */
function roeOf(side: string, entry: number, price: number, leverage: number): number {
  if (!entry || !price) return 0;
  const move = side === "SHORT" ? ((entry - price) / entry) * 100 : ((price - entry) / entry) * 100;
  return Math.round(move * leverage * 100) / 100;
}
const slPriceOf = (side: string, entry: number, pct: number): number =>
  side === "SHORT" ? entry * (1 + pct / 100) : entry * (1 - pct / 100);
const tpPriceOf = (side: string, entry: number, pct: number): number =>
  side === "SHORT" ? entry * (1 - pct / 100) : entry * (1 + pct / 100);

export function OpenPositionStrip({
  lang,
  tickers,
  onPickPair,
}: {
  lang: Lang;
  tickers: Record<string, Ticker>;
  onPickPair: (sym: string, itv: string) => void;
}) {
  const [open, setOpen] = useState<AutoTradeRow | null>(null);

  // poll 5s — request chỉ nặng đúng 1 hàng DB; tab ẩn thì ngừng để đỡ pin
  useEffect(() => {
    let alive = true;
    let timer = 0;
    const load = async () => {
      if (typeof document !== "undefined" && document.hidden) return;
      try {
        const res = await fetch("/api/autotrade?part=open", { cache: "no-store" });
        if (!res.ok) return;
        const j = (await res.json()) as { open: AutoTradeRow | null };
        if (alive) setOpen(j.open ?? null);
      } catch {
        // mạng chớp — giữ trạng thái cũ, lần poll sau chụp lại
      }
    };
    void load();
    timer = window.setInterval(() => void load(), 5_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  if (!open) return null;

  const live = tickers[open.symbol]?.price ?? open.entryPrice;
  const roe = roeOf(open.side, open.entryPrice, live, open.leverage);
  const sl = slPriceOf(open.side, open.entryPrice, open.slPct);
  const tp = tpPriceOf(open.side, open.entryPrice, open.tpPct);
  // vị trí giá live giữa SL (0%) và TP (100%) — vạch tiến độ rủi ro
  const span = Math.abs(tp - sl) || 1;
  const raw = open.side === "SHORT" ? (sl - live) / span : (live - sl) / span;
  const posPct = Math.min(100, Math.max(0, raw * 100));
  const stake = ((open.capitalBefore ?? 0) * (open.stakePct ?? 100)) / 100;
  const sideCls = open.side === "LONG" ? "text-emerald-400" : "text-rose-400";

  return (
    <div className="shrink-0 px-3 pt-2">
      <button
        type="button"
        onClick={() => onPickPair(open.symbol, open.interval)}
        title={t(lang, "open.strip.tip")}
        className="group flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-emerald-900/60 bg-emerald-950/20 px-3 py-1.5 text-left transition hover:border-emerald-700 hover:bg-emerald-950/40"
      >
        {/* nhãn + chớp sống */}
        <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-300/90">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
          </span>
          {t(lang, "auto.pos.open")}
        </span>

        <span className={`font-mono text-xs font-bold ${sideCls}`}>{open.side}</span>
        <span className="font-mono text-xs font-semibold text-zinc-100 group-hover:underline">
          {open.symbol.replace("USDT", "")} · {open.interval}
        </span>

        <span className="font-mono text-[11px] text-zinc-400">
          {t(lang, "auto.pos.entry")} <span className="text-zinc-200">{fmtPrice(open.entryPrice)}</span>
        </span>

        {/* ROE tạm thời — điểm chính của dải */}
        <span className="font-mono text-xs font-bold">
          <span className="text-zinc-500">{t(lang, "auto.pos.uroe")} </span>
          <span className={roe >= 0 ? "text-emerald-400" : "text-rose-400"}>
            {roe >= 0 ? "+" : ""}
            {roe.toFixed(2)}%
          </span>
        </span>

        {/* vạch tiến độ SL → TP + giá hai đầu (ẩn trên màn hình hẹp) */}
        <span className="ml-auto hidden min-w-[150px] flex-col gap-0.5 sm:flex">
          <span className="relative h-1 rounded-full bg-zinc-800">
            <span
              className="absolute top-[-2px] h-[8px] w-[2px] rounded-full bg-zinc-100"
              style={{ left: `calc(${posPct.toFixed(2)}% - 1px)` }}
            />
          </span>
          <span className="flex justify-between font-mono text-[9px] leading-none text-zinc-500">
            <span>SL {fmtPrice(sl)}</span>
            <span>TP {fmtPrice(tp)}</span>
          </span>
        </span>

        <span className="font-mono text-[10px] text-zinc-500">
          {t(lang, "auto.pos.stake")} {stake > 0 ? `${stake.toFixed(2)} USDT · ${open.stakePct ?? 100}%` : `${open.stakePct ?? 100}%`}
          {" · "}
          ×{open.leverage}
        </span>
      </button>
    </div>
  );
}
