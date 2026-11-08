#!/usr/bin/env python3
# audit-live.py — rà sổ dry-run từ file /api/autotrade JSON xuất trên VPS.
# Chạy: python3 audit-live.py [đường-dẫn-json]  (mặc định /home/duong/autotrade-live.json)
# Thuần stdlib, không cài thêm gì. Công thức khớp 1:1 với src/lib/audit-book.ts (0.2.87).
import json, sys

PATH = sys.argv[1] if len(sys.argv) > 1 else "/home/duong/autotrade-live.json"
d = json.load(open(PATH))
trades = d.get("trades", [])
FEE_PCT = 0.05  # % mỗi bên (src/lib/params.ts)

def r2(v): return round(v * 100) / 100

def expected_pnl(t):
    e, x, lev = t.get("entryPrice"), t.get("exitPrice"), t.get("leverage") or 1
    if not e or not x or lev <= 0: return None
    move = ((e - x) / e * 100) if t.get("side") == "SHORT" else ((x - e) / e * 100)
    pnl = r2(move * lev - FEE_PCT * lev * 2)
    # thanh lý: di chuyển BẤT LỢI chạm 100/lev % (một nguồn với liquidationHit
    # của engine — 0.2.88 vá bug đảo dấu làm SHORT thắng lớn bị ép −100)
    if lev > 1 and move <= -(100 / lev): pnl = -100.0
    elif pnl < -100: pnl = -100.0
    return pnl

closed = [t for t in trades if t.get("status") == "closed" and t.get("exitPrice")]
closed.sort(key=lambda t: t.get("createdAt") or "")
opens = [t for t in trades if t.get("status") == "open"]

st = d.get("stats") or {}
print(f"== 0) TỔNG: {len(trades)} lệnh | đóng {len(closed)} | mở {len(opens)}")
print(f"   UI stats: đóng {st.get('closed')} thắng {st.get('wins')} WR {st.get('winRate')}% net {st.get('netPnlPct')}")
print(f"   UI capital (equity hiển thị): {d.get('capital')} | ví lần reset gần nhất: {d.get('walletCapital')} (resetAt {d.get('resetAt')})")

# 1) ROE từng dòng
bad = 0
print("\n== 1) ROE LƯU vs ĐÚNG CÔNG THỨC (move × lev − phí round-trip; thanh lý −100)")
for t in closed:
    exp = expected_pnl(t)
    if exp is None:
        print(f"   [?] {t.get('symbol')} {t.get('side')} thiếu entry/exit — bỏ qua"); continue
    stored = t.get("pnlPct") or 0
    if abs(stored - exp) > 0.015:
        bad += 1
        print(f"   [LỆCH] {t.get('createdAt','')[:16]} {t.get('symbol')} {t.get('interval')} {t.get('side')} {t.get('exitKind')} lev{t.get('leverage')}: lưu {stored} ≠ đúng {exp} (chênh {r2(stored-exp)})")
print(f"   → {len(closed)-bad}/{len(closed)} dòng đúng" + (" — sổ sạch" if bad == 0 else f", {bad} dòng SAI"))

# 2) chuỗi vốn
print("\n== 2) CHUỖI VỐN (before kế thừa after trước; delta = vốn × stake% × ROE%)")
cap, chain_bad = None, 0
for t in closed:
    before = cap if cap is not None else (t.get("capitalBefore") or 1000)
    cb, ca = t.get("capitalBefore"), t.get("capitalAfter")
    if cb is None or abs(cb - before) > 0.01:
        chain_bad += 1
        print(f"   [ĐỨT] {t.get('createdAt','')[:16]} {t.get('symbol')} {t.get('side')}: before lưu {cb} ≠ kỳ vọng {r2(before)}")
    stake = t.get("stakePct") if t.get("stakePct") is not None else 100
    pnl = t.get("pnlPct") or 0
    after = max(0.0, r2(before + r2(before * (stake / 100) * (pnl / 100))))
    if ca is None or abs(ca - after) > 0.015:
        chain_bad += 1
        print(f"   [LỆCH] {t.get('createdAt','')[:16]} {t.get('symbol')} {t.get('side')}: after lưu {ca} ≠ kỳ vọng {after} (stake {stake}%)")
    cap = ca if ca is not None else after
tail = cap
if opens:
    ob = opens[0].get("capitalBefore")
    if ob is not None and tail is not None and abs(ob - tail) > 0.015:
        chain_bad += 1
        print(f"   [ĐỨT] lệnh mở {opens[0].get('symbol')}: capitalBefore {ob} ≠ equity chuỗi {tail}")
print(f"   → equity cuối chuỗi: {tail}" + (" — chuỗi liền" if chain_bad == 0 else f", {chain_bad} điểm lệch"))
ui_cap = d.get("capital")
if ui_cap is not None and tail is not None and abs(ui_cap - tail) > 0.015:
    print(f"   [!] UI capital {ui_cap} ≠ equity chuỗi {tail} — hiển thị lệch dữ liệu")

# 3) thống kê theo phía
print("\n== 3) THEO PHÍA (từ dữ liệu gốc, độc lập với UI)")
for side in ("LONG", "SHORT"):
    rows = [t for t in closed if t.get("side") == side]
    if not rows: continue
    wins = [t for t in rows if (t.get("pnlPct") or 0) > 0]
    losses = [t for t in rows if (t.get("pnlPct") or 0) <= 0]
    net = r2(sum(t.get("pnlPct") or 0 for t in rows))
    wr = len(wins) / len(rows) * 100
    aw = r2(sum(t["pnlPct"] for t in wins) / len(wins)) if wins else 0
    al = r2(sum(t["pnlPct"] for t in losses) / len(losses)) if losses else 0
    payoff = r2(abs(aw / al)) if al else float("inf")
    print(f"   {side}: {len(rows)} lệnh | WR {wr:.1f}% | net {net} | TB thắng {aw} | TB thua {al} | payoff {payoff}")

# 4) top lỗ
print("\n== 4) 5 LỆNH LỖ NẶNG NHẤT")
for t in sorted(closed, key=lambda x: x.get("pnlPct") or 0)[:5]:
    ap = t.get("autopsy")
    print(f"   {t.get('createdAt','')[:16]} {t.get('symbol')} {t.get('interval')} {t.get('side')} {t.get('exitKind')} entry {t.get('entryPrice')} → exit {t.get('exitPrice')} lev{t.get('leverage')} stake{t.get('stakePct')}% ROE {t.get('pnlPct')} prob {t.get('prob')} auc {t.get('auc')} score {t.get('score')} llm {t.get('llmVerdict')}")

# 5) lệnh mở
if opens:
    t = opens[0]
    lev = t.get("leverage") or 1
    sl_roe = r2((t.get("slPct") or 0) * lev)
    print(f"\n== 5) LỆNH ĐANG MỞ: {t.get('symbol')} {t.get('interval')} {t.get('side')} entry {t.get('entryPrice')} lev{lev} stake{t.get('stakePct')}% SL {t.get('slPct')}% giá (≈{sl_roe}% ROE) TP {t.get('tpPct')}% prob {t.get('prob')} auc {t.get('auc')}")
    if sl_roe > 50: print("   [!] SL tương đương >50% ROE — rủi ro/lệnh quá lớn")
else:
    print("\n== 5) Không có lệnh đang mở")

# 6) lệnh sinh sau 08/11 (sau repair)
new_rows = [t for t in trades if (t.get("createdAt") or "") >= "2026-11-08"]
if new_rows:
    print(f"\n== 6) {len(new_rows)} lệnh sinh từ 08/11 (kể cả đang mở):")
    for t in sorted(new_rows, key=lambda x: x.get("createdAt") or "")[:10]:
        print(f"   {t.get('createdAt','')[:16]} {t.get('symbol')} {t.get('interval')} {t.get('side')} {t.get('status')} entry {t.get('entryPrice')} ROE {t.get('pnlPct')} before {t.get('capitalBefore')} after {t.get('capitalAfter')}")

# 7) byCombo
bc = d.get("byCombo") or []
if bc:
    tot = r2(sum(c.get("netPnlPct") or 0 for c in bc))
    print(f"\n== 7) BYCOMBO ({len(bc)} combo) — tổng net {tot} vs UI net {st.get('netPnlPct')}")
    for c in bc[:8]:
        print(f"   {c.get('symbol')} {c.get('interval')}: {c.get('closed')} lệnh | WR {c.get('winRate')}% | net {c.get('netPnlPct')} | avg {c.get('avgPnlPct')}")
