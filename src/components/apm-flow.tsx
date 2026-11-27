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
  trail: number;
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
const NH = 64;
const GAP = 14;
const TOP = 52;
const PH = 56;
const PGAP = 12;
const MAX_POS = 6;
const AI_H = 64;
const AI_GAP = 56;
const COL_A = 16;
const COL_B = 350;
const COL_C = 684;
const AI_STEP = (W - 32 - NW * 4) / 3 + NW;
const AI_X = [0, 1, 2, 3].map((i) => 16 + i * AI_STEP);

type NodeDef = {
  id: string;
  title: string;
  value: string;
  sub: string;
  color: string;
  valColor?: string;
  dashed?: boolean;
};

const strokeW = (n: number, on: boolean) =>
  on ? Math.min(5, 1.6 + Math.log10(n + 1) * 1.8) : 1.2;

const curve = (x1: number, y1: number, x2: number, y2: number) => {
  const dx = x2 - x1;
  return `M ${x1} ${y1} C ${x1 + dx * 0.5} ${y1}, ${x2 - dx * 0.5} ${y2}, ${x2} ${y2}`;
};

function Line({
  d,
  color,
  w,
  dashed = false,
  flow = false,
  op = 1,
  neon = false,
  pulse = false,
}: {
  d: string;
  color: string;
  w: number;
  dashed?: boolean;
  flow?: boolean;
  op?: number;
  neon?: boolean;
  pulse?: boolean;
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
      strokeDasharray={dashed ? "5 5" : undefined}
      className={[flow ? "apm-flow" : "", pulse ? "apm-pulse" : ""].filter(Boolean).join(" ") || undefined}
      filter={neon ? "url(#apmNeonLine)" : undefined}
    />
  );
}

/** <defs> chung cho hiệu ứng neon — đặt 1 lần trong <svg> (định nghĩa lại mỗi
 *  render là rẻ, id phải duy nhất trong trang vì chỉ 1 flow map mỗi view). */
function NeonDefs() {
  return (
    <defs>
      {/* viền node phát sáng: halo blur + giữ nét gốc trên cùng */}
      <filter id="apmNeon" x="-75%" y="-75%" width="250%" height="250%">
        <feGaussianBlur stdDeviation="4.5" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
      {/* dây tín hiệu phát sáng nhẹ — dùng cho dây có dòng chảy (flow) */}
      <filter id="apmNeonLine" x="-75%" y="-75%" width="250%" height="250%">
        <feGaussianBlur stdDeviation="2.6" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
      {/* quầng mềm phía sau card (neon tube) — chỉ blur, lớp dưới cùng */}
      <filter id="apmHalo" x="-75%" y="-75%" width="250%" height="250%">
        <feGaussianBlur stdDeviation="11" />
      </filter>
    </defs>
  );
}

function Pill({ x, y, text, color }: { x: number; y: number; text: string; color: string }) {
  const w = Math.max(64, text.length * 6.2 + 14);
  return (
    <g>
      <rect x={x - w / 2} y={y - 9} width={w} height={18} rx={9} fill={C.bg} stroke={color} strokeOpacity={0.6} />
      <text x={x} y={y + 3.5} textAnchor="middle" fontSize={10} fill={color}>
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
  valColor,
  dashed = false,
  neon = false,
  pulse = false,
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
  valColor: string;
  dashed?: boolean;
  neon?: boolean;
  pulse?: boolean;
  onClick?: () => void;
}) {
  return (
    <g onClick={onClick} style={{ cursor: onClick ? "pointer" : "default" }}>
      <title>{`${title} — ${value} · ${sub}`}</title>
      {neon && (
        <rect
          x={x}
          y={y}
          width={w}
          height={h}
          rx={10}
          fill={color}
          opacity={0.5}
          className={pulse ? "apm-pulse" : undefined}
          filter="url(#apmHalo)"
        />
      )}
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={10}
        fill={C.card}
        stroke={neon ? color : dashed ? color : C.edge}
        strokeOpacity={neon ? 0.95 : dashed ? 0.6 : 1}
        strokeDasharray={dashed ? "4 3" : undefined}
        filter={neon ? "url(#apmNeon)" : undefined}
      />
      <circle cx={x + 12} cy={y + 14} r={3} fill={color} />
      <text x={x + 22} y={y + 17} fontSize={10.5} fill="#9aa3b5">
        {title}
      </text>
      <text
        x={x + 12}
        y={y + h / 2 + 7}
        fontSize={17}
        fontWeight={700}
        fill={valColor}
        fontFamily="ui-monospace, SFMono-Regular, monospace"
      >
        {value}
      </text>
      <text x={x + 12} y={y + h - 9} fontSize={9.5} fill={C.sub}>
        {sub}
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
  lang,
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

  const colA: NodeDef[] = [
    { id: "st-universe", title: t(lang, "apm.node.universe"), value: `${f.universePool}`, sub: "Universe · staples + trend", color: C.cyan },
    { id: "st-universe", title: t(lang, "apm.node.published"), value: `${f.publishedTop}`, sub: `${f.uptrend} uptrend`, color: C.blue },
    {
      id: "st-dock",
      title: t(lang, "apm.node.scan"),
      value: `${f.scanCombos}`,
      sub: scanStale ? `${f.scanAgeMin}m ago · 1h signals` : "1h signals",
      color: C.violet,
    },
    {
      id: "st-dock",
      title: t(lang, "apm.node.gate"),
      value: Number.isFinite(f.gatePass) ? `${f.gatePass}` : "—",
      sub: "Passed gate · matches auto engine",
      color: gateOn ? C.lime : C.grey,
      valColor: gateOn ? C.lime : C.sub,
    },
    { id: "st-dock", title: t(lang, "apm.node.skipped"), value: `${f.neutral}`, sub: "NEUTRAL / noise", color: C.grey, valColor: C.sub, dashed: true },
  ];

  const colC: NodeDef[] = [
    { id: "st-hist", title: t(lang, "apm.node.trades"), value: `${f.tradesTotal}`, sub: `${f.closedTrades} closed`, color: tradesOn ? C.lime : C.grey, valColor: C.text },
    { id: "st-hist", title: t(lang, "apm.node.tp"), value: `${f.tp}`, sub: "Take profit", color: C.lime, valColor: C.lime },
    { id: "st-hist", title: t(lang, "apm.node.sl"), value: `${f.sl}`, sub: "Stop loss", color: C.red, valColor: C.red },
    { id: "st-hist", title: "Trail", value: `${f.trail ?? 0}`, sub: "Trailing stop", color: C.cyan, valColor: C.cyan },
    { id: "st-hist", title: t(lang, "apm.node.flip"), value: `${f.flip + f.manual}`, sub: `flip ${f.flip} · manual ${f.manual}`, color: C.amber, valColor: C.amber },
  ];

  const aiNodes: NodeDef[] = [
    { id: "st-autopsy", title: "Trade autopsy · AI", value: `${f.closedTrades}`, sub: "Review closed trades", color: C.red },
    { id: "st-evo", title: "Strategy proposals · AI", value: "Propose", sub: "Needs approval", color: C.blue },
    { id: "st-param", title: "Parameters · AI", value: "Refresh", sub: "Load proven parameters", color: C.cyan },
    { id: "st-root", title: "Root cause", value: "Monitor", sub: "Diagnose only, never auto-fix", color: C.violet },
  ];

  const aY = (i: number) => TOP + i * (NH + GAP);
  const cY = (i: number) => TOP + i * (NH + GAP);
  const pY = (j: number) => TOP + j * (PH + PGAP);
  const pMid = (j: number) => pY(j) + PH / 2;
  const gateMid = aY(3) + NH / 2;
  const tradeMid = cY(0) + NH / 2;

  const posRows = hasPos ? shown.length : 1;
  const posBottom = TOP + posRows * PH + (posRows - 1) * PGAP + (extra > 0 ? 18 : 0);
  const colABottom = aY(4) + NH;
  const colCBottom = cY(3) + NH;
  const contentBottom = Math.max(colABottom, posBottom, colCBottom);
  const AI_Y = contentBottom + AI_GAP;
  const H = AI_Y + AI_H + 44;

  const outColor = [C.lime, C.red, C.cyan, C.amber];
  const outN = [f.tp, f.sl, f.trail ?? 0, f.flip + f.manual];
  const outOn = [f.tp > 0, f.sl > 0, (f.trail ?? 0) > 0, f.flip + f.manual > 0];

  const warn = f.gatePass === 0 && (f.tradesTotal > 0 || all.length > 0);

  return (
    <div className="w-full">
      <style>{`
        @keyframes apmFlow { to { stroke-dashoffset: -20; } }
        .apm-flow { animation: apmFlow 1.2s linear infinite; }
        @keyframes apmPulse { from { opacity: 0.55; } to { opacity: 1; } }
        .apm-pulse { animation: apmPulse 1.6s ease-in-out infinite alternate; }
        @media (prefers-reduced-motion: reduce) { .apm-flow, .apm-pulse { animation: none; } }
      `}</style>

      {warn && (
        <div className="mb-3 rounded-lg border border-amber-300/30 bg-amber-300/5 px-3 py-2 text-xs text-amber-300">
          Mismatch: gate = 0 but {f.tradesTotal} trades and {all.length} positions already exist.
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-white/5 bg-[#0b0e14]">
        <svg viewBox={`0 0 ${W} ${H}`} className="block w-full min-w-[720px]" role="img" aria-label="Trading flow map">
          <NeonDefs />
          {/* Cột A: chuỗi quét, gate, skipped nhánh nhạt */}
          {[0, 1, 2].map((i) => (
            <Line key={`a${i}`} d={`M ${COL_A + NW / 2} ${aY(i) + NH} V ${aY(i + 1)}`} color={C.grey} w={strokeW(f.scanCombos, true)} flow />
          ))}
          <Line d={`M ${COL_A + NW / 2} ${aY(3) + NH} V ${aY(4)}`} color={C.grey} w={1.2} dashed op={0.6} />
          <Pill x={COL_A + NW / 2} y={(aY(3) + NH + aY(4)) / 2} text={`skip ${f.neutral}`} color={C.grey} />

          {/* Gate → từng vị thế */}
          {(hasPos ? shown : [null]).map((_, j) => (
            <Line
              key={`g${j}`}
              d={curve(COL_A + NW, gateMid, COL_B, pMid(j))}
              color={gateOn ? C.cyan : C.violet}
              w={strokeW(f.gatePass, gateOn)}
              dashed={!gateOn}
              flow={gateOn}
              op={gateOn ? 0.95 : 0.45}
              neon={gateOn}
            />
          ))}
          <Pill x={(COL_A + NW + COL_B) / 2} y={(gateMid + pMid(0)) / 2} text={`gate ${f.gatePass}`} color={gateOn ? C.cyan : C.grey} />

          {/* Vị thế → Trades */}
          {(hasPos ? shown : [null]).map((_, j) => (
            <Line
              key={`p${j}`}
              d={curve(COL_B + NW, pMid(j), COL_C, tradeMid)}
              color={tradesOn ? C.lime : C.grey}
              w={strokeW(f.tradesTotal, tradesOn)}
              dashed={!tradesOn}
              flow={tradesOn}
              op={tradesOn ? 0.9 : 0.4}
              neon={tradesOn}
            />
          ))}
          <Pill x={(COL_B + NW + COL_C) / 2} y={(pMid(0) + tradeMid) / 2} text={`opened ${f.tradesTotal}`} color={tradesOn ? C.lime : C.grey} />

          {/* Cột C: trục nhánh kết quả */}
          <Line d={`M ${COL_C - 14} ${tradeMid} V ${cY(3) + NH / 2}`} color={C.grey} w={1.2} op={0.7} />
          {[1, 2, 3].map((i) => (
            <Line
              key={`o${i}`}
              d={`M ${COL_C - 14} ${cY(i) + NH / 2} H ${COL_C}`}
              color={outColor[i - 1]}
              w={strokeW(outN[i - 1], outOn[i - 1])}
              flow={outOn[i - 1]}
              op={outOn[i - 1] ? 0.9 : 0.4}
              neon={outOn[i - 1]}
              dashed={!outOn[i - 1]}
            />
          ))}

          {/* Kết quả → vòng AI */}
          <Line
            d={`M ${COL_C + NW / 2} ${colCBottom} V ${AI_Y - 26} H ${AI_X[0] + NW / 2} V ${AI_Y}`}
            color={C.cyan}
            w={1.6}
            flow
            op={0.7}
            neon
            pulse
          />
          <Pill x={450} y={AI_Y - 26} text="results → AI loop" color={C.cyan} />

          {/* Chuỗi AI 1 → 2 → 3 → 4 */}
          {[0, 1, 2].map((i) => (
            <Line
              key={`ai${i}`}
              d={`M ${AI_X[i] + NW} ${AI_Y + AI_H / 2} H ${AI_X[i + 1]}`}
              color={C.cyan}
              w={2}
              flow
              neon
              pulse
            />
          ))}

          {/* Phản hồi: AI 4 → Gate */}
          <Line
            d={`M ${AI_X[3] + NW / 2} ${AI_Y + AI_H} V ${H - 14} H 8 V ${gateMid} H ${COL_A}`}
            color={C.cyan}
            w={1.6}
            flow
            op={0.8}
            neon
            pulse
          />
          <Pill x={450} y={H - 14} text="feedback → gate" color={C.cyan} />

          {/* Nodes */}
          {colA.map((n, i) => (
            <Node
              key={`na${i}`}
              x={COL_A}
              y={aY(i)}
              title={n.title}
              value={n.value}
              sub={n.sub}
              color={n.color}
              valColor={n.valColor ?? C.text}
              dashed={n.dashed}
              neon={i === 3 && gateOn}
              onClick={() => onNodeClick?.(n.id)}
            />
          ))}

          {hasPos ? (
            shown.map((p, j) => {
              const color = p.side === "LONG" ? C.lime : C.red;
              const roiColor = p.roi == null ? C.sub : p.roi >= 0 ? C.lime : C.red;
              return (
                <g key={`pos${p.id ?? p.symbol}${j}`} onClick={() => onSelectPosition?.(j)} style={{ cursor: "pointer" }}>
                  <title>{`${p.symbol} ${p.side} · ROI ${p.roi == null ? "—" : `${p.roi.toFixed(2)}%`} · ${p.ageH.toFixed(1)}h`}</title>
                  {/* quầng neon theo side: long xanh, short đỏ */}
                  <rect x={COL_B} y={pY(j)} width={NW} height={PH} rx={10} fill={color} opacity={0.32} filter="url(#apmHalo)" />
                  <rect x={COL_B} y={pY(j)} width={NW} height={PH} rx={10} fill={C.card} stroke={color} strokeOpacity={0.55} strokeDasharray="4 3" filter="url(#apmNeon)" />
                  <circle cx={COL_B + 12} cy={pY(j) + 14} r={3} fill={color} />
                  <text x={COL_B + 22} y={pY(j) + 17} fontSize={10.5} fill={C.text}>
                    {p.symbol.replace(/USDT$/, "")} · {p.side}
                  </text>
                  <text x={COL_B + 12} y={pY(j) + 43} fontSize={15} fontWeight={700} fill={roiColor} fontFamily="ui-monospace, monospace">
                    {p.roi == null ? "—" : `${p.roi >= 0 ? "+" : ""}${p.roi.toFixed(2)}%`}
                  </text>
                  <text x={COL_B + NW - 10} y={pY(j) + 43} textAnchor="end" fontSize={9.5} fill={C.sub}>
                    {p.ageH.toFixed(1)}h · ROI
                  </text>
                </g>
              );
            })
          ) : (
            <Node
              x={COL_B}
              y={pY(0)}
              h={PH}
              title="Position"
              value="—"
              sub="No open positions"
              color={C.grey}
              valColor={C.sub}
              dashed
            />
          )}
          {extra > 0 && (
            <text x={COL_B + NW / 2} y={pY(shown.length - 1) + PH + 14} textAnchor="middle" fontSize={10} fill={C.sub}>
              +{extra} more positions
            </text>
          )}

          {colC.map((n, i) => (
            <Node
              key={`nc${i}`}
              x={COL_C}
              y={cY(i)}
              title={n.title}
              value={n.value}
              sub={n.sub}
              color={n.color}
              valColor={n.valColor ?? C.text}
              neon={i === 0 && tradesOn}
              onClick={() => onNodeClick?.(n.id)}
            />
          ))}

          {aiNodes.map((n, i) => (
            <Node
              key={`nai${i}`}
              x={AI_X[i]}
              y={AI_Y}
              h={AI_H}
              title={n.title}
              value={n.value}
              sub={n.sub}
              color={n.color}
              valColor={C.text}
              neon
              pulse
              onClick={() => onNodeClick?.(n.id)}
            />
          ))}
        </svg>
      </div>
    </div>
  );
}
