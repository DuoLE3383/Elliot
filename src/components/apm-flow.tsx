"use client";

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

const LIME = "emerald-400";
const RED = "rose-400";
const GREY = "#9aa0a6";
const AMBER = "#fbbf24";
const INK = "#15151a";
const EDGE = "#26262c";
const TXT = "#e9e9ec";
const SUB = "#8b8b94";

const NW = 196;
const NH = 66;
const ROW_GAP = 16;
const COL_A_X = 30;
const COL_M_X = 365;
const COL_B_X = 695;
const ROW_Y = [20, 138, 256, 374, 492];
const BASE_W = 1040;
const BASE_H = 604;

const cy = (row: number): number => ROW_Y[row] + NH / 2;
const cxL = COL_A_X + NW / 2;
const edgeR = COL_B_X + NW;

const thick = (n: number, max: number): number =>
  n <= 0 ? 1.4 : Math.min(18, 3 + 15 * Math.sqrt(n / Math.max(max, 1)));

function Ribbon({
  x1, y1, x2, y2, w, color, hot, dashed, dim,
}: {
  x1: number; y1: number; x2: number; y2: number;
  w: number; color: string; hot?: boolean; dashed?: boolean; dim?: boolean;
}) {
  const c1x = x1 + (x2 - x1) * 0.45;
  const c2x = x1 + (x2 - x1) * 0.55;
  const h = w / 2;
  const fill =
    `M ${x1} ${y1 - h} C ${c1x} ${y1 - h} ${c2x} ${y2 - h} ${x2} ${y2 - h}` +
    ` L ${x2} ${y2 + h} C ${c2x} ${y2 + h} ${c1x} ${y1 + h} ${x1} ${y1 + h} Z`;
  const core = `M ${x1} ${y1} C ${c1x} ${y1} ${c2x} ${y2} ${x2} ${y2}`;
  return (
    <g className="apm-band" opacity={dim ? 0.5 : 1}>
      <path d={fill} fill={color} fillOpacity={hot ? 0.4 : 0.24} />
      {!dashed && (
        <path d={core} fill="none" stroke={color} strokeOpacity={0.55} strokeWidth={1.1} />
      )}
      <path
        d={core}
        fill="none"
        stroke="#0b0b0e"
        strokeOpacity={0.5}
        strokeWidth={Math.max(1.4, w * 0.45)}
        strokeDasharray={dashed ? "3 7" : "5 9"}
        className={hot ? "pipe-flow-hot" : "pipe-flow"}
      />
      {dashed && (
        <path
          d={core}
          fill="none"
          stroke={color}
          strokeOpacity={0.85}
          strokeWidth={1.2}
          strokeDasharray="4 5"
        />
      )}
    </g>
  );
}

function BulgeRibbon({
  xEdge, y1, y2, bulgeX, w, color, hot, dashed, dim,
}: {
  xEdge: number; y1: number; y2: number; bulgeX: number;
  w: number; color: string; hot?: boolean; dashed?: boolean; dim?: boolean;
}) {
  const h = w / 2;
  const fill =
    `M ${xEdge} ${y1 - h} C ${bulgeX} ${y1 - h} ${bulgeX} ${y2 - h} ${xEdge} ${y2 - h}` +
    ` L ${xEdge} ${y2 + h} C ${bulgeX} ${y2 + h} ${bulgeX} ${y1 + h} ${xEdge} ${y1 + h} Z`;
  const core = `M ${xEdge} ${y1} C ${bulgeX} ${y1} ${bulgeX} ${y2} ${xEdge} ${y2}`;
  return (
    <g className="apm-band" opacity={dim ? 0.5 : 1}>
      <path d={fill} fill={color} fillOpacity={hot ? 0.4 : 0.24} />
      {!dashed && (
        <path d={core} fill="none" stroke={color} strokeOpacity={0.55} strokeWidth={1.1} />
      )}
      <path
        d={core}
        fill="none"
        stroke="#0b0b0e"
        strokeOpacity={0.5}
        strokeWidth={Math.max(1.4, w * 0.45)}
        strokeDasharray={dashed ? "3 7" : "5 9"}
        className={hot ? "pipe-flow-hot" : "pipe-flow"}
      />
      {dashed && (
        <path
          d={core}
          fill="none"
          stroke={color}
          strokeOpacity={0.85}
          strokeWidth={1.2}
          strokeDasharray="4 5"
        />
      )}
    </g>
  );
}

function BandChip({ x, y, color, label }: { x: number; y: number; color: string; label: string }) {
  const w = label.length * 5.4 + 14;
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
      style={{ filter: n.glow ? `drop-shadow(0 0 10px ${n.dot})` : undefined }}
    >
      <rect
        width={NW}
        height={NH}
        rx={13}
        fill={INK}
        stroke={n.stroke ?? EDGE}
        strokeWidth={1}
        strokeDasharray={n.strokeDash}
      />
      <circle cx={16} cy={20} r={3.5} fill={n.dot} />
      <text x={26} y={23.5} fontSize={10.5} fontWeight={600} fill={TXT}>
        {n.title}
      </text>
      <text
        x={16}
        y={45}
        fontSize={16}
        fontWeight={700}
        fill={n.valColor}
        fontFamily="var(--font-geist-mono), monospace"
      >
        {n.value}
      </text>
      <text x={16} y={58} fontSize={9} fill={SUB}>
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

  const midStartY = ROW_Y[1];
  const midNodeY = (idx: number): number => midStartY + idx * (NH + ROW_GAP);
  const midCy = (idx: number): number => midNodeY(idx) + NH / 2;

  const midBottomY = midStartY + midItems.length * (NH + ROW_GAP);
  const rightBottomY = ROW_Y[3] + NH;
  const H = Math.max(BASE_H, midBottomY + 32, rightBottomY + 32);

  const wGate = thick(f.gatePass, Math.max(f.scanCombos, 1));
  const wTp = thick(f.tp, maxExit);
  const wSl = thick(f.sl, maxExit);
  const wFlip = thick(f.flip + f.manual, maxExit);

  const tradesCy = cy(0);
  const ySrc = (dy: number): number => tradesCy + dy;

  const leftNodes: NodeSpec[] = [
    { x: COL_A_X, y: ROW_Y[0], id: "st-universe", title: t(lang, "apm.node.universe"), value: `${f.universePool}`, sub: "UNIVERSE staples + trend", dot: "#22d3ee", valColor: TXT },
    { x: COL_A_X, y: ROW_Y[1], id: "st-universe", title: t(lang, "apm.node.published"), value: `${f.publishedTop}`, sub: `${f.uptrend} uptrend`, dot: "#38bdf8", valColor: TXT },
    {
      x: COL_A_X, y: ROW_Y[2], id: "st-dock", title: t(lang, "apm.node.scan"), value: `${f.scanCombos}`,
      sub: f.scanAgeMin != null ? `${f.scanAgeMin}m ago` : "—", dot: "#a78bfa", valColor: TXT,
      glow: f.scanAgeMin != null && f.scanAgeMin <= 5,
    },
    {
      x: COL_A_X, y: ROW_Y[3], id: "st-dock", title: t(lang, "apm.node.gate"), value: `${f.gatePass}`,
      sub: t(lang, "apm.node.gate"), dot: LIME, valColor: f.gatePass > 0 ? LIME : SUB,
      stroke: f.gatePass > 0 ? "rgba(200,245,66,0.45)" : undefined, glow: f.gatePass > 0,
    },
    { x: COL_A_X, y: ROW_Y[4], id: "st-dock", title: t(lang, "apm.node.skipped"), value: `${f.neutral}`, sub: "NEUTRAL / noise", dot: GREY, valColor: SUB },
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
    { x: COL_B_X, y: ROW_Y[0], id: "st-hist", title: t(lang, "apm.node.trades"), value: `${f.tradesTotal}`, sub: `${f.closedTrades} closed`, dot: "#34d399", valColor: TXT },
    { x: COL_B_X, y: ROW_Y[1], id: "st-hist", title: t(lang, "apm.node.tp"), value: `${f.tp}`, sub: t(lang, "apm.band.success"), dot: LIME, valColor: LIME, stroke: "rgba(200,245,66,0.3)" },
    { x: COL_B_X, y: ROW_Y[2], id: "st-hist", title: t(lang, "apm.node.sl"), value: `${f.sl}`, sub: t(lang, "apm.band.error"), dot: RED, valColor: RED, stroke: "rgba(244,82,92,0.3)" },
    { x: COL_B_X, y: ROW_Y[3], id: "st-hist", title: t(lang, "apm.node.flip"), value: `${f.flip + f.manual}`, sub: `flip ${f.flip} · manual ${f.manual}`, dot: AMBER, valColor: AMBER },
  ];

  const nodes: NodeSpec[] = [...leftNodes, ...middleNodes, ...rightNodes];
  const gateCy = cy(3);
  const perOpenWidth = hasOpen ? Math.max(2.6, wGate / midItems.length) : 1.6;
  const firstMidCy = midCy(0);

  return (
    <div className="rail-scroll overflow-x-auto">
      <div className="min-w-[880px]">
        <svg viewBox={`0 0 ${BASE_W} ${H}`} width="100%" role="img" aria-label="trading flow map">
          {[0, 1, 2].map((r) => (
            <g key={`la-${r}`}>
              <Ribbon x1={cxL} y1={ROW_Y[r] + NH} x2={cxL} y2={ROW_Y[r + 1]} w={4} color={GREY} />
            </g>
          ))}

          <BulgeRibbon
            xEdge={COL_A_X} y1={cy(2)} y2={cy(4)} bulgeX={12}
            w={thick(f.neutral, Math.max(f.scanCombos, 1))} color={GREY}
          />
          <BandChip x={46} y={348} color={GREY} label={t(lang, "apm.band.normal")} />

          {midItems.map((pos, idx) => {
            const targetY = midCy(idx);
            const active = !pos.isFlat;
            return (
              <Ribbon
                key={`gate-mid-${pos.id ?? idx}`}
                x1={COL_A_X + NW} y1={gateCy} x2={COL_M_X} y2={targetY}
                w={perOpenWidth} color={active ? LIME : GREY}
                dashed={!active} dim={!active} hot={active && f.gatePass > 0}
              />
            );
          })}
          <BandChip
            x={(COL_A_X + NW + COL_M_X) / 2}
            y={gateCy * 0.5 + firstMidCy * 0.5}
            color={hasOpen ? LIME : GREY}
            label={hasOpen ? t(lang, "apm.band.pending") : t(lang, "apm.band.success")}
          />

          {midItems.map((pos, idx) => {
            const srcY = midCy(idx);
            const active = !pos.isFlat;
            return (
              <Ribbon
                key={`mid-opened-${pos.id ?? idx}`}
                x1={COL_M_X + NW} y1={srcY} x2={COL_B_X} y2={tradesCy}
                w={perOpenWidth} color={active ? LIME : GREY}
                dashed={!active} dim={!active} hot={active && f.tradesTotal > 0}
              />
            );
          })}
          <BandChip
            x={(COL_M_X + NW + COL_B_X) / 2}
            y={firstMidCy * 0.5 + tradesCy * 0.5}
            color={LIME}
            label={t(lang, "apm.band.success")}
          />

          <BulgeRibbon xEdge={edgeR} y1={ySrc(-12)} y2={cy(1)} bulgeX={928} w={wTp} color={LIME} hot={f.tp > 0} />
          <BulgeRibbon xEdge={edgeR} y1={ySrc(0)} y2={cy(2)} bulgeX={946} w={wSl} color={RED} hot={f.sl > 0} />
          <BulgeRibbon xEdge={edgeR} y1={ySrc(12)} y2={cy(3)} bulgeX={964} w={wFlip} color={AMBER} />
          <BandChip x={928} y={112} color={LIME} label={t(lang, "apm.band.success")} />
          <BandChip x={946} y={171} color={RED} label={t(lang, "apm.band.error")} />
          <BandChip x={964} y={230} color={AMBER} label={t(lang, "apm.band.normal")} />

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
  );
}