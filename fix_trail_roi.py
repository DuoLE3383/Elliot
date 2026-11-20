import pathlib
LB = chr(91)
RB = chr(93)
p = pathlib.Path("src/components/auto-panel-positions.tsx")
s = p.read_text()
if "trailRoiStopPrice" not in s:
    s = s.replace("trailStopPrice", "trailStopPrice, trailRoiStopPrice", 1)
old_stop = "const stop = trailStopPrice(open.side, open.entryPrice, peak, act, dist);"
new_stop = "const peakRoi = trailMovePct(open.side, open.entryPrice, peak) * open.leverage; const roiStop = trailRoiStopPrice(open.side, open.entryPrice, peakRoi, open.leverage); const stop = roiStop ?? trailStopPrice(open.side, open.entryPrice, peak, act, dist);"
assert old_stop in s, "khong tim thay dong stop cu"
s = s.replace(old_stop, new_stop)
old_move = "const move = trailMovePct(open.side, open.entryPrice, peak);"
new_move = "const move = peakRoi;"
assert old_move in s, "khong tim thay dong move cu"
s = s.replace(old_move, new_move)
old_wait = "auto.pos.trailWait\", { a: Number(act.toFixed(2))"
if old_wait in s:
    s = s.replace(old_wait, "auto.pos.trailWait\", { a: 3")
p.write_text(s)
print("OK - UI trail da chuyen sang ROI")
