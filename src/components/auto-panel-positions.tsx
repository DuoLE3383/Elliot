import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Square } from "lucide-react";
import { trailRoiStopPrice } from "@/lib/autotrade";

// Tach tu auto-panel.tsx - POSITIONS OPENING (Card 1369). Props any de tsc khong ket type.
// 0.3.12b — khối tóm tắt hiệu suất kiểu mockup: donut uROE (tỷ trọng margin
// LONG/SHORT) + 4 hàng stats (Open · LONG/SHORT · WR đóng · uPnL) — toàn bộ số
// thật từ opens + closedHist + tickers, không có lệnh thì vẽ vành đen + "—".
export function AutoPositions(props: any) {
  const { opens, open, tickers, cfg, capitalNow, lang, t, closeNow, closeOpen, fmtPrice, slPrice, tpPrice, trailStopPrice, trailMovePct, engineTrail, roeOf, rows, closedHist, leverage } = props;
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
        {/* ── AGENT ĐANG CHẠY — lấy từ cfg engine đang sync ── */}
        {(() => {
          const AGENT_META: Record<string, { icon: string; label: string }> = {
            VAULT: { icon: "🗄", label: "Safe — giữ vốn" },
            HEDGE: { icon: "⚖", label: "Balanced" },
            ALPHA: { icon: "🚀", label: "Aggressive" },
            GRAIL: { icon: "👑", label: "Elliott" },
          };
          const agentId = (cfg as any)?.agent ?? "HEDGE";
          const a = AGENT_META[agentId] ?? AGENT_META.HEDGE;
          const lev = (props as any)?.leverage ?? (cfg as any)?.leverage ?? open?.leverage ?? 0;
          const locked = !cfg?.on || opens.length === 0;
          return (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-violet-700/60 bg-gradient-to-r from-violet-950/60 via-teal-950/40 to-violet-950/60 px-2.5 py-1.5">
              <span className="text-sm">{a.icon}</span>
              <span className="shrink-0 font-mono text-[12px] font-bold text-violet-300">
                {agentId} Agent — {a.label}
              </span>
              <span className="min-w-0 flex-1 whitespace-normal leading-snug font-mono text-[11px] text-zinc-300" title={`current executing · Risk ${cfg?.riskPct ?? "?"}% · Gate ${cfg?.minScore ?? "?"}/${cfg?.minAuc ?? "?"}/${cfg?.minAcc ?? "?"} · TF ${(cfg?.runTf ?? []).join("/")} · Lev ×${lev}`}>
                current executing · Risk {cfg?.riskPct ?? "?"}% · Gate {cfg?.minScore ?? "?"}/{cfg?.minAuc ?? "?"}/{cfg?.minAcc ?? "?"} · TF {(cfg?.runTf ?? []).join("/")} · Lev ×{lev}
              </span>
              <span className={`ml-auto shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] font-bold ${locked ? "bg-amber-950/60 text-amber-300" : "bg-emerald-950/60 text-emerald-300"}`}>
                {locked ? "● STANDBY / SCANNING" : "● IN POSITION"}
              </span>
            </div>
          );
        })()}
        {/* ── TÓM TẮT HIỆU SUẤT — donut + 4 hàng stats (kiểu mockup, số thật) ── */}
        {(() => {
          const nOpen = opens.length;
          const longs = opens.filter((o: any) => o.side === "LONG");
          const shorts = opens.filter((o: any) => o.side !== "LONG");
          const marginOf = (o: any) => ((o.capitalBefore ?? capitalNow) * (o.stakePct ?? 100)) / 100;
          let upnl = 0, marginSum = 0, roeWeighted = 0;
          for (const o of opens) {
            const margin = marginOf(o);
            const mark = tickers[o.symbol]?.price ?? o.entryPrice;
            const move = o.side === "SHORT" ? (o.entryPrice - mark) / o.entryPrice : (mark - o.entryPrice) / o.entryPrice;
            const roi = move * o.leverage * 100;
            upnl += (margin * roi) / 100;
            marginSum += margin;
            roeWeighted += roi * margin;
          }
          const uRoe = marginSum > 0 ? roeWeighted / marginSum : null;
          const longMargin = longs.reduce((s: number, o: any) => s + marginOf(o), 0);
          const longFrac = marginSum > 0 ? longMargin / marginSum : 0;
          // donut: vành tròn — xanh emerald = margin LONG, đỏ rose = margin SHORT
          const R = 30, C = 2 * Math.PI * R;
          const longLen = longFrac * C;
          const closed = (closedHist ?? []).filter((x: any) => x.status === "closed");
          const wins = closed.filter((x: any) => (x.pnlPct ?? 0) > 0).length;
          const wr = closed.length > 0 ? (wins / closed.length) * 100 : null;
          return (
            <div className="flex items-center gap-4 rounded-xl border-2 bg-[#0b1222]/60 px-3 py-2.5" style={{ borderColor: uRoe == null ? "#1e2d4d" : uRoe >= 0 ? "#10b981" : "#f43f5e" }}>
              <div className="w-20 shrink-0 text-center">
                  <div className={`font-mono text-lg font-bold ${uRoe == null ? "text-zinc-600" : uRoe >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{uRoe == null ? "—" : `${uRoe >= 0 ? "+" : ""}${uRoe.toFixed(2)}%`}</div>
                  <div className="text-[8px] font-semibold uppercase leading-tight tracking-wide text-zinc-500">{t(lang, "auto2.perfUroe")}</div>
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
              <div key={open.id} className="rounded-lg border border-zinc-700 bg-zinc-900 p-2.5">

                <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                  <span className="text-zinc-500">{t(lang, "auto.col.pair")}</span>
                  <span className="text-right font-mono text-zinc-200">
                    {open.symbol} · {open.interval} · <span className={open.side === "LONG" ? "font-bold text-emerald-400" : "font-bold text-rose-400"}>{open.side}</span>
                  </span>
                  <span className="text-zinc-500">{t(lang, "auto.pos.entry")}</span>
                  <span className="text-right font-mono text-zinc-200">{fmtPrice(open.entryPrice)}</span>
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
                          {pnl >= 0 ? "+$" : "-$"}{Math.abs(pnl).toFixed(2)} · ROI {roi >= 0 ? "+" : ""}{roi.toFixed(2)}%
                        </span>
                      );
                    })()}
                  </span>
                  <span className="text-zinc-500">Giá đánh dấu · Giá thanh lý</span>
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
                    {fmtPrice(slPrice(open.side, open.entryPrice, open.slPct))} · −{open.slPct.toFixed(2)}%
                    <span className="text-zinc-500"> (ROI −{(open.slPct * open.leverage).toFixed(2)}%)</span>
                  </span>
                  <span className="text-zinc-500">TP</span>
                  <span className="text-right font-mono text-emerald-300">
                    {fmtPrice(tpPrice(open.side, open.entryPrice, open.tpPct))} · +{open.tpPct.toFixed(2)}%
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
                        const peak = et && et.peak > 0 ? et.peak : open.entryPrice;
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
                  <span className="text-zinc-500">{t(lang, "auto.pos.uroe")}</span>
                  {(() => {
                    const live = tickers[open.symbol]?.price ?? open.entryPrice;
                    const roe = roeOf(open.side, open.entryPrice, live, open.leverage);
                    return (
                      <span className={`text-right font-mono font-bold ${roe >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                        {roe >= 0 ? "+" : ""}
                        {roe.toFixed(2)}%
                      </span>
                    );
                  })()}
                </div>
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
