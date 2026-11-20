"use client";

// ─── AutoSidebar (v0.3.12) — thanh trái của trang /auto redesign ──────────────
// Theo mockup "Elliott AI Trading Engine": logo tam giác cyan, tên engine +
// version (đúng số package.json — không bịa), nav tới các trang THẬT của app
// (/auto active, / dashboard, /stats analytics, /arena, /ai), badge
// QUANTITATIVE STRATEGY, chân thanh: System Online + đồng hồ UTC+7 tick 1s.
// Ẩn dưới lg (chỉ desktop) — mobile dùng header thu gọn của Topbar.

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, Bot, LineChart, Swords, BrainCircuit } from "lucide-react";

/** version hiển thị — giữ đồng bộ package.json (prepush tự bump). */
export const APP_VERSION = "v0.3.13";

const NAV = [
  { href: "/auto", key: "Auto Trading", icon: Bot, accent: "text-sky-400" },
  { href: "/", key: "Dashboard", icon: Activity, accent: "text-zinc-400" },
  { href: "/stats", key: "Analytics", icon: LineChart, accent: "text-zinc-400" },
  { href: "/arena", key: "Arena", icon: Swords, accent: "text-zinc-400" },
  { href: "/ai", key: "AI Lab", icon: BrainCircuit, accent: "text-zinc-400" },
] as const;

/** Logo tam giác xếp lớp kiểu mockup — thuần SVG, không ảnh. */
function LogoMark() {
  return (
    <svg viewBox="0 0 48 48" className="h-11 w-11" aria-hidden>
      <defs>
        <linearGradient id="lg-tri" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#22d3ee" />
          <stop offset="100%" stopColor="#0ea5e9" />
        </linearGradient>
      </defs>
      <path d="M24 5 L44 40 L4 40 Z" fill="none" stroke="url(#lg-tri)" strokeWidth="2.6" strokeLinejoin="round" />
      <path d="M24 16 L36.5 37 L11.5 37 Z" fill="none" stroke="#22d3ee" strokeOpacity="0.55" strokeWidth="2" strokeLinejoin="round" />
      <path d="M24 26 L31 38 L17 38 Z" fill="url(#lg-tri)" fillOpacity="0.9" />
    </svg>
  );
}

export function AutoSidebar() {
  const pathname = usePathname();
  const [now, setNow] = useState<string>("");

  // đồng hồ UTC+7 — tick mỗi giây, chỉ chạy client-side
  useEffect(() => {
    const tick = () => {
      const d = new Date();
      const utc7 = new Date(d.getTime() + (7 * 60 + d.getTimezoneOffset()) * 60000);
      setNow(
        utc7.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) + " (UTC+7)",
      );
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <aside className="sticky top-0 hidden h-screen w-[218px] shrink-0 flex-col border-r border-[#1e2d4d]/70 bg-[#080d1a]/95 lg:flex">
      {/* logo + tên engine */}
      <div className="flex items-center gap-3 px-4 pb-4 pt-5">
        <div className="rounded-xl border border-cyan-800/40 bg-[#0b1424] p-1.5 shadow-[0_0_18px_rgba(34,211,238,0.18)]">
          <LogoMark />
        </div>
        <div className="min-w-0">
          <p className="whitespace-normal leading-snug text-[15px] font-bold leading-tight text-white">Elliott</p>
          <p className="whitespace-normal leading-snug text-[10px] leading-tight text-zinc-500">AI Trading Engine</p>
          <p className="font-mono text-[10px] leading-tight text-cyan-500/80">{APP_VERSION}</p>
        </div>
      </div>

      {/* nav — link tới trang thật của app */}
      <nav className="flex flex-col gap-1 px-3" aria-label="Main">
        {NAV.map((item) => {
          const active = pathname === item.href;
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`group relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors ${
                active
                  ? "bg-gradient-to-r from-sky-950/80 to-transparent text-white"
                  : "text-zinc-400 hover:bg-[#0d1526] hover:text-zinc-200"
              }`}
            >
              {active && <span className="absolute left-0 top-1.5 h-[calc(100%-12px)] w-[3px] rounded-full bg-gradient-to-b from-sky-400 to-cyan-500" aria-hidden />}
              <Icon className={`h-4 w-4 shrink-0 ${active ? "text-sky-400" : item.accent}`} />
              {item.key}
            </Link>
          );
        })}
      </nav>

      {/* badge QUANTITATIVE STRATEGY */}
      <div className="mx-3 mt-6 overflow-hidden rounded-xl border border-amber-700/40 bg-gradient-to-b from-[#161207] to-[#0b0d16] p-3 shadow-[0_0_16px_rgba(234,179,8,0.08)]">
        <div className="flex items-center gap-2">
          {/* vương miện */}
          <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" aria-hidden>
            <path d="M3 8 L7 12 L12 5 L17 12 L21 8 L19 18 H5 Z" fill="#eab308" fillOpacity="0.9" stroke="#facc15" strokeWidth="1" strokeLinejoin="round" />
            <circle cx="12" cy="14.5" r="1.4" fill="#fef08a" />
          </svg>
          <div className="min-w-0">
            <p className="text-[11px] font-black uppercase leading-tight tracking-[0.14em] text-amber-400">Quantitative</p>
            <p className="text-[9px] font-bold uppercase leading-tight tracking-[0.22em] text-amber-500/80">Strategy AI Engine</p>
          </div>
        </div>
        {/* bò vàng silhouette */}
        <svg viewBox="0 0 120 44" className="mt-2 w-full" aria-hidden>
          <defs>
            <linearGradient id="bull-g" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#fbbf24" stopOpacity="0.85" />
              <stop offset="100%" stopColor="#92400e" stopOpacity="0.8" />
            </linearGradient>
          </defs>
          <path
            d="M8 34 C10 20 22 12 36 13 C40 6 52 4 58 9 C66 2 80 4 84 11 C96 8 106 14 110 24 C112 30 109 35 104 36 L96 36 C94 31 90 29 86 31 L84 36 L74 36 C72 32 68 30 64 32 L62 36 L48 36 C46 31 42 29 38 31 L36 36 L22 36 C13 36 7 36 8 34 Z"
            fill="url(#bull-g)"
            stroke="#facc15"
            strokeOpacity="0.5"
            strokeWidth="0.8"
          />
        </svg>
      </div>

      <div className="flex-1" />

      {/* chân: system online + clock */}
      <div className="m-3 rounded-xl border border-emerald-900/50 bg-[#0a1410]/80 px-3 py-2.5">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-400">
          <span className="relative flex h-2 w-2" aria-hidden>
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
          System Online
        </p>
        <p className="mt-0.5 font-mono text-[12px] font-bold text-zinc-100">{now || "··:··:·· (UTC+7)"}</p>
      </div>
    </aside>
  );
}
