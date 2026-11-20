import pathlib
p = pathlib.Path("src/components/auto-panel-positions.tsx")
s = p.read_text()
old_props = ", trailRoiStopPrice,"
assert old_props in s, "khong tim thay trailRoiStopPrice trong props"
s = s.replace(old_props, ",", 1)
old_import = 'import { Square } from "lucide-react";'
assert old_import in s, "khong tim thay dong import Square"
new_import = old_import + '\nimport { trailRoiStopPrice } from "@/lib/autotrade";'
s = s.replace(old_import, new_import, 1)
p.write_text(s)
print("OK - trailRoiStopPrice da chuyen sang import, khong lay tu props nua")
