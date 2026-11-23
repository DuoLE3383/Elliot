// ─── /arena — SO SÁNH BA CHIẾN LƯỢC A/B/C (0.2.97) + trạng thái sổ LIVE ──────
// Server component đọc thẳng arenaSnapshot() (không cần client JS).
//   A = Vulcan/Donchian (15m, lev 5) · B = Elliott XGB (đa khung) ·
//   C = Wyckoff gốc 5 lớp (nến ngày, lev 1, long-only) · Live = mirror thật
//   của B khi LIVE bật. Ba sổ dry-run cùng vốn xuất phát từ ví reset nên so
//   trực tiếp được; live vốn là balance Binance thật.

import { arenaSnapshot, type ArenaSnapshot } from "@/lib/arena";

export const dynamic = "force-dynamic";

const num = (x: number | null | undefined, digits = 2): string =>
  x == null ? "—" : String(Math.round(x * 10 ** digits) / 10 ** digits);

function StatCard({ title, sub, s, accent }: { title: string; sub: string; s: ArenaSnapshot["a"]; accent: string }) {
  return (
    <div className="flex-1 rounded-lg border border-white/10 bg-white/5 p-4">
      <div className="text-lg font-semibold" style={{ color: accent }}>
        {title}
      </div>
      <div className="mb-3 text-xs text-white/50">{sub}</div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <span className="text-white/50">Closed / open trades</span>
        <span>
          {s.nClosed} / {s.nOpen}
        </span>
        <span className="text-white/50">Win rate</span>
        <span>{s.nClosed > 0 ? `${num(s.wr, 1)}%` : "—"}</span>
        <span className="text-white/50">Net ROI</span>
        <span className={s.nClosed > 0 ? (s.netRoi >= 0 ? "text-emerald-400" : "text-rose-400") : "text-white/40"}>{s.nClosed > 0 ? num(s.netRoi) : "—"}</span>
        <span className="text-white/50">Avg win / avg loss</span>
        <span>
          {num(s.avgWin)} / {num(s.avgLoss)}
        </span>
        <span className="text-white/50">Payoff</span>
        <span>{num(s.payoff)}</span>
        <span className="text-white/50">Final capital</span>
        <span>{num(s.finalCapital)}</span>
      </div>
      <div className="mt-2 border-t border-white/10 pt-2 text-xs text-white/60">
        {s.bySide.map((x) => (
          <div key={x.side}>
            {x.side}: {x.n} trades · WR {num(x.wr, 1)}% · net {num(x.net)}
          </div>
        ))}
      </div>
    </div>
  );
}

function EquityChart({ aEquity, bEquity, cEquity, dEquity }: { aEquity: ArenaSnapshot["aEquity"]; bEquity: ArenaSnapshot["bEquity"]; cEquity: ArenaSnapshot["cEquity"]; dEquity: ArenaSnapshot["dEquity"] }) {
  const all = [...aEquity.map((p) => p.capital), ...bEquity.map((p) => p.capital), ...cEquity.map((p) => p.capital), ...dEquity.map((p) => p.capital)];
  if (all.length < 2) {
    return <div className="p-6 text-center text-sm text-white/40">Not enough closed trades to draw the equity curve — books are still accumulating.</div>;
  }
  const trueMin = Math.min(...all);
  const trueMax = Math.max(...all);
  // SET CỨNG: Y-domain = [base*0.90 (-10%), base*1.50 (+50%)] — không auto-scale theo trade
  const base = aEquity[0]?.capital ?? bEquity[0]?.capital ?? cEquity[0]?.capital ?? dEquity[0]?.capital ?? 1000;
  const min = base * 0.90;
  const max = base * 1.50;
  const W = 720;
  const H = 180;
  const toXY = (pts: ArenaSnapshot["aEquity"]): string =>
    pts.length < 2
      ? ""
      : pts
          .map((p, i) => {
            const x = (i / (pts.length - 1)) * W;
            const y = H - ((p.capital - min) / (max - min || 1)) * H;
            return `${Math.round(x)},${Math.round(y)}`;
          })
          .join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded-lg border border-white/10 bg-black/30">
      <polyline points={toXY(bEquity)} fill="none" stroke="#60a5fa" strokeWidth="2" opacity="0.9" />
      <polyline points={toXY(aEquity)} fill="none" stroke="#f59e0b" strokeWidth="2" opacity="0.9" />
      <polyline points={toXY(cEquity)} fill="none" stroke="#a78bfa" strokeWidth="2" opacity="0.9" />
      <polyline points={toXY(dEquity)} fill="none" stroke="#34d399" strokeWidth="2" opacity="0.9" />
      <text x="8" y="16" fontSize="12" fill="#f59e0b">
        A — Vulcan
      </text>
      <text x="8" y="32" fontSize="12" fill="#60a5fa">
        B — Elliott
      </text>
      <text x="8" y="48" fontSize="12" fill="#a78bfa">
        C — Wyckoff
      </text>
      <text x={W - 8} y={H - 8} fontSize="11" fill="#ffffff66" textAnchor="end">
        {num(trueMin)} — {num(trueMax)} USDT
      </text>
    </svg>
  );
}

export default async function ArenaPage() {
  let snap: ArenaSnapshot | null = null;
  let err: string | null = null;
  try {
    snap = await arenaSnapshot();
  } catch (e) {
    err = e instanceof Error ? e.message : String(e);
  }
  return (
    <main className="mx-auto max-w-5xl space-y-4 p-4">
      <div>
        <h1 className="text-2xl font-bold">Arena A/B/C — Vulcan vs Elliott vs Wyckoff</h1>
        <p className="mt-1 text-sm text-white/50">
          Three dry-run books in parallel, all starting from the same reset-wallet capital. A = DonchianBreakout (15m, lev 5, ATR stop) ·
          B = the current Elliott engine · C = the original 5-layer Wyckoff funnel (daily candles, lev 1, long-only, since 0.2.97). ROI uses
          the same formula, so they compare directly. LIVE below is book B's real-order matching layer when LIVE is on.
        </p>
      </div>
      {err && <div className="rounded border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-300">Arena error: {err}</div>}
      {snap && (
        <>
          <div className="flex flex-col gap-4 lg:flex-row">
            <StatCard title="A — Vulcan/Donchian" sub="breakout 15m · lev 5 · stake 10% · ATR×2 stop" s={snap.a} accent="#f59e0b" />
            <StatCard title="B — Elliott" sub="signal engine + prob + LLM gate · lev from cfg" s={snap.b} accent="#60a5fa" />
            <StatCard title="C — Original Wyckoff" sub="5-layer funnel · daily candles · lev 1 · long-only · stake 10%" s={snap.c} accent="#a78bfa" />
          </div>
          <EquityChart aEquity={snap.aEquity} bEquity={snap.bEquity} cEquity={snap.cEquity} dEquity={snap.dEquity} />
          <div className="overflow-x-auto rounded-lg border border-white/10">
            <table className="w-full text-sm">
              <thead className="bg-white/5 text-left text-white/50">
                <tr>
                  <th className="px-3 py-2">Symbol</th>
                  <th className="px-3 py-2">A — trades</th>
                  <th className="px-3 py-2">A — net</th>
                  <th className="px-3 py-2">B — trades</th>
                  <th className="px-3 py-2">B — net</th>
                  <th className="px-3 py-2">C — trades</th>
                  <th className="px-3 py-2">C — net</th>
                </tr>
              </thead>
              <tbody>
                {snap.bySymbol.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-3 py-4 text-center text-white/40">
                      No trades yet in any of the three books.
                    </td>
                  </tr>
                )}
                {snap.bySymbol.map((r) => {
                  const best = Math.max(r.aNet, r.bNet, r.cNet);
                  return (
                    <tr key={r.symbol} className="border-t border-white/5">
                      <td className="px-3 py-2 font-medium">{r.symbol}</td>
                      <td className="px-3 py-2">{r.aN || "—"}</td>
                      <td className={`px-3 py-2 ${r.aNet >= 0 ? "text-emerald-400" : "text-rose-400"} ${best === r.aNet && (r.aN > 0) ? "font-bold" : ""}`}>{r.aN ? num(r.aNet) : "—"}</td>
                      <td className="px-3 py-2">{r.bN || "—"}</td>
                      <td className={`px-3 py-2 ${r.bNet >= 0 ? "text-emerald-400" : "text-rose-400"} ${best === r.bNet && (r.bN > 0) ? "font-bold" : ""}`}>{r.bN ? num(r.bNet) : "—"}</td>
                      <td className="px-3 py-2">{r.cN || "—"}</td>
                      <td className={`px-3 py-2 ${r.cNet >= 0 ? "text-emerald-400" : "text-rose-400"} ${best === r.cNet && (r.cN > 0) ? "font-bold" : ""}`}>{r.cN ? num(r.cNet) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/5 p-4">
            <div className="flex items-center justify-between">
              <div className="text-lg font-semibold text-emerald-300">LIVE — real mirror of B</div>
              <span className="rounded border border-emerald-700/60 px-2 py-0.5 text-[11px] text-emerald-300">{snap.live.on ? "ON" : "OFF"}</span>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
              <span className="text-white/50">Real filled orders</span>
              <span>
                {snap.live.nClosed} closed / {snap.live.nOpen} open
              </span>
              <span className="text-white/50">Win rate</span>
              <span>{num(snap.live.wr, 1)}%</span>
              <span className="text-white/50">Net ROI</span>
              <span className={snap.live.netRoi >= 0 ? "text-emerald-400" : "text-rose-400"}>{num(snap.live.netRoi)}</span>
              <span className="text-white/50">Balance Binance</span>
              <span>
                {num(snap.live.balanceBefore)} → {num(snap.live.balanceAfter)}
              </span>
            </div>
          </div>
          <div className="text-xs text-white/40">Updated: {new Date(snap.generatedAt).toLocaleString("en-US")} · source: GET /api/arena</div>
        </>
      )}
    </main>
  );
}