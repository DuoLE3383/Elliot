// ─── /arena — SO SÁNH CHIẾN LƯỢC A (Vulcan/Donchian) vs B (Elliott) ──────────
// Server component đọc thẳng arenaSnapshot() (không cần client JS). Sổ A chạy
// từ 0.2.93 nên khởi đầu trống — hai sổ tích tụ song song từ cùng vốn ví.
// LEARN: bảng học chéo (job đêm so sánh A thua/B thua) sẽ nối vào trang này ở
// phiên kế tiếp khi sổ A đủ dữ liệu.

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
        <span className="text-white/50">Lệnh đóng / đang mở</span>
        <span>
          {s.nClosed} / {s.nOpen}
        </span>
        <span className="text-white/50">Win rate</span>
        <span>{num(s.wr, 1)}%</span>
        <span className="text-white/50">Net ROE</span>
        <span className={s.netRoe >= 0 ? "text-emerald-400" : "text-rose-400"}>{num(s.netRoe)}</span>
        <span className="text-white/50">TB thắng / TB thua</span>
        <span>
          {num(s.avgWin)} / {num(s.avgLoss)}
        </span>
        <span className="text-white/50">Payoff</span>
        <span>{num(s.payoff)}</span>
        <span className="text-white/50">Vốn cuối</span>
        <span>{num(s.finalCapital)}</span>
      </div>
      <div className="mt-2 border-t border-white/10 pt-2 text-xs text-white/60">
        {s.bySide.map((x) => (
          <div key={x.side}>
            {x.side}: {x.n} lệnh · WR {num(x.wr, 1)}% · net {num(x.net)}
          </div>
        ))}
      </div>
    </div>
  );
}

function EquityChart({ aEquity, bEquity }: { aEquity: ArenaSnapshot["aEquity"]; bEquity: ArenaSnapshot["bEquity"] }) {
  const all = [...aEquity.map((p) => p.capital), ...bEquity.map((p) => p.capital)];
  if (all.length < 2) {
    return <div className="p-6 text-center text-sm text-white/40">Chưa đủ lệnh đóng để vẽ đường vốn — hai sổ đang tích tụ.</div>;
  }
  const min = Math.min(...all) * 0.999;
  const max = Math.max(...all) * 1.001;
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
      <text x="8" y="16" fontSize="12" fill="#f59e0b">
        A — Vulcan
      </text>
      <text x="8" y="32" fontSize="12" fill="#60a5fa">
        B — Elliott
      </text>
      <text x={W - 8} y={H - 8} fontSize="11" fill="#ffffff66" textAnchor="end">
        {num(min)} — {num(max)} USDT
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
    <main className="mx-auto max-w-4xl space-y-4 p-4">
      <div>
        <h1 className="text-2xl font-bold">Arena A/B — Vulcan (A) vs Elliott (B)</h1>
        <p className="mt-1 text-sm text-white/50">
          Hai sổ dry-run song song, cùng vốn xuất phát từ ví reset. A = DonchianBreakout
          (VulcanTrader, 15m, lev 5, ATR stop) · B = engine Elliott hiện tại. ROE cùng công
          thức nên so trực tiếp. A khởi động từ 0.2.93 nên dữ liệu tích tụ dần.
        </p>
      </div>
      {err && <div className="rounded border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-300">Arena lỗi: {err}</div>}
      {snap && (
        <>
          <div className="flex flex-col gap-4 sm:flex-row">
            <StatCard title="A — Vulcan/Donchian" sub="breakout 15m · lev 5 · stake 10% · ATR×2 stop" s={snap.a} accent="#f59e0b" />
            <StatCard title="B — Elliott" sub="engine tín hiệu + prob + llm gate · lev theo cfg" s={snap.b} accent="#60a5fa" />
          </div>
          <EquityChart aEquity={snap.aEquity} bEquity={snap.bEquity} />
          <div className="overflow-x-auto rounded-lg border border-white/10">
            <table className="w-full text-sm">
              <thead className="bg-white/5 text-left text-white/50">
                <tr>
                  <th className="px-3 py-2">Symbol</th>
                  <th className="px-3 py-2">A — lệnh</th>
                  <th className="px-3 py-2">A — net ROE</th>
                  <th className="px-3 py-2">B — lệnh</th>
                  <th className="px-3 py-2">B — net ROE</th>
                  <th className="px-3 py-2">T Advantage</th>
                </tr>
              </thead>
              <tbody>
                {snap.bySymbol.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-4 text-center text-white/40">
                      Chưa có lệnh nào trong hai sổ.
                    </td>
                  </tr>
                )}
                {snap.bySymbol.map((r) => {
                  const diff = Math.round((r.aNet - r.bNet) * 100) / 100;
                  return (
                    <tr key={r.symbol} className="border-t border-white/5">
                      <td className="px-3 py-2 font-medium">{r.symbol}</td>
                      <td className="px-3 py-2">{r.aN}</td>
                      <td className={`px-3 py-2 ${r.aNet >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{num(r.aNet)}</td>
                      <td className="px-3 py-2">{r.bN}</td>
                      <td className={`px-3 py-2 ${r.bNet >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{num(r.bNet)}</td>
                      <td className={`px-3 py-2 ${diff >= 0 ? "text-amber-400" : "text-sky-400"}`}>
                        {diff >= 0 ? "A" : "B"} {num(Math.abs(diff))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="text-xs text-white/40">Cập nhật: {new Date(snap.generatedAt).toLocaleString("vi-VN")} · nguồn: GET /api/arena</div>
        </>
      )}
    </main>
  );
}
