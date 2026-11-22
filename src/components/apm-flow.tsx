"use client";

// ─── Trading Flow Map (0.3.54 — thiết kế lại theo ảnh tham chiếu user) ────────
// User: "ý tôi là kiểu vầy nè" + ảnh: map 3 cột nền tối — header "● Trading
// Flow Map" + legend Success/Error/Normal/Pending bên phải, thẻ mono viền
// phát sáng, nối bằng ĐƯỜNG CONG NÉT ĐỨT mảnh (không còn dải băng dày).
// Giữ nguyên 100% hợp dữ liệu (ApmFlowCounts) + hành vi bấm node của 0.3.4:
// onNodeClick(id trạm) + onSelectPosition(idx) — /stats không phải đổi gì.
// Cấu trúc:
//   • CỘT TRÁI — Universe pool → Published top → Scan combos → Gate pass →
//     Skipped, nối bằng chấm đứt dọc (dòng dữ liệu đi xuống).
//   • CỘT GIỮA — thẻ "Open position #n" (symbol mono, side, "x.xxh · ROI"),
//     viền đứt + glow theo side (LONG lime / SHORT red).
//   • CỘT PHẢI — Trades opened → TP exits (Success) / SL exits (Error) /
//     Flip · manual (Normal) — bulge nét đứt từ cạnh phải node Trades.
// Nguồn: /api/stats khối `flow` (universePool/publishedTop/uptrend/scanCombos/
// gatePass/neutral/openPositions ROI live) — không thêm API mới.

import { t, type Lang } from "@/lib/i18n";

export interface OpenPositionItem {
  id?: string;
  symbol: string;
  side: "LONG" | "SHORT" | string;
  roi: number | null;
  ageH: number;
  entryPrice?: number;
  markPrice?: number;
  pnlUsd?: number;
  marginUsd?: number;
  marginPct?: number;
  sizeUsd?: number;
  leverage?: number;
  liqPrice?: number;
  slPrice?: number;
  slPct?: number;
  slRoiPct?: number;
  tpPrice?: number;
  tpPct?: number;
  tpRoiPct?: number;
  trailText?: string;
  distSlPct?: number;
  distTpPct?: number;
  timeframe?: string;
}

export interface ApmFlowCounts {
  universePool: number;
  publishedTop: number;
  uptrend: number;
  scanCombos: number;
  scanAgeMin: number | null;
  gatePass: number;
  neutral: number;
  tradesTotal: number;
  closedTrades: number;
  tp: number;
  sl: number;
  flip: number;
  manual: number;
  open: OpenPositionItem | OpenPositionItem[] | null;
  openPositions?: OpenPositionItem[];
}

const LIME = "#34d399";
const RED = "#fb7185";
const GREY = "#9aa0a6";
const AMBER = "#fbbf24";
const VIOLET = "#a78bfa";
const INK = "#15151a";
const EDGE = "#26262c";
const TXT = "#e9e9ec";
const SUB = "#8b8b94";

const NW = 172;
const NH = 64;
const ROW_GAP = 12;
const COL_A_X = 30;
const COL_M_X = 322;
const COL_B_X = 614;
const ROW_Y = [20, 150, 280, 410, 540];
const BASE_W = 900;
const BASE_H = 648;

const cy = (row: number): number => ROW_Y[row] + NH / 2;
const cxL = COL_A_X + NW / 2;
const edgeR = COL_B_X + NW;

// ─── Wire — đường cong nét đứt mảnh (thay dải băng dày của 0.3.4) ────────────
// hot = đang có dòng chảy thật (có lệnh / có pass) → xung chạy nhanh hơn.
function Wire({
  x1, y1, x2, y2, color, hot, dashed, dim, dash,
}: {
  x1: number; y1: number; x2: number; y2: number;
  color: string; hot?: boolean; dashed?: boolean; dim?: boolean; dash?: string;
}) {
  const c1x = x1 + (x2 - x1) * 0.45;
  const c2x = x1 + (x2 - x1) * 0.55;
  const d = `M ${x1} ${y1} C ${c1x} ${y1} ${c2x} ${y2} ${x2} ${y2}`;
  return (
    <g className="apm-band" opacity={dim ? 0.4 : 1}>
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeOpacity={hot ? 0.9 : 0.5}
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeDasharray={dash ?? (dashed ? "3 6" : "7 8")}
        className={hot ? "pipe-flow-hot" : "pipe-flow"}
      />
      {hot && (
        <path d={d} fill="none" stroke={color} strokeOpacity={0.16} strokeWidth={5} strokeLinecap="round" />
      )}
    </g>
  );
}

// Bulge — cong phồng ra ngoài cạnh phải (Trades → TP/SL/Flip), mảnh + đứt.
function BulgeWire({
  xEdge, y1, y2, bulgeX, color, hot, dashed,
}: {
  xEdge: number; y1: number; y2: number; bulgeX: number;
  color: string; hot?: boolean; dashed?: boolean;
}) {
  const d = `M ${xEdge} ${y1} C ${bulgeX} ${y1} ${bulgeX} ${y2} ${xEdge} ${y2}`;
  return (
    <g className="apm-band" opacity={hot ? 1 : 0.75}>
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeOpacity={hot ? 0.9 : 0.5}
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeDasharray={dashed ? "3 6" : "7 8"}
        className={hot ? "pipe-flow-hot" : "pipe-flow"}
      />
      {hot && (
        <path d={d} fill="none" stroke={color} strokeOpacity={0.16} strokeWidth={5} strokeLinecap="round" />
      )}
    </g>
  );
}

function BandChip({ x, y, color, label }: { x: number; y: number; color: string; label: string }) {
  const w = label.length * 5.6 + 14;
  return (
    <g>
      <rect
        x={x - w / 2}
        y={y - 8}
        width={w}
        height={16}
        rx={8}
        fill="#0b0b0e"
        fillOpacity={0.92}
        stroke={color}
        strokeOpacity={0.55}
        strokeWidth={0.8}
      />
      <text
        x={x}
        y={y + 3.5}
        textAnchor="middle"
        fontSize={8.5}
        fontWeight={600}
        fill={color}
        letterSpacing={0.4}
      >
        {label}
      </text>
    </g>
  );
}

interface NodeSpec {
  x: number;
  y: number;
  id: string;
  title: string;
  value: string;
  sub: string;
  dot: string;
  valColor: string;
  stroke?: string;
  strokeDash?: string;
  glow?: boolean;
  posIndex?: number;
}

function FlowNode({
  n,
  onClick,
  onSelectPosition,
}: {
  n: NodeSpec;
  onClick: (id: string) => void;
  onSelectPosition?: (idx: number) => void;
}) {
  const handleClick = () => {
    if (typeof n.posIndex === "number" && onSelectPosition) {
      onSelectPosition(n.posIndex);
    }
    onClick(n.id);
  };

  return (
    <g
      transform={`translate(${n.x} ${n.y})`}
      onClick={handleClick}
      className="cursor-pointer"
      style={{ filter: n.glow ? `drop-shadow(0 0 9px ${n.dot})` : undefined }}
    >
      <rect
        width={NW}
        height={NH}
        rx={14}
        fill={INK}
        stroke={n.stroke ?? EDGE}
        strokeWidth={1}
        strokeDasharray={n.strokeDash}
      />
      <circle cx={16} cy={21} r={3.5} fill={n.dot} />
      <text x={26} y={24.5} fontSize={10.5} fontWeight={600} fill={TXT}>
        {n.title}
      </text>
      <text
        x={16}
        y={49}
        fontSize={16.5}
        fontWeight={700}
        fill={n.valColor}
        fontFamily="var(--font-geist-mono), monospace"
      >
        {n.value}
      </text>
      <text x={16} y={64} fontSize={9} fill={SUB}>
        {n.sub}
      </text>
      <title>{`${n.title} — ${n.value} · ${n.sub}`}</title>
    </g>
  );
}

function normalizeOpenPositions(f: ApmFlowCounts): OpenPositionItem[] {
  if (Array.isArray(f.openPositions) && f.openPositions.length > 0) {
    return f.openPositions;
  }
  if (Array.isArray(f.open)) {
    return f.open;
  }
  if (f.open) {
    return [f.open];
  }
  return [];
}

export function ApmFlowMap({
  lang,
  f,
  onNodeClick,
  onSelectPosition,
}: {
  lang: Lang;
  f: ApmFlowCounts;
  onNodeClick?: (id: string) => void;
  onSelectPosition?: (idx: number) => void;
}) {
  const click = (id: string) => onNodeClick?.(id);
  const maxExit = Math.max(f.tp, f.sl, f.flip, f.manual, 1);

  const rawOpenList = normalizeOpenPositions(f);
  const hasOpen = rawOpenList.length > 0;

  const midItems: Array<OpenPositionItem & { isFlat?: boolean }> = hasOpen
    ? rawOpenList
    : [{ id: "flat", symbol: "", side: "", roi: null, ageH: 0, isFlat: true }];

  const midStartY = ROW_Y[0];
  const midTotalH = midItems.length * (NH + ROW_GAP) - ROW_GAP;
  const leftStep = (midTotalH - NH) / 4;
  const rightStep = (midTotalH - NH) / 3;
  const leftY = (i: number) => ROW_Y[0] + i * leftStep;
  const rightY = (i: number) => ROW_Y[0] + i * rightStep;
  const midNodeY = (idx: number): number => midStartY + idx * (NH + ROW_GAP);
  const midCy = (idx: number): number => midNodeY(idx) + NH / 2;

  const midBottomY = midStartY + midItems.length * (NH + ROW_GAP);
  const rightBottomY = ROW_Y[3] + NH;
  const H = Math.max(BASE_H, midStartY + midTotalH + 124);

  const tradesCy = cy(0);
  const ySrc = (dy: number): number => tradesCy + dy;

  // Scan combos: ảnh tham chiếu hiện "1h sig" — giữ ý nghĩa: khung tín hiệu 1h.
  // Scan stale thì ghi thêm tuổi để không mất thông tin "dữ liệu mới đến đây".
  const scanSub = f.scanAgeMin != null && f.scanAgeMin > 6
    ? `${f.scanAgeMin}m ago · 1h sig`
    : "1h sig";

  const leftNodes: NodeSpec[] = [
    { x: COL_A_X, y: leftY(0), id: "st-universe", title: t(lang, "apm.node.universe"), value: `${f.universePool}`, sub: "UNIVERSE staples + trend", dot: "#22d3ee", valColor: TXT },
    { x: COL_A_X, y: leftY(1), id: "st-universe", title: t(lang, "apm.node.published"), value: `${f.publishedTop}`, sub: `${f.uptrend} uptrend`, dot: "#38bdf8", valColor: TXT },
    {
      x: COL_A_X, y: leftY(2), id: "st-dock", title: t(lang, "apm.node.scan"), value: `${f.scanCombos}`,
      sub: scanSub, dot: "#a78bfa", valColor: TXT,
      glow: f.scanAgeMin != null && f.scanAgeMin <= 6,
    },
    {
      x: COL_A_X, y: leftY(3), id: "st-dock", title: t(lang, "apm.node.gate"), value: `${f.gatePass}`,
      sub: "last 24h", dot: LIME, valColor: f.gatePass > 0 ? LIME : SUB,
      stroke: f.gatePass > 0 ? "rgba(200,245,66,0.45)" : undefined, glow: f.gatePass > 0,
    },
    { x: COL_A_X, y: leftY(4), id: "st-dock", title: t(lang, "apm.node.skipped"), value: `${f.neutral}`, sub: "NEUTRAL / noise", dot: GREY, valColor: SUB },
  ];

  const middleNodes: NodeSpec[] = midItems.map((pos, idx) => {
    if (pos.isFlat) {
      return {
        x: COL_M_X, y: midNodeY(idx), id: "st-open",
        title: t(lang, "apm.node.openpos"), value: "flat",
        sub: t(lang, "apm.flow.flat"), dot: GREY, valColor: SUB,
      };
    }
    const roiText = pos.roi != null ? ` · ROI ${pos.roi >= 0 ? "+" : ""}${pos.roi.toFixed(2)}%` : "";
    const roiColor = pos.roi != null ? (pos.roi >= 0 ? LIME : RED) : TXT;
    return {
      x: COL_M_X,
      y: midNodeY(idx),
      id: "st-open",
      posIndex: idx,
      title: `${t(lang, "apm.node.openpos")} #${idx + 1}`,
      value: `${pos.symbol.replace("USDT", "")} ${pos.side}`,
      sub: `${pos.ageH.toFixed(2)}h${roiText}`,
      dot: pos.side === "LONG" ? LIME : RED,
      valColor: roiColor,
      stroke: pos.side === "LONG" ? "rgba(200,245,66,0.38)" : "rgba(244,82,92,0.5)",
      strokeDash: "5 4",
      glow: true,
    };
  });

  const rightNodes: NodeSpec[] = [
    { x: COL_B_X, y: rightY(0), id: "st-hist", title: t(lang, "apm.node.trades"), value: `${f.tradesTotal}`, sub: `${f.closedTrades} closed`, dot: LIME, valColor: TXT },
    { x: COL_B_X, y: rightY(1), id: "st-hist", title: t(lang, "apm.node.tp"), value: `${f.tp}`, sub: t(lang, "apm.band.success"), dot: LIME, valColor: LIME, stroke: "rgba(200,245,66,0.3)" },
    { x: COL_B_X, y: rightY(2), id: "st-hist", title: t(lang, "apm.node.sl"), value: `${f.sl}`, sub: t(lang, "apm.band.error"), dot: RED, valColor: RED, stroke: "rgba(244,82,92,0.3)" },
    { x: COL_B_X, y: rightY(3), id: "st-hist", title: t(lang, "apm.node.flip"), value: `${f.flip + f.manual}`, sub: `flip ${f.flip} · manual ${f.manual}`, dot: AMBER, valColor: AMBER },
  ];

  const bottomY = midStartY + midTotalH + 20;
  const bottomGap = ((COL_B_X + NW - COL_A_X) - 4 * NW) / 3;
  const bottomX = (i: number) => COL_A_X + i * (NW + bottomGap);
  // 4 node AI (design đã duyệt) — chỉ "Trade autopsy" có số thật hôm nay: queue
  // = mọi lệnh closed sổ B → value = f.closedTrades (trước đây hardcode "84").
  // Ba node còn lại là spec thiết kế (chưa có bảng dữ liệu) — giữ nguyên nhãn;
  // click trỏ sang trạm đúng nghĩa (dock = config/params, hist = lệnh) thay vì
  // st-universe mà trước đây 2 node giữa đang trỏ nhầm.
  const bottomNodes: NodeSpec[] = [
    { x: bottomX(0), y: bottomY, id: "st-hist", title: "Trade autopsy", value: `${f.closedTrades}`, sub: "thang / thua - queue 60s", dot: RED, valColor: TXT },
    { x: bottomX(1), y: bottomY, id: "st-dock", title: "Strategy self-evolution", value: "±20%", sub: "proposal-only - duyet moi ap", dot: "#38bdf8", valColor: TXT },
    { x: bottomX(2), y: bottomY, id: "st-dock", title: "param_values", value: "↻", sub: "doc lai tick sau - het hardcode", dot: "#22d3ee", valColor: TXT },
    { x: bottomX(3), y: bottomY, id: "st-hist", title: "Root-cause monitor", value: "5m", sub: "chi quet & ghi - khong sua", dot: "#a78bfa", valColor: TXT },
  ];
  const nodes: NodeSpec[] = [...leftNodes, ...middleNodes, ...rightNodes, ...bottomNodes];
  const gateCy = leftY(3) + NH / 2;
  const firstMidCy = midCy(0);

  return (
    <div>

      <div className="rail-scroll overflow-x-auto">
        <div className="min-w-[880px]">
          <svg viewBox={`0 0 ${BASE_W} ${H}`} width="100%" role="img" aria-label="trading flow map">
            {/* chuỗi dọc cột trái — 4 khoảng, chấm đứt mảnh */}
            {[0, 1, 2, 3].map((r) => (
              <Wire
                key={`la-${r}`}
                x1={cxL} y1={leftY(r) + NH} x2={cxL} y2={leftY(r + 1)}
                color={GREY} dash="2 5"
              />
            ))}

            {/* Skipped — nhánh thoát ra ngoài cạnh trái (Normal) */}
            <Wire
              x1={COL_A_X} y1={leftY(4) + NH / 2} x2={12} y2={leftY(4) + NH / 2}
              color={GREY} dash="3 6" dim
            />
            <BandChip x={40} y={leftY(4) + NH + 8} color={GREY} label={t(lang, "apm.band.normal")} />

            {/* Gate pass → từng vị thế: Pending (đứt tím) khi flat, lime khi có dòng */}
            {midItems.map((pos, idx) => {
              const targetY = midCy(idx);
              const active = !pos.isFlat;
              return (
                <Wire
                  key={`gate-mid-${pos.id ?? idx}`}
                  x1={COL_A_X + NW} y1={gateCy} x2={COL_M_X} y2={targetY}
                  color={active ? LIME : VIOLET}
                  dashed={!active}
                  dim={!active}
                  hot={active && f.gatePass > 0}
                />
              );
            })}
            <BandChip
              x={(COL_A_X + NW + COL_M_X) / 2}
              y={gateCy * 0.5 + firstMidCy * 0.5}
              color={hasOpen ? LIME : VIOLET}
              label={hasOpen ? t(lang, "apm.band.pending") : t(lang, "apm.band.success")}
            />

            {/* Vị thế → Trades opened */}
            {midItems.map((pos, idx) => {
              const srcY = midCy(idx);
              const active = !pos.isFlat;
              return (
                <Wire
                  key={`mid-opened-${pos.id ?? idx}`}
                  x1={COL_M_X + NW} y1={srcY} x2={COL_B_X} y2={tradesCy}
                  color={active ? LIME : GREY}
                  dashed={!active}
                  dim={!active}
                  hot={active && f.tradesTotal > 0}
                />
              );
            })}
            <BandChip
              x={(COL_M_X + NW + COL_B_X) / 2}
              y={firstMidCy * 0.5 + tradesCy * 0.5}
              color={LIME}
              label={t(lang, "apm.band.success")}
            />

            {/* Trades → TP / SL / Flip (bulge phải, mảnh đứt) */}
            <BulgeWire xEdge={edgeR} y1={ySrc(-12)} y2={rightY(1) + NH / 2} bulgeX={821} color={LIME} hot={f.tp > 0} />
            <BulgeWire xEdge={edgeR} y1={ySrc(0)} y2={rightY(2) + NH / 2} bulgeX={839} color={RED} hot={f.sl > 0} />
            <BulgeWire xEdge={edgeR} y1={ySrc(12)} y2={rightY(3) + NH / 2} bulgeX={857} color={AMBER} hot={f.flip + f.manual > 0} />
            <BandChip x={821} y={rightY(1) + NH / 2 - 16} color={LIME} label={t(lang, "apm.band.success")} />
            <BandChip x={839} y={rightY(2) + NH / 2 - 16} color={RED} label={t(lang, "apm.band.error")} />
            <BandChip x={857} y={rightY(3) + NH / 2 - 16} color={AMBER} label={t(lang, "apm.band.normal")} />

            {nodes.map((n, i) => (
              <FlowNode
                key={`${n.id}-${n.x}-${n.y}-${i}`}
                n={n}
                onClick={click}
                onSelectPosition={onSelectPosition}
              />
            ))}
          </svg>
        </div>
      </div>
    </div>
  );
}
