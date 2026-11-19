"use client";

// ─── ApmFlowMap — Trading Flow Map kiểu APM (0.3.4) ─────────────────────────
// Dựng lại trang /stats theo thiết kế tham chiếu (NetGitFinancial — Dribbble):
// 2 cột node + dải băng (ribbon) cong nối giữa chúng, DÀY THEO SỐ LƯỢNG và
// MÀU THEO TÌNH TRẠNG: xanh lime = Success (lãi/qua cổng), đỏ = Error (SL),
// xám = Normal (bỏ qua/trung tính), đỏ nét đứt = Pending (lệnh đang mở).
//  - Cột trái = phễu quét: Universe → Published top → Scan → Gate pass /
//    Skipped (nối dọc bằng connector nhỏ + bypass cho nhánh bị loại).
//  - Cột phải = sổ lệnh: Trades opened → Open position / TP / SL / Flip.
//  - Băng hero: Gate pass → Trades opened (dải lime dày nhất khi có ứng viên).
//  - Xung điện chạy trên băng (dash trượt — dùng lại keyframes pipe-dash của
//    PipeMap 0.2.85, cùng ngôn ngữ "dòng điện" với nền circuit).
//  - Bấm node → onNodeClick(id) mở trạm tương ứng (accordion cũ → giờ là
//    trang chi tiết section của layout APM).
// Toạ độ cố định, không measure DOM, không random → SSR = client.

import { t, type Lang } from "@/lib/i18n";

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
  open: { symbol: string; side: string; roe: number | null; ageH: number } | null;
}

// ── bảng màu khớp ảnh tham chiếu ──
const LIME = "#c8f542";
const RED = "#f4525c";
const GREY = "#9aa0a6";
const AMBER = "#fbbf24";
const INK = "#15151a";
const EDGE = "#26262c";
const TXT = "#e9e9ec";
const SUB = "#8b8b94";

// ── hình học lưới (viewBox 960×604 — svg scale theo bề rộng, mobile cuộn ngang)
// Kênh băng: băng quạt outcome + bypass Skipped chạy QUANH CỌT node (bulge
// ngoài mép) — không bao giờ bị node che, đúng kiểu băng cong viền của ảnh ref.
const NW = 200; // bề rộng node
const NH = 66; // bề cao node
const COL_A_X = 30; // cột trái 30..230 — chanel bypass bên trái tại x≈12
const COL_B_X = 640; // cột phải 640..840 — kênh bulge phải 868..916
const ROW_Y = [20, 138, 256, 374, 492]; // 5 hàng
const W = 960;
const H = 604;

const cy = (row: number): number => ROW_Y[row] + NH / 2;
const cxL = COL_A_X + NW / 2;
const cxR = COL_B_X + NW / 2;
const edgeR = COL_B_X + NW; // mép phải cột B — nguồn băng quạt outcome

/** độ dày băng theo số lượng: 0 → hairline; còn lại 3..18 theo căn bậc hai */
const thick = (n: number, max: number): number =>
  n <= 0 ? 1.4 : Math.min(18, 3 + 15 * Math.sqrt(n / Math.max(max, 1)));

/** ribbon cubic-bezier giữa 2 điểm — dải fill dày `w` + lõi dash chạy */
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
      {/* xung điện chạy dọc băng — dash tối trên nền sáng tạo cảm giác dòng chảy */}
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

/** ribbon BULGE: rời mép cột, cong ra ngoài (bulgeX) rồi quay vào node đích —
 *  dùng cho quạt outcome (phải) và bypass Skipped (trái) để băng không cắt node */
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
      {!dashed && <path d={core} fill="none" stroke={color} strokeOpacity={0.55} strokeWidth={1.1} />}
      <path
        d={core}
        fill="none"
        stroke="#0b0b0e"
        strokeOpacity={0.5}
        strokeWidth={Math.max(1.4, w * 0.45)}
        strokeDasharray={dashed ? "3 7" : "5 9"}
        className={hot ? "pipe-flow-hot" : "pipe-flow"}
      />
      {dashed && <path d={core} fill="none" stroke={color} strokeOpacity={0.85} strokeWidth={1.2} strokeDasharray="4 5" />}
    </g>
  );
}

/** chip nhãn tình trạng đặt giữa băng (kiểu "Success/Error/Pending" ảnh ref) */
function BandChip({ x, y, color, label }: { x: number; y: number; color: string; label: string }) {
  const w = label.length * 5.4 + 14;
  return (
    <g>
      <rect x={x - w / 2} y={y - 8} width={w} height={16} rx={8} fill="#0b0b0e" fillOpacity={0.92} stroke={color} strokeOpacity={0.55} strokeWidth={0.8} />
      <text x={x} y={y + 3.5} textAnchor="middle" fontSize={8.5} fontWeight={600} fill={color} letterSpacing={0.4}>
        {label}
      </text>
    </g>
  );
}

interface NodeSpec {
  row: number;
  col: "A" | "B";
  id: string;
  title: string;
  value: string;
  sub: string;
  dot: string;
  valColor: string;
  stroke?: string;
  strokeDash?: string;
  glow?: boolean;
}

function FlowNode({ n, onClick }: { n: NodeSpec; onClick: (id: string) => void }) {
  const x = n.col === "A" ? COL_A_X : COL_B_X;
  const y = ROW_Y[n.row];
  return (
    <g
      transform={`translate(${x} ${y})`}
      onClick={() => onClick(n.id)}
      className="cursor-pointer"
      style={{ filter: n.glow ? `drop-shadow(0 0 10px ${n.dot})` : undefined }}
    >
      <rect width={NW} height={NH} rx={13} fill={INK} stroke={n.stroke ?? EDGE} strokeWidth={1} strokeDasharray={n.strokeDash} />
      <circle cx={16} cy={20} r={3.5} fill={n.dot} />
      <text x={26} y={23.5} fontSize={10.5} fontWeight={600} fill={TXT}>
        {n.title}
      </text>
      <text x={16} y={45} fontSize={16} fontWeight={700} fill={n.valColor} fontFamily="var(--font-geist-mono), monospace">
        {n.value}
      </text>
      <text x={16} y={58} fontSize={9} fill={SUB}>
        {n.sub}
      </text>
      <title>{`${n.title} — ${n.value} · ${n.sub}`}</title>
    </g>
  );
}

export function ApmFlowMap({
  lang,
  f,
  onNodeClick,
}: {
  lang: Lang;
  f: ApmFlowCounts;
  onNodeClick?: (id: string) => void;
}) {
  const click = (id: string) => onNodeClick?.(id);
  const maxExit = Math.max(f.tp, f.sl, f.flip, f.manual, 1);
  const hasOpen = !!f.open;

  // ── độ dày các băng ──
  const wGate = thick(f.gatePass, Math.max(f.scanCombos, 1));
  const wOpen = thick(hasOpen ? 1 : 0, 1);
  const wTp = thick(f.tp, maxExit);
  const wSl = thick(f.sl, maxExit);
  const wFlip = thick(f.flip + f.manual, maxExit);
  // giãn điểm xuất phát trên mép phải node Trades opened để 4 băng quạt không
  // đan xen thành búi — mỗi băng chìa từ vùng dọc riêng của node nguồn
  const ySrc = (dy: number): number => cy(0) + dy; // cy(0)=53, node trải 20..86

  // ── node specs ──
  const nodes: NodeSpec[] = [
    { row: 0, col: "A", id: "st-universe", title: t(lang, "apm.node.universe"), value: `${f.universePool}`, sub: "UNIVERSE staples + trend", dot: "#22d3ee", valColor: TXT },
    { row: 1, col: "A", id: "st-universe", title: t(lang, "apm.node.published"), value: `${f.publishedTop}`, sub: `${f.uptrend} uptrend`, dot: "#38bdf8", valColor: TXT },
    {
      row: 2, col: "A", id: "st-dock", title: t(lang, "apm.node.scan"), value: `${f.scanCombos}`,
      sub: f.scanAgeMin != null ? `${f.scanAgeMin}m ago` : "—", dot: "#a78bfa", valColor: TXT,
      glow: f.scanAgeMin != null && f.scanAgeMin <= 5,
    },
    {
      row: 3, col: "A", id: "st-dock", title: t(lang, "apm.node.gate"), value: `${f.gatePass}`,
      sub: t(lang, "apm.node.gate"), dot: LIME, valColor: f.gatePass > 0 ? LIME : SUB,
      stroke: f.gatePass > 0 ? "rgba(200,245,66,0.45)" : undefined, glow: f.gatePass > 0,
    },
    { row: 4, col: "A", id: "st-dock", title: t(lang, "apm.node.skipped"), value: `${f.neutral}`, sub: "NEUTRAL / noise", dot: GREY, valColor: SUB },
    { row: 0, col: "B", id: "st-hist", title: t(lang, "apm.node.trades"), value: `${f.tradesTotal}`, sub: `${f.closedTrades} closed`, dot: "#34d399", valColor: TXT },
    hasOpen && f.open
      ? {
          row: 1, col: "B", id: "st-open",
          title: t(lang, "apm.node.openpos"),
          value: `${f.open.symbol.replace("USDT", "")} ${f.open.side}`,
          sub: `${f.open.ageH.toFixed(1)}h${f.open.roe != null ? ` · ROE ${f.open.roe >= 0 ? "+" : ""}${f.open.roe.toFixed(2)}%` : ""}`,
          dot: RED, valColor: f.open.roe != null ? (f.open.roe >= 0 ? LIME : RED) : TXT,
          stroke: "rgba(244,82,92,0.55)", strokeDash: "5 4", glow: true,
        }
      : {
          row: 1, col: "B", id: "st-open",
          title: t(lang, "apm.node.openpos"), value: "flat",
          sub: t(lang, "apm.flow.flat"), dot: GREY, valColor: SUB,
        },
    { row: 2, col: "B", id: "st-hist", title: t(lang, "apm.node.tp"), value: `${f.tp}`, sub: t(lang, "apm.band.success"), dot: LIME, valColor: LIME, stroke: "rgba(200,245,66,0.3)" },
    { row: 3, col: "B", id: "st-hist", title: t(lang, "apm.node.sl"), value: `${f.sl}`, sub: t(lang, "apm.band.error"), dot: RED, valColor: RED, stroke: "rgba(244,82,92,0.3)" },
    { row: 4, col: "B", id: "st-hist", title: t(lang, "apm.node.flip"), value: `${f.flip + f.manual}`, sub: `flip ${f.flip} · manual ${f.manual}`, dot: AMBER, valColor: AMBER },
  ];

  return (
    <div className="rail-scroll overflow-x-auto">
      <div className="min-w-[780px]">
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="trading flow map">
          {/* ── connector dọc cột trái: phễu chảy xuống ── */}
          {[0, 1, 2].map((r) => (
            <g key={`la-${r}`}>
              <Ribbon x1={cxL} y1={ROW_Y[r] + NH} x2={cxL} y2={ROW_Y[r + 1]} w={4} color={GREY} />
            </g>
          ))}
          {/* bypass Scan → Skipped: nhánh bị loại cong QUANH mép trái (không cắt node) */}
          <BulgeRibbon
            xEdge={COL_A_X} y1={cy(2)} y2={cy(4)} bulgeX={12}
            w={thick(f.neutral, Math.max(f.scanCombos, 1))} color={GREY}
          />
          <BandChip x={46} y={348} color={GREY} label={t(lang, "apm.band.normal")} />
          {/* ── băng hero: Gate pass → Trades opened ── */}
          <Ribbon x1={COL_A_X + NW} y1={cy(3)} x2={COL_B_X} y2={cy(0)} w={wGate} color={LIME} hot={f.gatePass > 0} />
          <BandChip x={435} y={cy(3) * 0.5 + cy(0) * 0.5} color={LIME} label={t(lang, "apm.band.success")} />
          {/* ── quạt Trades opened → Open / TP / SL / Flip: cong quanh mép phải,
              điểm xuất phát giãn dọc (−16/−6/+6/+16) để băng không đan nhau ── */}
          <BulgeRibbon xEdge={edgeR} y1={ySrc(-16)} y2={cy(1)} bulgeX={868} w={wOpen} color={RED} dashed dim={!hasOpen} />
          <BulgeRibbon xEdge={edgeR} y1={ySrc(-6)} y2={cy(2)} bulgeX={884} w={wTp} color={LIME} hot={f.tp > 0} />
          <BulgeRibbon xEdge={edgeR} y1={ySrc(6)} y2={cy(3)} bulgeX={900} w={wSl} color={RED} hot={f.sl > 0} />
          <BulgeRibbon xEdge={edgeR} y1={ySrc(16)} y2={cy(4)} bulgeX={916} w={wFlip} color={AMBER} />
          <BandChip x={868} y={112} color={RED} label={t(lang, "apm.band.pending")} />
          <BandChip x={884} y={171} color={LIME} label={t(lang, "apm.band.success")} />
          <BandChip x={900} y={230} color={RED} label={t(lang, "apm.band.error")} />
          <BandChip x={916} y={289} color={AMBER} label={t(lang, "apm.band.normal")} />
          {/* ── node vẽ CUỐI (đè lên băng tại điểm nối) ── */}
          {nodes.map((n, i) => (
            <FlowNode key={`${n.id}-${i}`} n={n} onClick={click} />
          ))}
        </svg>
      </div>
    </div>
  );
}
