"use client";

export interface OpenPositionItem {
  id?: string;
  symbol: string;
  side?: string;
  timeframe?: string;
  ageH: number;
  entryPrice?: number;
  markPrice?: number;
  pnlUsd?: number;
  roi?: number;
  slPrice?: number;
  tpPrice?: number;
  distSlPct?: number;
  distTpPct?: number;
  marginUsd?: number;
  sizeUsd?: number;
  leverage?: number;
  liqPrice?: number | null;
  trailText?: string;
  p1Pct?: number | null;
  p1Share?: number | null;
  tp2Pct?: number | null;
  trailPct?: number | null;
  peakPrice?: number | null;
}

interface OpenPositionsModalProps {
  open: boolean;
  inline?: boolean;
  positions: OpenPositionItem[];
  onClose: () => void;
  onClosePosition?: (pos: OpenPositionItem) => void;
}

function fmtPrice(v?: number): string {
  if (v == null || Number.isNaN(v)) return "—";
  if (v >= 100) return v.toFixed(2);
  if (v >= 1) return v.toFixed(4);
  return v.toFixed(5);
}

function fmtUsd(v?: number, withSign = false): string {
  if (v == null || Number.isNaN(v)) return "—";
  const sign = withSign ? (v >= 0 ? "+" : "-") : v < 0 ? "-" : "";
  return `${sign}$${Math.abs(v).toFixed(2)}`;
}

function fmtPct(v?: number, withSign = false): string {
  if (v == null || Number.isNaN(v)) return "—";
  const sign = withSign ? (v >= 0 ? "+" : "") : "";
  return `${sign}${v.toFixed(2)}%`;
}

export function OpenPositionsModal({
  open,
  positions,
  onClose,
  onClosePosition,
  inline,
}: OpenPositionsModalProps) {
  if (!open) return null;
  const totalPnl = positions.reduce((s, x) => s + (x.pnlUsd ?? 0), 0);
  if (inline) {
    // Render inline: cao bằng panel trái, header ghim, list cuộn bên trong
    return (
      <div style={{ maxHeight: 620 }} className="flex h-full flex-col overflow-hidden rounded-2xl border border-[#26262c] bg-[#121216] text-[#e9e9ec] shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[#222228] bg-[#121216] px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            <h3 className="text-sm font-semibold tracking-tight">Open Positions ({positions.length})</h3>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto divide-y divide-[#202026] p-3 space-y-3">
          {positions.length === 0 ? (
            <div className="py-10 text-center text-xs text-[#8b8b94]">No open positions.</div>
          ) : (
            positions.map((pos, i) => {
              const isLong = pos.side?.toUpperCase() === "LONG";
              const sl = pos.slPrice ?? 0; const tp = pos.tpPrice ?? 0;
              const entry = pos.entryPrice ?? 0; const mark = pos.markPrice ?? entry;
              const roiVal = Number((pos as any)?.roi ?? (pos as any)?.roePct ?? 0);
              const roiIsProfit = roiVal >= 0; // ROI am -> do, khong lay mau theo pnlTotal
    const peak = Number(((pos as any)?.peakPrice ?? (pos as any)?.peak ?? mark));
    const peakRoi = ((pos as any)?.entryPrice && peak) ? (String(((pos as any)?.side ?? '')).toUpperCase() === 'SHORT' ? (((pos as any).entryPrice - peak) / (pos as any).entryPrice) : ((peak - (pos as any).entryPrice) / (pos as any).entryPrice)) * 100 * Number(((pos as any)?.leverage ?? 1)) : 0;
    // TP1 CHUAN: p1Share DB la 0..1, neu >1 thi /100. Khong co p1Pct => chua TP1, khong tu suy.
    const p1ShareRaw = Number((pos as any)?.p1Share ?? 0);
    const p1ShareFrac = p1ShareRaw > 1 ? Math.min(1, p1ShareRaw / 100) : Math.min(1, Math.max(0, p1ShareRaw));
    const hasTp1 = (pos as any)?.p1Pct != null && p1ShareFrac > 0;
    const bankedRoi = Number((pos as any)?.p1Pct ?? 0); // p1Pct = ROI % cua phan banked, da tru phi
    const marginFull = Number((pos as any)?.margin ?? (pos as any)?.marginUsd ?? (pos as any)?.entryCapital ?? ((pos as any)?.sizeUsd != null && (pos as any)?.leverage ? (pos as any).sizeUsd / (pos as any).leverage : 0));
    const remainFrac = hasTp1 ? (1 - p1ShareFrac) : 1;
    const bankedPnl = hasTp1 ? marginFull * p1ShareFrac * (bankedRoi / 100) : 0;
    const marginRemain = marginFull * remainFrac;
    const sizeRemain = marginRemain * Number((pos as any)?.leverage ?? 1);
    // PNL HIEN DUNG: banked + runner, khong phai marginFull * ROI hien tai
    const curRoi = Number((pos as any)?.roi ?? (pos as any)?.roePct ?? 0); // roi backend = move * leverage cua lenh, roePct DB = ROI
    const pnlTotal = hasTp1 ? bankedPnl + marginRemain * (curRoi / 100) : marginFull * (curRoi / 100);
    const isProfit = pnlTotal >= 0; // mau theo PNL $ dung (banked + runner)
              const span = Math.abs(tp - sl);
              const clamp01 = (val: number) => Math.max(4, Math.min(96, val));
              const entryPos = span > 0 ? clamp01(((entry - Math.min(sl, tp)) / span) * 100) : 50;
              const markPos = span > 0 ? clamp01(((mark - Math.min(sl, tp)) / span) * 100) : 55;
              return (
                <div key={pos.id ?? `${pos.symbol}-${i}`} className="rounded-xl border border-[#24242c] bg-[#16161c] p-3.5 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-bold text-white">{pos.symbol}</span>
                      <span className={`rounded px-1.5 py-0.5 text-xs font-bold uppercase ${isLong ? "bg-emerald-400/15 text-emerald-400" : "bg-rose-400/15 text-rose-400"}`}>{pos.side}</span>
                      {pos.timeframe && <span className="text-xs text-[#8b8b94]">{pos.timeframe}</span>}
                      <span className="text-xs text-[#71717a]">· {(pos.ageH ?? 0).toFixed(2)}h</span>
                    </div>
                    <span className={`font-mono text-xs font-bold ${roiIsProfit ? "text-emerald-400" : "text-rose-400"}`}>ROI {fmtPct(pos.roi ?? undefined, true)}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 rounded-lg bg-[#111116] px-3 py-2 border border-[#202027]">
                    <div><div className="text-xs uppercase text-[#7c7c86]">Entry</div><div className="font-mono text-xs font-semibold">{fmtPrice(pos.entryPrice)}</div></div>
                    <div><div className="text-xs uppercase text-[#7c7c86]">Mark</div><div className="font-mono text-xs font-semibold">{fmtPrice(pos.markPrice)}</div></div>
                    <div className="text-right"><div className="text-xs uppercase text-[#7c7c86]">PnL</div><div className={`font-mono text-xs font-bold ${isProfit ? "text-emerald-400" : "text-rose-400"}`}>{fmtUsd(pnlTotal, true)}</div></div>
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between font-mono text-xs text-[#9aa0a6]">
                      <span className="text-rose-400">{isLong ? "SL " : "TP "}{fmtPrice(isLong ? pos.slPrice : pos.tpPrice)}</span>
                      <span className="text-[#a1a1aa]">Entry {fmtPrice(pos.entryPrice)}</span>
                      <span className="text-[#a1a1aa]">{isLong ? "TP " : "SL "}{fmtPrice(isLong ? pos.tpPrice : pos.slPrice)}</span>
                    </div>
                    <div className="relative h-2 w-full rounded-full bg-[#24242d]">
                      <span className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 h-3 w-0.5 bg-[#a1a1aa]" style={{ left: `${entryPos}%` }} />
                      <span className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 h-3.5 w-1.5 rounded-sm ${isProfit ? "bg-emerald-400" : "bg-rose-400"}`} style={{ left: `${markPos}%` }} />
                    </div>
                    <div className="flex items-center justify-between text-xs text-[#8b8b94]">
      <div className="mt-1 flex items-center justify-between text- text-zinc-400"><span>Peak <span className="font-mono text-amber-300">{peak.toFixed(5)}</span></span><span className="font-mono text-amber-300">{peakRoi >= 0 ? "+" : ""}{peakRoi.toFixed(2)}% ROI</span></div>
      {hasTp1 && (<div className="flex items-center justify-between text-"><span className="text-emerald-300">TP1 partial {(p1ShareFrac*100).toFixed(0)}% · Banked +${bankedPnl.toFixed(2)} @ +{bankedRoi.toFixed(2)}%</span><span className="text-zinc-300">Remaining ${marginRemain.toFixed(2)} ({(remainFrac*100).toFixed(0)}%) · Size ${sizeRemain.toFixed(2)}</span></div>)}
                      <span><strong className="font-mono text-[#d4d4d8]">{fmtPct(pos.distTpPct)}</strong> {(pos.distTpPct ?? 0) < 0 ? "past TP" : "to TP"}</span>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-[#202027] text-xs text-[#8b8b94]">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono">
                      <span>Margin <b className="text-[#d4d4d8]">{fmtUsd(pos.marginUsd)}</b></span>
                      <span>Size <b className="text-[#d4d4d8]">{fmtUsd(pos.sizeUsd)}</b>{pos.leverage ? ` (${pos.leverage}x)` : ""}</span>
                      {pos.liqPrice != null && <span>Liq <b className="text-rose-400">{fmtPrice(pos.liqPrice)}</b></span>}
                      {pos.trailText && <span className="text-[#93c5fd]">{pos.trailText}</span>}
                    </div>
                    {onClosePosition && <button type="button" onClick={() => onClosePosition(pos)} className="rounded-lg border border-[#2e2e38] bg-[#1e1e26] px-3 py-1 text-xs font-medium hover:border-rose-400/60 hover:text-rose-400">Close</button>}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur- p-3 pt-14 sm:pt-16"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl translate-y-2 sm:translate-y-4 rounded-2xl border border-[#26262c] bg-[#121216] text-[#e9e9ec] shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[#222228] px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            <h3 className="text-sm font-semibold tracking-tight">
              Open Positions ({positions.length})
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[#2a2a32] bg-[#19191f] px-2.5 py-1 text-xs text-[#a1a1aa] hover:text-white transition"
          >
            Esc / Close
          </button>
        </div>

        <div style={{ maxHeight: 520 }} className="overflow-y-auto divide-y divide-[#202026] p-3 space-y-3">
          {positions.length === 0 ? (
            <div className="py-10 text-center text-xs text-[#8b8b94]">
              No open positions.
            </div>
          ) : (
            positions.map((pos, i) => {
              const isLong = pos.side?.toUpperCase() === "LONG";
              // isProfit tinh sau roiVal qua pnlTotal
              const sl = pos.slPrice ?? 0;
              const tp = pos.tpPrice ?? 0;
              const entry = pos.entryPrice ?? 0;
              const mark = pos.markPrice ?? entry;
              const p1ShareRaw = Number((pos as any)?.p1Share ?? 0);
              const p1ShareFrac = p1ShareRaw > 1 ? Math.min(1, p1ShareRaw / 100) : Math.min(1, Math.max(0, p1ShareRaw));
              const hasTp1 = (pos as any)?.p1Pct != null && p1ShareFrac > 0;
              const bankedRoi = Number((pos as any)?.p1Pct ?? 0);
              const marginFull = Number((pos as any)?.margin ?? (pos as any)?.marginUsd ?? (pos as any)?.entryCapital ?? ((pos as any)?.sizeUsd != null && (pos as any)?.leverage ? (pos as any).sizeUsd / (pos as any).leverage : 0));
              const bankedPnl = hasTp1 ? marginFull * p1ShareFrac * (bankedRoi / 100) : 0;
              const roiVal = Number((pos as any)?.roi ?? (pos as any)?.roePct ?? 0); const marginRemain = hasTp1 ? marginFull * (1 - p1ShareFrac) : marginFull; const pnlTotal = hasTp1 ? bankedPnl + marginRemain * (roiVal / 100) : marginFull * (roiVal / 100); const isProfit = pnlTotal >= 0;
              const roiIsProfit = roiVal >= 0; // ROI am -> do, khong lay mau theo pnlTotal
              const span = Math.abs(tp - sl);
              const clamp01 = (val: number) => Math.max(4, Math.min(96, val));
              const entryPos =
                span > 0 ? clamp01(((entry - Math.min(sl, tp)) / span) * 100) : 50;
              const markPos =
                span > 0 ? clamp01(((mark - Math.min(sl, tp)) / span) * 100) : 55;

              return (
                <div
                  key={pos.id ?? `${pos.symbol}-${i}`}
                  className="rounded-xl border border-[#24242c] bg-[#16161c] p-3.5 space-y-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-bold text-white">
                        {pos.symbol}
                      </span>
                      <span
                        className={`rounded px-1.5 py-0.5 text-xs font-bold uppercase ${
                          isLong
                            ? "bg-emerald-400/15 text-emerald-400"
                            : "bg-rose-400/15 text-rose-400"
                        }`}
                      >
                        {pos.side}
                      </span>
                      {pos.timeframe && (
                        <span className="text-xs text-[#8b8b94]">{pos.timeframe}</span>
                      )}
                      <span className="text-xs text-[#71717a]">
                        · {(pos.ageH ?? 0).toFixed(2)}h
                      </span>
                    </div>
                    <div className="text-right">
                      <span
                        className={`font-mono text-xs font-bold ${
                          roiIsProfit ? "text-emerald-400" : "text-rose-400"
                        }`}
                      >
                        ROI {fmtPct(pos.roi ?? undefined, true)}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2 rounded-lg bg-[#111116] px-3 py-2 border border-[#202027]">
                    <div>
                      <div className="text-xs uppercase text-[#7c7c86]">Entry</div>
                      <div className="font-mono text-xs font-semibold text-[#e9e9ec]">
                        {fmtPrice(pos.entryPrice)}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs uppercase text-[#7c7c86]">Mark</div>
                      <div className="font-mono text-xs font-semibold text-[#e9e9ec]">
                        {fmtPrice(pos.markPrice)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs uppercase text-[#7c7c86]">PnL</div>
                      <div
                        className={`font-mono text-xs font-bold ${
                          isProfit ? "text-emerald-400" : "text-rose-400"
                        }`}
                      >
                        {fmtUsd(pnlTotal, true)}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between font-mono text-xs text-[#9aa0a6]">
                      <span className="text-rose-400">{isLong ? "SL " : "TP "}{fmtPrice(isLong ? pos.slPrice : pos.tpPrice)}</span>
                      <span className="text-[#a1a1aa]">Entry {fmtPrice(pos.entryPrice)}</span>
                      <span className="text-[#a1a1aa]">{isLong ? "TP " : "SL "}{fmtPrice(isLong ? pos.tpPrice : pos.slPrice)}</span>
                    </div>
                    <div className="relative h-2 w-full rounded-full bg-[#24242d]">
                      <span
                        className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 h-3 w-0.5 bg-[#a1a1aa]"
                        style={{ left: `${entryPos}%` }}
                      />
                      <span
                        className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 h-3.5 w-1.5 rounded-sm ${
                          isProfit ? "bg-emerald-400" : "bg-rose-400"
                        }`}
                        style={{ left: `${markPos}%` }}
                      />
                    </div>
                    <div className="flex items-center justify-between text-xs text-[#8b8b94]">
                      {hasTp1 ? (<span>TP1 <b className="text-emerald-400">+{bankedRoi.toFixed(2)}% ROI</b> · Banked <b>+${bankedPnl.toFixed(2)}</b> · Taken {(p1ShareFrac*100).toFixed(0)}%</span>) : null}
                      <span>
                        <strong className="font-mono text-[#d4d4d8]">
                          {fmtPct(pos.distTpPct)}
                        </strong>{" "}
                        {(pos.distTpPct ?? 0) < 0 ? "past TP" : "to TP"}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-[#202027] text-xs text-[#8b8b94]">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono">
                      <span>
                        Margin <b className="text-[#d4d4d8]">{fmtUsd(pos.marginUsd)}</b>
                      </span>
                      <span>
                        Size <b className="text-[#d4d4d8]">{fmtUsd(pos.sizeUsd)}</b>
                        {pos.leverage ? ` (${pos.leverage}x)` : ""}
                      </span>
                      {pos.liqPrice != null && (
                        <span>
                          Liq <b className="text-rose-400">{fmtPrice(pos.liqPrice)}</b>
                        </span>
                      )}
                      {pos.trailText && (
                        <span className="text-[#93c5fd]">{pos.trailText}</span>
                      )}
                    </div>
                    {onClosePosition && (
                      <button
                        type="button"
                        onClick={() => onClosePosition(pos)}
                        className="rounded-lg border border-[#2e2e38] bg-[#1e1e26] px-3 py-1 text-xs font-medium text-[#e9e9ec] hover:border-rose-400/60 hover:text-rose-400 transition"
                      >
                        Close
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
