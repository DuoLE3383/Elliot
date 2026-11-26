"use client";

// ─── AppHeader — thanh nav dẫn trang dùng chung cho CẢ 5 trang (Home · Analytics
// · Arena · AI Lab · AI Revolution). Mỗi trang nhúng thanh này ở mép trên cùng;
// header riêng của trang (terminal bar / console bar / APM bar) nằm ngay dưới,
// sticky top-9 để không đè lên nhau. Active theo pathname — giống NAV của
// AutoSidebar (/auto) để nav đồng bộ toàn app.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, LineChart, Swords, BrainCircuit, Bot } from "lucide-react";
import { ElliottLogo } from "@/components/logo";

const NAV = [
  { href: "/", key: "Home", icon: Activity },
  { href: "/stats", key: "Analytics", icon: LineChart },
  { href: "/arena", key: "Arena", icon: Swords },
  { href: "/ai", key: "AI Lab", icon: BrainCircuit },
  { href: "/auto", key: "AI Revolution", icon: Bot },
] as const;

export function AppHeader() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Main"
      className="sticky top-0 z-50 flex h-9 shrink-0 items-center gap-1 border-b border-zinc-800/70 bg-[#020617]/85 px-2 backdrop-blur sm:px-3"
    >
      {/* logo ở GIỮA thanh nav (đúng chỗ khung đỏ user vẽ) — lg mới đủ chỗ cho
          5 link + logo giữa; mobile vẫn chỉ 5 icon. Vẫn chỉ 1 logo/trang: các
          trang nội dung (terminal/console bar) không nhắc lại badge này */}
      <div className="pointer-events-none absolute inset-y-0 left-1/2 z-10 hidden -translate-x-1/2 items-center lg:flex">
        <Link
          href="/"
          className="pointer-events-auto flex items-center gap-1.5 rounded-md px-2 py-1 hover:bg-zinc-900"
          title="Elliott — Home"
        >
          <ElliottLogo className="h-5 w-5" />
          <span className="hidden text-[11px] font-black tracking-[0.22em] text-zinc-100 xl:inline">ELLIOTT</span>
        </Link>
      </div>
      {NAV.map((item) => {
        const active = pathname === item.href;
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium transition-colors sm:px-2.5 sm:text-xs ${
              active
                ? "bg-zinc-800/80 text-emerald-400"
                : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
            }`}
          >
            <Icon className={`h-3.5 w-3.5 shrink-0 ${active ? "text-emerald-400" : "text-zinc-500"}`} />
            {/* mobile: chỉ icon — 5 link vừa màn hình 390px */}
            <span className="hidden sm:inline">{item.key}</span>
          </Link>
        );
      })}
    </nav>
  );
}
