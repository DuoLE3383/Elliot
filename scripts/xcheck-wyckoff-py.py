# -*- coding: utf-8 -*-
"""Cross-check phía Python — REPLICA ĐÚNG vòng lặp đã verify trong
scripts/verify-wyckoff-crypto.py (precompute swing + searchsorted, tốc độ nhanh).
Tạo /tmp/wy-py.jsonl cùng định dạng /tmp/wy-ts.jsonl."""
import io, json, os, glob
import numpy as np
import pandas as pd

out = []
for f in sorted(glob.glob(os.path.join(os.path.dirname(__file__), "wyckoff-cache", "*_1d.csv"))):
    sym = os.path.basename(f).replace("_1d.csv", "")
    df = pd.read_csv(f)
    n = len(df)
    highs_a = df["high"].astype(float).to_numpy()
    low_a = df["low"].astype(float).to_numpy()
    close_a = df["close"].astype(float).to_numpy()
    vol_a = df["volume"].astype(float).to_numpy()
    pct_a = pd.to_numeric(df["pct_chg"], errors="coerce").to_numpy()
    dates = df["date"].astype(str).to_numpy()

    # precompute swing (tâm i, window 3) — y hệt verify
    W = 3
    sl_c, sl_v, sh_c, sh_v = [], [], [], []
    for i in range(W, n - W):
        lw = low_a[i - W:i + W + 1]
        hw = highs_a[i - W:i + W + 1]
        if low_a[i] == np.nanmin(lw):
            sl_c.append(i); sl_v.append(float(low_a[i]))
        if highs_a[i] == np.nanmax(hw):
            sh_c.append(i); sh_v.append(float(highs_a[i]))
    sl_c = np.array(sl_c); sl_v = np.array(sl_v)
    sh_c = np.array(sh_c); sh_v = np.array(sh_v)

    for t in range(140, n - 1):
        lo_i = np.searchsorted(sl_c, t - 87)
        hi_i = np.searchsorted(sl_c, t - 4, side="right")
        sw_l = sl_v[lo_i:hi_i]
        lo_j = np.searchsorted(sh_c, t - 87)
        hi_j = np.searchsorted(sh_c, t - 4, side="right")
        sw_h = sh_v[lo_j:hi_j]
        support = float(np.median(sw_l[-5:])) if len(sw_l) >= 2 else float(np.quantile(low_a[max(0, t - 90):t], 0.10))
        resistance = float(np.median(sw_h[-5:])) if len(sw_h) >= 2 else float(np.quantile(highs_a[max(0, t - 90):t], 0.90))
        if support <= 0 or resistance <= support:
            continue
        width_pct = (resistance - support) / support * 100.0
        if width_pct < 4.0 or width_pct > 45.0:
            continue
        zc = close_a[max(0, t - 90):t]
        drift_pct = abs((zc[-1] - zc[0]) / zc[0] * 100.0) if zc[0] > 0 else 999
        if drift_pct > 18.0:
            continue
        zl = low_a[max(0, t - 90):t]
        zh = highs_a[max(0, t - 90):t]
        s_tests = int((zl <= support * 1.035).sum())
        r_tests = int((zh >= resistance * 0.965).sum())
        if s_tests < 2 or r_tests < 2:
            continue
        width = resistance - support
        mid = support + width / 2.0
        prev_close = np.full_like(zc, np.nan)
        prev_close[1:] = zc[:-1]
        tr_arr = np.fmax.reduce([zh - zl, np.abs(zh - prev_close), np.abs(zl - prev_close)])
        atr = float(np.nanmean(tr_arr[-20:]))
        last_c = float(zc[-1])
        atr_pct = atr / last_c * 100.0 if last_c > 0 else 0.0
        ideal_width = min(max(atr_pct * 4.0, 6.0), 40.0)
        width_score = max(0.0, 1.0 - abs(width_pct - ideal_width) / max(ideal_width, 1.0))
        test_score = min((s_tests + r_tests) / 6.0, 1.0)
        drift_score = max(0.0, 1.0 - drift_pct / 18.0)
        quality = float(0.45 * test_score + 0.35 * width_score + 0.20 * drift_score)

        # trigger — y hệt verify loop
        def vr_last(window: int) -> float | None:
            if t < window:
                return None
            m = float(np.nanmean(vol_a[t - window:t]))
            return vol_a[t] / m if m > 0 else None

        lc, ll = close_a[t], low_a[t]
        pl = low_a[t - 1] if t >= 1 else ll
        pct = pct_a[t] if pd.notna(pct_a[t]) else 0.0
        trig = "none"
        vr = vr_last(max(20, 5))
        if vr is not None and lc >= resistance * 0.99 and pct >= 6.0 and vr >= 3.0:
            trig = "sos"
        vr5 = vr_last(5)
        if trig == "none" and vr5 is not None and min(pl, ll) <= support * 0.995 \
                and lc > support * 1.005 and lc < mid + width * 0.25 and vr5 >= 1.3:
            trig = "spring"
        out.append({"sym": sym, "date": str(dates[t]), "trigger": trig,
                    "support": f"{support:.8f}", "quality": f"{quality:.6f}"})

with io.open("/tmp/wy-py.jsonl", "w", encoding="utf-8") as fh:
    for r in out:
        fh.write(json.dumps(r) + "\n")
spr = sum(1 for r in out if r["trigger"] == "spring")
sos = sum(1 for r in out if r["trigger"] == "sos")
print(f"PY done — {len(out)} range-valid rows, triggers: spring={spr} sos={sos}")
