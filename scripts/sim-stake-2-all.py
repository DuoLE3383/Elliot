import sqlite3, datetime
db = sqlite3.connect("file:/opt/elliott/data/custom.db?mode=ro", uri=True)
db.row_factory = sqlite3.Row
rows = list(db.execute("SELECT symbol, interval, side, slPct, tpPct, stakePct, leverage, pnlPct, exitKind, exitTime FROM AutoTrade WHERE status='closed' ORDER BY exitTime ASC"))
# sequential replay giong script truoc
def replay(stake_fn):
    cap=1000.0; out=[]
    for r in rows:
        stake=stake_fn(r); pnl=r["pnlPct"] or 0
        delta=cap*(stake/100)*(pnl/100); cap+=delta
        out.append(delta)
    return out
d_orig=replay(lambda r: r["stakePct"])
d_new=replay(lambda r: 5.0 if r["stakePct"]==2 else r["stakePct"])
print(f"TOTAL stake 2%: {sum(1 for r in rows if r['stakePct']==2)} / {len(rows)} closed")
# tong rieng nhom stake 2%
s2_orig=sum(d for r,d in zip(rows,d_orig) if r["stakePct"]==2)
s2_new=sum(d for r,d in zip(rows,d_new) if r["stakePct"]==2)
wins=sum(1 for r in rows if r["stakePct"]==2 and (r["pnlPct"] or 0)>0)
losses=sum(1 for r in rows if r["stakePct"]==2 and (r["pnlPct"] or 0)<=0)
print(f"Nhom stake 2%: thang {wins} / thua {losses} | Tong PnL 2%=${s2_orig:+.2f} -> 5%=${s2_new:+.2f} | Chenh ${s2_new-s2_orig:+.2f}")
print(f"Lenh lo nang nhat (5%): {min(((d,r) for r,d in zip(rows,d_new) if r['stakePct']==2), key=lambda x: x[0])[1]['symbol']} {min(((d,r) for r,d in zip(rows,d_new) if r['stakePct']==2), key=lambda x: x[0])[0]:+.2f}")
print(f"Lenh thang lon nhat (5%): {max(((d,r) for r,d in zip(rows,d_new) if r['stakePct']==2), key=lambda x: x[0])[1]['symbol']} {max(((d,r) for r,d in zip(rows,d_new) if r['stakePct']==2), key=lambda x: x[0])[0]:+.2f}")
print("\n# | symbol interval side pnl% | sl tp lev | delta 2% -> 5% | exitTime")
for i,(r,do,dn) in enumerate(zip(rows,d_orig,d_new),1):
    if r["stakePct"]!=2: continue
    dt=datetime.datetime.fromtimestamp(r["exitTime"]/1000).strftime("%d/%m %H:%M") if r["exitTime"] else "-"
    print(f"{i:3d} | {r['symbol']:<14} {r['interval']:<4} {r['side']:<5} {r['pnlPct']:+6.2f}% | sl={r['slPct']:.3f} tp={r['tpPct']:.3f} x{r['leverage']:.0f} | ${do:+.2f} -> ${dn:+.2f} | {dt} {r['exitKind']}")
# luu CSV de mo lai
import csv
with open("scripts/sim-stake-2-all.csv","w",newline="") as f:
    w=csv.writer(f); w.writerow(["symbol","interval","side","pnlPct","slPct","tpPct","leverage","exitKind","exitTime","delta_2pct_sim","delta_5pct_sim"])
    for r,do,dn in zip(rows,d_orig,d_new):
        if r["stakePct"]==2: w.writerow([r["symbol"],r["interval"],r["side"],r["pnlPct"],r["slPct"],r["tpPct"],r["leverage"],r["exitKind"],r["exitTime"],round(do,2),round(dn,2)])
print("\nDa luu: scripts/sim-stake-2-all.csv")
