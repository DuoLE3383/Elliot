import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fetchForceStats, shouldWarnForce } from "@/lib/force-learn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RotateCcw } from "lucide-react";

// Tach tu auto-panel.tsx - CAPITAL + AUDIT + WIN RATE + RESET + BYCOMBO + HISTORY (Card 1510).
// Props any de tsc khong ket type. Chi tiet lenh se them vao day, khong phinh file cu.
// 0.3.12 — header "Recent Trades" theo mockup redesign.
export function AutoHistory(props: any) {
  const { auto, capitalNow, cfg, lang, t, auditRes, auditBusy, doAudit, doResetCapital, resetOpen, setResetOpen, resetAmount, setResetAmount, resetBusy, closedHist, sideClass, onPickPair, NOISE_BAND, ConfluenceTable, best, flipped, rows, confluenceMap, TOP_N, ef, blockedWhy, probShown, scanning, trainHist, bcastSnap, ListChecks } = props;
  return (
    <Card className="border-[#1e2d4d]/70 bg-[#0a0f1e]/80 mt-4">
      <CardHeader className="px-4 pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-1.5 text-base font-semibold text-zinc-100">
            {/* list icon — kiểu mockup */}
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden>
              <path d="M8 6 H21 M8 12 H21 M8 18 H21" stroke="#38bdf8" strokeWidth="2" strokeLinecap="round" />
              <circle cx="4" cy="6" r="1.4" fill="#38bdf8" />
              <circle cx="4" cy="12" r="1.4" fill="#38bdf8" />
              <circle cx="4" cy="18" r="1.4" fill="#38bdf8" />
            </svg>
            {t(lang, "auto2.recentTrades")}
          </CardTitle>
          {closedHist.length > 0 && (
            <span className="font-mono text-[10px] text-zinc-500">{closedHist.length}×</span>
          )}
        </div>
        <p className="text-[11px] leading-relaxed text-zinc-500">{t(lang, "auto2.recentSub")}</p>
      </CardHeader>
      <CardContent className="space-y-3 px-3 pt-0">
        {/* capital + stats */}
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-2">
            <p className="whitespace-normal leading-snug text-[10px] uppercase tracking-wide text-zinc-500">{t(lang, "auto.capital.now")}</p>
            <p className="mt-0.5 whitespace-normal leading-snug font-mono text-[16px] font-bold text-zinc-100">{capitalNow.toFixed(2)}</p>
            <p className="whitespace-normal leading-snug text-[9px] text-zinc-600">{t(lang, "auto.capital.start", { n: auto?.walletCapital ?? cfg.capital })}</p>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-2">
            <p className="whitespace-normal leading-snug text-[10px] uppercase tracking-wide text-zinc-500">Net ROI</p>
            <p className={`mt-0.5 whitespace-normal leading-snug font-mono text-[16px] font-bold ${(auto?.stats.netPnlPct ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
              {(auto?.stats.netPnlPct ?? 0) >= 0 ? "+" : ""}
              {(auto?.stats.netPnlPct ?? 0).toFixed(2)}%
            </p>
            <p className="whitespace-normal leading-snug text-[9px] text-zinc-600">{t(lang, "auto.stats.trades", { n: auto?.stats.closed ?? 0 })}</p>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-2">
            <p className="whitespace-normal leading-snug text-[10px] uppercase tracking-wide text-zinc-500">Win</p>
            <p className="mt-0.5 whitespace-normal leading-snug font-mono text-[16px] font-bold text-zinc-100">{(auto?.stats.winRate ?? 0).toFixed(2)}%</p>
            <p className="whitespace-normal leading-snug text-[9px] text-zinc-600">
              {auto?.stats.wins ?? 0}/{auto?.stats.closed ?? 0}
            </p>
          </div>
        </div>

        <div className="grid items-stretch gap-3 lg:grid-cols-2">
          <ConfluenceTable onPickPair={onPickPair} />
          <div className="flex h-full flex-col">
        {/* best pick + ranking — scan table always shows, even with no results */}
        <div className="space-y-1.5">
          {best && (
            <div className="flex items-center justify-between rounded-lg border border-teal-800/60 bg-teal-950/20 px-2.5 py-1.5">
              <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-teal-400">
                {t(lang, "auto.best")}
              </span>
              <span className="flex items-center gap-2">
                {flipped && (
                  <span
                    title={t(lang, "auto.best.flip.tip")}
                    className="rounded border border-amber-700/60 bg-amber-950/40 px-1.5 py-0.5 text-[9px] font-bold text-amber-400"
                  >
                    ⚠ {t(lang, "auto.best.flip")}
                  </span>
                )}
                <button
                  type="button"
                  className="font-mono text-xs font-bold text-zinc-100 hover:text-teal-300"
                  onClick={() => onPickPair(best.symbol, best.interval)}
                >
                  {best.symbol} {best.interval} <span className={sideClass(best.bias)}>{best.bias}</span> · {best.score.toFixed(2)}
                </button>
              </span>
            </div>
          )}
          <div className="flex-1 overflow-x-auto rounded-lg border border-zinc-800">
              {/* cột số co đúng nội dung (kể cả nhãn vi "HƯỚNG"), PAIR (1fr)
                  nhận toàn bộ phần còn lại — hết cảnh whitespace-normal leading-snug "XMR…" */}
              <div className="grid grid-cols-[170px_40px_52px_60px_44px_54px_50px_64px] min-w- gap-x-0.5 border-b border-zinc-800 bg-zinc-950/60 px-1.5 py-1 text-[9px] font-semibold uppercase tracking-wide text-zinc-500">
                <span>{t(lang, "auto.col.pair")}</span>
                <span>{t(lang, "auto.col.tf")}</span>
                <span>{t(lang, "auto.col.side")}</span>
                <span className="text-right">{t(lang, "auto.col.prob")}</span>
                <span className="text-right">{t(lang, "auto.col.auc")}</span>
                <span className="text-right">{t(lang, "auto.col.acc")}</span>
                <span className="text-right">{t(lang, "auto.col.score")}</span>
                <span className="text-right">Force</span>
              </div>
              {rows.slice(0, TOP_N).map((r, i) => {
                const tradeable = r.bias !== "NEUTRAL" && r.auc >= ef.minAuc && r.acc >= ef.minAcc && (ef.minScore <= 0 || r.score >= ef.minScore);
                const why = blockedWhy(r);
                return (
                  <button
                    key={`${r.symbol}-${r.interval}`}
                    type="button"
                    onClick={() => onPickPair(r.symbol, r.interval)}
                    title={why ? t(lang, "auto.block.tip", { why }) : undefined}
                    className={`grid w-full grid-cols-[170px_40px_52px_60px_44px_54px_50px_64px] min-w- items-center gap-x-0.5 px-1.5 py-1 text-left font-mono text-[10px] hover:bg-zinc-800/60 ${
                      i === 0 ? "bg-teal-950/20" : ""
                    }`}
                  >
                    <span className="whitespace-normal leading-snug text-zinc-200">
                      {r.symbol}
                      {confluenceMap[r.symbol] ? <span className="ml-1 text-s text-violet-400">· {confluenceMap[r.symbol]}</span> : null}
                      {r.regressed && (
                        <span
                          title={t(lang, "auto.regress.tip", { auc: (r.champAuc ?? 0).toFixed(2) })}
                          className="ml-1 text-amber-500"
                        >
                          ↓
                        </span>
                      )}
                      {r.whale?.tag === "whale" && (
                        <span title={`🐋 volZ ${(r.whale.volZ ?? 0).toFixed(2)}σ`} className="ml-1 text-amber-400">🐋</span>
                      )}
                      {r.whale?.tag === "watch" && (
                        <span title={`volZ ${(r.whale.volZ ?? 0).toFixed(2)}σ`} className="ml-1 text-zinc-600">🐋</span>
                      )}
                    </span>
                    <span className="text-zinc-500">{r.interval}</span>
                    <span className={sideClass(r.bias)}>{r.bias === "NEUTRAL" ? "—" : r.bias}</span>
                    <span className="text-right text-zinc-300" title={r.bias === "SHORT" ? t(lang, "auto.col.prob.tip") : undefined}>
                      {(probShown(r) * 100).toFixed(2)}%
                    </span>
                    <span className={`text-right ${r.auc >= ef.minAuc ? "text-emerald-400" : "text-zinc-500"}`}>{r.auc.toFixed(2)}</span>
                    <span className={`text-right ${r.acc >= ef.minAcc ? "text-emerald-400" : "text-zinc-500"}`}>{r.acc.toFixed(2)}%</span>
                    <span className={`text-right font-bold ${tradeable && !r.regressed ? "text-teal-300" : "text-zinc-600"}`}>{r.score.toFixed(2)}</span>
                    <span className="text-right">
                      <button type="button" onClick={async (e) => { e.stopPropagation(); try { const st = await fetchForceStats(r.symbol, r.interval, r.bias); const warn = shouldWarnForce(st, r.symbol, r.interval, r.bias); if (warn && !confirm(warn + "\n\nForce anyway?")) return; } catch {} fetch("/api/force-open", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ symbol: r.symbol, interval: r.interval, bias: r.bias, agent: "HEDGE", score: r.score, riskPct: (cfg as any)?.riskPct ?? 10 }) }).then(() => window.location.reload()); }} className="rounded bg-teal-600 px-1.5 py-0.5 text- font-bold text-white hover:bg-teal-500 disabled:opacity-40" disabled={r.bias === "NEUTRAL"}>Force</button>
                    </span>
                  </button>
                );
              })}
              {rows.length === 0 && !scanning && (
                <div className="grid grid-cols-[170px_40px_52px_60px_44px_54px_50px_64px] gap-x-0.5 px-1.5 py-2 font-mono text-xs text-zinc-500">
                  <span className="col-span-8">{t(lang, "auto.scan.empty")}</span>
                </div>
              )}
            </div>
            <p className="text-[10px] leading-snug text-zinc-600">{t(lang, "auto.rank.hint")}</p>
            {/* 0.3.2 — sàn HIỆU LỰC engine đang lọc: DQF tự học thì hiện rõ để
                user thấy bảng đổi màu theo sàn động, không nhầm với cfg panel */}
            {ef.src === "dqf" && (
              <p
                className="mt-0.5 text-[10px] font-medium text-teal-400"
                title={t(lang, "auto.dqf.floors.tip")}
              >
                {t(lang, "auto.dqf.floors", { s: Math.round(ef.minScore), a: ef.minAuc.toFixed(2), c: Math.round(ef.minAcc) })}
              </p>
            )}
        </div>

          </div>
        </div>

        {/* train history — every backend train is persisted (FinetuneRun); the
            🏆 badge marks the best run per combo, the champion–challenger bar
            every fresh train must clear before it may trade */}
        {trainHist && (trainHist.total > 0 || trainHist.latest.length > 0) && (
          <div className="border-t border-zinc-800 pt-2">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">{t(lang, "auto.trainhist.title")}</p>
              <span className="font-mono text-[10px] text-zinc-600">{t(lang, "auto.trainhist.total", { n: trainHist.total })}</span>
            </div>
            <div className="rail-scroll mt-1.5 max-h-32 space-y-0.5 overflow-y-auto pr-0.5">
              {trainHist.latest.map((r, i) => (
                <button
                  key={`${r.symbol}-${r.interval}-${r.at}-${i}`}
                  type="button"
                  onClick={() => onPickPair(r.symbol, r.interval)}
                  className="flex w-full items-center gap-2 rounded px-1.5 py-0.5 font-mono text-[10px] hover:bg-zinc-800/60"
                >
                  <span className="shrink-0 text-zinc-600">
                    {new Date(r.at).toLocaleTimeString(lang === "vi" ? "vi-VN" : "en-GB", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })}
                  </span>
                  <span className="whitespace-normal leading-snug text-zinc-300">
                    {r.symbol} {r.interval}
                  </span>
                  {r.best && (
                    <span title={t(lang, "auto.trainhist.champ")} className="shrink-0">
                      🏆
                    </span>
                  )}
                  <span className="ml-auto shrink-0 text-zinc-400">AUC {r.auc.toFixed(2)}</span>
                  <span className={`shrink-0 ${r.acc >= ef.minAcc ? "text-emerald-400" : "text-zinc-500"}`}>{r.acc.toFixed(2)}%</span>
                </button>
              ))}
            </div>
            <p className="mt-1 text-[10px] leading-snug text-zinc-600">{t(lang, "auto.trainhist.hint")}</p>
          </div>
        )}

        {/* broadcast verdicts — MỘT thuật toán gate (bcast-gate.gateRow) upsert
            vào bảng BcastVerdict của custom.db; Telegram chỉ đăng combo "pass"
            của CÙNG bảng này nên panel và TG không thể lệch nhau */}
        {bcastSnap && bcastSnap.total > 0 && (
          <div className="border-t border-zinc-800 pt-2">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">{t(lang, "auto.bcast.title")}</p>
              <span className="font-mono text-[10px] text-zinc-600">
                {bcastSnap.pass}/{bcastSnap.total} {t(lang, "auto.bcast.pass")}
              </span>
            </div>
            <div className="rail-scroll mt-1.5 max-h-32 space-y-0.5 overflow-y-auto pr-0.5">
              {bcastSnap.rows.slice(0, 10).map((r, i) => {
                const pass = r.verdict === "pass";
                return (
                  <button
                    key={`${r.symbol}-${r.interval}-${i}`}
                    type="button"
                    onClick={() => onPickPair(r.symbol, r.interval)}
                    title={`${r.symbol} ${r.interval} · AUC ${r.auc.toFixed(2)} · ACC ${r.acc.toFixed(2)}% · ${new Date(r.at).toLocaleTimeString(lang === "vi" ? "vi-VN" : "en-GB", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })}`}
                    className="flex w-full items-center gap-2 rounded px-1.5 py-0.5 font-mono text-[10px] hover:bg-zinc-800/60"
                  >
                    <span className="shrink-0">{pass ? "✅" : "❌"}</span>
                    <span className="whitespace-normal leading-snug text-zinc-300">
                      {r.symbol} {r.interval}
                    </span>
                    <span className={r.side === "SHORT" ? "shrink-0 text-rose-400" : "shrink-0 text-emerald-400"}>
                      {r.side === "SHORT" ? "SELL" : r.side === "LONG" ? "BUY" : "—"}
                    </span>
                    <span className="ml-auto shrink-0 text-zinc-400">{r.score.toFixed(2)}</span>
                    <span className={`shrink-0 ${pass ? "text-emerald-400" : "text-zinc-500"}`}>
                      {pass ? "TG" : r.reason}
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="mt-1 text-[10px] leading-snug text-zinc-600">{t(lang, "auto.bcast.hint")}</p>
          </div>
        )}

        {/* 0.2.97 — universe đã DỜI sang Watchlist (dashboard): "universe không
            phải nằm trong auto mà nằm ở watch list mới đúng". Panel auto chỉ
            còn trade: rank/scan/bcast/vị thế. */}
        <p className="border-t border-zinc-800 pt-2 text-[10px] leading-snug text-zinc-600">{t(lang, "auto.noiseBand", { band: NOISE_BAND })}</p>

        {/* RÀ SỔ + WIN RATE THEO PHÍA (0.2.87) — lịch sử dry-run trộn nhiều phiên
            bản công thức (trước 0.2.77 gross ROI, DCA ghi entry trung bình cộng
            sai) → WR phía SHORT/LONG có thể sai. Nút "Rà sổ" tính lại ROI mọi
            lệnh closed theo công thức hiện hành, thống kê LONG/SHORT tách biệt
            trước/sau; "Sửa sổ" ghi số đúng + chạy lại chuỗi vốn. */}
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-2">
          <div className="flex flex-wrap items-center justify-between gap-1.5">
            <p className="text-[10px] uppercase tracking-wide text-zinc-500">{t(lang, "auto.sides.title")}</p>
            <Button
              size="sm"
              variant="outline"
              className="h-7 border-zinc-700 px-2 text-[11px] text-zinc-300 hover:bg-zinc-800"
              disabled={auditBusy}
              onClick={() => void doAudit(false)}
            >
              <ListChecks className="mr-1.5 h-3 w-3" />
              {auditBusy && !auditRes ? "…" : t(lang, "auto.audit.btn")}
            </Button>
          </div>
          <div className="mt-1.5 grid grid-cols-2 gap-2">
            {(["LONG", "SHORT"] as const).map((side) => {
              const closed = (auto?.trades ?? []).filter((x) => x.status === "closed" && x.side === side);
              const wins = closed.filter((x) => (x.pnlPct ?? 0) > 0).length;
              const net = closed.reduce((a, x) => a + (x.pnlPct ?? 0), 0);
              const wr = closed.length ? (wins / closed.length) * 100 : 0;
              return (
                <div key={side} className="rounded-md border border-zinc-800/80 bg-zinc-900/40 px-2 py-1.5">
                  <p className={`font-mono text-[10px] font-bold ${side === "LONG" ? "text-emerald-400" : "text-rose-400"}`}>{side}</p>
                  <p className="mt-0.5 font-mono text-sm font-bold text-zinc-100">{wr.toFixed(2)}%</p>
                  <p className="font-mono text-[9px] text-zinc-600">
                    {wins}/{closed.length} · <span className={net >= 0 ? "text-emerald-400/80" : "text-rose-400/80"}>{net >= 0 ? "+" : ""}{net.toFixed(2)}%</span>
                  </p>
                </div>
              );
            })}
          </div>
          {auditRes?.ok && auditRes.report && (
            <div className="mt-2 space-y-1.5 rounded-md border border-teal-900/60 bg-teal-950/20 p-2 text-[10px] leading-relaxed text-zinc-300">
              <p className="font-medium text-teal-300">
                {auditRes.report.issues.length === 0
                  ? t(lang, "auto.audit.clean")
                  : t(lang, "auto.audit.mismatch", { n: auditRes.report.issues.length, m: auditRes.report.closed })}
              </p>
              {auditRes.report.issues.length > 0 && (
                <p className="text-zinc-400">
                  {t(lang, "auto.audit.net", {
                    a: auditRes.report.netBefore.toFixed(2),
                    b: auditRes.report.netAfter.toFixed(2),
                  })}
                </p>
              )}
              {/* LONG/SHORT theo sổ ĐẦY ĐỦ (server rà cả lịch sử, không chỉ 200 lệnh) */}
              <div className="grid grid-cols-2 gap-1.5 font-mono">
                {auditRes.report.sides.after.map((s) => {
                  const b = auditRes.report!.sides.before.find((x) => x.side === s.side);
                  return (
                    <div key={s.side} className="rounded border border-zinc-800 bg-zinc-900/50 px-1.5 py-1">
                      <span className={s.side === "LONG" ? "text-emerald-400" : "text-rose-400"}>{s.side}</span>
                      <span className="text-zinc-400"> {b ? `${b.winRate.toFixed(2)}%` : "?"}→{s.winRate.toFixed(2)}%</span>
                      <span className="text-zinc-600">
                        {" "}· {s.wins}/{s.closed}
                      </span>
                      <span className={`ml-1 ${s.netPnl >= 0 ? "text-emerald-400/80" : "text-rose-400/80"}`}>
                        {s.netPnl >= 0 ? "+" : ""}
                        {s.netPnl.toFixed(2)}%
                      </span>
                      {b && b.mismatched > 0 && <span className="block text-[9px] text-amber-400/80">{b.mismatched} ⚠</span>}
                    </div>
                  );
                })}
              </div>
              {auditRes.report.issues.length > 0 && !auditRes.repaired && (
                <>
                  <div className="max-h-20 overflow-y-auto rounded border border-zinc-800 bg-zinc-950/60 font-mono text-[9px] text-zinc-400">
                    {auditRes.report.issues.slice(0, 12).map((x) => (
                      <p key={x.id} className="px-1.5 py-0.5">
                        {x.symbol ?? ""} {x.side === "SHORT" ? "S" : "L"} {x.exitKind === "tp" ? "TP" : x.exitKind === "sl" ? "SL" : x.exitKind === "flip" ? "🔄" : x.exitKind === "trail" ? "🪢" : "···"} {x.stored >= 0 ? "+" : ""}
                        {x.stored.toFixed(2)}% → {x.expected >= 0 ? "+" : ""}
                        {x.expected.toFixed(2)}%
                      </p>
                    ))}
                    {auditRes.report.issues.length > 12 && (
                      <p className="px-1.5 py-0.5 text-zinc-600">+{auditRes.report.issues.length - 12} …</p>
                    )}
                  </div>
                  <Button
                    size="sm"
                    className="h-7 w-full border-teal-900 bg-teal-950/50 px-2 text-[11px] text-teal-300 hover:bg-teal-900/50"
                    disabled={auditBusy}
                    onClick={() => void doAudit(true)}
                  >
                    {auditBusy ? "…" : t(lang, "auto.audit.repair")}
                  </Button>
                </>
              )}
              {auditRes.repaired && (
                <p className="font-mono text-emerald-400">
                  {t(lang, "auto.audit.repaired", {
                    n: auditRes.pnlFixed ?? 0,
                    c: auditRes.capitalRefixed ?? 0,
                    f: (auditRes.finalCapital ?? 0).toFixed(2),
                  })}
                </p>
              )}
            </div>
          )}
        </div>

        {/* RESET VỐN DRY-RUN (0.2.86) — xoá sạch sổ lệnh + đặt vốn mới về ví
            DryRunState (server nhớ qua restart). Hai bước: nút → xác nhận có ô
            nhập vốn (khởi tạo = vốn hiện tại). Chấp nhận = mất lịch sử lệnh. */}
        <div className="flex flex-wrap items-center gap-2">
          {!resetOpen ? (
            <>
              <Button
                size="sm"
                variant="outline"
                className="h-7 border-zinc-700 px-2 text-[11px] text-zinc-300 hover:bg-zinc-800"
                onClick={() => {
                  setResetAmount(String(Math.round(auto?.walletCapital ?? capitalNow)));
                  setResetOpen(true);
                }}
              >
                <RotateCcw className="mr-1.5 h-3 w-3" />
                {t(lang, "auto.reset.btn")}
              </Button>
              <span className="text-[10px] text-zinc-600">{t(lang, "auto.reset.hint")}</span>
            </>
          ) : (
            <div className="flex w-full flex-wrap items-center gap-1.5 rounded-lg border border-amber-900/60 bg-amber-950/20 p-1.5">
              <span className="text-[10px] text-amber-300/90">{t(lang, "auto.reset.confirm")}</span>
              <Input
                type="number"
                min={1}
                value={resetAmount}
                onChange={(e) => setResetAmount(e.target.value)}
                className="h-7 w-24 border-zinc-800 bg-zinc-950/60 px-2 font-mono text-xs text-zinc-100"
                aria-label={t(lang, "auto.reset.btn")}
              />
              <span className="text-[10px] text-zinc-500">USDT</span>
              <Button
                size="sm"
                className="h-7 border-rose-900 bg-rose-950/50 px-2 text-[11px] text-rose-300 hover:bg-rose-900/50"
                disabled={resetBusy}
                onClick={() => void doResetCapital()}
              >
                {resetBusy ? "…" : t(lang, "auto.reset.yes")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-[11px] text-zinc-400"
                onClick={() => setResetOpen(false)}
                disabled={resetBusy}
              >
                {t(lang, "auto.reset.no")}
              </Button>
            </div>
          )}
        </div>

        {/* win-rate by pair × timeframe */}
        {(auto?.byCombo?.length ?? 0) > 0 && (
          <div className="border-t border-zinc-800 pt-2">
            <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">{t(lang, "auto.combo.title")}</p>
            <div className="mt-1.5 overflow-hidden rounded-lg border border-zinc-800">
              <div className="grid grid-cols-[1fr_30px_44px_44px_54px_64px] gap-x-1 border-b border-zinc-800 bg-zinc-950/60 px-2 py-1 text-[9px] font-semibold uppercase tracking-wide text-zinc-500">
                <span>{t(lang, "auto.col.pair")}</span>
                <span>{t(lang, "auto.col.tf")}</span>
                <span className="text-right">{t(lang, "auto.combo.col.trades")}</span>
                <span className="text-right">{t(lang, "auto.combo.col.win")}</span>
                <span className="text-right">{t(lang, "auto.combo.col.net")}</span>
                <span className="text-right">TOTAL PNL</span>
              </div>
              <div className="rail-scroll max-h-36 overflow-y-auto">
                {(auto?.byCombo ?? []).map((c: any) => (
                  <button
                    key={`${c.symbol}-${c.interval}`}
                    type="button"
                    onClick={() => onPickPair(c.symbol, c.interval)}
                    className="grid w-full grid-cols-[1fr_30px_44px_44px_54px_64px] items-center gap-x-1 px-2 py-1 text-left font-mono text-[10px] hover:bg-zinc-800/60"
                  >
                    <span className="whitespace-normal leading-snug text-zinc-200">{c.symbol}</span>
                    <span className="text-zinc-500">{c.interval}</span>
                    <span className="text-right text-zinc-400">{c.closed}</span>
                    <span className={`text-right font-bold ${c.winRate >= 50 ? "text-emerald-400" : "text-rose-400"}`}>{c.winRate.toFixed(2)}%</span>
                    <span className={`text-right ${(c.netPnlPct ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                      {c.netPnlPct >= 0 ? "+" : ""}
                      {c.netPnlPct.toFixed(2)}%
                    </span>
                    <span className={`text-right ${((() => { const _t = (closedHist ?? []).filter((x: any) => x.symbol === c.symbol && x.interval === c.interval).reduce((s: number, x: any) => s + (x.capitalAfter != null && x.capitalBefore != null ? x.capitalAfter - x.capitalBefore : ((x.pnlPct ?? 0) / 100) * (((x.capitalBefore ?? capitalNow) * (x.stakePct ?? 100)) / 100)), 0); return _t; })()) >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{((() => { const _t = (closedHist ?? []).filter((x: any) => x.symbol === c.symbol && x.interval === c.interval).reduce((s: number, x: any) => s + (x.capitalAfter != null && x.capitalBefore != null ? x.capitalAfter - x.capitalBefore : ((x.pnlPct ?? 0) / 100) * (((x.capitalBefore ?? capitalNow) * (x.stakePct ?? 100)) / 100)), 0); return _t; })()) >= 0 ? "+$" : "-$"}{Math.abs((() => { const _t = (closedHist ?? []).filter((x: any) => x.symbol === c.symbol && x.interval === c.interval).reduce((s: number, x: any) => s + (x.capitalAfter != null && x.capitalBefore != null ? x.capitalAfter - x.capitalBefore : ((x.pnlPct ?? 0) / 100) * (((x.capitalBefore ?? capitalNow) * (x.stakePct ?? 100)) / 100)), 0); return _t; })()).toFixed(2)}</span>
                  </button>
                ))}
              </div>
            </div>
            <p className="mt-1 text-[10px] leading-snug text-zinc-600">{t(lang, "auto.combo.hint")}</p>
          </div>
        )}

        {/* history */}
        <div className="border-t border-zinc-800 pt-2">
          <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">{t(lang, "auto.hist")}</p>
          {closedHist.length === 0 ? (
            <p className="mt-1 text-[11px] text-zinc-600">{t(lang, "auto.hist.empty")}</p>
          ) : (
            <div className="rail-scroll mt-1.5 max-h-44 space-y-1 overflow-y-auto pr-0.5">
              {closedHist.map((r: any) => {
                const entry = r.entryPrice ?? null;
                const exit = r.exitPrice ?? null;
                const lev = r.leverage ?? null;
                const margin = r.stakePct != null && r.capitalBefore != null ? (r.stakePct / 100) * r.capitalBefore : null;
                const pnlUsd = r.pnlPct != null && margin != null ? (r.pnlPct / 100) * margin : (r.capitalAfter != null && r.capitalBefore != null ? r.capitalAfter - r.capitalBefore : null);
                const t0 = r.entryTime ? new Date(r.entryTime).getTime() : 0;
                const t1 = r.exitTime ? new Date(r.exitTime).getTime() : 0;
                const holdMs = t0 && t1 ? Math.max(0, t1 - t0) : 0;
                const hold = holdMs >= 3600000 ? `${(holdMs / 3600000).toFixed(2)}h` : holdMs >= 60000 ? `${Math.round(holdMs / 60000)}m` : holdMs > 0 ? `${Math.round(holdMs / 1000)}s` : "—";
                const reason = r.exitKind === "tp" ? "TP" : r.exitKind === "sl" ? "SL" : r.exitKind === "trail" ? "TRAIL" : r.exitKind === "flip" ? "FLIP" : (r.exitKind ?? "—");
                return (
                <div key={r.id} className="flex items-center gap-2 overflow-x-auto whitespace-nowrap rounded-md border border-zinc-800/80 bg-zinc-950/40 px-2 py-1 text-[10px]">
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="shrink-0 text-zinc-500">
                      {new Date(r.exitTime ?? r.entryTime).toLocaleTimeString(lang === "vi" ? "vi-VN" : "en-GB", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })}
                    </span>
                    <span className="whitespace-normal leading-snug font-mono text-zinc-300">{r.symbol} {r.interval}</span>
                    <span className={`shrink-0 font-mono ${sideClass(r.side)}`}>{r.side}</span>
                    <span className={`ml-auto shrink-0 font-mono font-bold ${(r.pnlPct ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                      {(r.pnlPct ?? 0) >= 0 ? "+" : ""}{(r.pnlPct ?? 0).toFixed(2)}%
                    </span>
                    <span className="shrink-0 font-mono text-zinc-600">{r.exitKind === "tp" ? "TP" : r.exitKind === "sl" ? "SL" : r.exitKind === "trail" ? "TRAIL" : r.exitKind === "flip" ? "FLIP" : "..."}</span>
                  </div>
                  <div className="flex shrink-0 items-center gap-x-2 font-mono text-[10px] text-zinc-500">
                    <span>{entry != null && exit != null ? `${Number(entry).toFixed(2)} -> ${Number(exit).toFixed(2)}` : "Entry -> Exit -"}</span>
                    {lev != null && <span>Lev {lev}x</span>}
                    {margin != null && <span>Margin ${Number(margin).toFixed(2)}</span>}
                    {pnlUsd != null && <span className={Number(pnlUsd) >= 0 ? "text-emerald-400" : "text-rose-400"}>PNL ${Number(pnlUsd) >= 0 ? "+" : ""}{Number(pnlUsd).toFixed(2)}</span>}
                    <span>HOLD {hold}</span>
                    <span className="text-zinc-400">{reason}</span>
                  </div>
                </div>
                );
              })}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}