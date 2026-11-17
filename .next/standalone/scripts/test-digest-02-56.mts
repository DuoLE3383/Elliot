// Test nhanh statLines — mô phỏng 5 lệnh đóng + 1 đang mở
const mod = await import("../src/lib/autotrade.ts");
const mk = (id: string, sym: string, tf: string, side: string, pnl: number, kind: string, exitH: number): any => ({
  id, symbol: sym, interval: tf, side, entryPrice: 1, entryTime: new Date(Date.now() - exitH * 3600e3 - 3600e3).toISOString(),
  slPct: 1, tpPct: 2, leverage: 5, stakePct: 100, status: "closed", exitPrice: 1,
  exitTime: new Date(Date.now() - exitH * 3600e3).toISOString(), pnlPct: pnl, exitKind: kind,
  prob: 0.6, acc: 70, auc: 0.8, score: 30, capitalBefore: 100, capitalAfter: 100 + pnl,
  llmVerdict: "go", llmReason: null, autopsy: null, methodId: null, createdAt: new Date().toISOString(),
});
const st = {
  trades: [mk("1","LINK","15m","LONG",5.2,"tp",1), mk("2","ATOM","15m","SHORT",-2.95,"sl",3), mk("3","TRX","5m","LONG",0,"manual",5), mk("4","BTC","1h","LONG",1.1,"flip",7), mk("5","ETH","15m","SHORT",3.3,"tp",9)],
  open: { id:"6", symbol:"TRX", interval:"5m", side:"LONG", entryPrice:0.31889, entryTime:new Date().toISOString(), slPct:1, tpPct:2, leverage:5, stakePct:100, status:"open", exitPrice:null, exitTime:null, pnlPct:null, exitKind:null, prob:0.6, acc:70, auc:0.8, score:30, capitalBefore:79013, capitalAfter:null, llmVerdict:"go", llmReason:null, autopsy:null, methodId:null, createdAt:new Date().toISOString() },
  capital: 79013.81,
  stats: { closed: 23, wins: 11, winRate: 47.8, netPnlPct: 12.3 },
  byCombo: [{ symbol:"LINK", interval:"15m", closed:3, winRate:66.7 }],
};
console.log(mod.statLines(st as any, Date.now() - 3600e3, `⏰ <b>HOURLY REPORT · 01:00</b>`, "last 1h").join("\n"));
