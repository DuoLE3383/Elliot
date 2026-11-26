import sqlite3
db = sqlite3.connect("file:/opt/elliott/data/custom.db?mode=ro", uri=True)
db.row_factory = sqlite3.Row
rows = list(db.execute("SELECT symbol, interval, side, slPct, tpPct, stakePct, leverage, pnlPct, exitKind, exitTime FROM AutoTrade WHERE status='closed' ORDER BY exitTime ASC"))
print(f"Total closed trades: {len(rows)} | stake 2%: {sum(1 for r in rows if r['stakePct']==2)}")

def simulate(stake_map, start=1000.0):
    cap = start
    peak = start
    max_dd = 0.0
    total_pnl = 0.0
    wins = 0
    per_trade = []
    for r in rows:
        stake = stake_map(r)
        pnl = r["pnlPct"] or 0
        delta = cap * (stake/100) * (pnl/100)
        cap_after = cap + delta
        cap = cap_after
        total_pnl += delta
        if pnl > 0: wins += 1
        peak = max(peak, cap)
        dd = (peak - cap) / peak * 100 if peak else 0
        max_dd = max(max_dd, dd)
        per_trade.append((r, stake, delta, cap))
    return {"final": cap, "roi": (cap-start)/start*100, "pnl": total_pnl, "wins": wins, "winrate": wins/len(rows)*100 if rows else 0, "maxDD": max_dd, "per_trade": per_trade}

orig = simulate(lambda r: r["stakePct"])
new = simulate(lambda r: 5.0 if r["stakePct"]==2 else r["stakePct"])

print("\n=== SO SANH SEQUENTIAL REPLAY (bat dau $1000) ===")
print(f"{'':<18} {'Goc (stake that)':<18} {'Sim 2%->5%':<18} {'Chenh lech':<12}")
print(f"{'Final capital':<18} ${orig['final']:.2f}{'':<10} ${new['final']:.2f}{'':<10} ${new['final']-orig['final']:+.2f}")
print(f"{'Total ROI':<18} {orig['roi']:+.2f}%{'':<11} {new['roi']:+.2f}%{'':<11} {new['roi']-orig['roi']:+.2f}%")
print(f"{'Total PnL $':<18} ${orig['pnl']:+.2f}{'':<10} ${new['pnl']:+.2f}{'':<10} ${new['pnl']-orig['pnl']:+.2f}")
print(f"{'Win rate':<18} {orig['winrate']:.2f}% (khong doi - pnlPct giu nguyen)")
print(f"{'Max Drawdown':<18} {orig['maxDD']:.2f}%{'':<11} {new['maxDD']:.2f}%")
print(f"\nDB that (multi-position, khong sequential): final ~$1296.64 - sim sequential se lech chut do engine cho mo nhieu lenh song song, dung de so sanh tuong doi.")

print("\n=== 10 LENH STAKE 2% GAN NHAT - DELTA 2% vs 5% (cung capitalBefore sim) ===")
# lay 10 lenh stake 2% cuoi, so sanh delta neu cung capital
count=0
for (r, stake, delta, cap) in reversed(new["per_trade"]):
    if r["stakePct"]==2 and count<10:
        # tim delta goc tuong ung
        idx = new["per_trade"].index((r, stake, delta, cap))
        orig_delta = orig["per_trade"][idx][2]
        print(f"{r['symbol']} {r['interval']} {r['side']} pnl={r['pnlPct']:+.2f}% sl={r['slPct']:.3f} tp={r['tpPct']:.3f} | delta 2%=${orig_delta:+.2f} -> 5%=${delta:+.2f} (x2.5)")
        count+=1
print("\n=== TP/SL KHONG DOI ===")
print("slPct/tpPct giu nguyen - stake chi doi $ PnL, khong doi % TP/SL hay % pnlPct.")
