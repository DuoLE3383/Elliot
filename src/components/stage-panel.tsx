"use client";

// ─── Stage — trạm accordion gom nội dung (0.2.85) ────────────────────────────
// Yêu cầu user: "/stats và /ai vẫn dàn trải quá.. hãy gom lại". Mỗi trạm của
// pipeline = 1 HÀNG GỌN: dot trạng thái + tên + vài số headline (aside) +
// chevron; bấm mới mở toàn bộ metrics/charts/notes. Trang mặc định thu gọn →
// vừa 1-2 màn hình thay vì cuộn dài.
//  - active: trạm đang suy diễn/xử lý → dot ping + viền trái sáng (khớp node
//    PipeMap cùng màu — line điện đổ về trạm nào là thấy ngay).
//  - flashing: vừa được node trỏ tới → phát vòng sáng (chapter-flash).
//  - note ("Suy diễn: …"): hiện trong phần mở — gộp dòng suy diễn cũ của
//    Chapter 0.2.84 vào đây, không còn Card lồng Card.

import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";

export type StageTone =
  | "cyan"
  | "sky"
  | "violet"
  | "amber"
  | "emerald"
  | "rose"
  | "orange"
  | "indigo"
  | "fuchsia"
  | "blue"
  | "teal"
  | "zinc";

const T: Record<StageTone, { dot: string; text: string; edge: string; edgeIdle: string }> = {
  cyan: { dot: "bg-cyan-400", text: "text-cyan-300", edge: "border-l-cyan-500/80", edgeIdle: "border-l-zinc-700/60" },
  sky: { dot: "bg-sky-400", text: "text-sky-300", edge: "border-l-sky-500/80", edgeIdle: "border-l-zinc-700/60" },
  violet: { dot: "bg-violet-400", text: "text-violet-300", edge: "border-l-violet-500/80", edgeIdle: "border-l-zinc-700/60" },
  amber: { dot: "bg-amber-400", text: "text-amber-300", edge: "border-l-amber-500/80", edgeIdle: "border-l-zinc-700/60" },
  emerald: { dot: "bg-emerald-400", text: "text-emerald-300", edge: "border-l-emerald-500/80", edgeIdle: "border-l-zinc-700/60" },
  rose: { dot: "bg-rose-400", text: "text-rose-300", edge: "border-l-rose-500/80", edgeIdle: "border-l-zinc-700/60" },
  orange: { dot: "bg-orange-400", text: "text-orange-300", edge: "border-l-orange-500/80", edgeIdle: "border-l-zinc-700/60" },
  indigo: { dot: "bg-indigo-400", text: "text-indigo-300", edge: "border-l-indigo-500/80", edgeIdle: "border-l-zinc-700/60" },
  fuchsia: { dot: "bg-fuchsia-400", text: "text-fuchsia-300", edge: "border-l-fuchsia-500/80", edgeIdle: "border-l-zinc-700/60" },
  blue: { dot: "bg-blue-400", text: "text-blue-300", edge: "border-l-blue-500/80", edgeIdle: "border-l-zinc-700/60" },
  teal: { dot: "bg-teal-400", text: "text-teal-300", edge: "border-l-teal-500/80", edgeIdle: "border-l-zinc-700/60" },
  zinc: { dot: "bg-zinc-400", text: "text-zinc-300", edge: "border-l-zinc-500/80", edgeIdle: "border-l-zinc-700/60" },
};

export function Stage({
  id,
  tone,
  icon,
  title,
  note,
  active,
  open,
  flashing,
  onToggle,
  aside,
  children,
}: {
  id: string;
  tone: StageTone;
  icon?: ReactNode;
  title: string;
  /** dòng suy diễn — hiện trong phần mở */
  note?: string;
  /** trạm đang xử lý → dot ping + viền sáng */
  active?: boolean;
  open: boolean;
  /** vừa được node PipeMap trỏ tới → phát vòng sáng */
  flashing?: boolean;
  onToggle: () => void;
  /** số headline / badge bên phải hàng */
  aside?: ReactNode;
  children: ReactNode;
}) {
  const c = T[tone];
  return (
    <section id={id} className={flashing ? "chapter-flash rounded-xl" : "rounded-xl"}>
      <div
        className={`overflow-hidden rounded-xl border border-zinc-800 border-l-2 bg-zinc-900/50 transition-colors ${
          open || active ? c.edge : c.edgeIdle
        }`}
      >
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-zinc-900/80"
        >
          {active ? (
            <span className="relative flex h-2.5 w-2.5 shrink-0">
              <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${c.dot} opacity-60`} />
              <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${c.dot}`} />
            </span>
          ) : (
            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${c.dot} ${open ? "" : "opacity-50"}`} />
          )}
          <span className={`flex min-w-0 items-center gap-1.5 text-[13px] font-semibold ${c.text}`}>
            {icon}
            <span className="whitespace-normal leading-snug">{title}</span>
          </span>
          <span className="ml-auto flex shrink-0 items-center gap-1.5">{aside}</span>
          <ChevronDown className={`h-4 w-4 shrink-0 text-zinc-500 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
        {open && (
          <div className="border-t border-zinc-800/80 px-3 py-3">
            {note && <p className="mb-2.5 text-[11px] leading-relaxed text-zinc-500">↳ {note}</p>}
            {children}
          </div>
        )}
      </div>
    </section>
  );
}
