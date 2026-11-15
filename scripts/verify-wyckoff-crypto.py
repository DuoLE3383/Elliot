"""Kiểm chứng mô hình WyckoffTradingAgent (phễu 5 lớp) cho dry-run crypto.

Port 1-1 từ wyckoff/core/wyckoff_structure.py + FunnelConfig mặc định trong
wyckoff_engine.py, chạy walk-forward trên nến NGÀY Binance USDT-M (đúng
timeframe gốc: mô hình được thiết kế cho bar ngày của A-share).

Câu hỏi kiểm chứng:
  1. Trigger Spring/SOS/LPS/EVR có chạy được trên crypto không (tần suất)?
  2. Forward return sau trigger có tốt hơn baseline (ngày thường trong range)?
  3. Mô hình thoát gốc (TP +18% / SL -8% trong 15 ngày, spot) ra sao trên crypto?
"""

from __future__ import annotations

import json
import os
import time
import urllib.request

import numpy as np
import pandas as pd

CACHE_DIR = "/home/z/my-project/scripts/wyckoff-cache"
os.makedirs(CACHE_DIR, exist_ok=True)

# ---------- Binance fetch ----------

SYMBOLS = [
    "BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT",
    "DOGEUSDT", "ADAUSDT", "AVAXUSDT", "LINKUSDT", "ATOMUSDT",
    "UNIUSDT", "OPUSDT", "ARBUSDT", "SUIUSDT", "APTUSDT",
    "NEARUSDT", "LTCUSDT", "XLMUSDT", "JUPUSDT", "PEPEUSDT",
]

BASE = "https://fapi.binance.com/fapi/v1/klines"
BYBIT = "https://api.bybit.com/v5/market/kline"


def fetch_bybit(symbol: str) -> pd.DataFrame:
    """Fallback khi Binance ban IP. Nến ngày linear USDT, volume = base asset."""
    url = f"{BYBIT}?category=linear&symbol={symbol}&interval=D&limit=1000"
    for attempt in range(3):
        try:
            with urllib.request.urlopen(url, timeout=30) as r:
                body = json.loads(r.read().decode())
            lst = body.get("result", {}).get("list", [])
            if lst:
                break
        except Exception as exc:
            print(f"  bybit {symbol} retry {attempt + 1}: {exc}")
            time.sleep(5 * (attempt + 1))
    else:
        return pd.DataFrame()
    lst = list(reversed(lst))  # bybit trả newest-first
    df = pd.DataFrame(lst, columns=["openTime", "open", "high", "low", "close", "volume", "turnover"])
    for c in ("open", "high", "low", "close", "volume"):
        df[c] = pd.to_numeric(df[c], errors="coerce")
    df["date"] = pd.to_datetime(df["openTime"].astype("int64"), unit="ms").dt.date
    df["pct_chg"] = df["close"].pct_change() * 100.0
    return df[["date", "open", "high", "low", "close", "volume", "pct_chg"]]


def fetch_klines(symbol: str, interval: str = "1d", limit: int = 1000) -> pd.DataFrame:
    cache = os.path.join(CACHE_DIR, f"{symbol}_{interval}.csv")
    if os.path.exists(cache):
        return pd.read_csv(cache, parse_dates=False)
    url = f"{BASE}?symbol={symbol}&interval={interval}&limit={limit}"
    for attempt in range(4):
        try:
            with urllib.request.urlopen(url, timeout=30) as r:
                data = json.loads(r.read().decode())
            break
        except Exception as exc:  # 418/429/ban -> skip sang Bybit ngay
            print(f"  {symbol} binance fail ({exc}) -> fallback Bybit")
            return fetch_bybit(symbol)
    else:
        print(f"  {symbol}: Binance lỗi -> fallback Bybit")
        return fetch_bybit(symbol)
    cols = ["openTime", "open", "high", "low", "close", "volume",
            "closeTime", "qav", "trades", "tbb", "tbq", "ignore"]
    df = pd.DataFrame(data, columns=cols)
    for c in ("open", "high", "low", "close", "volume"):
        df[c] = pd.to_numeric(df[c], errors="coerce")
    df["date"] = pd.to_datetime(df["openTime"], unit="ms").dt.date
    df["pct_chg"] = df["close"].pct_change() * 100.0
    df = df[["date", "open", "high", "low", "close", "volume", "pct_chg"]]
    df.to_csv(cache, index=False)
    return df


# ---------- Port từ _price_math.py ----------

def swing_values(series: pd.Series, kind: str, window: int = 3) -> list[float]:
    values = pd.to_numeric(series, errors="coerce").reset_index(drop=True)
    width = max(int(window), 1)
    if kind not in {"low", "high"} or len(values) < width * 2 + 1:
        return []
    swings: list[float] = []
    for i in range(width, len(values) - width):
        cur = values.iloc[i]
        if pd.isna(cur):
            continue
        span = values.iloc[i - width:i + width + 1].dropna()
        boundary = span.min() if kind == "low" else span.max()
        if not span.empty and float(cur) == float(boundary):
            swings.append(float(cur))
    return swings


# ---------- Port từ wyckoff_structure.py (đúng công thức) ----------

# FunnelConfig mặc định (wyckoff_engine.py):
SPRING_VOL_RATIO = 1.3
SOS_PCT_MIN = 6.0
SOS_VOL_RATIO = 3.0
SOS_VOL_WINDOW = 20
LPS_LOOKBACK = 3
LPS_VOL_REF_WINDOW = 60
LPS_VOL_DRY_RATIO = 0.65
EVR_VOL_RATIO = 1.8
EVR_VOL_WINDOW = 10
EVR_MAX_DROP = 2.0
EVR_MAX_RISE = 2.0
SPRING_TR_MAX_RANGE_PCT = 30.0
SPRING_TR_MAX_DRIFT_PCT = 12.0
TR_ATR_WINDOW = 20


def identify_trading_range(df: pd.DataFrame, *, lookback: int = 90,
                           swing_window: int = 3, exclude_last: int = 1):
    """Trả về dict {support, resistance, mid, width_pct, quality} hoặc None."""
    min_bars = max(40, swing_window * 2 + 20)
    if len(df) < min_bars + max(exclude_last, 0):
        return None
    df_s = df.iloc[:-exclude_last] if exclude_last > 0 else df
    zone = df_s.tail(max(lookback, min_bars))
    if len(zone) < min_bars:
        return None
    high, low, close = zone["high"], zone["low"], zone["close"]
    if high.isna().all() or low.isna().all() or close.isna().all():
        return None
    sw_lows = swing_values(low, "low", swing_window)
    sw_highs = swing_values(high, "high", swing_window)
    support = float(pd.Series(sw_lows[-5:]).median()) if len(sw_lows) >= 2 else float(low.quantile(0.10))
    resistance = float(pd.Series(sw_highs[-5:]).median()) if len(sw_highs) >= 2 else float(high.quantile(0.90))
    if support <= 0 or resistance <= support:
        return None
    width_pct = (resistance - support) / support * 100.0
    max_width = min(max(SPRING_TR_MAX_RANGE_PCT * 1.5, 24.0), 55.0)
    if width_pct < 4.0 or width_pct > max_width:
        return None
    clean = close.dropna()
    first, last = float(clean.iloc[0]), float(clean.iloc[-1])
    if first <= 0:
        return None
    drift_pct = abs((last - first) / first * 100.0)
    max_drift = max(SPRING_TR_MAX_DRIFT_PCT * 1.5, 18.0)
    if drift_pct > max_drift:
        return None
    tol = 0.035
    s_tests = int((low <= support * (1.0 + tol)).sum())
    r_tests = int((high >= resistance * (1.0 - tol)).sum())
    if s_tests < 2 or r_tests < 2:
        return None
    # ATR% cho quality
    hc, lc, cc = high, low, close
    tr = pd.concat([hc - lc, (hc - cc.shift()).abs(), (lc - cc.shift()).abs()], axis=1).max(axis=1)
    atr = tr.tail(max(TR_ATR_WINDOW, 1)).mean()
    atr_pct = float(atr / last * 100.0) if pd.notna(atr) and last > 0 else 0.0
    ideal_width = min(max(atr_pct * 4.0, 6.0), 40.0)
    width_score = max(0.0, 1.0 - abs(width_pct - ideal_width) / max(ideal_width, 1.0))
    test_score = min((s_tests + r_tests) / 6.0, 1.0)
    drift_score = max(0.0, 1.0 - drift_pct / max_drift)
    quality = float(0.45 * test_score + 0.35 * width_score + 0.20 * drift_score)
    return {"support": support, "resistance": resistance,
            "mid": support + (resistance - support) / 2.0,
            "width": resistance - support, "quality": quality}


def last_ref_volume_ratio(volume: pd.Series, window: int) -> float | None:
    if len(volume) < window + 1:
        return None
    ref = pd.to_numeric(volume, errors="coerce").tail(window + 1).iloc[:-1].dropna()
    if ref.empty or float(ref.mean()) <= 0:
        return None
    last = volume.iloc[-1]
    if pd.isna(last):
        return None
    return float(last) / float(ref.mean())


def recent_ref_volume_ratio(volume: pd.Series, recent_n: int, ref_n: int) -> float | None:
    recent_n = max(recent_n, 1)
    ref_n = max(ref_n, recent_n + 1)
    if len(volume) < ref_n + recent_n:
        return None
    vol = pd.to_numeric(volume, errors="coerce")
    recent = vol.tail(recent_n).dropna()
    ref = vol.tail(ref_n + recent_n).iloc[:-recent_n].dropna()
    if recent.empty or ref.empty or float(ref.max()) <= 0:
        return None
    return float(recent.max()) / float(ref.max())


def detect_triggers(df: pd.DataFrame, tr: dict) -> dict[str, float]:
    """Trigger đánh trên BAR CUỐI so với range trước đó (đúng logic gốc)."""
    out: dict[str, float] = {}
    close = df["close"].astype(float)
    low = df["low"].astype(float)
    volume = df["volume"]
    last_close = float(close.iloc[-1])
    last_low = float(low.iloc[-1])
    prev_low = float(low.iloc[-2]) if len(low) >= 2 else last_low
    last_pct = float(df["pct_chg"].iloc[-1]) if pd.notna(df["pct_chg"].iloc[-1]) else 0.0
    width = tr["width"]
    mid, support, resistance, quality = tr["mid"], tr["support"], tr["resistance"], tr["quality"]

    # SOS
    vr = last_ref_volume_ratio(volume, max(SOS_VOL_WINDOW, 5))
    if vr is not None:
        breakout = last_close >= resistance * (1.0 - 0.01)
        push = last_pct >= SOS_PCT_MIN
        vol_ok = vr >= SOS_VOL_RATIO
        if breakout and push and vol_ok:
            out["sos"] = vr + max((last_close - resistance) / resistance * 100.0, 0.0) + quality

    # Spring
    vr = last_ref_volume_ratio(volume, 5)
    pierced = min(prev_low, last_low) <= support * 0.995
    recovered = last_close > support * 1.005
    in_range = last_close < mid + width * 0.25
    if vr is not None and pierced and recovered and in_range and vr >= SPRING_VOL_RATIO:
        out["spring"] = (last_close - support) / support * 100.0 + quality

    # LPS
    dry = recent_ref_volume_ratio(volume, LPS_LOOKBACK, max(LPS_VOL_REF_WINDOW, 10))
    near = float(low.tail(LPS_LOOKBACK).min()) <= support + width * 0.35
    holds = last_close > support
    if dry is not None and near and holds and dry <= LPS_VOL_DRY_RATIO:
        out["lps"] = (1.0 - dry) + quality

    # EVR
    vr = last_ref_volume_ratio(volume, max(EVR_VOL_WINDOW, 10))
    if vr is not None and vr >= EVR_VOL_RATIO and last_close <= mid \
            and -EVR_MAX_DROP <= last_pct <= EVR_MAX_RISE and last_close >= support * 0.98:
        out["evr"] = vr + quality
    return out


# ---------- Walk-forward ----------

def forward_stats(df: pd.DataFrame, t: int, hold_days: int = 5):
    """Forward return +1/+3/+5 ngày từ close[t]."""
    res = {}
    for h in (1, 3, 5):
        if t + h < len(df):
            res[f"f{h}"] = (float(df["close"].iloc[t + h]) / float(df["close"].iloc[t]) - 1.0) * 100.0
        else:
            res[f"f{h}"] = None
    return res


def tp_sl_outcome(df: pd.DataFrame, t: int, tp_pct: float, sl_pct: float, max_hold: int = 15):
    """Trong max_hold nến tiếp theo: TP +18% trước hay SL -8% trước (giá đóng entry)."""
    entry = float(df["close"].iloc[t])
    tp, sl = entry * (1 + tp_pct / 100.0), entry * (1 - sl_pct / 100.0)
    for k in range(1, min(max_hold, len(df) - t - 1) + 1):
        bar = df.iloc[t + k]
        if float(bar["low"]) <= sl:
            return "SL"
        if float(bar["high"]) >= tp:
            return "TP"
    return "NONE"


def main():
    print("Lấy klines ngày Binance (limit 1000) cho", len(SYMBOLS), "symbol...")
    frames: dict[str, pd.DataFrame] = {}
    for i, sym in enumerate(SYMBOLS):
        frames[sym] = fetch_klines(sym)
        print(f"  [{i + 1}/{len(SYMBOLS)}] {sym}: {len(frames[sym])} nến")
        if i < len(SYMBOLS) - 1:
            time.sleep(1.2)
    frames = {s: d for s, d in frames.items() if d is not None and not d.empty and len(d) > 50}
    print(f"Symbol hợp lệ: {len(frames)}/{len(SYMBOLS)}")

    # Breadth thị trường: % symbol có close >= MA20 (theo ngày)
    breadth: dict = {}
    for sym, df in frames.items():
        close = df["close"].reset_index(drop=True)
        ma20 = close.rolling(20).mean()
        for t in range(len(df)):
            d = str(df["date"].iloc[t])
            if pd.notna(ma20.iloc[t]):
                breadth.setdefault(d, []).append(1.0 if float(close.iloc[t]) >= float(ma20.iloc[t]) else 0.0)
    breadth_pct = {d: float(np.mean(v)) * 100.0 for d, v in breadth.items()}

    rows: list[dict] = []
    range_day_rows: list[dict] = []  # baseline: ngày có range hợp lệ nhưng KHÔNG trigger
    total_days = 0
    for si, (sym, df0) in enumerate(frames.items()):
        df = df0.reset_index(drop=True)
        n = len(df)
        total_days += n
        # Tiền tính swing toàn chuỗi: tâm i là swing low nếu low[i] = min(low[i-3..i+3])
        lows_a, highs_a = df["low"].to_numpy(float), df["high"].to_numpy(float)
        sw_low_c, sw_low_v, sw_high_c, sw_high_v = [], [], [], []
        for i in range(3, n - 3):
            win_l = lows_a[i - 3:i + 4]
            if lows_a[i] == win_l.min():
                sw_low_c.append(i); sw_low_v.append(lows_a[i])
            win_h = highs_a[i - 3:i + 4]
            if highs_a[i] == win_h.max():
                sw_high_c.append(i); sw_high_v.append(highs_a[i])
        sl_c = np.array(sw_low_c, dtype=int); sh_c = np.array(sw_high_c, dtype=int)
        sl_v = np.array(sw_low_v); sh_v = np.array(sw_high_v)

        vol_a = df["volume"].to_numpy(float)
        close_a = df["close"].to_numpy(float)
        low_a = lows_a
        for t in range(140, n - 1):
            # zone = bars [t-90 .. t-1]; swing tâm g hợp lệ: t-90 <= g-3 và g+3 <= t-1
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
            # ATR% quality (window 20 trên zone) — fmax bỏ NaN hàng đầu như pandas .max(axis=1)
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
            tr = {"support": support, "resistance": resistance, "mid": mid, "width": width, "quality": quality}

            # volume ratios tính vector trên mảng
            def vr_last(window: int) -> float | None:
                if t < window:
                    return None
                ref = vol_a[t - window:t]
                m = float(np.nanmean(ref))
                return vol_a[t] / m if m > 0 else None

            def dry_ratio(recent_n: int, ref_n: int) -> float | None:
                if t < ref_n + recent_n:
                    return None
                rec = vol_a[t - recent_n + 1:t + 1]
                ref = vol_a[t - recent_n - ref_n + 1:t - recent_n + 1]
                mx = float(np.nanmax(ref))
                return float(np.nanmax(rec)) / mx if mx > 0 else None

            # SOS
            hits: dict[str, float] = {}
            vr = vr_last(max(SOS_VOL_WINDOW, 5))
            lc, ll = close_a[t], low_a[t]
            pl = low_a[t - 1] if t >= 1 else ll
            pct = df["pct_chg"].iloc[t] if pd.notna(df["pct_chg"].iloc[t]) else 0.0
            if vr is not None and lc >= resistance * 0.99 and pct >= SOS_PCT_MIN and vr >= SOS_VOL_RATIO:
                hits["sos"] = vr + max((lc - resistance) / resistance * 100.0, 0.0) + quality
            # Spring
            vr5 = vr_last(5)
            if vr5 is not None and min(pl, ll) <= support * 0.995 and lc > support * 1.005 \
                    and lc < mid + width * 0.25 and vr5 >= SPRING_VOL_RATIO:
                hits["spring"] = (lc - support) / support * 100.0 + quality
            # LPS
            dry = dry_ratio(LPS_LOOKBACK, max(LPS_VOL_REF_WINDOW, 10))
            if dry is not None and float(np.min(low_a[max(0, t - 2):t + 1])) <= support + width * 0.35 \
                    and lc > support and dry <= LPS_VOL_DRY_RATIO:
                hits["lps"] = (1.0 - dry) + quality
            # EVR
            vr10 = vr_last(max(EVR_VOL_WINDOW, 10))
            if vr10 is not None and vr10 >= EVR_VOL_RATIO and lc <= mid \
                    and -EVR_MAX_DROP <= pct <= EVR_MAX_RISE and lc >= support * 0.98:
                hits["evr"] = vr10 + quality

            fwd = forward_stats(df, t)
            row = {"sym": sym, "date": str(df["date"].iloc[t]),
                   "breadth": breadth_pct.get(str(df["date"].iloc[t]), None),
                   **fwd}
            if hits:
                for k, score in hits.items():
                    rows.append({"trigger": k, "score": round(score, 3),
                                 "tp15_18_8": tp_sl_outcome(df, t, 18, 8),
                                 "tp15_9_4": tp_sl_outcome(df, t, 9, 4),
                                 **row})
            else:
                range_day_rows.append(row)
        print(f"  [{si + 1}/{len(frames)}] {sym}: xong ({len(rows)} trigger đến giờ)")

    trig = pd.DataFrame(rows)
    base = pd.DataFrame(range_day_rows)
    print(f"\nTổng nến quét: {total_days} | nến có range Wyckoff hợp lệ (baseline): {len(base)}")
    if trig.empty:
        print("KHÔNG CÓ TRIGGER NÀO với tham số gốc — mô hình quá chặt cho crypto.")
        return

    print("\n=== Tần suất trigger (toàn bộ lịch sử ~2.7 năm) ===")
    cnt = trig.groupby("trigger").size()
    for k, v in cnt.items():
        per_sym_year = v / len(SYMBOLS) / 2.7
        print(f"  {k.upper():8s}: {v:4d} lần  (~{per_sym_year:.1f}/symbol/năm)")

    def stats(sub: pd.DataFrame, col: str) -> tuple[float, float, int]:
        s = sub[col].dropna()
        return (float(s.mean()), float((s > 0).mean() * 100.0), len(s))

    print("\n=== Forward return: trigger vs baseline (ngày có range, không trigger) ===")
    print(f"{'Nhóm':14s} {'n':>5s} | {'f+1d mean':>9s} {'win%':>6s} | {'f+3d mean':>9s} {'win%':>6s} | {'f+5d mean':>9s} {'win%':>6s}")
    print(f"{'BASELINE':14s} {len(base):5d}", end=" | ")
    for c in ("f1", "f3", "f5"):
        m, w, _ = stats(base, c)
        print(f"{m:9.2f} {w:5.1f}%", end=" | " if c != "f5" else "\n")
    for k in ("spring", "sos", "lps", "evr"):
        sub = trig[trig["trigger"] == k]
        if sub.empty:
            continue
        print(f"{k.upper():14s} {len(sub):5d}", end=" | ")
        for c in ("f1", "f3", "f5"):
            m, w, _ = stats(sub, c)
            print(f"{m:9.2f} {w:5.1f}%", end=" | " if c != "f5" else "\n")

    print("\n=== Theo regime (breadth = % symbol trên MA20) ===")
    for k in ("spring", "sos", "lps"):
        sub = trig[(trig["trigger"] == k) & trig["breadth"].notna()]
        if sub.empty:
            continue
        hi = sub[sub["breadth"] >= 50.0]
        lo = sub[sub["breadth"] < 50.0]
        for name, g in (("RISK_ON", hi), ("RISK_OFF", lo)):
            if len(g) < 5:
                continue
            m, w, _ = stats(g, "f3")
            print(f"  {k.upper():8s} {name}: n={len(g):4d} f+3d={m:6.2f}% win={w:.1f}%")

    print("\n=== Mô hình thoát gốc (TP +18%/SL -8%, 15 ngày) vs crypto hóa (TP +9%/SL -4%) ===")
    for k in ("spring", "sos", "lps", "evr"):
        sub = trig[trig["trigger"] == k]
        if sub.empty:
            continue
        o1 = sub["tp15_18_8"].value_counts(normalize=True)
        o2 = sub["tp15_9_4"].value_counts(normalize=True)
        f1 = {x: round(float(o1.get(x, 0) * 100), 1) for x in ("TP", "SL", "NONE")}
        f2 = {x: round(float(o2.get(x, 0) * 100), 1) for x in ("TP", "SL", "NONE")}
        print(f"  {k.upper():8s} gốc TP/SL/none = {f1} | crypto = {f2}")

    trig.to_csv("/home/z/my-project/scripts/wyckoff_crypto_triggers.csv", index=False)
    base.to_csv("/home/z/my-project/scripts/wyckoff_crypto_baseline.csv", index=False)
    print("\nĐã lưu chi tiết: scripts/wyckoff_crypto_triggers.csv")


if __name__ == "__main__":
    main()
