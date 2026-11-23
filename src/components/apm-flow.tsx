"use client";

import type { Lang } from "@/lib/i18n";

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

const C = {
  lime: "#34d399",
  red: "#fb7185",
  amber: "#fbbf24",
  violet: "#a78bfa",
  cyan: "#22d3ee",
  blue: "#60a5fa",
  grey: "#6b7280",
  text: "#e8edf5",
  sub: "#8b95a7",
  edge: "#2b3442",
  card: "#0f141c",
  bg: "#0b0e14",
};

const W = 900;
const NW = 200;
const NH = 60;
const GAP = 16;
const TOP = 44;
const PH = 100;
const PGAP = 10;
const MAX_POS = 4;
const AI_W = 200;
const AI_H = 60;
const AI_GAP = 56;
const COL_A = 14;
const COL_B = 350;
const COL_C = 686;
const AI_STEP = (W - 28 - AI_W) / 3;
const AI_X = [0, 1, 2, 3].map((i) => 14 + i * AI_STEP);

const rowY = (i: number) => TOP + i * (NH + GAP);
const posY = (j: number) => TOP + j * (PH + PGAP);
const strokeW = (n: number, on: boolean) => (on ? Math.min(4.5, 1.4 + Math.log10(n + 1) * 1.6) : 1.1);
const curve = (x1: number, y1: number, x2: number, y2: number) => {
  const dx = x2 - x1;
  return `M ${x1} ${y1} C ${x1 + dx * 0.5} ${y1}, ${x2 - dx * 0.5} ${y2}, ${x2} ${y2}`;
};
const fmtN = (n: number | null | undefined, d = 2) => (n == null || !Number.isFinite(n) ? "—" : n.toFixed(d));

function Line({
  d,
  color,
  w,
  on = false,
  dashed = false,
  op = 1,
}: {
  d: string;
  color: string;
  w: number;
  on?: boolean;
  dashed?: boolean;
  op?: number;
}) {
  return (
    <path
      d={d}
      fill="none"
      stroke={color}
      strokeOpacity={op}
      strokeWidth={w}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeDasharray={on || dashed ? "6 6" : undefined}
      className={on ? "apm-flow" : undefined}
      filter={on ? "url(#apm-glow)" : undefined}
    />
  );
}

function Pill({ x, y, text, color }: { x: number; y: number; text: string; color: string }) {
  const w = Math.max(60, text.length * 5.6 + 12);
  return (
    <g>
      <rect x={x - w / 2} y={y - 8} width={w} height={16} rx={8} fill={C.bg} stroke={color} strokeOpacity={0.6} />
      <text x={x} y={y + 3} textAnchor="middle" fontSize={8} fill={color}>
        {text}
      </text>
    </g>
  );
}

function Node({
  x,
  y,
  w = NW,
  h = NH,
  title,
  value,
  sub,
  color,
  valColor = C.text,
  on = false,
  dashed = false,
  onClick,
}: {
  x: number;
  y: number;
  w?: number;
  h?: number;
  title: string;
  value: string;
  sub: string;
  color: string;
  valColor?: string;
  on?: boolean;
  dashed?: boolean;
  onClick?: () => void;
}) {
  return (
    <g onClick={onClick} style={{ cursor: onClick ? "pointer" : "default" }}>
      <title>{`${title}: ${value} (${sub})`}</title>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={9}
        fill={C.card}
        stroke={on || dashed ? color : C.edge}
        strokeOpacity={on ? 0.9 : dashed ? 0.5 : 1}
        strokeDasharray={dashed ? "4 3" : undefined}
        filter={on ? "url(#apm-glow)" : undefined}
      />
      <circle cx={x + 10} cy={y + 12} r={2.5} fill={color} />
      <text x={x + 18} y={y + 15} fontSize={8.5} fill="#9aa3b5">
        {title}
      </text>
      <text x={x + 10} y={y + h / 2 + 6} fontSize={13} fontWeight={700} fill={valColor} fontFamily="ui-monospace, monospace">
        {value}
      </text>
      <text x={x + 10} y={y + h - 7} fontSize={8} fill={C.sub}>
        {sub}
      </text>
    </g>
  );
}

function PosCard({ p, x, y, onClick }: { p: OpenPositionItem; x: number; y: number; onClick?: () => void }) {
  const color = p.side === "LONG" ? C.lime : C.red;
  const roiColor = p.roi == null ? C.sub : p.roi >= 0 ? C.lime : C.red;
  const sym = p.symbol.replace(/USDT$/, "");
  const lev = p.leverage != null ? ` · x${p.leverage}` : "";
  const pnl = p.pnlUsd == null ? "—" : `${p.pnlUsd >= 0 ? "+" : ""}${p.pnlUsd.toFixed(2)}`;
  return (
    <g onClick={onClick} style={{ cursor: "pointer" }}>
      <title>{`${sym} ${p.side}${lev} · ROI ${fmtN(p.roi)}% · ${p.ageH.toFixed(1)}h`}</title>
      <rect x={x} y={y} width={NW} height={PH} rx={9} fill={C.card} stroke={color} strokeOpacity={0.85} filter="url(#apm-glow)" />
      <circle cx={x + 10} cy={y + 12} r={2.5} fill={color} />
      <text x={x + 18} y={y + 15} fontSize={8.5} fontWeight={600} fill={C.text}>
        {`${sym} · ${p.side}${lev}`}
      </text>
      <text x={x + 10} y={y + 38} fontSize={13} fontWeight={700} fill={roiColor} fontFamily="ui-monospace, monospace">
        {p.roi == null ? "—" : `${p.roi >= 0 ? "+" : ""}${p.roi.toFixed(2)}%`}
      </text>
      <text x={x + NW - 10} y={y + 38} textAnchor="end" fontSize={8} fill={C.sub}>
        {`ROI · ${p.ageH.toFixed(1)}h`}
      </text>
      <text x={x + 10} y={y + 54} fontSize={8} fill={C.sub}>
        {`Entry ${fmtN(p.entryPrice, 4)} · Mark ${fmtN(p.markPrice, 4)}`}
      </text>
      <text x={x + 10} y={y + 68} fontSize={8} fill={C.sub}>
        {`SL ${fmtN(p.slPct)}% · TP ${fmtN(p.tpPct)}%`}
      </text>
      <text x={x + 10} y={y + 82} fontSize={8} fill={C.sub}>
        {`to SL ${fmtN(p.distSlPct)}% · to TP ${fmtN(p.distTpPct)}%`}
      </text>
      <text x={x + 10} y={y + 95} fontSize={8} fill={C.sub}>
        {`PnL ${pnl} USD · Margin ${fmtN(p.marginUsd)}`}
      </text>
    </g>
  );
}

function normalizePositions(f: ApmFlowCounts): OpenPositionItem[] {
  if (Array.isArray(f.openPositions) && f.openPositions.length) return f.openPositions;
  if (Array.isArray(f.open)) return f.open;
  return f.open ? [f.open] : [];
}

export function ApmFlowMap({
  f,
  onNodeClick,
  onSelectPosition,
}: {
  lang: Lang;
  f: ApmFlowCounts;
  onNodeClick?: (id: string) => void;
  onSelectPosition?: (index: number) => void;
}) {
  const all = normalizePositions(f);
  const shown = all.slice(0, MAX_POS);
  const extra = all.length - shown.length;
  const hasPos = shown.length > 0;
  const gateOn = f.gatePass > 0;
  const tradesOn = f.tradesTotal > 0;
  const scanStale = f.scanAgeMin != null && f.scanAgeMin > 6;
  const outOn = [f.tp > 0, f.sl > 0, f.flip + f.manual > 0];
  const outColor = [C.lime, C.red, C.amber];

  const colA = [
    { id: "st-universe", title: "Universe pool", value: `${f.universePool}`, sub: "staples + trend universe", color: C.cyan, on: false, dashed: false, valColor: C.text },
    { id: "st-universe", title: "Published top", value: `${f.publishedTop}`, sub: `${f.uptrend} in uptrend`, color: C.blue, on: false, dashed: false, valColor: C.text },
    {
      id: "st-dock",
      title: "Scan combos",
      value: `${f.scanCombos}`,
      sub: scanStale ? `last scan ${f.scanAgeMin}m ago · 1h signal` : "1h signal · fresh",
      color: C.violet,
      on: !scanStale && f.scanCombos > 0,
      dashed: false,
      valColor: C.text,
    },
    { id: "st-dock", title: "Gate passed", value: `${f.gatePass}`, sub: "recent window · matches auto engine", color: gateOn ? C.lime : C.grey, on: gateOn, dashed: false, valColor: gateOn ? C.lime : C.sub },
    { id: "st-dock", title: "Skipped", value: `${f.neutral}`, sub: "NEUTRAL · filtered out", color: C.grey, on: false, dashed: true, valColor: C.sub },
  ];

  const colC = [
    { id: "st-hist", title: "Completed trades", value: `${f.tradesTotal}`, sub: `${f.closedTrades} closed · ${all.length} open`, color: tradesOn ? C.lime : C.grey, on: tradesOn, valColor: C.text },
    { id: "st-hist", title: "TP / Trail TP", value: `${f.tp}`, sub: "take-profit exits", color: C.lime, on: f.tp > 0, valColor: C.lime },
    { id: "st-hist", title: "SL / Trail SL", value: `${f.sl}`, sub: "stop-loss exits", color: C.red, on: f.sl > 0, valColor: C.red },
    { id: "st-hist", title: "Flip / Manual", value: `${f.flip + f.manual}`, sub: `flip ${f.flip} · manual ${f.manual}`, color: C.amber, on: f.flip + f.manual > 0, valColor: C.amber },
  ];

  const aiNodes = [
    { id: "st-autopsy", title: "Trade autopsy · AI", value: `${f.closedTrades}`, sub: "review closed trades", color: C.red },
    { id: "st-evo", title: "Strategy evolution · AI", value: "Proposal", sub: "suggest only · needs approval", color: C.blue },
    { id: "st-param", title: "param_values · AI", value: "Refresh", sub: "reload validated parameters", color: C.cyan },
    { id: "st-root", title: "Root-cause monitor", value: "Monitor", sub: "diagnose only · no auto-edit", color: C.violet },
  ];

  const gateMid = rowY(3) + NH / 2;
  const tradeMid = rowY(0) + NH / 2;
  const pMid = (j: number) => posY(j) + PH / 2;
  const posRows = hasPos ? shown.length : 1;
  const posBottom = posY(posRows - 1) + (hasPos ? PH : NH) + (extra > 0 ? 16 : 0);
  const contentBottom = Math.max(rowY(4) + NH, posBottom, rowY(3) + NH);
  const AI_Y = contentBottom + AI_GAP;
  const H = AI_Y + AI_H + 40;
  const colCBottom = rowY(3) + NH;

  const warn = f.gatePass === 0 && (f.tradesTotal > 0 || all.length > 0);

  return (
    <div className="w-full">
      <style>{`
        @keyframes apmFlow { to { stroke-dashoffset: -24; } }
        .apm-flow { animation: apmFlow 1.2s linear infinite; }
        @media (prefers-reduced-motion: reduce) { .apm-flow { animation: none; } }
      `}</style>

      {warn && (
        <div className="mb-3 rounded-lg border border-amber-300/30 bg-amber-300/5 px-3 py-2 text-[11px] text-amber-300">
          Mismatch: gate = 0 but {f.tradesTotal} trades and {all.length} open positions exist.
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-white/5 bg-[#0b0e14]">
        <svg viewBox={`0 0 ${W} ${H}`} className="block w-full min-w-[720px]" role="img" aria-label="Trading flow map">
          <defs>
            <filter id="apm-glow" x="-40%" y="-40%" width="180%" height="180%">
              <feGaussianBlur stdDeviation="2.4" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <pattern id="apm-grid" width="28" height="28" patternUnits="userSpaceOnUse">
              <path d="M 28 0 L 0 0 0 28" fill="none" stroke="#1a2230" strokeWidth="0.6" />
            </pattern>
          </defs>
          <rect width={W} height={H} fill="url(#apm-grid)" opacity={0.5} />

          {/* Scan chain */}
          {[0, 1, 2, 3].map((i) => (
            <Line key={`chain${i}`} d={`M ${COL_A + NW / 2} ${rowY(i) + NH} V ${rowY(i + 1)}`} color={C.blue} w={strokeW(f.scanCombos, true)} on />
          ))}
          <Line d={`M ${COL_A + NW / 2} ${rowY(3) + NH} V ${rowY(4)}`} color={C.grey} w={1.1} dashed op={0.6} />
          <Pill x={COL_A + NW / 2} y={(rowY(3) + NH + rowY(4)) / 2} text={`skipped ${f.neutral}`} color={C.grey} />

          {/* Gate → positions */}
          {(hasPos ? shown : [null]).map((_, j) => (
            <Line
              key={`gate${j}`}
              d={curve(COL_A + NW, gateMid, COL_B, hasPos ? pMid(j) : posY(0) + NH / 2)}
              color={gateOn ? C.cyan : C.violet}
              w={strokeW(f.gatePass, gateOn)}
              on={gateOn}
              dashed={!gateOn}
              op={gateOn ? 0.95 : 0.45}
            />
          ))}
          <Pill x={(COL_A + NW + COL_B) / 2} y={(gateMid + pMid(0)) / 2} text={`gate ${f.gatePass}`} color={gateOn ? C.cyan : C.grey} />

          {/* Positions → completed trades */}
          {(hasPos ? shown : [null]).map((_, j) => (
            <Line
              key={`pos${j}`}
              d={curve(COL_B + NW, hasPos ? pMid(j) : posY(0) + NH / 2, COL_C, tradeMid)}
              color={tradesOn ? C.lime : C.grey}
              w={strokeW(f.tradesTotal, tradesOn)}
              on={tradesOn}
              dashed={!tradesOn}
              op={tradesOn ? 0.9 : 0.4}
            />
          ))}
          <Pill x={(COL_B + NW + COL_C) / 2} y={(pMid(0) + tradeMid) / 2} text={`completed ${f.tradesTotal}`} color={tradesOn ? C.lime : C.grey} />

          {/* Completed → outcome bus */}
          <Line d={`M ${COL_C - 14} ${tradeMid} V ${rowY(3) + NH / 2}`} color={C.grey} w={1.1} op={0.7} />
          <Line d={`M ${COL_C - 14} ${tradeMid} H ${COL_C}`} color={tradesOn ? C.lime : C.grey} w={strokeW(f.tradesTotal, tradesOn)} on={tradesOn} />
          {[1, 2, 3].map((i) => (
            <Line
              key={`out${i}`}
              d={`M ${COL_C - 14} ${rowY(i) + NH / 2} H ${COL_C}`}
              color={outColor[i - 1]}
              w={strokeW([f.tp, f.sl, f.flip + f.manual][i - 1], outOn[i - 1])}
              on={outOn[i - 1]}
              dashed={!outOn[i - 1]}
              op={outOn[i - 1] ? 0.9 : 0.4}
            />
          ))}

          {/* Outcomes → AI loop */}
          <Line d={`M ${COL_C + NW / 2} ${colCBottom} V ${AI_Y - 26} H ${AI_X[0] + AI_W / 2} V ${AI_Y}`} color={C.cyan} w={1.6} on op={0.7} />
          <Pill x={450} y={AI_Y - 26} text="outcomes → AI loop" color={C.cyan} />

          {/* AI chain 1 → 2 → 3 → 4 */}
          {[0, 1, 2].map((i) => (
            <Line key={`ai${i}`} d={`M ${AI_X[i] + AI_W} ${AI_Y + AI_H / 2} H ${AI_X[i + 1]}`} color={C.cyan} w={1.8} on />
          ))}

          {/* Feedback AI → gate */}
          <Line d={`M ${AI_X[3] + AI_W / 2} ${AI_Y + AI_H} V ${H - 12} H 8 V ${gateMid} H ${COL_A}`} color={C.cyan} w={1.6} on op={0.8} />
          <Pill x={450} y={H - 12} text="feedback → gate" color={C.cyan} />

          {/* Column A nodes */}
          {colA.map((n, i) => (
            <Node
              key={`na${i}`}
              x={COL_A}
              y={rowY(i)}
              title={n.title}
              value={n.value}
              sub={n.sub}
              color={n.color}
              valColor={n.valColor}
              on={n.on}
              dashed={n.dashed}
              onClick={() => onNodeClick?.(n.id)}
            />
          ))}

          {/* Open positions */}
          {hasPos ? (
            shown.map((p, j) => (
              <PosCard key={`pc${p.id ?? p.symbol}${j}`} p={p} x={COL_B} y={posY(j)} onClick={() => onSelectPosition?.(j)} />
            ))
          ) : (
            <Node x={COL_B} y={posY(0)} h={NH} title="Open positions" value="0" sub="no open position" color={C.grey} valColor={C.sub} dashed />
          )}
          {extra > 0 && (
            <text x={COL_B + NW / 2} y={posY(shown.length - 1) + PH + 12} textAnchor="middle" fontSize={8} fill={C.sub}>
              {`+${extra} more open`}
            </text>
          )}

          {/* Column C nodes */}
          {colC.map((n, i) => (
            <Node
              key={`nc${i}`}
              x={COL_C}
              y={rowY(i)}
              title={n.title}
              value={n.value}
              sub={n.sub}
              color={n.color}
              valColor={n.valColor}
              on={n.on}
              onClick={() => onNodeClick?.(n.id)}
            />
          ))}

          {/* AI nodes */}
          {aiNodes.map((n, i) => (
            <Node
              key={`nai${i}`}
              x={AI_X[i]}
              y={AI_Y}
              w={AI_W}
              h={AI_H}
              title={n.title}
              value={n.value}
              sub={n.sub}
              color={n.color}
              on
              onClick={() => onNodeClick?.(n.id)}
            />
          ))}
        </svg>
      </div>
    </div>
  );
}
