#!/usr/bin/env python3
# 0.2.84 — restructure /ai: b1→CH1, b3+b5+b2→CH2, b4+b6a→CH3 (grid 2 cột),
# b6b+b7→CH4. Bo wrapper grid cũ của block 6, strip dòng đóng thừa.
import io, sys

PATH = "/home/z/my-project/src/app/ai/page.tsx"
lines = io.open(PATH, encoding="utf-8").read().split("\n")

def find(prefix: str, start: int = 0) -> int:
    for i in range(start, len(lines)):
        if lines[i].startswith(prefix):
            return i
    sys.exit(f"NOT FOUND: {prefix!r}")

B1 = find("        {/* 1 — trạng thái vận hành")
B2 = find("        {/* 2 — độ tin cậy prob")
B3 = find("        {/* 3 — đã học bao nhiêu dữ liệu */}")
B4 = find("        {/* 4 — giải phẫu lệnh (autopsy)")
B5 = find("        {/* 5 — champion mỗi combo */}")
B6 = find("        {/* 6 — công cụ: Tự tiến hoá")
B6A = find("          {/* 6a — Tự tiến hoá")
B6B = find("          {/* 6b — Phân tích nguyên nhân gốc")
B7 = find("        {/* 7 — About: 2 lớp AI")
END = find("      {/* ── Settings popup (0.2.76)")
assert B1 < B2 < B3 < B4 < B5 < B6 < B6A < B6B < B7 < END, (B1, B2, B3, B4, B5, B6, B6A, B6B, B7, END)

b1, b2, b3, b4, b5 = lines[B1:B2], lines[B2:B3], lines[B3:B4], lines[B4:B5], lines[B5:B6]
b6a = lines[B6A:B6B]
b6b = lines[B6B:B7]
b7 = lines[B7:END]

# b6b kết thúc bằng dòng đóng grid cũ "        </div>" — bỏ nó (card dive sống
# trong Chapter của CH4, không cần wrapper grid)
while b6b and not b6b[-1].strip():
    b6b.pop()
assert b6b[-1].strip() == "</div>" or b6b[-1].strip() == "        </div>", repr(b6b[-1])
b6b.pop()
while b6b and not b6b[-1].strip():
    b6b.pop()

def indent(block: list[str]) -> list[str]:
    return [("    " + l if l.strip() else l) for l in block]

b1_i, b2_i, b3_i, b4_i, b5_i = indent(b1), indent(b2), indent(b3), indent(b4), indent(b5)
b6a_i, b6b_i, b7_i = indent(b6a), indent(b6b), indent(b7)

frag = []
frag.append("        {/* ── 0.2.84 — CH1 · Engine hiện hành & LLM Risk Officer ── */}")
frag.append('        <section id="ai-chA" className={flash === "ai-chA" ? "chapter-flash" : undefined}>')
frag.append('          <Chapter title={t(lang, "ai.chA.t")} note={t(lang, "ai.chA.note")}>')
frag.extend(b1_i)
frag.append("          </Chapter>")
frag.append("        </section>")
frag.append("")
frag.append("        {/* ── 0.2.84 — CH2 · Dữ liệu đã học & độ tin cậy: runs + champions + reliability ── */}")
frag.append('        <section id="ai-chB" className={flash === "ai-chB" ? "chapter-flash" : undefined}>')
frag.append('          <Chapter title={t(lang, "ai.chB.t")} note={t(lang, "ai.chB.note")}>')
frag.extend(b3_i)
frag.extend(b5_i)
frag.extend(b2_i)
frag.append("          </Chapter>")
frag.append("        </section>")
frag.append("")
frag.append("        {/* ── 0.2.84 — CH3 · Tự học & Giải phẫu lệnh: autopsy + evo ── */}")
frag.append('        <section id="ai-chC" className={flash === "ai-chC" ? "chapter-flash" : undefined}>')
frag.append('          <Chapter title={t(lang, "ai.chC.t")} note={t(lang, "ai.chC.note")}>')
frag.append('            <div className="grid gap-4 xl:grid-cols-2">')
frag.extend(b4_i)
frag.extend(b6a_i)
frag.append("            </div>")
frag.append("          </Chapter>")
frag.append("        </section>")
frag.append("")
frag.append("        {/* ── 0.2.84 — CH4 · Phân tích nguyên nhân gốc (LLM) & About ── */}")
frag.append('        <section id="ai-chD" className={flash === "ai-chD" ? "chapter-flash" : undefined}>')
frag.append('          <Chapter title={t(lang, "ai.chD.t")} note={t(lang, "ai.chD.note")}>')
frag.extend(b6b_i)
frag.extend(b7_i)
frag.append("          </Chapter>")
frag.append("        </section>")
frag.append("")

new_lines = lines[:B1] + frag + lines[END:]
io.open(PATH, "w", encoding="utf-8", newline="\n").write("\n".join(new_lines))
print(f"OK: b1={len(b1)} b2={len(b2)} b3={len(b3)} b4={len(b4)} b5={len(b5)} b6a={len(b6a)} b6b={len(b6b)} b7={len(b7)}; file now {len(new_lines)} lines")
