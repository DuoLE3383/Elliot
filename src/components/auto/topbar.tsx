"use client";

// ─── AutoTopbar (v0.3.12) — header trên của /auto redesign ────────────────────
// Theo mockup: pill "Binance API ✓ Connected" (click mở/đóng thẻ cấu hình
// BinanceApiCard ngay dưới), nhóm Mode LIVE / DRY-RUN, pill Session Asia,
// nút START ALL (gradient xanh) / STOP ALL (gradient đỏ), chuông thông báo.
// Trạng thái Binance + LIVE lấy từ /api/binance-keys + /api/engine (poll 15s).

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Bell, ChevronDown, Globe, Play, ShieldCheck, Square } from "lucide-react";
import { Button } from "@/components/ui/button";

interface BinanceStatus {
  configured: boolean;
  source: "store" | "env" | null;
  apiKeyMasked: string | null;
}

interface Props {
  lang: "vi" | "en";
  /** engine live flag (LIVE thật) */
  liveOn: boolean;
  /** sổ B dry-run đang chạy? (DRY-RUN pill sáng khi cfg.on) */
  dryOn: boolean;
  /** breadth Wyckoff — hiển thị cạnh session khi có */
  breadth: number | null;
  /** số cảnh báo đang có (vd lệnh đang mở) — badge chuông, 0 = ẩn */
  notifCount?: number;
  /** đổi ngôn ngữ EN ↔ VI */
  onToggleLang: () => void;
  onStartAll: () => void;
  onStopAll: () => void;
  /** mở/đóng thẻ cấu hình Binance API bên dưới */
  onToggleApiCard: () => void;
  apiCardOpen: boolean;
}

export function AutoTopbar({ lang, liveOn, dryOn, breadth, notifCount = 0, onToggleLang, onStartAll, onStopAll, onToggleApiCard, apiCardOpen }: Props) {
  const [binance, setBinance] = useState<BinanceStatus | null>(null);
  const [busy, setBusy] = useState<"start" | "stop" | null>(null);
  const busyRef = useRef(false);

  const loadBinance = useCallback(async () => {
    try {
      const res = await fetch("/api/binance-keys", { cache: "no-store" });
      if (res.ok) setBinance((await res.json()) as BinanceStatus);
    } catch {
      /* giữ cũ */
    }
  }, []);

  useEffect(() => {
    void loadBinance();
    const id = window.setInterval(() => void loadBinance(), 30_000);
    return () => window.clearInterval(id);
  }, [loadBinance]);

  const run = (kind: "start" | "stop") => () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(kind);
    try {
      if (kind === "start") onStartAll();
      else onStopAll();
    } finally {
      window.setTimeout(() => {
        busyRef.current = false;
        setBusy(null);
      }, 900);
    }
  };

  const connected = binance?.configured === true;

  return (
    <header className="sticky top-0 z-30 border-b border-[#1e2d4d]/70 bg-[#060a14]/90 backdrop-blur">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2.5 sm:px-5">
        {/* mobile: back + tên gọn */}
        <Button
          size="sm"
          variant="outline"
          className="h-8 gap-1.5 border-[#24365c] bg-transparent px-2 text-xs text-zinc-300 hover:bg-[#0d1526] lg:hidden"
          asChild
        >
          <Link href="/">
            <ArrowLeft className="h-3.5 w-3.5" />
          </Link>
        </Button>
        <div className="mr-1 hidden min-w-0 lg:block">
          <h1 className="text-[15px] font-bold leading-tight text-white">Auto Trading Console</h1>
          <p className="text-[10px] leading-tight text-zinc-500">{lang === "vi" ? "Bốn chiến lược — một engine" : "Four strategies — one engine"}</p>
        </div>

        {/* pill Binance API — mở thẻ cấu hình */}
        <button
          type="button"
          onClick={onToggleApiCard}
          aria-expanded={apiCardOpen}
          title={binance?.apiKeyMasked ?? (lang === "vi" ? "Cấu hình Binance API" : "Configure Binance API")}
          className={`flex items-center gap-2 rounded-xl border px-2.5 py-1.5 text-left transition-colors ${
            connected
              ? "border-emerald-800/60 bg-emerald-950/30 hover:bg-emerald-950/50"
              : "border-zinc-700/60 bg-zinc-900/60 hover:bg-zinc-800/60"
          }`}
        >
          {/* logo Binance diamond */}
          <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" aria-hidden>
            <path d="M12 2 L18.5 8.5 L15.5 11.5 L12 8 L8.5 11.5 L5.5 8.5 Z" fill="#f0b90b" />
            <path d="M7.5 12.5 L10.5 15.5 L7.5 18.5 L4.5 15.5 Z" fill="#f0b90b" />
            <path d="M16.5 12.5 L19.5 15.5 L16.5 18.5 L13.5 15.5 Z" fill="#f0b90b" />
            <path d="M9.8 16.5 L12 14.3 L14.2 16.5 L12 18.7 Z" fill="#f0b90b" />
          </svg>
          <span className="leading-tight">
            <span className="block text-[11px] font-bold text-zinc-100">Binance API</span>
            <span className={`block text-[10px] font-medium ${connected ? "text-emerald-400" : "text-zinc-500"}`}>
              {connected ? "✓ Connected" : lang === "vi" ? "Chưa cấu hình" : "Not configured"}
            </span>
          </span>
        </button>

        <span className="hidden h-7 w-px bg-[#1e2d4d] sm:block" aria-hidden />

        {/* Mode: LIVE / DRY-RUN — nhóm card có viền như mockup */}
        <div className="flex items-center gap-1.5 rounded-xl border border-[#24365c] bg-[#0b1424] px-2 py-1.5">
          <span className="hidden text-[10px] font-semibold uppercase tracking-wide text-zinc-500 sm:block">Mode</span>
          <span
            className={`rounded-lg border px-2.5 py-1 font-mono text-[11px] font-bold ${
              liveOn ? "border-emerald-600 bg-emerald-950/60 text-emerald-300 shadow-[0_0_10px_rgba(34,197,94,0.25)]" : "border-zinc-800 bg-zinc-950/60 text-zinc-600"
            }`}
          >
            {liveOn && <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400 align-middle" aria-hidden />}
            LIVE
          </span>
          <span
            className={`rounded-lg border px-2.5 py-1 font-mono text-[11px] font-bold ${
              !liveOn && dryOn ? "border-teal-700 bg-teal-950/50 text-teal-300" : "border-zinc-800 bg-zinc-950/60 text-zinc-600"
            }`}
            title="Dry-run"
          >
            DRY-RUN
          </span>
        </div>

        {/* Session */}
        <span className="hidden items-center gap-1.5 rounded-lg border border-[#24365c] bg-[#0b1424] px-2.5 py-1.5 text-[11px] font-medium text-zinc-300 md:flex">
          <Globe className="h-3.5 w-3.5 text-sky-400" aria-hidden />
          Asia
          <ChevronDown className="h-3 w-3 text-zinc-500" aria-hidden />
        </span>
        {breadth != null && (
          <span className="hidden rounded-lg border border-violet-900/60 bg-violet-950/30 px-2 py-1 font-mono text-[10px] text-violet-300 xl:block" title="Wyckoff breadth">
            breadth {breadth.toFixed(2)}%
          </span>
        )}

        <div className="flex-1" />

        {/* START ALL / STOP ALL */}
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={run("start")}
            disabled={busy != null}
            className="h-9 gap-1.5 rounded-xl border border-emerald-400/40 bg-gradient-to-b from-emerald-500 to-emerald-700 px-4 text-[12px] font-bold text-white shadow-[0_0_16px_rgba(16,185,129,0.35)] hover:from-emerald-400 hover:to-emerald-600 disabled:opacity-60"
          >
            <Play className="h-3.5 w-3.5 fill-current" />
            START ALL
          </Button>
          <Button
            size="sm"
            onClick={run("stop")}
            disabled={busy != null}
            className="h-9 gap-1.5 rounded-xl border border-rose-400/40 bg-gradient-to-b from-rose-500 to-rose-700 px-4 text-[12px] font-bold text-white shadow-[0_0_16px_rgba(244,63,94,0.3)] hover:from-rose-400 hover:to-rose-600 disabled:opacity-60"
          >
            <Square className="h-3 w-3 fill-current" />
            STOP ALL
          </Button>
        </div>

        {/* chuông — trạng thái telegram/engine */}
        <span
          className="relative hidden h-9 w-9 items-center justify-center rounded-xl border border-[#24365c] bg-[#0b1424] text-zinc-400 sm:flex"
          title={lang === "vi" ? "Thông báo qua Telegram — cấu hình trong tab More" : "Telegram notifications — configure in More tab"}
          aria-hidden
        >
          <Bell className="h-4 w-4" />
          {notifCount > 0 && (
            <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-600 px-1 font-mono text-[9px] font-bold text-white">
              {notifCount > 9 ? "9+" : notifCount}
            </span>
          )}
        </span>

        {/* đổi ngôn ngữ EN ↔ VI */}
        <button
          type="button"
          onClick={onToggleLang}
          className="h-9 rounded-xl border border-[#24365c] bg-[#0b1424] px-2.5 font-mono text-[11px] font-bold text-zinc-300 hover:bg-[#132038]"
          aria-label={lang === "vi" ? "Switch to English" : "Chuyển sang tiếng Việt"}
        >
          {lang === "vi" ? "EN" : "VI"}
        </button>
      </div>
    </header>
  );
}
