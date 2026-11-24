"use client";
import { fetchForceStats, shouldWarnForce } from "@/lib/force-learn";

export function ForceBar({ symbol, interval }: { symbol: string; interval: string }) {
  const sym = (symbol ?? "").toUpperCase();
  const base = sym.replace("USDT", "");
  const doForce = async (bias: "LONG" | "SHORT") => {
    if (!sym) return;
    try {
      const st = await fetchForceStats(sym, interval, bias);
      const warn = shouldWarnForce(st, sym, interval, bias);
      if (warn && !confirm(warn + "\n\nForce anyway?")) return;
    } catch {}
    const r = await fetch("/api/force-open", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ symbol: sym, interval, bias, agent: "HERCULES", score: 0, riskPct: 10 }) });
    const d: any = await r.json().catch(() => ({}));
    if (!r.ok) alert(d?.error ?? "Force failed");
    else window.location.reload();
  };
  return (
    <div className="flex w-full gap-2 px-3 pb-3">
      <button type="button" onClick={() => doForce("LONG")} className="flex-1 rounded bg-emerald-600 px-3 py-2 font-mono text-sm font-bold text-white hover:bg-emerald-500">Force LONG {base} {interval}</button>
      <button type="button" onClick={() => doForce("SHORT")} className="flex-1 rounded bg-rose-600 px-3 py-2 font-mono text-sm font-bold text-white hover:bg-rose-500">Force SHORT {base} {interval}</button>
    </div>
  );
}
