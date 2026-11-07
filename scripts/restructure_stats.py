#!/usr/bin/env python3
# 0.2.84 — restructure /stats: chuyển picker+tabs vào CH5, journal vào CH4
# (sau CH1-CH3 đã chèn bằng MultiEdit). Khớp block theo marker chính xác.
import io, sys

PATH = "/home/z/my-project/src/app/stats/page.tsx"
src = io.open(PATH, encoding="utf-8").read()
lines = src.split("\n")

def find(prefix: str, start: int = 0) -> int:
    for i in range(start, len(lines)):
        if lines[i].startswith(prefix):
            return i
    sys.exit(f"NOT FOUND: {prefix!r}")

P = find("            {/* combo picker cho 2 section client-side */}")
T = find("            {/* ── 0.2.82 — TERMINAL TABS")
J = find("            {/* ── Trade journal — tính Ở SERVER")
E = find("            {/* 0.2.82 — card Deep analysis (blue) XOÁ")

assert P < T < J < E, (P, T, J, E)

picker, tabs, journal = lines[P:T], lines[T:J], lines[J:E]

def indent(block: list[str]) -> list[str]:
    return [("    " + l if l.strip() else l) for l in block]

picker_i, tabs_i, journal_i = indent(picker), indent(tabs), indent(journal)

fragment = []
fragment.append("            {/* ── 0.2.84 — CH4 · Lịch sử & Sổ lệnh: hist + sg + journal ── */}")
fragment.append('            <section id="st-ch4" className={flash === "st-ch4" ? "chapter-flash" : undefined}>')
fragment.append('              <Chapter title={t(lang, "stats.ch4.t")} note={t(lang, "stats.ch4.note")}>')
fragment.append('                <div className="grid gap-3 xl:grid-cols-2">')
fragment.append('                  {sec("hist")}')
fragment.append('                  {sec("sg")}')
fragment.append("                </div>")
fragment.append('                <div className="mt-3">')
fragment.extend(journal_i)
fragment.append("                </div>")
fragment.append("              </Chapter>")
fragment.append("            </section>")
fragment.append("")
fragment.append("            {/* ── 0.2.84 — CH5 · Lab & Phân tích sâu: bộ chọn combo + 3 tab terminal ── */}")
fragment.append('            <section id="st-ch5" className={flash === "st-ch5" ? "chapter-flash" : undefined}>')
fragment.append('              <Chapter title={t(lang, "stats.ch5.t")} note={t(lang, "stats.ch5.note")}>')
fragment.extend(picker_i)
fragment.extend(tabs_i)
fragment.append("              </Chapter>")
fragment.append("            </section>")
fragment.append("")

new_lines = lines[:P] + fragment + lines[E:]
io.open(PATH, "w", encoding="utf-8", newline="\n").write("\n".join(new_lines))
print(f"OK: picker={len(picker)} tabs={len(tabs)} journal={len(journal)} lines moved; file now {len(new_lines)} lines")
