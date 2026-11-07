// Sanity-check các hàm pure mới của 0.2.86 — bản copy standalone (không import TS chain)
const comboMemoryOf = (trades, symbol, interval, lookback = 8) => {
  let streak = 0, streakDone = false, net = 0, n = 0;
  for (const t of trades) {
    if (t.status !== "closed" || t.symbol !== symbol || t.interval !== interval) continue;
    const pnl = t.pnlPct ?? 0;
    if (!streakDone) { if (pnl < 0) streak += 1; else streakDone = true; }
    if (n < Math.max(0, lookback)) { net += pnl; n += 1; }
    if (streakDone && n >= Math.max(0, lookback)) break;
  }
  return { streak, net: Math.round(net * 100) / 100, n };
};
const comboMemoryReason = (mem, loseStreak, netFloor) => {
  if (loseStreak > 0 && mem.streak >= loseStreak) return `streak ${mem.streak} lỗ liên tiếp (gate ${loseStreak})`;
  if (netFloor < 0 && mem.n >= 3 && mem.net <= netFloor) return `net ${mem.net.toFixed(1)}% ${mem.n} lệnh gần nhất ≤ ${netFloor}%`;
  return null;
};
const rollingChampions = (runs, window) => {
  const seen = new Map(), champ = new Map();
  const win = Math.max(0, Math.round(window));
  for (const r of runs) {
    const k = `${r.symbol}|${r.interval}`;
    if (win > 0) {
      const c = seen.get(k) ?? 0;
      if (c >= win) continue;
      seen.set(k, c + 1);
      if (r.lv !== 0) continue;
    }
    const cur = champ.get(k);
    if (!cur || r.auc > cur.auc || (r.auc === cur.auc && r.acc > cur.acc)) champ.set(k, { auc: r.auc, acc: r.acc });
  }
  return champ;
};
const lvOfRunParams = (params) => {
  try { const n = Number((JSON.parse(params ?? "{}") ?? {}).lv); return Number.isFinite(n) && n > 0 ? Math.round(n) : 0; }
  catch { return 0; }
};

const mk = (sym, itv, pnl) => ({ symbol: sym, interval: itv, status: "closed", pnlPct: pnl });

// ── comboMemoryOf ──
const trades = [
  mk("BTCUSDT", "15m", -2),
  mk("BTCUSDT", "15m", -3),
  mk("BTCUSDT", "15m", 5),
  mk("BTCUSDT", "15m", -1),
  mk("ETHUSDT", "1h", -9),
  mk("BTCUSDT", "15m", -4),
  mk("BTCUSDT", "15m", -5),
  mk("BTCUSDT", "15m", -6),
];
const m1 = comboMemoryOf(trades, "BTCUSDT", "15m", 8);
console.log("mem full      =", m1); // streak 2 · net -16 · n 7
const m2 = comboMemoryOf(trades, "BTCUSDT", "15m", 3);
console.log("mem lookback3 =", m2); // streak 2 · net 0 (-2-3+5) · n 3
console.log("mem rỗng      =", comboMemoryOf([], "X", "1m", 8));

console.log("reason streak :", comboMemoryReason({ streak: 4, net: -5, n: 4 }, 4, -12));
console.log("reason net    :", comboMemoryReason({ streak: 1, net: -16, n: 6 }, 4, -12));
console.log("reason pass   :", comboMemoryReason({ streak: 2, net: -5, n: 4 }, 4, -12));
console.log("reason off    :", comboMemoryReason({ streak: 9, net: -50, n: 9 }, 0, 0));

// ── rollingChampions ──
const runs = [
  { symbol: "A", interval: "15m", acc: 70, auc: 0.9, lv: 0 },
  { symbol: "A", interval: "15m", acc: 80, auc: 0.98, lv: 5 },
  { symbol: "A", interval: "15m", acc: 65, auc: 0.85, lv: 0 },
  { symbol: "A", interval: "15m", acc: 60, auc: 0.8, lv: 0 },
];
console.log("champ rolling 20 =", rollingChampions(runs, 20).get("A|15m")); // 0.9 — lv5 bỏ qua
console.log("champ rolling 2  =", rollingChampions(runs, 2).get("A|15m"));  // 0.9
console.log("champ legacy 0   =", rollingChampions(runs, 0).get("A|15m"));  // 0.98 — legacy tính mọi lv

console.log("lv parse:", lvOfRunParams(JSON.stringify({ lv: 6 })), lvOfRunParams("{}"), lvOfRunParams("rác"));

// xác nhận
const ok =
  m1.streak === 2 && m1.net === -16 && m1.n === 7 &&
  m2.net === 0 && m2.n === 3 &&
  rollingChampions(runs, 20).get("A|15m").auc === 0.9 &&
  rollingChampions(runs, 2).get("A|15m").auc === 0.9 &&
  rollingChampions(runs, 0).get("A|15m").auc === 0.98 &&
  lvOfRunParams(JSON.stringify({ lv: 6 })) === 6 &&
  lvOfRunParams("rác") === 0;
console.log(ok ? "✅ TẤT CẢ PASS" : "❌ CÓ KẾT QUẢ SAI");
process.exit(ok ? 0 : 1);
