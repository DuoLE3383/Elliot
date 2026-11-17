module.exports = [
"[project]/src/components/price-chart.tsx [app-ssr] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "PriceChart",
    ()=>PriceChart
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/server/route-modules/app-page/vendored/ssr/react-jsx-dev-runtime.js [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/server/route-modules/app-page/vendored/ssr/react.js [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$market$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/market.ts [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$i18n$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/i18n.ts [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$equity$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/equity.ts [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$ui$2f$button$2e$tsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/components/ui/button.tsx [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$minus$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__$3c$export__default__as__Minus$3e$__ = __turbopack_context__.i("[project]/node_modules/lucide-react/dist/esm/icons/minus.js [app-ssr] (ecmascript) <export default as Minus>");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$plus$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__$3c$export__default__as__Plus$3e$__ = __turbopack_context__.i("[project]/node_modules/lucide-react/dist/esm/icons/plus.js [app-ssr] (ecmascript) <export default as Plus>");
"use client";
;
;
;
;
;
;
;
const UP = "#10b981";
const DOWN = "#f43f5e";
const FLIP = "#f59e0b";
const GRID = "#27272a";
const TEXT = "#a1a1aa";
// Wyckoff palette — mirrors the Pine original
const WY_ACC = "#22c55e";
const WY_DIST = "#ef4444";
const WY_PHC = "#a855f7";
const WY_ACC_BAR = "#84cc16"; // barcolor lime
const WY_DIST_BAR = "#a855f7"; // barcolor purple
const WY_PIVOT = "#f97316";
const WY_EMA_F = "#14b8a6"; // teal
const WY_EMA_S = "#ef4444"; // red
// SMA band tolerance around the gate SMA (visual aid: how far price is from the gate)
const BAND_PCT = 0.005;
const wyEventColor = (e)=>e.phaseC ? WY_PHC : e.dir === 1 ? WY_ACC : WY_DIST;
const PAD_L = 8;
const PAD_R = 64;
const PAD_T = 12;
const PAD_B = 26;
const autoBars = (w)=>w < 520 ? 52 : w < 768 ? 76 : 110;
function PriceChart({ klines, sma, signals, papers, openPaper, pending, pinnedIndex, onPin, lang, wyckoff, wyckoffOn, stop, trend, fill = false, candleStyle = "neon", onCandleStyle, livePrice }) {
    const wrapRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useRef"])(null);
    const plotRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useRef"])(null);
    const [width, setWidth] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useState"])(900);
    const [measuredH, setMeasuredH] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useState"])(360);
    const [viewEndRaw, setViewEndRaw] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useState"])(null);
    /** user zoom override — visible bar count (null = auto by width) */ const [bars, setBars] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useState"])(null);
    /** hover crosshair — candle index + cursor y inside the plot */ const [hover, setHover] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useState"])(null);
    const dragRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useRef"])(null);
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useEffect"])(()=>{
        const el = wrapRef.current;
        const plot = plotRef.current;
        if (!el) return;
        const ro = new ResizeObserver((entries)=>{
            for (const en of entries){
                if (en.target === el) {
                    setWidth(Math.max(320, Math.floor(en.contentRect.width)));
                } else if (en.target === plot) {
                    // floor of 160px keeps the plot usable — going lower would overflow the card
                    setMeasuredH(Math.max(160, Math.floor(en.contentRect.height)));
                }
            }
        });
        ro.observe(el);
        if (plot) ro.observe(plot);
        return ()=>ro.disconnect();
    }, []);
    // wheel zoom — native listener (passive: false) so preventDefault works
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useEffect"])(()=>{
        const el = wrapRef.current;
        if (!el) return;
        const onWheel = (e)=>{
            if (!e.deltaY) return;
            e.preventDefault();
            setBars((prev)=>{
                const base = prev ?? autoBars(width);
                const next = e.deltaY > 0 ? base * 1.18 : base / 1.18;
                return Math.max(24, Math.min(340, Math.round(next)));
            });
        };
        el.addEventListener("wheel", onWheel, {
            passive: false
        });
        return ()=>el.removeEventListener("wheel", onWheel);
    }, [
        width
    ]);
    const n = klines.length;
    // Neo view theo THỜI GIAN khi dãy nến trượt (live nối nến mới / nạp đè 500
    // nến sau LIVE_REPAIR_MS): đang xem lịch sử mà mép phải bị “kéo” lệch vài nến
    // sau mỗi tick là chết — bump viewEndRaw theo đúng số nến mép phải đã dịch.
    const anchorRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useRef"])({
        n: 0,
        lastT: 0
    });
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useEffect"])(()=>{
        const prev = anchorRef.current;
        const lastT = n ? klines[n - 1].t : 0;
        anchorRef.current = {
            n,
            lastT
        };
        if (!n || !prev.lastT || lastT <= prev.lastT) return;
        const dt = n >= 2 ? klines[n - 1].t - klines[n - 2].t : 0;
        if (dt <= 0) return;
        const shift = Math.round((lastT - prev.lastT) / dt);
        if (shift > 0) setViewEndRaw((v)=>v == null ? null : Math.min(n - 1, v + shift));
    }, [
        n,
        klines
    ]);
    const winSize = Math.max(20, Math.min(bars ?? autoBars(width), n || 1));
    const viewEnd = Math.min(viewEndRaw ?? n - 1, n - 1);
    const viewStart = Math.max(0, viewEnd - winSize + 1);
    const zoom = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useCallback"])((dir)=>setBars((prev)=>{
            const base = prev ?? autoBars(width);
            const next = dir === 1 ? base / 1.35 : base * 1.35;
            return Math.max(24, Math.min(340, Math.round(next)));
        }), [
        width
    ]);
    const jumpLatest = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useCallback"])(()=>setViewEndRaw(null), []);
    const height = fill ? measuredH : width < 520 ? 280 : 360;
    const plotW = width - PAD_L - PAD_R;
    // ── Equity pane (Đường cong vốn) — a small strip carved out of the plot bottom
    const eq = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useMemo"])(()=>(0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$equity$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["equityFrom"])(papers), [
        papers
    ]);
    const eqOn = eq.points.length >= 2;
    const EQ_PANE = 58;
    const eqPaneH = eqOn ? EQ_PANE : 0;
    const plotH = height - PAD_T - PAD_B - eqPaneH;
    const cw = plotW / Math.max(1, viewEnd - viewStart + 1);
    const { minP, maxP } = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useMemo"])(()=>{
        let lo = Infinity;
        let hi = -Infinity;
        for(let i = viewStart; i <= viewEnd && i < n; i++){
            const k = klines[i];
            if (k.l < lo) lo = k.l;
            if (k.h > hi) hi = k.h;
            const s = sma[i];
            if (s != null && s < lo) lo = s;
            if (s != null && s > hi) hi = s;
            const st = stop?.[i];
            if (st != null && st < lo) lo = st;
            if (st != null && st > hi) hi = st;
        }
        // NOTE: open SL/TP are deliberately NOT part of the scale — a wide 6% SL
        // would squash the candles. Levels are clipped to the plot instead.
        if (openPaper && openPaper.entry >= lo * 0.98 && openPaper.entry <= hi * 1.02) {
            if (openPaper.entry < lo) lo = openPaper.entry;
            if (openPaper.entry > hi) hi = openPaper.entry;
        }
        if (!isFinite(lo) || !isFinite(hi)) return {
            minP: 0,
            maxP: 1
        };
        if (hi === lo) {
            hi += hi * 0.001 || 1;
            lo -= lo * 0.001 || 1;
        }
        const pad = (hi - lo) * 0.06;
        return {
            minP: lo - pad,
            maxP: hi + pad
        };
    }, [
        klines,
        sma,
        stop,
        viewStart,
        viewEnd,
        n,
        openPaper
    ]);
    const x = (i)=>PAD_L + (i - viewStart) * cw + cw / 2;
    const y = (p)=>PAD_T + (maxP - p) / (maxP - minP) * plotH;
    /** inverse of y() — price under the crosshair */ const priceAtY = (py)=>minP + (PAD_T + plotH - py) / plotH * (maxP - minP);
    const onPointerDown = (e)=>{
        dragRef.current = {
            x: e.clientX,
            end: viewEnd
        };
        e.target.setPointerCapture?.(e.pointerId);
    };
    const onPointerMove = (e)=>{
        // hover crosshair (TradingView-style) — always tracked, pan continues on top
        const rect = e.currentTarget.getBoundingClientRect();
        const py = Math.max(PAD_T, Math.min(PAD_T + plotH, e.clientY - rect.top));
        const i = Math.max(viewStart, Math.min(viewEnd, viewStart + Math.floor((e.clientX - rect.left - PAD_L) / cw)));
        setHover((prev)=>prev && prev.i === i && Math.abs(prev.py - py) < 0.5 ? prev : {
                i,
                py
            });
        const d = dragRef.current;
        if (!d) return;
        const shift = Math.round((d.x - e.clientX) / cw);
        const end = Math.min(n - 1, Math.max(winSize - 1, d.end + shift));
        setViewEndRaw(end >= n - 1 ? null : end);
    };
    const onPointerUp = ()=>{
        dragRef.current = null;
    };
    const onPointerLeave = ()=>{
        dragRef.current = null;
        setHover(null);
    };
    // ── Equity pane geometry (Đường cong vốn) ──────────────────────────────
    const eqTop = PAD_T + plotH + 10;
    const eqH = eqPaneH - 16;
    const eqLo = Math.min(eq.trough, 0);
    const eqHi = Math.max(eq.peak, eqLo + 0.5);
    const eqY = (v)=>eqTop + (eqHi - v) / (eqHi - eqLo) * eqH;
    const eqX = (bar)=>Math.max(PAD_L, Math.min(PAD_L + plotW, x(bar)));
    // trades closed up to the viewed bar — the curve stays honest while panning back
    const eqSeen = eqOn ? eq.points.filter((p)=>p.bar <= viewEnd) : [];
    const eqLine = (()=>{
        if (!eqOn || eqH <= 4) return null;
        if (eqSeen.length === 0) {
            const d = `M${PAD_L},${eqY(0).toFixed(1)} L${(PAD_L + plotW).toFixed(1)},${eqY(0).toFixed(1)}`;
            return {
                d,
                area: `${d} Z`,
                endV: 0,
                endY: eqY(0)
            };
        }
        const pts = eqSeen;
        let d = pts[0].bar > viewStart ? `M${PAD_L},${eqY(0).toFixed(1)} L${eqX(pts[0].bar).toFixed(1)},${eqY(pts[0].cum).toFixed(1)}` : `M${eqX(pts[0].bar).toFixed(1)},${eqY(pts[0].cum).toFixed(1)}`;
        for(let k = 1; k < pts.length; k++)d += ` L${eqX(pts[k].bar).toFixed(1)},${eqY(pts[k].cum).toFixed(1)}`;
        const endY = eqY(pts[pts.length - 1].cum);
        d += ` L${(PAD_L + plotW).toFixed(1)},${endY.toFixed(1)}`; // flat extension to "now"
        const area = `${d} L${(PAD_L + plotW).toFixed(1)},${eqY(0).toFixed(1)} L${PAD_L},${eqY(0).toFixed(1)} Z`;
        return {
            d,
            area,
            endV: pts[pts.length - 1].cum,
            endY
        };
    })();
    const sigInView = signals.filter((s)=>s.i >= viewStart && s.i <= viewEnd);
    const eqColor = eqLine ? eqLine.endV >= 0 ? UP : DOWN : UP;
    const papersInView = papers.filter((p)=>p.exitIndex !== undefined ? p.exitIndex >= viewStart || p.entryIndex <= viewEnd : p.entryIndex <= viewEnd);
    // ── Volume profile over the visible window (buy/sell split via taker data) ─
    const vp = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useMemo"])(()=>(0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$market$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["volumeProfile"])(klines, viewStart, viewEnd, 26), [
        klines,
        viewStart,
        viewEnd
    ]);
    const vpW = plotW * 0.16;
    // ── Whale delta histogram over the visible window ────────────────────────
    const whale = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useMemo"])(()=>{
        let maxD = 0;
        const rows = [];
        for(let i = viewStart; i <= viewEnd && i < n; i++){
            const k = klines[i];
            if (k.tb == null || k.v <= 0) continue;
            const d = 2 * k.tb - k.v;
            rows.push({
                i,
                d
            });
            if (Math.abs(d) > maxD) maxD = Math.abs(d);
        }
        return {
            rows,
            maxD
        };
    }, [
        klines,
        viewStart,
        viewEnd,
        n
    ]);
    const whaleH = plotH * 0.2;
    // ── Wyckoff layers (only when enabled) ─────────────────────────────────
    const wyOn = !!wyckoffOn && !!wyckoff;
    const wyBoxes = wyOn ? wyckoff.boxes.filter((b)=>!b.deleted && b.right >= viewStart && b.left <= viewEnd) : [];
    const wyEvents = wyOn ? wyckoff.events.filter((e)=>!e.deleted && e.bar >= viewStart && e.bar <= viewEnd) : [];
    const wyPivots = wyOn ? wyckoff.pivots.filter((p)=>!p.hidden && p.bar >= viewStart && p.bar <= viewEnd) : [];
    const tintOf = (i)=>wyOn ? wyckoff.tints[i] : 0;
    /** polyline path skipping nulls (EMA arrays) */ const linePath = (arr)=>{
        let d = "";
        let pen = false;
        for(let i = viewStart; i <= viewEnd; i++){
            const v = arr[i];
            if (v == null) {
                pen = false;
                continue;
            }
            d += `${pen ? "L" : "M"}${x(i)},${y(v)} `;
            pen = true;
        }
        return d.trim();
    };
    /** SMA ± band filled area — one closed subpath per contiguous SMA run */ const bandPath = ()=>{
        let d = "";
        let top = [];
        let bot = [];
        const flush = ()=>{
            if (top.length >= 2) {
                d += `M${top.join(" L")} L${bot.reverse().join(" L")} Z `;
            }
            top = [];
            bot = [];
        };
        for(let i = viewStart; i <= viewEnd; i++){
            const v = sma[i];
            if (v == null) {
                flush();
                continue;
            }
            top.push(`${x(i)},${y(v * (1 + BAND_PCT))}`);
            bot.push(`${x(i)},${y(v * (1 - BAND_PCT))}`);
        }
        flush();
        return d.trim();
    };
    /** UT trailing-stop segments, colored per trend run */ const stopSegs = ()=>{
        const segs = [];
        let cur = null;
        for(let i = viewStart; i <= viewEnd; i++){
            const v = stop?.[i];
            const tr = trend?.[i] ?? 0;
            if (v == null || tr === 0) {
                cur = null;
                continue;
            }
            const up = tr === 1;
            if (cur && cur.up === up) cur.d += ` L${x(i)},${y(v)}`;
            else {
                cur = {
                    d: `M${x(i)},${y(v)}`,
                    up
                };
                segs.push(cur);
            }
        }
        return segs;
    };
    const timeLabel = (t)=>{
        const d = new Date(t);
        const hh = String(d.getHours()).padStart(2, "0");
        const mm = String(d.getMinutes()).padStart(2, "0");
        return `${d.getDate()}/${d.getMonth() + 1} ${hh}:${mm}`;
    };
    if (n === 0) {
        return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
            ref: wrapRef,
            className: `flex items-center justify-center rounded-lg border border-zinc-800 bg-zinc-950 text-sm text-zinc-500 ${fill ? "h-full" : "h-64"}`,
            children: (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$i18n$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["t"])(lang, "chart.empty")
        }, void 0, false, {
            fileName: "[project]/src/components/price-chart.tsx",
            lineNumber: 367,
            columnNumber: 7
        }, this);
    }
    const gridPrices = Array.from({
        length: 5
    }, (_, k)=>minP + (maxP - minP) * k / 4);
    const openEntryLabel = openPaper?.flippedFrom ? (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$i18n$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["t"])(lang, "chart.line.flipEntry") : (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$i18n$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["t"])(lang, "chart.line.entry");
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
        ref: wrapRef,
        className: `relative flex select-none flex-col ${fill ? "h-full" : ""}`,
        children: [
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                ref: plotRef,
                className: `relative min-h-0 overflow-hidden ${fill ? "flex-1" : ""}`,
                children: [
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("svg", {
                        width: width,
                        height: height,
                        className: "touch-pan-y rounded-lg border border-zinc-800 bg-zinc-950",
                        onPointerDown: onPointerDown,
                        onPointerMove: onPointerMove,
                        onPointerUp: onPointerUp,
                        onPointerLeave: onPointerLeave,
                        role: "img",
                        "aria-label": (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$i18n$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["t"])(lang, "chart.title"),
                        children: [
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("defs", {
                                children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("clipPath", {
                                    id: "wy-plot-clip",
                                    children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("rect", {
                                        x: PAD_L,
                                        y: PAD_T,
                                        width: plotW,
                                        height: plotH
                                    }, void 0, false, {
                                        fileName: "[project]/src/components/price-chart.tsx",
                                        lineNumber: 395,
                                        columnNumber: 15
                                    }, this)
                                }, void 0, false, {
                                    fileName: "[project]/src/components/price-chart.tsx",
                                    lineNumber: 394,
                                    columnNumber: 13
                                }, this)
                            }, void 0, false, {
                                fileName: "[project]/src/components/price-chart.tsx",
                                lineNumber: 393,
                                columnNumber: 11
                            }, this),
                            gridPrices.map((p, k)=>/*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("g", {
                                    children: [
                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("line", {
                                            x1: PAD_L,
                                            x2: PAD_L + plotW,
                                            y1: y(p),
                                            y2: y(p),
                                            stroke: GRID,
                                            strokeWidth: 1
                                        }, void 0, false, {
                                            fileName: "[project]/src/components/price-chart.tsx",
                                            lineNumber: 401,
                                            columnNumber: 15
                                        }, this),
                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("text", {
                                            x: PAD_L + plotW + 6,
                                            y: y(p) + 4,
                                            fill: TEXT,
                                            fontSize: 10,
                                            fontFamily: "ui-monospace, monospace",
                                            children: (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$i18n$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["fmtPrice"])(p)
                                        }, void 0, false, {
                                            fileName: "[project]/src/components/price-chart.tsx",
                                            lineNumber: 402,
                                            columnNumber: 15
                                        }, this)
                                    ]
                                }, k, true, {
                                    fileName: "[project]/src/components/price-chart.tsx",
                                    lineNumber: 400,
                                    columnNumber: 13
                                }, this)),
                            (()=>{
                                const last = width < 520 ? 3 : 5;
                                const est = (s)=>s.length * 6.2; // ~px per char @ 10px mono
                                let prevRight = -Infinity;
                                const nodes = [];
                                for(let k = 0; k <= last; k++){
                                    const idx = Math.round(viewStart + (viewEnd - viewStart) * k / last);
                                    const kk = klines[Math.min(idx, n - 1)];
                                    const label = timeLabel(kk.t);
                                    const w = est(label);
                                    const anchor = k === 0 ? "start" : k === last ? "end" : "middle";
                                    const cx = k === 0 ? PAD_L : k === last ? PAD_L + plotW : Math.min(x(idx), PAD_L + plotW - 10);
                                    const left = anchor === "start" ? cx : anchor === "end" ? cx - w : cx - w / 2;
                                    if (left < prevRight + 10) continue; // would collide with the previous label
                                    prevRight = left + w;
                                    nodes.push(/*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("text", {
                                        x: cx,
                                        y: height - 8,
                                        fill: TEXT,
                                        fontSize: 10,
                                        textAnchor: anchor,
                                        fontFamily: "ui-monospace, monospace",
                                        children: label
                                    }, k, false, {
                                        fileName: "[project]/src/components/price-chart.tsx",
                                        lineNumber: 424,
                                        columnNumber: 17
                                    }, this));
                                }
                                return nodes;
                            })(),
                            whale.maxD > 0 && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("g", {
                                clipPath: "url(#wy-plot-clip)",
                                children: [
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("line", {
                                        x1: PAD_L,
                                        x2: PAD_L + plotW,
                                        y1: PAD_T + plotH,
                                        y2: PAD_T + plotH,
                                        stroke: GRID,
                                        strokeWidth: 1
                                    }, void 0, false, {
                                        fileName: "[project]/src/components/price-chart.tsx",
                                        lineNumber: 443,
                                        columnNumber: 15
                                    }, this),
                                    whale.rows.map(({ i, d })=>{
                                        const h = Math.max(1, Math.abs(d) / whale.maxD * whaleH);
                                        const bw = Math.max(1.5, cw * 0.55);
                                        return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("rect", {
                                            x: x(i) - bw / 2,
                                            y: PAD_T + plotH - h,
                                            width: bw,
                                            height: h,
                                            fill: d >= 0 ? UP : DOWN,
                                            opacity: 0.34
                                        }, `wh-${i}`, false, {
                                            fileName: "[project]/src/components/price-chart.tsx",
                                            lineNumber: 455,
                                            columnNumber: 19
                                        }, this);
                                    })
                                ]
                            }, void 0, true, {
                                fileName: "[project]/src/components/price-chart.tsx",
                                lineNumber: 442,
                                columnNumber: 13
                            }, this),
                            eqOn && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("g", {
                                pointerEvents: "none",
                                children: [
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("defs", {
                                        children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("linearGradient", {
                                            id: "eq-pane-fill",
                                            x1: "0",
                                            y1: "0",
                                            x2: "0",
                                            y2: "1",
                                            children: [
                                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("stop", {
                                                    offset: "0%",
                                                    stopColor: eqColor,
                                                    stopOpacity: 0.25
                                                }, void 0, false, {
                                                    fileName: "[project]/src/components/price-chart.tsx",
                                                    lineNumber: 474,
                                                    columnNumber: 19
                                                }, this),
                                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("stop", {
                                                    offset: "100%",
                                                    stopColor: eqColor,
                                                    stopOpacity: 0.02
                                                }, void 0, false, {
                                                    fileName: "[project]/src/components/price-chart.tsx",
                                                    lineNumber: 475,
                                                    columnNumber: 19
                                                }, this)
                                            ]
                                        }, void 0, true, {
                                            fileName: "[project]/src/components/price-chart.tsx",
                                            lineNumber: 473,
                                            columnNumber: 17
                                        }, this)
                                    }, void 0, false, {
                                        fileName: "[project]/src/components/price-chart.tsx",
                                        lineNumber: 472,
                                        columnNumber: 15
                                    }, this),
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("line", {
                                        x1: PAD_L,
                                        x2: PAD_L + plotW,
                                        y1: PAD_T + plotH + 4,
                                        y2: PAD_T + plotH + 4,
                                        stroke: GRID,
                                        strokeWidth: 1
                                    }, void 0, false, {
                                        fileName: "[project]/src/components/price-chart.tsx",
                                        lineNumber: 478,
                                        columnNumber: 15
                                    }, this),
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("text", {
                                        x: PAD_L + 2,
                                        y: eqTop + 1,
                                        fill: "#71717a",
                                        fontSize: 9,
                                        fontFamily: "ui-monospace, monospace",
                                        children: [
                                            (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$i18n$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["t"])(lang, "tabs.equity"),
                                            " · ",
                                            eq.count
                                        ]
                                    }, void 0, true, {
                                        fileName: "[project]/src/components/price-chart.tsx",
                                        lineNumber: 479,
                                        columnNumber: 15
                                    }, this),
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("line", {
                                        x1: PAD_L,
                                        x2: PAD_L + plotW,
                                        y1: eqY(0),
                                        y2: eqY(0),
                                        stroke: "#3f3f46",
                                        strokeDasharray: "4 4",
                                        strokeWidth: 1
                                    }, void 0, false, {
                                        fileName: "[project]/src/components/price-chart.tsx",
                                        lineNumber: 482,
                                        columnNumber: 15
                                    }, this),
                                    eqLine && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("path", {
                                        d: eqLine.area,
                                        fill: "url(#eq-pane-fill)"
                                    }, void 0, false, {
                                        fileName: "[project]/src/components/price-chart.tsx",
                                        lineNumber: 483,
                                        columnNumber: 26
                                    }, this),
                                    eqLine && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("path", {
                                        d: eqLine.d,
                                        fill: "none",
                                        stroke: eqColor,
                                        strokeWidth: 1.6,
                                        strokeLinejoin: "round"
                                    }, void 0, false, {
                                        fileName: "[project]/src/components/price-chart.tsx",
                                        lineNumber: 484,
                                        columnNumber: 26
                                    }, this),
                                    eqLine && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("text", {
                                        x: PAD_L + plotW,
                                        y: Math.max(eqTop + 8, eqLine.endY - 4),
                                        textAnchor: "end",
                                        fill: eqColor,
                                        fontSize: 10,
                                        fontWeight: 700,
                                        fontFamily: "ui-monospace, monospace",
                                        children: (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$i18n$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["fmtPct"])(eqLine.endV)
                                    }, void 0, false, {
                                        fileName: "[project]/src/components/price-chart.tsx",
                                        lineNumber: 486,
                                        columnNumber: 17
                                    }, this)
                                ]
                            }, void 0, true, {
                                fileName: "[project]/src/components/price-chart.tsx",
                                lineNumber: 471,
                                columnNumber: 13
                            }, this),
                            vp && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("g", {
                                clipPath: "url(#wy-plot-clip)",
                                children: [
                                    vp.rows.map((r, k)=>{
                                        const yTop = y(r.high);
                                        const yBot = y(r.low);
                                        const h = Math.max(1, yBot - yTop - 1);
                                        const tot = r.buy + r.sell;
                                        if (tot <= 0) return null;
                                        const w = tot / vp.max * vpW;
                                        const bw = r.buy / tot * w;
                                        const right = PAD_L + plotW;
                                        return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("g", {
                                            children: [
                                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("rect", {
                                                    x: right - bw,
                                                    y: yTop,
                                                    width: Math.max(0, bw),
                                                    height: h,
                                                    fill: UP,
                                                    opacity: 0.2
                                                }, void 0, false, {
                                                    fileName: "[project]/src/components/price-chart.tsx",
                                                    lineNumber: 515,
                                                    columnNumber: 21
                                                }, this),
                                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("rect", {
                                                    x: right - w,
                                                    y: yTop,
                                                    width: Math.max(0, w - bw),
                                                    height: h,
                                                    fill: DOWN,
                                                    opacity: 0.18
                                                }, void 0, false, {
                                                    fileName: "[project]/src/components/price-chart.tsx",
                                                    lineNumber: 516,
                                                    columnNumber: 21
                                                }, this)
                                            ]
                                        }, `vp-${k}`, true, {
                                            fileName: "[project]/src/components/price-chart.tsx",
                                            lineNumber: 514,
                                            columnNumber: 19
                                        }, this);
                                    }),
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("line", {
                                        x1: PAD_L,
                                        x2: PAD_L + plotW,
                                        y1: y(vp.poc),
                                        y2: y(vp.poc),
                                        stroke: "#e4e4e7",
                                        strokeOpacity: 0.22,
                                        strokeDasharray: "3 5",
                                        strokeWidth: 1
                                    }, void 0, false, {
                                        fileName: "[project]/src/components/price-chart.tsx",
                                        lineNumber: 520,
                                        columnNumber: 15
                                    }, this)
                                ]
                            }, void 0, true, {
                                fileName: "[project]/src/components/price-chart.tsx",
                                lineNumber: 503,
                                columnNumber: 13
                            }, this),
                            wyOn && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("g", {
                                clipPath: "url(#wy-plot-clip)",
                                children: wyBoxes.map((b, k)=>{
                                    const x1 = Math.max(PAD_L, x(b.left) - cw / 2);
                                    const x2 = Math.min(PAD_L + plotW, x(b.right) + cw / 2);
                                    const yTop = y(b.top);
                                    const yBot = y(b.bottom);
                                    const col = b.dir === 1 ? WY_ACC : WY_DIST;
                                    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("rect", {
                                        x: x1,
                                        y: Math.min(yTop, yBot),
                                        width: Math.max(0, x2 - x1),
                                        height: Math.max(1, Math.abs(yBot - yTop)),
                                        fill: col,
                                        fillOpacity: 0.07,
                                        stroke: col,
                                        strokeOpacity: 0.35,
                                        strokeWidth: 1
                                    }, `wyb-${b.left}-${b.dir}-${k}`, false, {
                                        fileName: "[project]/src/components/price-chart.tsx",
                                        lineNumber: 543,
                                        columnNumber: 19
                                    }, this);
                                })
                            }, void 0, false, {
                                fileName: "[project]/src/components/price-chart.tsx",
                                lineNumber: 535,
                                columnNumber: 13
                            }, this),
                            papersInView.map((p)=>{
                                const isFlip = p.exitKind === "flip";
                                const color = p.side === "LONG" ? UP : DOWN;
                                if (p.exitIndex === undefined || p.exit === undefined) {
                                    // open paper handled below
                                    return null;
                                }
                                const a = Math.max(p.entryIndex, viewStart);
                                const b = Math.min(p.exitIndex, viewEnd);
                                if (b < viewStart || a > viewEnd) return null;
                                return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("g", {
                                    opacity: 0.85,
                                    children: [
                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("line", {
                                            x1: x(a),
                                            x2: x(b),
                                            y1: y(p.entry),
                                            y2: y(p.exit),
                                            stroke: color,
                                            strokeWidth: 1.2,
                                            strokeDasharray: isFlip ? "5 3" : "2 3",
                                            opacity: 0.7
                                        }, void 0, false, {
                                            fileName: "[project]/src/components/price-chart.tsx",
                                            lineNumber: 573,
                                            columnNumber: 17
                                        }, this),
                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("circle", {
                                            cx: x(a),
                                            cy: y(p.entry),
                                            r: 3,
                                            fill: color
                                        }, void 0, false, {
                                            fileName: "[project]/src/components/price-chart.tsx",
                                            lineNumber: 583,
                                            columnNumber: 17
                                        }, this),
                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("circle", {
                                            cx: x(Math.min(p.exitIndex, viewEnd)),
                                            cy: y(p.exit),
                                            r: 3.5,
                                            fill: p.exitKind === "flip" ? FLIP : color,
                                            stroke: "#18181b",
                                            strokeWidth: 1,
                                            children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("title", {
                                                children: `#${p.side} ${(0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$i18n$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["fmtPrice"])(p.entry)} → ${(0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$i18n$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["fmtPrice"])(p.exit)}`
                                            }, void 0, false, {
                                                fileName: "[project]/src/components/price-chart.tsx",
                                                lineNumber: 592,
                                                columnNumber: 19
                                            }, this)
                                        }, void 0, false, {
                                            fileName: "[project]/src/components/price-chart.tsx",
                                            lineNumber: 584,
                                            columnNumber: 17
                                        }, this)
                                    ]
                                }, p.id, true, {
                                    fileName: "[project]/src/components/price-chart.tsx",
                                    lineNumber: 572,
                                    columnNumber: 15
                                }, this);
                            }),
                            openPaper && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("g", {
                                clipPath: "url(#wy-plot-clip)",
                                children: [
                                    {
                                        p: openPaper.entry,
                                        c: "#e4e4e7",
                                        label: openEntryLabel,
                                        dash: "6 4"
                                    },
                                    {
                                        p: openPaper.sl,
                                        c: DOWN,
                                        label: "SL",
                                        dash: "4 4"
                                    },
                                    {
                                        p: openPaper.tp,
                                        c: UP,
                                        label: "TP",
                                        dash: "4 4"
                                    }
                                ].map((row, k)=>{
                                    const ly = y(row.p);
                                    if (ly < PAD_T - 1 || ly > PAD_T + plotH + 1) return null;
                                    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("g", {
                                        children: [
                                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("line", {
                                                x1: PAD_L,
                                                x2: PAD_L + plotW,
                                                y1: ly,
                                                y2: ly,
                                                stroke: row.c,
                                                strokeWidth: 1.2,
                                                strokeDasharray: row.dash,
                                                opacity: 0.9
                                            }, void 0, false, {
                                                fileName: "[project]/src/components/price-chart.tsx",
                                                lineNumber: 610,
                                                columnNumber: 21
                                            }, this),
                                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("rect", {
                                                x: PAD_L + plotW + 2,
                                                y: ly - 8,
                                                width: 60,
                                                height: 16,
                                                rx: 3,
                                                fill: row.c,
                                                opacity: 0.16
                                            }, void 0, false, {
                                                fileName: "[project]/src/components/price-chart.tsx",
                                                lineNumber: 620,
                                                columnNumber: 21
                                            }, this),
                                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("text", {
                                                x: PAD_L + plotW + 6,
                                                y: ly + 4,
                                                fill: row.c,
                                                fontSize: 9.5,
                                                fontWeight: 700,
                                                fontFamily: "ui-monospace, monospace",
                                                children: [
                                                    row.label,
                                                    " ",
                                                    (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$i18n$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["fmtPrice"])(row.p)
                                                ]
                                            }, void 0, true, {
                                                fileName: "[project]/src/components/price-chart.tsx",
                                                lineNumber: 629,
                                                columnNumber: 21
                                            }, this)
                                        ]
                                    }, k, true, {
                                        fileName: "[project]/src/components/price-chart.tsx",
                                        lineNumber: 609,
                                        columnNumber: 19
                                    }, this);
                                })
                            }, void 0, false, {
                                fileName: "[project]/src/components/price-chart.tsx",
                                lineNumber: 600,
                                columnNumber: 13
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("path", {
                                d: bandPath(),
                                fill: "#facc15",
                                fillOpacity: 0.07,
                                stroke: "none"
                            }, void 0, false, {
                                fileName: "[project]/src/components/price-chart.tsx",
                                lineNumber: 646,
                                columnNumber: 11
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("path", {
                                d: sma.slice(viewStart, viewEnd + 1).map((v, k)=>v == null ? null : `${k === 0 || sma.slice(viewStart, viewStart + k).every((s)=>s == null) ? "M" : "L"}${x(viewStart + k)},${y(v)}`).filter(Boolean).join(" "),
                                fill: "none",
                                stroke: "#facc15",
                                strokeWidth: 1.4,
                                opacity: 0.75
                            }, void 0, false, {
                                fileName: "[project]/src/components/price-chart.tsx",
                                lineNumber: 649,
                                columnNumber: 11
                            }, this),
                            wyOn && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("g", {
                                clipPath: "url(#wy-plot-clip)",
                                children: [
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("path", {
                                        d: linePath(wyckoff.emaS),
                                        fill: "none",
                                        stroke: WY_EMA_S,
                                        strokeWidth: 1,
                                        opacity: 0.5
                                    }, void 0, false, {
                                        fileName: "[project]/src/components/price-chart.tsx",
                                        lineNumber: 664,
                                        columnNumber: 15
                                    }, this),
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("path", {
                                        d: linePath(wyckoff.emaF),
                                        fill: "none",
                                        stroke: WY_EMA_F,
                                        strokeWidth: 1,
                                        opacity: 0.55
                                    }, void 0, false, {
                                        fileName: "[project]/src/components/price-chart.tsx",
                                        lineNumber: 665,
                                        columnNumber: 15
                                    }, this)
                                ]
                            }, void 0, true, {
                                fileName: "[project]/src/components/price-chart.tsx",
                                lineNumber: 663,
                                columnNumber: 13
                            }, this),
                            stop && trend && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("g", {
                                clipPath: "url(#wy-plot-clip)",
                                children: stopSegs().map((seg, k)=>/*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("path", {
                                        d: seg.d,
                                        fill: "none",
                                        stroke: seg.up ? UP : DOWN,
                                        strokeWidth: 1.3,
                                        strokeDasharray: "1 3",
                                        opacity: 0.85,
                                        strokeLinecap: "round"
                                    }, `stop-${k}`, false, {
                                        fileName: "[project]/src/components/price-chart.tsx",
                                        lineNumber: 673,
                                        columnNumber: 17
                                    }, this))
                            }, void 0, false, {
                                fileName: "[project]/src/components/price-chart.tsx",
                                lineNumber: 671,
                                columnNumber: 13
                            }, this),
                            klines.slice(viewStart, viewEnd + 1).map((k, idx)=>{
                                const i = viewStart + idx;
                                const up = k.c >= k.o;
                                // Wyckoff barcolor tint applies only in "neon" style — the "normal"
                                // style ignores it so all-tinted stretches keep plain green/red
                                // candles (pivots, event labels & EMAs still show the phases)
                                const tint = tintOf(i);
                                // "normal" style = every body filled (green up / red down); "neon" = hollow up-bodies
                                const solid = candleStyle === "normal";
                                const color = !solid && tint === 1 ? WY_ACC_BAR : !solid && tint === -1 ? WY_DIST_BAR : up ? UP : DOWN;
                                const bw = Math.max(2, cw * 0.62);
                                const yo = y(k.o);
                                const yc = y(k.c);
                                const top = Math.min(yo, yc);
                                const h = Math.max(1.5, Math.abs(yc - yo));
                                return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("g", {
                                    children: [
                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("line", {
                                            x1: x(i),
                                            x2: x(i),
                                            y1: y(k.h),
                                            y2: y(k.l),
                                            stroke: color,
                                            strokeWidth: 1,
                                            opacity: solid ? 1 : tint !== 0 ? 0.9 : 1
                                        }, void 0, false, {
                                            fileName: "[project]/src/components/price-chart.tsx",
                                            lineNumber: 705,
                                            columnNumber: 17
                                        }, this),
                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("rect", {
                                            x: x(i) - bw / 2,
                                            y: top,
                                            width: bw,
                                            height: h,
                                            fill: solid ? color : up || tint !== 0 ? tint !== 0 ? color : "transparent" : color,
                                            stroke: color,
                                            strokeWidth: 1,
                                            opacity: solid ? 1 : tint !== 0 ? 0.85 : 1
                                        }, void 0, false, {
                                            fileName: "[project]/src/components/price-chart.tsx",
                                            lineNumber: 706,
                                            columnNumber: 17
                                        }, this)
                                    ]
                                }, k.t, true, {
                                    fileName: "[project]/src/components/price-chart.tsx",
                                    lineNumber: 704,
                                    columnNumber: 15
                                }, this);
                            }),
                            wyOn && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("g", {
                                clipPath: "url(#wy-plot-clip)",
                                children: [
                                    wyPivots.map((p, k)=>{
                                        const px = x(p.bar);
                                        const py = y(p.price);
                                        // tiny triangle: up under a pivot low, down over a pivot high
                                        const d = p.isHigh ? `M${px},${py - 2} ${px - 3.5},${py - 9} ${px + 3.5},${py - 9}` : `M${px},${py + 2} ${px - 3.5},${py + 9} ${px + 3.5},${py + 9}`;
                                        return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("path", {
                                            d: d,
                                            fill: WY_PIVOT,
                                            opacity: 0.75
                                        }, `wyp-${p.bar}-${p.isHigh ? "h" : "l"}-${k}`, false, {
                                            fileName: "[project]/src/components/price-chart.tsx",
                                            lineNumber: 730,
                                            columnNumber: 24
                                        }, this);
                                    }),
                                    wyEvents.map((e, k)=>{
                                        const px = x(e.bar);
                                        const py = y(e.price);
                                        const col = wyEventColor(e);
                                        const tri = e.below ? `M${px},${py + 2} ${px - 4},${py + 9} ${px + 4},${py + 9}` : `M${px},${py - 2} ${px - 4},${py - 9} ${px + 4},${py - 9}`;
                                        return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("g", {
                                            opacity: 0.95,
                                            children: [
                                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("path", {
                                                    d: tri,
                                                    fill: col
                                                }, void 0, false, {
                                                    fileName: "[project]/src/components/price-chart.tsx",
                                                    lineNumber: 741,
                                                    columnNumber: 21
                                                }, this),
                                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("text", {
                                                    x: px,
                                                    y: e.below ? py + 20 : py - 13,
                                                    textAnchor: "middle",
                                                    fontSize: 9,
                                                    fontWeight: 700,
                                                    fill: col,
                                                    fontFamily: "ui-monospace, monospace",
                                                    children: e.kind
                                                }, void 0, false, {
                                                    fileName: "[project]/src/components/price-chart.tsx",
                                                    lineNumber: 742,
                                                    columnNumber: 21
                                                }, this),
                                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("title", {
                                                    children: `Wyckoff ${e.kind} · ${(0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$i18n$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["fmtPrice"])(e.price)} · ${e.dir === 1 ? "ACC" : "DIST"}`
                                                }, void 0, false, {
                                                    fileName: "[project]/src/components/price-chart.tsx",
                                                    lineNumber: 753,
                                                    columnNumber: 21
                                                }, this)
                                            ]
                                        }, `wye-${e.kind}-${e.time}-${e.dir}-${k}`, true, {
                                            fileName: "[project]/src/components/price-chart.tsx",
                                            lineNumber: 740,
                                            columnNumber: 19
                                        }, this);
                                    })
                                ]
                            }, void 0, true, {
                                fileName: "[project]/src/components/price-chart.tsx",
                                lineNumber: 722,
                                columnNumber: 13
                            }, this),
                            sigInView.map((s)=>{
                                const k = klines[s.i];
                                const buy = s.dir === "BUY";
                                const isPin = pinnedIndex === s.i;
                                const color = buy ? UP : DOWN;
                                const mx = x(s.i);
                                const my = buy ? y(k.l) + 14 : y(k.h) - 14;
                                const tri = buy ? `${mx},${my - 6} ${mx - 5},${my + 3} ${mx + 5},${my + 3}` : `${mx},${my + 6} ${mx - 5},${my - 3} ${mx + 5},${my - 3}`;
                                return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("g", {
                                    className: "cursor-pointer",
                                    onPointerDown: (e)=>e.stopPropagation(),
                                    onClick: (e)=>{
                                        e.stopPropagation();
                                        onPin(isPin ? null : s.i);
                                    },
                                    children: [
                                        isPin && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("circle", {
                                            cx: mx,
                                            cy: my,
                                            r: 10,
                                            fill: "none",
                                            stroke: FLIP,
                                            strokeWidth: 1.6
                                        }, void 0, false, {
                                            fileName: "[project]/src/components/price-chart.tsx",
                                            lineNumber: 781,
                                            columnNumber: 27
                                        }, this),
                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("path", {
                                            d: `M${tri}`,
                                            fill: s.smaOk ? color : "none",
                                            stroke: s.smaOk ? color : FLIP,
                                            strokeWidth: s.smaOk ? 0 : 1.2,
                                            strokeDasharray: s.smaOk ? undefined : "2 2",
                                            children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("title", {
                                                children: `${s.dir} · ${(0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$i18n$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["fmtPrice"])(s.price)} · ${s.smaOk ? (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$i18n$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["t"])(lang, "dock.gate.open") : (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$i18n$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["t"])(lang, "chart.mark.blocked")}`
                                            }, void 0, false, {
                                                fileName: "[project]/src/components/price-chart.tsx",
                                                lineNumber: 789,
                                                columnNumber: 19
                                            }, this)
                                        }, void 0, false, {
                                            fileName: "[project]/src/components/price-chart.tsx",
                                            lineNumber: 782,
                                            columnNumber: 17
                                        }, this)
                                    ]
                                }, `${s.t}-${s.dir}`, true, {
                                    fileName: "[project]/src/components/price-chart.tsx",
                                    lineNumber: 772,
                                    columnNumber: 15
                                }, this);
                            }),
                            livePrice != null && (()=>{
                                const ly = y(livePrice);
                                const tagY = Math.max(PAD_T + 8, Math.min(PAD_T + plotH - 8, ly));
                                const lastK = klines[n - 1];
                                const col = livePrice >= (lastK ? lastK.o : livePrice) ? UP : DOWN;
                                return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("g", {
                                    pointerEvents: "none",
                                    children: [
                                        ly >= PAD_T && ly <= PAD_T + plotH && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("line", {
                                            x1: PAD_L,
                                            x2: PAD_L + plotW,
                                            y1: ly,
                                            y2: ly,
                                            stroke: col,
                                            strokeWidth: 1,
                                            strokeDasharray: "2 4",
                                            opacity: 0.75
                                        }, void 0, false, {
                                            fileName: "[project]/src/components/price-chart.tsx",
                                            lineNumber: 807,
                                            columnNumber: 21
                                        }, this),
                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("rect", {
                                            x: PAD_L + plotW + 2,
                                            y: tagY - 8,
                                            width: 60,
                                            height: 16,
                                            rx: 3,
                                            fill: col
                                        }, void 0, false, {
                                            fileName: "[project]/src/components/price-chart.tsx",
                                            lineNumber: 818,
                                            columnNumber: 19
                                        }, this),
                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("text", {
                                            x: PAD_L + plotW + 6,
                                            y: tagY + 3.5,
                                            fill: "#fafafa",
                                            fontSize: 10,
                                            fontWeight: 700,
                                            fontFamily: "ui-monospace, monospace",
                                            children: (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$i18n$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["fmtPrice"])(livePrice)
                                        }, void 0, false, {
                                            fileName: "[project]/src/components/price-chart.tsx",
                                            lineNumber: 819,
                                            columnNumber: 19
                                        }, this)
                                    ]
                                }, void 0, true, {
                                    fileName: "[project]/src/components/price-chart.tsx",
                                    lineNumber: 805,
                                    columnNumber: 17
                                }, this);
                            })(),
                            hover && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("g", {
                                pointerEvents: "none",
                                children: [
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("line", {
                                        x1: x(hover.i),
                                        x2: x(hover.i),
                                        y1: PAD_T,
                                        y2: PAD_T + plotH,
                                        stroke: "#52525b",
                                        strokeWidth: 1,
                                        strokeDasharray: "3 3"
                                    }, void 0, false, {
                                        fileName: "[project]/src/components/price-chart.tsx",
                                        lineNumber: 835,
                                        columnNumber: 15
                                    }, this),
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("line", {
                                        x1: PAD_L,
                                        x2: PAD_L + plotW,
                                        y1: hover.py,
                                        y2: hover.py,
                                        stroke: "#52525b",
                                        strokeWidth: 1,
                                        strokeDasharray: "3 3"
                                    }, void 0, false, {
                                        fileName: "[project]/src/components/price-chart.tsx",
                                        lineNumber: 836,
                                        columnNumber: 15
                                    }, this),
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("rect", {
                                        x: PAD_L + plotW + 2,
                                        y: hover.py - 8,
                                        width: 60,
                                        height: 16,
                                        rx: 3,
                                        fill: "#52525b"
                                    }, void 0, false, {
                                        fileName: "[project]/src/components/price-chart.tsx",
                                        lineNumber: 837,
                                        columnNumber: 15
                                    }, this),
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("text", {
                                        x: PAD_L + plotW + 6,
                                        y: hover.py + 3.5,
                                        fill: "#fafafa",
                                        fontSize: 10,
                                        fontFamily: "ui-monospace, monospace",
                                        children: (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$i18n$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["fmtPrice"])(priceAtY(hover.py))
                                    }, void 0, false, {
                                        fileName: "[project]/src/components/price-chart.tsx",
                                        lineNumber: 838,
                                        columnNumber: 15
                                    }, this)
                                ]
                            }, void 0, true, {
                                fileName: "[project]/src/components/price-chart.tsx",
                                lineNumber: 834,
                                columnNumber: 13
                            }, this)
                        ]
                    }, void 0, true, {
                        fileName: "[project]/src/components/price-chart.tsx",
                        lineNumber: 382,
                        columnNumber: 9
                    }, this),
                    hover && klines[hover.i] && (()=>{
                        const k = klines[hover.i];
                        const up = k.c >= k.o;
                        const chg = (k.c - k.o) / k.o * 100;
                        const cls = up ? "text-emerald-400" : "text-rose-400";
                        return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                            className: "pointer-events-none absolute left-2 top-1.5 z-10 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 rounded-md border border-zinc-800/80 bg-zinc-950/85 px-2 py-1 font-mono text-[10.5px] leading-none backdrop-blur-sm",
                            children: [
                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                    className: "text-zinc-500",
                                    children: timeLabel(k.t)
                                }, void 0, false, {
                                    fileName: "[project]/src/components/price-chart.tsx",
                                    lineNumber: 855,
                                    columnNumber: 17
                                }, this),
                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                    className: "text-zinc-500",
                                    children: [
                                        "O ",
                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("b", {
                                            className: cls,
                                            children: (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$i18n$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["fmtPrice"])(k.o)
                                        }, void 0, false, {
                                            fileName: "[project]/src/components/price-chart.tsx",
                                            lineNumber: 857,
                                            columnNumber: 21
                                        }, this)
                                    ]
                                }, void 0, true, {
                                    fileName: "[project]/src/components/price-chart.tsx",
                                    lineNumber: 856,
                                    columnNumber: 17
                                }, this),
                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                    className: "text-zinc-500",
                                    children: [
                                        "H ",
                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("b", {
                                            className: cls,
                                            children: (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$i18n$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["fmtPrice"])(k.h)
                                        }, void 0, false, {
                                            fileName: "[project]/src/components/price-chart.tsx",
                                            lineNumber: 860,
                                            columnNumber: 21
                                        }, this)
                                    ]
                                }, void 0, true, {
                                    fileName: "[project]/src/components/price-chart.tsx",
                                    lineNumber: 859,
                                    columnNumber: 17
                                }, this),
                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                    className: "text-zinc-500",
                                    children: [
                                        "L ",
                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("b", {
                                            className: cls,
                                            children: (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$i18n$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["fmtPrice"])(k.l)
                                        }, void 0, false, {
                                            fileName: "[project]/src/components/price-chart.tsx",
                                            lineNumber: 863,
                                            columnNumber: 21
                                        }, this)
                                    ]
                                }, void 0, true, {
                                    fileName: "[project]/src/components/price-chart.tsx",
                                    lineNumber: 862,
                                    columnNumber: 17
                                }, this),
                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                    className: "text-zinc-500",
                                    children: [
                                        "C ",
                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("b", {
                                            className: cls,
                                            children: (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$i18n$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["fmtPrice"])(k.c)
                                        }, void 0, false, {
                                            fileName: "[project]/src/components/price-chart.tsx",
                                            lineNumber: 866,
                                            columnNumber: 21
                                        }, this)
                                    ]
                                }, void 0, true, {
                                    fileName: "[project]/src/components/price-chart.tsx",
                                    lineNumber: 865,
                                    columnNumber: 17
                                }, this),
                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("b", {
                                    className: cls,
                                    children: [
                                        chg >= 0 ? "+" : "",
                                        chg.toFixed(2),
                                        "%"
                                    ]
                                }, void 0, true, {
                                    fileName: "[project]/src/components/price-chart.tsx",
                                    lineNumber: 868,
                                    columnNumber: 17
                                }, this),
                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                    className: "text-zinc-500",
                                    children: [
                                        (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$i18n$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["t"])(lang, "chart.ohlc.vol"),
                                        " ",
                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("b", {
                                            className: "text-zinc-300",
                                            children: (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$market$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["fmtCompact"])(k.v)
                                        }, void 0, false, {
                                            fileName: "[project]/src/components/price-chart.tsx",
                                            lineNumber: 873,
                                            columnNumber: 47
                                        }, this)
                                    ]
                                }, void 0, true, {
                                    fileName: "[project]/src/components/price-chart.tsx",
                                    lineNumber: 872,
                                    columnNumber: 17
                                }, this)
                            ]
                        }, void 0, true, {
                            fileName: "[project]/src/components/price-chart.tsx",
                            lineNumber: 854,
                            columnNumber: 15
                        }, this);
                    })()
                ]
            }, void 0, true, {
                fileName: "[project]/src/components/price-chart.tsx",
                lineNumber: 381,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                className: "mt-1.5 flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[11px] text-zinc-500",
                children: [
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                        className: "flex shrink-0 items-center gap-0.5",
                        children: [
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$ui$2f$button$2e$tsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["Button"], {
                                size: "sm",
                                variant: "outline",
                                className: "h-7 w-7 rounded-md border-zinc-700 p-0 text-zinc-300 hover:bg-zinc-800 sm:h-6 sm:w-6",
                                title: (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$i18n$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["t"])(lang, "chart.zoom.in"),
                                "aria-label": (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$i18n$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["t"])(lang, "chart.zoom.in"),
                                onClick: ()=>zoom(1),
                                children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$plus$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__$3c$export__default__as__Plus$3e$__["Plus"], {
                                    className: "h-3 w-3"
                                }, void 0, false, {
                                    fileName: "[project]/src/components/price-chart.tsx",
                                    lineNumber: 891,
                                    columnNumber: 13
                                }, this)
                            }, void 0, false, {
                                fileName: "[project]/src/components/price-chart.tsx",
                                lineNumber: 883,
                                columnNumber: 11
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$ui$2f$button$2e$tsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["Button"], {
                                size: "sm",
                                variant: "outline",
                                className: "h-7 w-7 rounded-md border-zinc-700 p-0 text-zinc-300 hover:bg-zinc-800 sm:h-6 sm:w-6",
                                title: (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$i18n$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["t"])(lang, "chart.zoom.out"),
                                "aria-label": (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$i18n$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["t"])(lang, "chart.zoom.out"),
                                onClick: ()=>zoom(-1),
                                children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$minus$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__$3c$export__default__as__Minus$3e$__["Minus"], {
                                    className: "h-3 w-3"
                                }, void 0, false, {
                                    fileName: "[project]/src/components/price-chart.tsx",
                                    lineNumber: 901,
                                    columnNumber: 13
                                }, this)
                            }, void 0, false, {
                                fileName: "[project]/src/components/price-chart.tsx",
                                lineNumber: 893,
                                columnNumber: 11
                            }, this),
                            viewEnd < n - 1 && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$ui$2f$button$2e$tsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["Button"], {
                                size: "sm",
                                variant: "outline",
                                className: "ml-1 h-7 rounded-md border-zinc-700 px-2 text-[11px] text-zinc-300 hover:bg-zinc-800 sm:h-6",
                                onClick: jumpLatest,
                                children: [
                                    "⟶ ",
                                    (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$i18n$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["t"])(lang, "chart.zoom.latest")
                                ]
                            }, void 0, true, {
                                fileName: "[project]/src/components/price-chart.tsx",
                                lineNumber: 904,
                                columnNumber: 13
                            }, this)
                        ]
                    }, void 0, true, {
                        fileName: "[project]/src/components/price-chart.tsx",
                        lineNumber: 882,
                        columnNumber: 9
                    }, this),
                    onCandleStyle && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$ui$2f$button$2e$tsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["Button"], {
                        size: "sm",
                        variant: "outline",
                        className: `h-7 rounded-md border-zinc-700 px-2 text-[11px] sm:h-6 ${candleStyle === "normal" ? "bg-zinc-100 text-zinc-900 hover:bg-zinc-200" : "bg-transparent text-zinc-300 hover:bg-zinc-800"}`,
                        title: candleStyle === "normal" ? (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$i18n$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["t"])(lang, "chart.candle.toNeon") : (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$i18n$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["t"])(lang, "chart.candle.toNormal"),
                        "aria-label": (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$i18n$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["t"])(lang, "chart.candle.style"),
                        onClick: ()=>onCandleStyle(candleStyle === "normal" ? "neon" : "normal"),
                        children: candleStyle === "normal" ? (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$i18n$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["t"])(lang, "chart.candle.normal") : (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$i18n$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["t"])(lang, "chart.candle.neon")
                    }, void 0, false, {
                        fileName: "[project]/src/components/price-chart.tsx",
                        lineNumber: 915,
                        columnNumber: 11
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                        className: "flex items-center gap-1.5",
                        children: [
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                className: `inline-block h-2.5 w-2.5 rounded-sm ${candleStyle === "normal" ? "bg-emerald-500" : "border border-emerald-500"}`
                            }, void 0, false, {
                                fileName: "[project]/src/components/price-chart.tsx",
                                lineNumber: 935,
                                columnNumber: 11
                            }, this),
                            (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$i18n$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["t"])(lang, "chart.legend.candles")
                        ]
                    }, void 0, true, {
                        fileName: "[project]/src/components/price-chart.tsx",
                        lineNumber: 934,
                        columnNumber: 9
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                        className: "flex items-center gap-1.5",
                        children: [
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                className: "inline-block h-0.5 w-4 bg-yellow-400"
                            }, void 0, false, {
                                fileName: "[project]/src/components/price-chart.tsx",
                                lineNumber: 943,
                                columnNumber: 11
                            }, this),
                            (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$i18n$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["t"])(lang, "chart.legend.sma")
                        ]
                    }, void 0, true, {
                        fileName: "[project]/src/components/price-chart.tsx",
                        lineNumber: 942,
                        columnNumber: 9
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                        className: "flex items-center gap-1.5",
                        children: [
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                className: "inline-block h-2 w-2.5 rounded-sm bg-yellow-400/25 ring-1 ring-yellow-500/50"
                            }, void 0, false, {
                                fileName: "[project]/src/components/price-chart.tsx",
                                lineNumber: 947,
                                columnNumber: 11
                            }, this),
                            (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$i18n$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["t"])(lang, "chart.legend.band")
                        ]
                    }, void 0, true, {
                        fileName: "[project]/src/components/price-chart.tsx",
                        lineNumber: 946,
                        columnNumber: 9
                    }, this),
                    stop && trend && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                        className: "flex items-center gap-1.5",
                        children: [
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                className: "inline-block h-0.5 w-4 border-t border-dashed border-emerald-400"
                            }, void 0, false, {
                                fileName: "[project]/src/components/price-chart.tsx",
                                lineNumber: 952,
                                columnNumber: 13
                            }, this),
                            (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$i18n$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["t"])(lang, "chart.legend.stop")
                        ]
                    }, void 0, true, {
                        fileName: "[project]/src/components/price-chart.tsx",
                        lineNumber: 951,
                        columnNumber: 11
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                        className: "flex items-center gap-1.5",
                        children: [
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                className: "inline-block h-2.5 w-2.5 rounded-sm bg-emerald-500"
                            }, void 0, false, {
                                fileName: "[project]/src/components/price-chart.tsx",
                                lineNumber: 957,
                                columnNumber: 11
                            }, this),
                            (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$i18n$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["t"])(lang, "chart.legend.trades")
                        ]
                    }, void 0, true, {
                        fileName: "[project]/src/components/price-chart.tsx",
                        lineNumber: 956,
                        columnNumber: 9
                    }, this),
                    whale.maxD > 0 && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                        className: "flex items-center gap-1.5",
                        title: (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$i18n$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["t"])(lang, "whale.note"),
                        children: [
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                className: "inline-block h-2.5 w-1.5 rounded-sm bg-emerald-500/40"
                            }, void 0, false, {
                                fileName: "[project]/src/components/price-chart.tsx",
                                lineNumber: 962,
                                columnNumber: 13
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                className: "-ml-2 inline-block h-2.5 w-1.5 rounded-sm bg-rose-500/40"
                            }, void 0, false, {
                                fileName: "[project]/src/components/price-chart.tsx",
                                lineNumber: 963,
                                columnNumber: 13
                            }, this),
                            (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$i18n$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["t"])(lang, "chart.legend.whale")
                        ]
                    }, void 0, true, {
                        fileName: "[project]/src/components/price-chart.tsx",
                        lineNumber: 961,
                        columnNumber: 11
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                        className: "flex items-center gap-1.5",
                        title: `${(0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$i18n$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["t"])(lang, "vp.buy")} / ${(0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$i18n$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["t"])(lang, "vp.sell")}`,
                        children: [
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                className: "inline-block h-2.5 w-2.5 rounded-sm bg-emerald-500/40 ring-1 ring-emerald-500/50"
                            }, void 0, false, {
                                fileName: "[project]/src/components/price-chart.tsx",
                                lineNumber: 968,
                                columnNumber: 11
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                className: "-ml-2.5 inline-block h-2.5 w-2.5 rounded-sm bg-rose-500/40 ring-1 ring-rose-500/50"
                            }, void 0, false, {
                                fileName: "[project]/src/components/price-chart.tsx",
                                lineNumber: 969,
                                columnNumber: 11
                            }, this),
                            (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$i18n$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["t"])(lang, "chart.legend.vp")
                        ]
                    }, void 0, true, {
                        fileName: "[project]/src/components/price-chart.tsx",
                        lineNumber: 967,
                        columnNumber: 9
                    }, this),
                    eqOn && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                        className: "flex items-center gap-1.5",
                        title: (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$i18n$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["t"])(lang, "equity.title"),
                        children: [
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                className: "inline-block h-0.5 w-4 rounded bg-gradient-to-r from-emerald-400 to-rose-400"
                            }, void 0, false, {
                                fileName: "[project]/src/components/price-chart.tsx",
                                lineNumber: 974,
                                columnNumber: 13
                            }, this),
                            (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$i18n$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["t"])(lang, "tabs.equity")
                        ]
                    }, void 0, true, {
                        fileName: "[project]/src/components/price-chart.tsx",
                        lineNumber: 973,
                        columnNumber: 11
                    }, this),
                    wyOn && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["Fragment"], {
                        children: [
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                className: "flex items-center gap-1.5",
                                children: [
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                        className: "inline-block h-2.5 w-2.5 rounded-sm bg-emerald-500/25 ring-1 ring-emerald-500/60"
                                    }, void 0, false, {
                                        fileName: "[project]/src/components/price-chart.tsx",
                                        lineNumber: 981,
                                        columnNumber: 15
                                    }, this),
                                    (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$i18n$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["t"])(lang, "chart.legend.wyacc")
                                ]
                            }, void 0, true, {
                                fileName: "[project]/src/components/price-chart.tsx",
                                lineNumber: 980,
                                columnNumber: 13
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                className: "flex items-center gap-1.5",
                                children: [
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                        className: "inline-block h-2.5 w-2.5 rounded-sm bg-rose-500/25 ring-1 ring-rose-500/60"
                                    }, void 0, false, {
                                        fileName: "[project]/src/components/price-chart.tsx",
                                        lineNumber: 985,
                                        columnNumber: 15
                                    }, this),
                                    (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$i18n$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["t"])(lang, "chart.legend.wydist")
                                ]
                            }, void 0, true, {
                                fileName: "[project]/src/components/price-chart.tsx",
                                lineNumber: 984,
                                columnNumber: 13
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                className: "flex items-center gap-1.5",
                                children: [
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                        className: "inline-block h-0 w-0 border-x-[4px] border-b-[7px] border-x-transparent border-b-violet-500"
                                    }, void 0, false, {
                                        fileName: "[project]/src/components/price-chart.tsx",
                                        lineNumber: 989,
                                        columnNumber: 15
                                    }, this),
                                    (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$i18n$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["t"])(lang, "chart.legend.wyphc")
                                ]
                            }, void 0, true, {
                                fileName: "[project]/src/components/price-chart.tsx",
                                lineNumber: 988,
                                columnNumber: 13
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                className: "flex items-center gap-1.5",
                                children: [
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                        className: "inline-block h-0 w-0 border-x-[4px] border-b-[7px] border-x-transparent border-b-orange-500"
                                    }, void 0, false, {
                                        fileName: "[project]/src/components/price-chart.tsx",
                                        lineNumber: 993,
                                        columnNumber: 15
                                    }, this),
                                    (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$i18n$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["t"])(lang, "chart.legend.wypivot")
                                ]
                            }, void 0, true, {
                                fileName: "[project]/src/components/price-chart.tsx",
                                lineNumber: 992,
                                columnNumber: 13
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                className: "flex items-center gap-1.5",
                                children: [
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                        className: "inline-block h-0.5 w-4 bg-teal-500"
                                    }, void 0, false, {
                                        fileName: "[project]/src/components/price-chart.tsx",
                                        lineNumber: 997,
                                        columnNumber: 15
                                    }, this),
                                    (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$i18n$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["t"])(lang, "chart.legend.wyema")
                                ]
                            }, void 0, true, {
                                fileName: "[project]/src/components/price-chart.tsx",
                                lineNumber: 996,
                                columnNumber: 13
                            }, this)
                        ]
                    }, void 0, true),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                        className: "text-zinc-600",
                        children: [
                            pinnedIndex != null ? (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$i18n$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["t"])(lang, "chart.hint.pinned") : (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$i18n$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["t"])(lang, "chart.hint.pin"),
                            " · ",
                            (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$i18n$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["t"])(lang, "chart.hint.terminal")
                        ]
                    }, void 0, true, {
                        fileName: "[project]/src/components/price-chart.tsx",
                        lineNumber: 1002,
                        columnNumber: 9
                    }, this)
                ]
            }, void 0, true, {
                fileName: "[project]/src/components/price-chart.tsx",
                lineNumber: 881,
                columnNumber: 7
            }, this),
            pending && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                className: "mt-1 shrink-0 rounded-md border border-dashed border-zinc-700 bg-zinc-900/60 px-3 py-1.5 text-[11px] text-zinc-400",
                children: [
                    (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$i18n$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["t"])(lang, "dock.pending"),
                    ": ",
                    pending.side === "LONG" ? "LONG" : "SHORT",
                    " — ",
                    (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$i18n$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["t"])(lang, "dock.pendingNote")
                ]
            }, void 0, true, {
                fileName: "[project]/src/components/price-chart.tsx",
                lineNumber: 1008,
                columnNumber: 9
            }, this)
        ]
    }, void 0, true, {
        fileName: "[project]/src/components/price-chart.tsx",
        lineNumber: 380,
        columnNumber: 5
    }, this);
}
}),
];

//# sourceMappingURL=src_components_price-chart_tsx_27344726._.js.map