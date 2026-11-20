import { fetchKlinesDirect } from "../src/lib/klines-direct";
import { UNIVERSE } from "../src/lib/universe";
import { scorePair } from "../src/lib/universe";
// Session hien tai theo gio VN (UTC+7): Asia 07-15h, London 15-23h, NY 20-04h (overlap London/NY 20-23h manh nhat)
function sessionNow(d = new Date()) {
  const h = d.getUTCHours() + 7; const hh = h >= 24 ? h - 24 : h;
  if (hh >= 20 && hh < 23) return "London+NY OVERLAP (bien dong cao nhat)";
  if (hh >= 15 && hh < 20) return "London";
  if (hh >= 20 || hh < 4) return "New York";
  return "Asia";
}
async function main(){
  console.log(`Session hien tai (VN): ${sessionNow()} · du bao 8-24h toi`);
  const rows: any[] = [];
  for (const sym of UNIVERSE){
    const k: any[] = await fetchKlinesDirect(sym, "1h", 250);
    if (k.length < 100) continue;
    const r = scorePair(sym, k as any);
    rows.push(r);
  }
  rows.sort((a,b)=>b.score - a.score);
  const aboveMA = rows.filter(r=>r.trend > 0).length;
  const avgAtr = rows.reduce((s,r)=>s+r.atrPct,0)/rows.length;
  console.log(`Universe ${rows.length} · trend duong ${aboveMA} · ATR tb ${avgAtr.toFixed(2)}% (1h) · ${avgAtr > 2 ? "BIEN DONG CAO — tranh SHORT duoi, cho Upthrust ro" : avgAtr > 1 ? "bien dong trung binh" : "bien dong thap — Range de hinh thanh"}`);
  console.log("TOP 10 pairs 8-24h (trend + ATR):");
  rows.slice(0,10).forEach((r,i)=> console.log(`${i+1}. ${r.symbol} score ${r.score.toFixed(2)} · ATR ${r.atrPct.toFixed(2)}% · trend ${r.trend.toFixed(2)} · ret24h ${(r.ret24h*100).toFixed(1)}% · ret10d ${(r.ret10d*100).toFixed(1)}%`));
  console.log("BOTTOM 5 (yeu nhat — ung vien SHORT neu co Upthrust):");
  rows.slice(-5).reverse().forEach((r,i)=> console.log(`${i+1}. ${r.symbol} score ${r.score.toFixed(2)} · ATR ${r.atrPct.toFixed(2)}% · trend ${r.trend.toFixed(2)} · ret24h ${(r.ret24h*100).toFixed(1)}%`));
}
main();
