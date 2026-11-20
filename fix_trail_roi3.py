import pathlib
p = pathlib.Path("src/components/auto-panel-positions.tsx")
s = p.read_text()
old = "const peak = et && et.peak > 0 ? et.peak : open.entryPrice;"
assert old in s, "khong tim thay dong peak cu"
new = "const markPx = tickers[open.symbol]?.price ?? open.entryPrice; const livePeak = open.side === \"SHORT\" ? Math.min(open.entryPrice, markPx) : Math.max(open.entryPrice, markPx); const basePeak = et && et.peak > 0 ? et.peak : livePeak; const peak = open.side === \"SHORT\" ? Math.min(basePeak, markPx) : Math.max(basePeak, markPx);"
s = s.replace(old, new, 1)
p.write_text(s)
print("OK - peak fallback theo gia mark, khong con = entry khi et null")
