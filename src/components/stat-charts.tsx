"use client";

// ─── Biểu đồ SVG cho trang /stats — 0.2.68, nâng cấp hover 0.2.91 ────────────
// KHÔNG thêm chart library: line/bars vẽ SVG tay, stack/timeline dùng div %.
// Mọi chart bọc trong ChartBox có tooltip hover (giống field) giải thích cách
// đọc — đúng yêu cầu "rê chuột vào hiện hint". Màu theo cùng quy ước tone của
// trang: emerald = tốt/lãi, rose = xấu/lỗ, amber = chú ý, zinc = trung tính.
//
// 0.2.91 — "rê chuột để xem chi tiết": MỖI cột/điểm/đoạn có tooltip riêng
// (React state — chạy cả cảm ứng qua tap) hiện label + giá trị + các dòng
// `sub` do server tính sẵn (số lệnh, net ROI, phía, kiểu đóng, thời điểm…).
// Tooltip đặt BÊN TRONG khung chart (top) nên không đè lên hint của ChartBox
// (hint vẫn nằm phía trên khung).

import type { Lang } from "@/lib/i18n";
import { SESSIONS } from "@/lib/market";
import type { StatChart } from "@/lib/stats";
import { Fragment, useEffect, useState } from "react";

/** màu cố định cho từng nhãn stack — khớp quy ước LONG xanh / SHORT đỏ của app */
const STACK_HUE: Record<string, string> = {
  win: "#34d399", tp: "#34d399", long: "#34d399",
  loss: "#fb7185", sl: "#fb7185", short: "#fb7185",
  trail: "#fbbf24", flip: "#fbbf24",
  manual: "#71717a", flat: "#71717a", neutral: "#71717a",
};
const hueOf = (label: string): string => STACK_HUE[label.toLowerCase()] ?? "#22d3ee";

const SESSION_HUE: Record<string, string> = {
  sydney: "#22d3ee", tokyo: "#a78bfa", london: "#f59e0b", newyork: "#34d399",
};
const SESSION_LABEL: Record<string, string> = {
  sydney: "Sydney", tokyo: "Tokyo", london: "London", newyork: "New York",
};

/** khung tooltip — hiện bằng REACT STATE (mouseenter/mouseleave + tap), KHÔNG
 *  dùng CSS :hover: Tailwind 4 bọc group-hover trong @media (hover:hover) nên
 *  trên thiết bị cảm ứng/headless variant bị tắt — state thì chạy mọi nơi. */
function TipBox({ text }: { text: string }) {
  return (
    <div className="pointer-events-none absolute bottom-full left-0 z-50 mb-1 w-64 rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-[10px] leading-snug text-zinc-300 shadow-xl">
      {text}
    </div>
  );
}

/** (0.2.91) tooltip chi tiết TỪNG phần tử chart — nằm trong khung, định vị
 *  theo % chiều ngang của phần tử đang hover, kẹp biên để không tràn khung. */
function ItemTip({
  label,
  value,
  sub,
  leftPct,
  valueClass = "text-cyan-300",
}: {
  label: string;
  value: string;
  sub?: string[];
  leftPct: number;
  valueClass?: string;
}) {
  const left = Math.min(Math.max(leftPct, 15), 85);
  return (
    <div
      className="pointer-events-none absolute top-1 z-40 w-44 -translate-x-1/2 rounded-md border border-zinc-700 bg-zinc-900/95 px-2 py-1.5 text-[10px] leading-snug shadow-xl"
      style={{ left: `${left}%` }}
    >
      <p className="whitespace-normal leading-snug font-mono font-bold text-zinc-100">{label}</p>
      <p className={`font-mono text-[11px] font-bold ${valueClass}`}>{value}</p>
      {sub
        ?.filter(Boolean)
        .map((s, i) => (
          <p key={i} className="font-mono text-[9.5px] text-zinc-400">
            {s}
          </p>
        ))}
    </div>
  );
}


function TableChart({ chart }: { chart: Extract<StatChart, { kind: "table" }> }) {
  const isDay = chart.columns.at(0) === "Day";
  const title = isDay ? "By day" : "By hour";
  const [openDay, setOpenDay] = useState<string | null>(null);
  const isPnlCol = (ci: number) => ci >= 3;
  const colorOf = (cell: string) => {
    if (cell.startsWith("+")) return "text-emerald-400";
    if (cell.startsWith("-")) return "text-rose-400";
    return "text-zinc-400";
  };
  return (
    <div className="overflow-x-auto">
      <p className="mb-1.5 font-mono text-sm font-bold text-zinc-200">{title} - Trade history, PNL % and PNL $ {isDay ? "(click a day to see its hours)" : ""}</p>
      <table className="w-full text-left font-mono text-xs leading-tight">
        <thead><tr>{chart.columns.map((c, i) => (<th key={i} className="border-b border-zinc-800 px-2 py-1 text-xs font-medium text-zinc-400">{c}</th>))}</tr></thead>
        <tbody>
          {chart.rows.map((row, ri) => {
            const day = row.at(0) ?? "";
            const detailRows = isDay && chart.details ? chart.details[day] : undefined;
            const isOpen = openDay === day;
            return (
              <Fragment key={ri}>
                <tr onClick={detailRows ? () => setOpenDay(isOpen ? null : day) : undefined} className={detailRows ? "cursor-pointer border-b border-zinc-900 hover:bg-zinc-900/60" : "border-b border-zinc-900"}>
                  {row.map((cell, ci) => (
                    <td key={ci} className={`px-2 py-1 ${isPnlCol(ci) ? colorOf(cell) : "text-zinc-200"}`}>{ci === 0 && detailRows ? (isOpen ? "v " : "> ") : ""}{cell}</td>
                  ))}
                </tr>
                {isOpen && detailRows ? (
                  <tr className="border-b border-zinc-900">
                    <td colSpan={chart.columns.length} className="px-2 py-1">
                      <table className="w-full text-left font-mono text-xs leading-tight">
                        <thead><tr>{chart.columns.map((c, i) => (<th key={i} className="border-b border-zinc-800 px-2 py-1 text-xs font-medium text-zinc-500">{i === 0 ? "Hour" : c}</th>))}</tr></thead>
                        <tbody>{detailRows.map((dRow, di) => (<tr key={di} className="border-b border-zinc-900/60">{dRow.map((cell, ci) => (<td key={ci} className={`px-2 py-1 ${isPnlCol(ci) ? colorOf(cell) : "text-zinc-300"}`}>{cell}</td>))}</tr>))}</tbody>
                      </table>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function ChartBox({ chart, lang }: { chart: StatChart; lang: Lang }) {
  const [show, setShow] = useState(false);
  const text = lang === "vi" ? chart.hintVi ?? chart.hint : chart.hint;
  return (
    <div
      className="relative min-w-0 rounded-md border border-zinc-800/80 bg-zinc-950/50 p-2.5 sm:col-span-2"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      onClick={() => setShow((v) => !v)} // cảm ứng: bấm bật/tắt hint
    >
      {chart.kind === "line" && <LineChart chart={chart} />}
      {chart.kind === "bars" && <BarsChart chart={chart} />}
      {chart.kind === "stack" && <StackChart chart={chart} />}
      {chart.kind === "timeline" && <SessionTimeline />}
      {chart.kind === "table" && <TableChart chart={chart} />}
      {text && show && <TipBox text={text} />}
    </div>
  );
}

// ─── 1. Đường vốn (equity curve) ─────────────────────────────────────────────
function LineChart({ chart }: { chart: Extract<StatChart, { kind: "line" }> }) {
  const [hov, setHov] = useState<number | null>(null);
  const pts = chart.points;
  if (pts.length < 2) return null;
  const W = 600;
  const H = 132;
  const padX = 8;
  const padT = 10;
  const padB = 16; // chừa chỗ nhãn thời gian
  const t0 = pts[0].t;
  const t1 = pts[pts.length - 1].t;
  const vs = pts.map((p) => p.v);
  const vmin = Math.min(...vs);
  const vmax = Math.max(...vs);
  const span = vmax - vmin || 1;
  const x = (tt: number): number => padX + ((tt - t0) / (t1 - t0 || 1)) * (W - padX * 2);
  const y = (v: number): number => padT + (1 - (v - vmin) / span) * (H - padT - padB);
  const path = pts.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(2)},${y(p.v).toFixed(2)}`).join(" ");
  const up = pts[pts.length - 1].v >= pts[0].v;
  const color = up ? "#34d399" : "#fb7185";
  const last = pts[pts.length - 1];
  const fmtT = (tt: number): string =>
    new Date(tt).toLocaleString("en-GB", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-32 w-full" preserveAspectRatio="xMidYMid meet" role="img">
        {/* lưới min/max mờ + nhãn giá trị — nhãn min/max nằm TRÁI để khỏi đè
            nhãn giá trị hiện tại ở góc phải (dính chùm khi curve kết thúc gần đỉnh) */}
        <line x1={padX} y1={y(vmin)} x2={W - padX} y2={y(vmin)} stroke="#3f3f46" strokeDasharray="3 4" strokeWidth="1" />
        <line x1={padX} y1={y(vmax)} x2={W - padX} y2={y(vmax)} stroke="#3f3f46" strokeDasharray="3 4" strokeWidth="1" />
        <text x={padX} y={y(vmax) - 3} fontSize="9" fill="#a1a1aa">${vmax.toFixed(2)}</text>
        <text x={padX} y={y(vmin) + 9} fontSize="9" fill="#a1a1aa">${vmin.toFixed(2)}</text>
        <path d={path} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />
        {pts.map((p, i) => (
          <circle key={i} cx={x(p.t)} cy={y(p.v)} r={i === pts.length - 1 ? 3.5 : 2} fill={color} opacity={i === pts.length - 1 ? 1 : 0.75} />
        ))}
        {/* vùng bắt hover rộng (0.2.91) — chấm nhỏ khó rê chuột */}
        {pts.map((p, i) => (
          <circle
            key={`h${i}`}
            cx={x(p.t)}
            cy={y(p.v)}
            r={9}
            fill="transparent"
            onMouseEnter={() => setHov(i)}
            onMouseLeave={() => setHov(null)}
          />
        ))}
        <text x={padX} y={H - 4} fontSize="8" fill="#71717a">{fmtT(t0)}</text>
        <text x={W - padX} y={H - 4} textAnchor="end" fontSize="8" fill="#71717a">{fmtT(t1)}</text>
        {/* giá trị hiện tại — kẹp trong khung, lệch trái 26px khi chạm mép phải */}
        <text
          x={Math.min(x(last.t), W - padX - 26)}
          y={y(last.v) - 7}
          textAnchor="middle"
          fontSize="10"
          fontWeight="700"
          fill={color}
        >
          ${last.v.toFixed(2)}
        </text>
      </svg>
      {hov != null && pts[hov] && (
        <ItemTip
          label={fmtT(pts[hov].t)}
          value={`$${pts[hov].v.toFixed(2)}`}
          sub={[
            `${pts[hov].v - pts[0].v >= 0 ? "+" : ""}${(pts[hov].v - pts[0].v).toFixed(2)}$ vs first`,
            `${((pts[hov].v / pts[0].v - 1) * 100).toFixed(2)}% cumulative`,
          ]}
          leftPct={(x(pts[hov].t) / W) * 100}
          valueClass={pts[hov].v >= pts[0].v ? "text-emerald-300" : "text-rose-300"}
        />
      )}
    </div>
  );
}

// ─── 2. Cột (PnL từng lệnh / win rate / score) ──────────────────────────────
function BarsChart({ chart }: { chart: Extract<StatChart, { kind: "bars" }> }) {
  const [hov, setHov] = useState<number | null>(null);
  const items = chart.items;
  if (items.length === 0) return null;
  const W = 600;
  const H = 132;
  const padX = 8;
  const padT = 10;
  const padB = items.length <= 10 ? 18 : 10;
  const hasNeg = chart.max == null && items.some((i) => i.v < 0);
  const maxAbs = chart.max != null ? chart.max : Math.max(...items.map((i) => Math.abs(i.v)), 0.0001);
  const plotH = H - padT - padB;
  const zeroY = hasNeg ? padT + plotH / 2 : H - padB;
  const scale = (hasNeg ? plotH / 2 : plotH) / maxAbs;
  const slot = (W - padX * 2) / items.length;
  const bw = Math.max(2, slot - 3);
  const fmtV = (v: number): string =>
    chart.unit === "%" ? `${v >= 0 ? "+" : ""}${v.toFixed(2)}%` : chart.unit === "$" ? `$${v.toFixed(2)}` : v.toFixed(2);
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-32 w-full" preserveAspectRatio="xMidYMid meet" role="img">
        <line x1={padX} y1={zeroY} x2={W - padX} y2={zeroY} stroke="#52525b" strokeWidth="1" />
        {items.map((it, i) => {
          const h = Math.max(1, Math.abs(it.v) * scale);
          const yy = it.v >= 0 ? zeroY - h : zeroY;
          const cx = padX + i * slot + slot / 2;
          return (
            <rect
              key={i}
              x={cx - bw / 2}
              y={yy}
              width={bw}
              height={h}
              rx="1.5"
              fill={it.v >= 0 ? "#34d399" : "#fb7185"}
              opacity={hov === i ? 1 : 0.85}
              onMouseEnter={() => setHov(i)}
              onMouseLeave={() => setHov(null)}
            />
          );
        })}
        {items.length <= 10 &&
          items.map((it, i) => (
            <text
              key={i}
              x={padX + i * slot + slot / 2}
              y={H - 5}
              textAnchor="middle"
              fontSize="8.5"
              fill={hov === i ? "#e4e4e7" : "#71717a"}
            >
              {it.label.length > 9 ? `${it.label.slice(0, 8)}…` : it.label}
            </text>
          ))}
        <text x={padX} y={padT - 2} fontSize="9" fill="#a1a1aa">
          {chart.unit === "%" && chart.max === 100 ? "0–100%" : `max |${fmtV(maxAbs)}|`}
        </text>
      </svg>
      {hov != null && items[hov] && (
        <ItemTip
          label={items[hov].label}
          value={fmtV(items[hov].v)}
          sub={items[hov].sub}
          leftPct={((padX + hov * slot + slot / 2) / W) * 100}
          valueClass={items[hov].v >= 0 ? "text-emerald-300" : "text-rose-300"}
        />
      )}
    </div>
  );
}

// ─── 3. Thanh xếp lớp + chú giải ────────────────────────────────────────────
function StackChart({ chart }: { chart: Extract<StatChart, { kind: "stack" }> }) {
  const [hov, setHov] = useState<string | null>(null);
  const total = chart.items.reduce((a, b) => a + b.n, 0);
  if (total === 0) return <p className="text-[10px] text-zinc-600">— no data yet</p>;
  // vị trí tâm % của từng đoạn (0.2.91) — để tooltip hiện đúng chỗ đang hover
  let acc = 0;
  const centers = chart.items.map((i) => {
    const c = ((acc + i.n / 2) / total) * 100;
    acc += i.n;
    return c;
  });
  const hovItem = chart.items.find((i) => i.label === hov);
  const hovCenter = hov != null ? centers[chart.items.findIndex((i) => i.label === hov)] : null;
  return (
    <div className="relative space-y-1.5">
      <div className="flex h-4 w-full overflow-hidden rounded">
        {chart.items
          .filter((i) => i.n > 0)
          .map((i) => (
            <div
              key={i.label}
              className="h-full"
              style={{
                width: `${(i.n / total) * 100}%`,
                backgroundColor: hueOf(i.label),
                opacity: hov == null || hov === i.label ? 1 : 0.45,
              }}
              onMouseEnter={() => setHov(i.label)}
              onMouseLeave={() => setHov(null)}
            />
          ))}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5">
        {chart.items.map((i) => (
          <span
            key={i.label}
            className={`inline-flex cursor-default items-center gap-1 font-mono text-[10px] ${hov === i.label ? "text-zinc-100" : "text-zinc-400"}`}
            onMouseEnter={() => setHov(i.label)}
            onMouseLeave={() => setHov(null)}
          >
            <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: hueOf(i.label) }} />
            {i.label} · {i.n}
          </span>
        ))}
      </div>
      {hovItem != null && hovCenter != null && (
        <ItemTip
          label={hovItem.label}
          value={`${hovItem.n} / ${total} (${((hovItem.n / total) * 100).toFixed(2)}%)`}
          leftPct={hovCenter}
          valueClass="text-zinc-100"
        />
      )}
    </div>
  );
}

// ─── 4. Timeline 24h của 4 phiên UTC + mốc "now" ────────────────────────────
function SessionTimeline() {
  // lazy init + interval — mount xong mới có snap nên không lo hydration mismatch
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  const nowPct =
    now != null
      ? ((new Date(now).getUTCHours() * 60 + new Date(now).getUTCMinutes()) / 1440) * 100
      : null;
  return (
    <div className="space-y-1">
      {SESSIONS.map((s) => {
        // Sydney wraps midnight (21→06) → tách 2 đoạn 21–24 và 00–06
        const segs = s.from < s.to ? [{ a: s.from, b: s.to }] : [{ a: s.from, b: 24 }, { a: 0, b: s.to }];
        const label = `${SESSION_LABEL[s.key]} ${String(s.from).padStart(2, "0")}–${String(s.to).padStart(2, "0")}h UTC`;
        return (
          <div key={s.key} className="flex items-center gap-2">
            <span className="w-16 shrink-0 text-right text-[9px] uppercase tracking-wide text-zinc-500">
              {SESSION_LABEL[s.key]}
            </span>
            <div className="relative h-3.5 flex-1 rounded-sm bg-zinc-900">
              {segs.map((g, gi) => (
                <div
                  key={gi}
                  className="absolute inset-y-0 rounded-sm"
                  style={{
                    left: `${(g.a / 24) * 100}%`,
                    width: `${((g.b - g.a) / 24) * 100}%`,
                    backgroundColor: SESSION_HUE[s.key],
                    opacity: 0.85,
                  }}
                  title={label}
                />
              ))}
              {nowPct != null && (
                <div
                  className="absolute -inset-y-0.5 z-10 w-px bg-rose-400"
                  style={{ left: `${nowPct}%` }}
                  title="now (UTC)"
                />
              )}
            </div>
          </div>
        );
      })}
      <div className="flex items-center gap-2">
        <span className="w-16 shrink-0" />
        <div className="relative h-3 flex-1 text-[8px] text-zinc-600">
          <span className="absolute left-0">00h</span>
          <span className="absolute -translate-x-1/2" style={{ left: "25%" }}>06</span>
          <span className="absolute -translate-x-1/2" style={{ left: "50%" }}>12</span>
          <span className="absolute -translate-x-1/2" style={{ left: "75%" }}>18</span>
          <span className="absolute right-0">24h UTC</span>
        </div>
      </div>
    </div>
  );
}
