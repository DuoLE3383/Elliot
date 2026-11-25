import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Square } from "lucide-react";
import { trailRoiStopPrice } from "@/lib/autotrade";

// Tach tu auto-panel.tsx - POSITIONS OPENING (Card 1369). Props any de tsc khong ket type.
// 0.3.12b — khối tóm tắt hiệu suất kiểu mockup: donut uROI (tỷ trọng margin
// LONG/SHORT) + 4 hàng stats (Open · LONG/SHORT · WR đóng · uPnL) — toàn bộ số
// thật từ opens + closedHist + tickers, không có lệnh thì vẽ vành đen + "—".
export function AutoPositions(props: any) {
  const { opens, open, tickers, cfg, capitalNow, lang, t, closeNow, closeOpen, fmtPrice, slPrice, tpPrice, trailStopPrice, trailMovePct, engineTrail, roiOf, rows, closedHist, leverage } = props;
  const closeFn = closeNow ?? closeOpen;
  return (
    <Card className="border-[#1e2d4d]/70 bg-[#0a0f1e]/80 h-full">
      <CardHeader className="px-4 pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-1.5 text-base font-semibold text-zinc-100">
            {/* bar-chart icon — kiểu mockup */}
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden>
              <rect x="4" y="12" width="3.4" height="8" rx="0.8" fill="#22d3ee" fillOpacity="0.85" />
              <rect x="10.3" y="7" width="3.4" height="13" rx="0.8" fill="#22d3ee" fillOpacity="0.85" />
              <rect x="16.6" y="3" width="3.4" height="17" rx="0.8" fill="#22d3ee" fillOpacity="0.85" />
            </svg>
            {t(lang, "auto2.positionsTitle")}
          </CardTitle>
          {opens.length > 0 && (
            <Badge variant="outline" className="border-emerald-700/60 bg-emerald-950/30 font-mono text-emerald-300">
              {opens.length} OPEN
            </Badge>
          )}
        </div>
        <p className="text-[11px] leading-relaxed text-zinc-500">{t(lang, "auto2.positionsSub")}</p>
      </CardHeader>
      <CardContent className="space-y-3 px-3 pt-0">
        {/* ── TÓM TẮT HIỆU SUẤT — donut + 4 hàng stats (kiểu mockup, số thật) ── */}
        {(() => {
          const nOpen = opens.length;
          const longs = opens.filter((o: any) => o.side === "LONG");
          const shorts = opens.filter((o: any) => o.side !== "LONG");
          const marginOf = (o: any) => ((o.capitalBefore ?? capitalNow) * (o.stakePct ?? 100)) / 100;
          let upnl = 0, marginSum = 0, roiWeighted = 0;
          for (const o of opens) {
            const margin = marginOf(o);
            const mark = tickers[o.symbol]?.price ?? o.entryPrice;
            const move = o.side === "SHORT" ? (o.entryPrice - mark) / o.entryPrice : (mark - o.entryPrice) / o.entryPrice;
            const roi = move * o.leverage * 100;
            upnl += (margin * roi) / 100;
            marginSum += margin;
            roiWeighted += roi * margin;
          }
          const uRoi = marginSum > 0 ? roiWeighted / marginSum : null;
          const longMargin = longs.reduce((s: number, o: any) => s + marginOf(o), 0);
          const longFrac = marginSum > 0 ? longMargin / marginSum : 0;
          // donut: vành tròn — xanh emerald = margin LONG, đỏ rose = margin SHORT
          const R = 30, C = 2 * Math.PI * R;
          const longLen = longFrac * C;
          const closed = (closedHist ?? []).filter((x: any) => x.status === "closed");
          const wins = closed.filter((x: any) => (x.pnlPct ?? 0) > 0).length;
          const wr = closed.length > 0 ? (wins / closed.length) * 100 : null;
          return (
            <div className="flex items-center gap-4 rounded-xl border-2 bg-[#0b1222]/60 px-3 py-2.5" style={{ borderColor: uRoi == null ? "#1e2d4d" : uRoi >= 0 ? "#10b981" : "#f43f5e" }}>
              <div className="w-20 shrink-0 text-center">
                  <div className={`font-mono text-lg font-bold ${uRoi == null ? "text-zinc-600" : uRoi >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{uRoi == null ? "—" : `${uRoi >= 0 ? "+" : ""}${uRoi.toFixed(2)}%`}</div>
                  <div className="text-[8px] font-semibold uppercase leading-tight tracking-wide text-zinc-500">{t(lang, "auto2.perfUroi")}</div>
                </div>
              {/* 4 hàng stats */}
              <dl className="grid min-w-0 flex-1 grid-cols-1 gap-y-1 font-mono text-[11px] sm:grid-cols-2 sm:gap-x-4">
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="font-sans text-zinc-500">{t(lang, "auto2.perfOpen")}</dt>
                  <dd className="font-bold text-zinc-100">{nOpen}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="font-sans text-zinc-500">LONG / SHORT</dt>
                  <dd className="font-bold"><span className="text-emerald-400">{longs.length}</span> / <span className="text-rose-400">{shorts.length}</span></dd>
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="font-sans text-zinc-500">{t(lang, "auto2.perfWr")}</dt>
                  <dd className="font-bold text-zinc-100">{wr == null ? "—" : `${wr.toFixed(2)}%`}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="font-sans text-zinc-500">{t(lang, "auto2.perfUpnl")}</dt>
                  <dd className={`font-bold ${nOpen === 0 ? "text-zinc-600" : upnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                    {nOpen === 0 ? "—" : `${upnl >= 0 ? "+$" : "−$"}${Math.abs(upnl).toFixed(2)}`}
                  </dd>
                </div>
              </dl>
            </div>
          );
        })()}
        {/* open position */}
        {open ? (
          <>
            {opens.map((open) => (
              <div key={open.id} className="rounded-lg border border-zinc-700 bg-zinc-900 p-2">

                {(() => {
                  const etRaw = open.entryTime ?? open.openedAt ?? open.createdAt ?? null;
                  const et = etRaw ? new Date(etRaw) : null;
                  const mins = et ? Math.max(0, Math.floor((Date.now() - et.getTime()) / 60000)) : null;
                  const book = open.book ?? "B";
                  const mark = tickers[open.symbol]?.price ?? open.entryPrice;
                  const mv = open.side === "SHORT" ? (open.entryPrice - mark) / open.entryPrice : (mark - open.entryPrice) / open.entryPrice;
                  const roi = mv * open.leverage * 100;
                  const timeTxt = et ? et.toLocaleTimeString("vi-VN", { hour12: false }) : "—";
                  const ago = mins == null ? "" : mins < 1 ? "vua vao" : mins < 60 ? mins + " phut truoc" : Math.floor(mins / 60) + "h" + (mins % 60) + "m truoc";
                  return (
                    <div className="mb-0.5 space-y-0.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className={`rounded px-1.5 py-0.5 font-mono text-xs font-bold ${book === "A" ? "bg-violet-950/70 text-violet-300" : book === "C" ? "bg-amber-950/70 text-amber-300" : book === "D" ? "bg-emerald-950/70 text-emerald-300" : "bg-sky-950/70 text-sky-300"}`}>{book}</span>
                        <span className="font-mono text-sm font-bold text-zinc-100">{open.symbol}</span>
                        <span className={`rounded px-1.5 py-0.5 font-mono text-xs font-bold ${open.side === "LONG" ? "bg-emerald-950/70 text-emerald-300" : "bg-rose-950/70 text-rose-300"}`}>{open.side}</span>
                        <span className="font-mono text-xs text-zinc-400">{open.interval}</span>
                        <span className="ml-auto font-mono text-xs text-zinc-300">Vao {timeTxt} - {ago}</span>
                      </div>
                      <div className="flex items-end justify-between gap-2">
                        <div>
                          <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Entry</div>
                          <div className="font-mono text-xl font-bold leading-none text-zinc-50">{fmtPrice(open.entryPrice)}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-xs text-zinc-500">Mark - cach Entry</div>
                          <div className="font-mono text-sm font-bold text-zinc-200">{fmtPrice(mark)} - <span className={mv >= 0 ? "text-emerald-400" : "text-rose-400"}>{mv >= 0 ? "+" : ""}{(mv * 100).toFixed(2)}%</span></div>
                          <div className="font-mono text-xs font-bold text-emerald-400">ROI {roi >= 0 ? "+" : ""}{roi.toFixed(2)}%</div>
                        </div>
                      </div>
                    </div>
                  );
                })()}
                <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                  <span className="text-zinc-500">{t(lang, "auto.pos.stake")}</span>
                  <span className="text-right font-mono text-zinc-200">
                    {(((open.capitalBefore ?? capitalNow) * (open.stakePct ?? 100)) / 100).toFixed(2)} USDT · {(open.stakePct ?? 100).toFixed(2)}%
                    <span className="text-zinc-500">
                      {" "}
                      · {t(lang, "auto.pos.notional")} {(((((open.capitalBefore ?? capitalNow) * (open.stakePct ?? 100)) / 100) * open.leverage)).toFixed(2)} USDT ({open.leverage}x)
                    </span>
                  </span>
                  <span className="text-zinc-500">PNL (USDT)</span>
                  <span className="text-right font-mono text-zinc-200">
                    {(() => {
                      const margin = ((open.capitalBefore ?? capitalNow) * (open.stakePct ?? 100)) / 100;
                      const mark = tickers[open.symbol]?.price ?? open.entryPrice;
                      const move = open.side === "SHORT" ? (open.entryPrice - mark) / open.entryPrice : (mark - open.entryPrice) / open.entryPrice;
                      const roi = move * open.leverage * 100;
                      const pnl = (margin * roi) / 100;
                      return (
                        <span className={pnl >= 0 ? "font-bold text-emerald-400" : "font-bold text-rose-400"}>
                          {pnl >= 0 ? "+$" : "-$"}{Math.abs(pnl).toFixed(2)}
                        </span>
                      );
                    })()}
                  </span>
                  <span className="text-zinc-500">Mark · Liq price</span>
                  <span className="text-right font-mono text-zinc-200">
                    {(() => {
                      const mark = tickers[open.symbol]?.price ?? open.entryPrice;
                      const liq = open.side === "SHORT" ? open.entryPrice * (1 + 1 / open.leverage) : open.entryPrice * (1 - 1 / open.leverage);
                      return (
                        <>
                          {fmtPrice(mark)} · <span className="text-rose-300">{fmtPrice(liq)}</span>
                        </>
                      );
                    })()}
                  </span>
                  <span className="text-zinc-500">SL</span>
                  <span className="text-right font-mono text-rose-300">
                    {fmtPrice(slPrice(open.side, open.entryPrice, open.slPct))} · −{(open.slPct * Number(open.leverage ?? 1)).toFixed(2)}% ROI
                    <span className="text-zinc-500"> (ROI −{(open.slPct * open.leverage).toFixed(2)}%)</span>
                  </span>
                  <span className="text-zinc-500">TP</span>
                  <span className="text-right font-mono text-emerald-300">
                    {fmtPrice(tpPrice(open.side, open.entryPrice, open.tpPct))} · +{(open.tpPct * Number(open.leverage ?? 1)).toFixed(2)}% ROI
                    <span className="text-zinc-500"> (ROI +{(open.tpPct * open.leverage).toFixed(2)}%)</span>
                  </span>
                  {cfg.trailOn && (
                    <>
                      <span className="text-zinc-500" title={t(lang, "auto.trail.tip")}>
                        🚉 Trail
                      </span>
                      {(() => {
                        // peak + bộ thông số ĐÃ KHOÁ từ engine snapshot (id phải khớp
                        // lệnh đang mở); trailAuto → act/dist là số đề xuất riêng cho
                        // lệnh (ATR(pair×TF)×đòn bẩy), không phải cfg chung; engine
                        // chưa tick lần nào thì fallback cfg như cũ
                        const et = engineTrail && engineTrail.id === open.id ? engineTrail : null;
                        const markPx = tickers[open.symbol]?.price ?? open.entryPrice; const livePeak = open.side === "SHORT" ? Math.min(open.entryPrice, markPx) : Math.max(open.entryPrice, markPx); const basePeak = et && et.peak > 0 ? et.peak : livePeak; const peak = open.side === "SHORT" ? Math.min(basePeak, markPx) : Math.max(basePeak, markPx);
                        const act = et && et.act > 0 ? et.act : cfg.trailActPct;
                        const dist = et && et.dist > 0 ? et.dist : cfg.trailDistPct;
                        const peakRoi = trailMovePct(open.side, open.entryPrice, peak) * open.leverage; const roiStop = trailRoiStopPrice(open.side, open.entryPrice, peakRoi, open.leverage); const stop = roiStop ?? trailStopPrice(open.side, open.entryPrice, peak, act, dist);
                        const move = peakRoi;
                        return (
                          <span className="text-right font-mono text-violet-300">
                            {stop != null ? (
                              <>
                                {fmtPrice(stop)}
                                <span className="text-zinc-500">
                                  {" "}
                                  · {t(lang, "auto.pos.trailPeak")} {fmtPrice(peak)} ({move >= 0 ? "+" : ""}
                                  {move.toFixed(2)}%)
                                </span>
                              </>
                            ) : (
                              <span className="text-zinc-500">{t(lang, "auto.pos.trailWait", { a: 3, m: Number(move.toFixed(2)) })}</span>
                            )}
                            {et?.src === "atr" && et.atrPct > 0 && (
                              <span
                                className="block text-[9px] font-sans text-zinc-600"
                                title={t(lang, "auto.trail.autoTip")}
                              >
                                {t(lang, "auto.pos.trailAuto", { a: Number(et.atrPct.toFixed(2)), l: et.lev || open.leverage, act: Number(act.toFixed(2)), dist: Number(dist.toFixed(2)) })}
                              </span>
                            )}
                          </span>
                        );
                      })()}
                    </>
                  )}
                </div>
                {(() => {
                  const sl = slPrice(open.side, open.entryPrice, open.slPct);
                  const hasTp = (open.tpPct ?? 0) > 0;
                  const tp = hasTp ? tpPrice(open.side, open.entryPrice, open.tpPct) : open.entryPrice;
                  const mark = tickers[open.symbol]?.price ?? open.entryPrice;
                  const lo = Math.min(sl, tp, open.entryPrice);
                  const hi = Math.max(sl, tp, open.entryPrice);
                  const pct = (v) => hi > lo ? Math.max(2, Math.min(98, ((v - lo) / (hi - lo)) * 100)) : 50;
                  const dSl = Math.abs((sl - mark) / mark) * 100;
                  const dTp = hasTp ? Math.abs((tp - mark) / mark) * 100 : null;
                  return (
                    <div className="mt-1 space-y-0.5">
                      <div className="flex justify-between font-mono text-xs text-zinc-500"><span>{open.side === "SHORT" && hasTp ? "TP " : "SL "}{fmtPrice(open.side === "SHORT" && hasTp ? tp : sl)}</span><span>Entry {fmtPrice(open.entryPrice)}</span><span>{hasTp ? (open.side === "SHORT" ? "SL " + fmtPrice(sl) : "TP " + fmtPrice(tp)) : "TP Trail"}</span></div>
                      <div className="relative h-2 rounded-full bg-zinc-800">
                        <div className="absolute top-1/2 h-3 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded bg-zinc-100" style={{ left: pct(open.entryPrice) + "%" }} />
                        <div className="absolute top-1/2 h-3 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded bg-emerald-400" style={{ left: pct(mark) + "%" }} />
                      </div>
                      <div className="flex justify-between font-mono text-xs text-zinc-500"><span>Con {dSl.toFixed(2)}% toi SL</span><span>{dTp != null ? "Con " + dTp.toFixed(2) + "% toi TP" : "TP theo Trail"}</span></div>
                    </div>
                  );
                })()}
                <Button size="sm" variant="outline" className="mt-2 h-7 w-full border-zinc-700 text-[11px] text-zinc-300 hover:bg-zinc-800" onClick={() => void closeNow(open)}>
                  <Square className="mr-1.5 h-3 w-3" />
                  {t(lang, "auto.pos.close")}
                </Button>
              </div>
            ))}
          </>
        ) : (
          rows.length > 0 && <p className="text-[11px] text-zinc-600">{t(lang, "auto.pos.none")}</p>
        )}

      </CardContent>
    </Card>
  );
}