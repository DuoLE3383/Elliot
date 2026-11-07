"use client";

// ─── PipeMap — sơ đồ suy diễn hình chữ S (0.2.85, thay FlowMap 0.2.84) ───────
// Yêu cầu user: line sáng CHẠY rõ ràng về các modal/chức năng liên quan, node
// đang suy diễn/xử lý PHÁT SÁNG. FlowMap cũ chỉ là hàng pill nối line 20px —
// gần như vô hình → vẽ lại thành sơ đồ SVG thật:
//  - 2 hàng zigzag (S-flow): hàng 1 chạy trái→phải, bò xuống mép phải, hàng 2
//    chạy phải→trái. Toạ độ node tính từ danh sách → SSR/client giống hệt nhau.
//  - Connector = đường elbow có DÒNG ĐIỆN CHẠY (dash trượt theo hướng vẽ, CSS
//    thuần — cùng ngôn ngữ circuit nền 0.2.83) + mũi tên chỉ hướng suy diễn.
//    Line tô MÀU CỦA NODE ĐÍCH — điện "đổ về" nơi nó nối.
//  - Node ĐANG XỬ LÝ (active): viền + glow drop-shadow + halo nhấp nháy; line
//    VÀO nó chuyển xung nhanh dày hơn → nhìn là biết đang suy diễn tới đâu.
//  - Bấm node → onNodeClick(id): trang tự MỞ accordion trạm đó, cuộn tới và
//    phát vòng sáng; id đặc biệt có thể mở popup / nhảy trang khác.
// Không measure DOM, không random — render máy chủ = máy khách.

export type PipeTone =
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

export interface PipeNodeDef {
  /** id mục tiêu khi bấm (element id trạm / hành động đặc biệt của trang) */
  id: string;
  label: string;
  sub?: string;
  tone: PipeTone;
  /** đang suy diễn/xử lý → node glow + halo + line vào nó xung nhanh */
  active?: boolean;
  /** chưa có dữ liệu → mờ đi */
  dim?: boolean;
}

/** màu hex mỗi tone — SVG cần giá trị thô cho stroke/fill/drop-shadow */
const C: Record<PipeTone, string> = {
  cyan: "#22d3ee",
  sky: "#38bdf8",
  violet: "#a78bfa",
  amber: "#fbbf24",
  emerald: "#34d399",
  rose: "#fb7185",
  orange: "#fb923c",
  indigo: "#818cf8",
  fuchsia: "#e879f9",
  blue: "#60a5fa",
  teal: "#2dd4bf",
  zinc: "#a1a1aa",
};

// hình học lưới (viewBox 1000 — svg scale theo bề rộng, mobile cuộn ngang)
const PAD = 10;
const NW = 170; // bề rộng node
const NH = 54; // bề cao node
const GAP_Y = 38; // khoảng dọc 2 hàng (chỗ bò xuống)
const W = 1000;

interface Conn {
  d: string;
  col: string;
  hot: boolean;
  arrow: string;
}

export function PipeMap({
  nodes,
  onNodeClick,
  hint,
}: {
  nodes: PipeNodeDef[];
  onNodeClick?: (id: string) => void;
  hint?: string;
}) {
  const n = nodes.length;
  const slots = Math.ceil(n / 2); // mỗi hàng tối đa `slots` node
  const gapX = slots > 1 ? (W - 2 * PAD - slots * NW) / (slots - 1) : 0;
  const rowY = [PAD, PAD + NH + GAP_Y];
  const H = rowY[1] + NH + PAD;

  // toạ độ node: hàng 1 trái→phải, hàng 2 PHẢI→TRÁI (hình chữ S)
  const pos = nodes.map((_, i) => {
    if (i < slots) return { x: PAD + i * (NW + gapX), y: rowY[0] };
    const j = i - slots;
    return { x: W - PAD - NW - j * (NW + gapX), y: rowY[1] };
  });

  // connector i → i+1: ngang trong hàng, bò xuống ở.rung hàng
  const conns: Conn[] = [];
  for (let i = 0; i < n - 1; i++) {
    const b = nodes[i + 1];
    const pa = pos[i];
    const pb = pos[i + 1];
    const col = C[b.tone];
    const hot = !!b.active;
    if (i === slots - 1) {
      // bò xuống: đáy node cuối hàng 1 → đỉnh node đầu hàng 2
      const x1 = pa.x + NW / 2;
      const y1 = pa.y + NH;
      const x2 = pb.x + NW / 2;
      const y2 = pb.y;
      const midY = pa.y + NH + GAP_Y / 2;
      const d =
        Math.abs(x1 - x2) < 1
          ? `M ${x1} ${y1} V ${y2}`
          : `M ${x1} ${y1} V ${midY} H ${x2} V ${y2}`;
      conns.push({ d, col, hot, arrow: `${x2},${y2} ${x2 - 5},${y2 - 8} ${x2 + 5},${y2 - 8}` });
    } else if (i < slots - 1) {
      // hàng 1: chạy sang phải
      const y = pa.y + NH / 2;
      const x1 = pa.x + NW;
      const x2 = pb.x;
      conns.push({ d: `M ${x1} ${y} H ${x2}`, col, hot, arrow: `${x2},${y} ${x2 - 8},${y - 5} ${x2 - 8},${y + 5}` });
    } else {
      // hàng 2: chạy sang trái
      const y = pa.y + NH / 2;
      const x1 = pa.x;
      const x2 = pb.x + NW;
      conns.push({ d: `M ${x1} ${y} H ${x2}`, col, hot, arrow: `${x2},${y} ${x2 + 8},${y - 5} ${x2 + 8},${y + 5}` });
    }
  }

  return (
    <div>
      <div className="rail-scroll overflow-x-auto">
        <div className="min-w-[840px]">
          <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="pipeline map">
            {/* line nền mờ cho liền mạch + dash chạy + mũi tên chỉ hướng */}
            {conns.map((c, i) => (
              <g key={i}>
                <path d={c.d} fill="none" stroke={c.col} strokeOpacity={0.15} strokeWidth={2.4} strokeLinecap="round" />
                <path
                  d={c.d}
                  fill="none"
                  stroke={c.col}
                  strokeOpacity={c.hot ? 0.95 : 0.5}
                  strokeWidth={c.hot ? 2.4 : 1.7}
                  strokeLinecap="round"
                  className={c.hot ? "pipe-flow-hot" : "pipe-flow"}
                />
                <polygon points={c.arrow} fill={c.col} opacity={c.hot ? 0.95 : 0.55} />
              </g>
            ))}
            {/* node */}
            {nodes.map((nd, i) => {
              const col = C[nd.tone];
              const p = pos[i];
              // cy = tâm node theo TOẠ ĐỘ LOCAL (g đã translate tới p) — tính
              // p.y vào đây sẽ offset kép, text hàng 2 trôi ra ngoài viewBox
              const cy = NH / 2;
              return (
                <g
                  key={`${nd.id}-${i}`}
                  transform={`translate(${p.x} ${p.y})`}
                  onClick={() => onNodeClick?.(nd.id)}
                  className="cursor-pointer"
                  style={{ filter: nd.active ? `drop-shadow(0 0 9px ${col})` : undefined }}
                  opacity={nd.dim ? 0.45 : 1}
                >
                  {nd.active && (
                    <rect
                      x={-4}
                      y={-4}
                      width={NW + 8}
                      height={NH + 8}
                      rx={13}
                      fill="none"
                      stroke={col}
                      strokeWidth={1.3}
                      className="pipe-halo"
                    />
                  )}
                  <rect
                    width={NW}
                    height={NH}
                    rx={11}
                    fill={col}
                    fillOpacity={nd.active ? 0.16 : 0.07}
                    stroke={col}
                    strokeOpacity={nd.active ? 1 : 0.5}
                    strokeWidth={nd.active ? 1.6 : 1.1}
                  />
                  <text
                    x={NW / 2}
                    y={nd.sub ? cy - 3 : cy + 4.5}
                    textAnchor="middle"
                    fontSize={13}
                    fontWeight={700}
                    fill={nd.active ? col : "#e4e4e7"}
                  >
                    {nd.label}
                  </text>
                  {nd.sub && (
                    <text x={NW / 2} y={cy + 13} textAnchor="middle" fontSize={9.5} fill={col} fillOpacity={0.85}>
                      {nd.sub}
                    </text>
                  )}
                  <title>
                    {nd.label}
                    {nd.sub ? ` — ${nd.sub}` : ""}
                  </title>
                </g>
              );
            })}
          </svg>
        </div>
      </div>
      {hint && <p className="mt-1.5 text-[10px] leading-relaxed text-zinc-600">{hint}</p>}
    </div>
  );
}
