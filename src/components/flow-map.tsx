"use client";

// ─── FlowMap — sơ đồ suy diễn đầu trang /stats + /ai (0.2.84) ────────────────
// Yêu cầu user: "làm những line sáng đó chạy về các modal hay chức năng liên
// kết liên quan và sáng lên ở những nơi đang suy diễn xử lý".
// Cấu trúc: hàng node pill nối nhau bằng connector SVG có xung điện chạy liên
// tục (CSS thuần — cùng ngôn ngữ "dòng điện" với nền circuit 0.2.83).
//  - Node ĐANG XỬ LÝ (active): viền + glow màu tone, chấm ping nhấp nháy,
//    line VÀO nó chuyển sang xung nhanh (flow-line-hot) → điện đang đổ về đó.
//  - Bấm node → onNodeClick(id): trang cuộn tới nhóm liên quan + nhóm phát
//    vòng sáng (chapter-flash); id đặc biệt có thể mở modal / nhảy trang khác.
// Không dùng Math.random, không measure DOM → SSR/client render giống hệt nhau.

export type FlowTone =
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

export interface FlowNodeDef {
  /** id mục tiêu khi bấm (element id / hành động đặc biệt) */
  id: string;
  label: string;
  sub?: string;
  tone: FlowTone;
  /** đang suy diễn/xử lý → node sáng + ping + line vào nó xung nhanh */
  active?: boolean;
  /** chưa có dữ liệu → mờ đi */
  dim?: boolean;
}

const TONE_MAP: Record<FlowTone, { idle: string; hot: string; glow: string; dot: string; line: string }> = {
  cyan: { idle: "border-cyan-900/80 bg-cyan-950/30 text-cyan-200", hot: "border-cyan-400 bg-cyan-900/60 text-cyan-100", glow: "shadow-[0_0_16px_rgba(34,211,238,0.45)]", dot: "bg-cyan-400", line: "#22d3ee" },
  sky: { idle: "border-sky-900/80 bg-sky-950/30 text-sky-200", hot: "border-sky-400 bg-sky-900/60 text-sky-100", glow: "shadow-[0_0_16px_rgba(56,189,248,0.45)]", dot: "bg-sky-400", line: "#38bdf8" },
  violet: { idle: "border-violet-900/80 bg-violet-950/30 text-violet-200", hot: "border-violet-400 bg-violet-900/60 text-violet-100", glow: "shadow-[0_0_16px_rgba(167,139,250,0.45)]", dot: "bg-violet-400", line: "#a78bfa" },
  amber: { idle: "border-amber-900/80 bg-amber-950/30 text-amber-200", hot: "border-amber-400 bg-amber-900/60 text-amber-100", glow: "shadow-[0_0_16px_rgba(251,191,36,0.45)]", dot: "bg-amber-400", line: "#fbbf24" },
  emerald: { idle: "border-emerald-900/80 bg-emerald-950/30 text-emerald-200", hot: "border-emerald-400 bg-emerald-900/60 text-emerald-100", glow: "shadow-[0_0_16px_rgba(52,211,153,0.45)]", dot: "bg-emerald-400", line: "#34d399" },
  rose: { idle: "border-rose-900/80 bg-rose-950/30 text-rose-200", hot: "border-rose-400 bg-rose-900/60 text-rose-100", glow: "shadow-[0_0_16px_rgba(251,113,133,0.45)]", dot: "bg-rose-400", line: "#fb7185" },
  orange: { idle: "border-orange-900/80 bg-orange-950/30 text-orange-200", hot: "border-orange-400 bg-orange-900/60 text-orange-100", glow: "shadow-[0_0_16px_rgba(251,146,60,0.45)]", dot: "bg-orange-400", line: "#fb923c" },
  indigo: { idle: "border-indigo-900/80 bg-indigo-950/30 text-indigo-200", hot: "border-indigo-400 bg-indigo-900/60 text-indigo-100", glow: "shadow-[0_0_16px_rgba(129,140,248,0.45)]", dot: "bg-indigo-400", line: "#818cf8" },
  fuchsia: { idle: "border-fuchsia-900/80 bg-fuchsia-950/30 text-fuchsia-200", hot: "border-fuchsia-400 bg-fuchsia-900/60 text-fuchsia-100", glow: "shadow-[0_0_16px_rgba(232,121,249,0.45)]", dot: "bg-fuchsia-400", line: "#e879f9" },
  blue: { idle: "border-blue-900/80 bg-blue-950/30 text-blue-200", hot: "border-blue-400 bg-blue-900/60 text-blue-100", glow: "shadow-[0_0_16px_rgba(96,165,250,0.45)]", dot: "bg-blue-400", line: "#60a5fa" },
  teal: { idle: "border-teal-900/80 bg-teal-950/30 text-teal-200", hot: "border-teal-400 bg-teal-900/60 text-teal-100", glow: "shadow-[0_0_16px_rgba(45,212,191,0.45)]", dot: "bg-teal-400", line: "#2dd4bf" },
  zinc: { idle: "border-zinc-800 bg-zinc-900/60 text-zinc-300", hot: "border-zinc-500 bg-zinc-800 text-zinc-100", glow: "shadow-[0_0_14px_rgba(161,161,170,0.35)]", dot: "bg-zinc-400", line: "#a1a1aa" },
};

export function FlowMap({
  nodes,
  onNodeClick,
  hint,
}: {
  nodes: FlowNodeDef[];
  onNodeClick?: (id: string) => void;
  hint?: string;
}) {
  return (
    <div>
      <div className="flex flex-wrap items-center gap-y-2">
        {nodes.map((n, i) => {
          const c = TONE_MAP[n.tone];
          return (
            <span key={`${n.id}-${i}`} className="inline-flex items-center">
              {i > 0 && (
                <svg className="h-2.5 w-5 shrink-0 sm:w-7" aria-hidden>
                  {/* xung điện chạy liên tục; line vào node busy xung nhanh + sáng */}
                  <line
                    x1="0"
                    y1="50%"
                    x2="100%"
                    y2="50%"
                    stroke={c.line}
                    strokeWidth={n.active ? 2 : 1.4}
                    opacity={n.active ? 0.95 : 0.4}
                    className={n.active ? "flow-line-hot" : "flow-line"}
                  />
                </svg>
              )}
              <button
                type="button"
                onClick={() => onNodeClick?.(n.id)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-left transition-all duration-200 hover:brightness-125 ${n.active ? `${c.hot} ${c.glow}` : c.idle} ${n.dim ? "opacity-50" : ""}`}
              >
                {n.active ? (
                  <span className="relative flex h-2 w-2 shrink-0">
                    <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${c.dot} opacity-60`} />
                    <span className={`relative inline-flex h-2 w-2 rounded-full ${c.dot}`} />
                  </span>
                ) : (
                  <span className={`h-2 w-2 shrink-0 rounded-full ${c.dot} opacity-50`} />
                )}
                <span className="leading-tight">
                  <span className="block whitespace-nowrap text-[11px] font-semibold">{n.label}</span>
                  {n.sub && <span className="block whitespace-nowrap text-[9px] opacity-75">{n.sub}</span>}
                </span>
              </button>
            </span>
          );
        })}
      </div>
      {hint && <p className="mt-2 text-[10px] text-zinc-600">{hint}</p>}
    </div>
  );
}
