# Biểu đồ rà soát bùng nổ BTC 4 năm từ explosion-report.json
import json, matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
from datetime import datetime, timezone

plt.rcParams["font.family"] = "DejaVu Sans"  # đủ dấu tiếng Việt
plt.rcParams["axes.unicode_minus"] = False

rep = json.load(open("/home/z/my-project/download/explosion-report.json"))
ser = rep["series"]
T = [datetime.fromtimestamp(t / 1000, tz=timezone.utc) for t in ser["t"]]
C = ser["c"]
BBW = ser["bbwRank"]
ATR = ser["atrRank"]
hits = set(ser["hitIdx"])
cur = rep["stats"]["current"]

fig, (ax1, ax2, ax3) = plt.subplots(
    3, 1, figsize=(12.5, 8.6), sharex=True, constrained_layout=True,
    gridspec_kw={"height_ratios": [3, 1.2, 1.2]},
)

# ── panel 1: giá (log) + mốc bùng nổ ──
ax1.plot(T, C, lw=0.9, color="#64748b")
ax1.set_yscale("log")
up = [(t, c) for t, c, i in zip(T, C, range(len(T))) if i in hits and (i == 0 or C[i] >= C[i - 1])]
dn = [(t, c) for t, c, i in zip(T, C, range(len(T))) if i in hits and i > 0 and C[i] < C[i - 1]]
ax1.scatter([t for t, _ in up], [c for _, c in up], s=14, color="#10b981", zorder=3, label=f"Bùng nổ LÊN ({len(up)})")
ax1.scatter([t for t, _ in dn], [c for _, c in dn], s=14, color="#f43f5e", zorder=3, label=f"Bùng nổ XUỐNG ({len(dn)})")
ax1.set_ylabel("Giá (USD, log)")
ax1.set_title(f"{rep['symbol']} · {rep['years']} năm · ngày |return| ≥ {rep['thresholdPct']:.0f}% — {len(rep['expl'])} sự kiện", fontsize=12, fontweight="bold")
ax1.legend(loc="upper left", fontsize=9, frameon=False)
ax1.grid(alpha=0.25)

# ── panel 2: percentile BBW (nén biến động) ──
ax2.plot(T, BBW, lw=0.7, color="#0ea5e9", label="BBW percentile (100n)")
ax2.axhspan(0, 0.25, color="#fde68a", alpha=0.5)
ax2.text(T[8], 0.10, "vùng nén (p≤25)", fontsize=8, color="#92400e")
ax2.axhline(0.5, color="#cbd5e1", lw=0.6)
ax2.set_ylabel("BBW p-rank")
ax2.set_ylim(0, 1)
ax2.legend(loc="upper left", fontsize=8, frameon=False)
ax2.grid(alpha=0.25)

# ── panel 3: percentile ATR ──
ax3.plot(T, ATR, lw=0.7, color="#8b5cf6", label="ATR% percentile (100n)")
ax3.axhline(0.5, color="#cbd5e1", lw=0.6)
ax3.set_ylabel("ATR p-rank")
ax3.set_ylim(0, 1)
ax3.set_xlabel("Thời gian (UTC)")
ax3.legend(loc="upper left", fontsize=8, frameon=False)
ax3.grid(alpha=0.25)
ax3.xaxis.set_major_locator(mdates.MonthLocator(interval=4))
ax3.xaxis.set_major_formatter(mdates.DateFormatter("%m/%y"))

cur_date = T[-2]
ax1.axvline(cur_date, color="#0f172a", lw=1, ls="--", alpha=0.7)
ax1.annotate(
    f"hôm nay · điểm tiền đề {cur['score']}/100",
    xy=(cur_date, C[-2]), xytext=(-120, -14), textcoords="offset points",
    fontsize=8, color="#0f172a",
)

out = "/home/z/my-project/download/bung-no-BTC-4nam.png"
fig.savefig(out, dpi=110)
print("saved", out)
