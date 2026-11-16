// ─── /api/tune2 — "NÂNG CẤP CẤP 2": đề xuất RR + Quality floor cho 3 sổ ──────
// GET              → đề xuất ĐÃ LƯU (db/tune2-proposal.json; lần đầu tự tính từ
//                    số thật của cả ba sổ) + giá trị đang hiệu lực của các núm.
//                    File có sẵn thì KHÔNG đụng DB — GET luôn nhẹ, không đốt DB
//                    (bài học vụ integrity_check: poll không được quét DB).
// POST refresh     → đo lại từ DB + sinh lại đề xuất (giữ trạng thái applied/
//                    dismissed của cùng param), lưu file.
// POST apply {book}→ ÁP các đề xuất pending của MỘT sổ: setOverride cho núm
//                    runtime (RR_TP_RATIO, VUL_*, WYC_*), syncEngine cho floor
//                    sổ B (minScore/minAuc/minAcc); đánh dấu applied trong file.
// POST dismiss {book} → bỏ qua các đề xuất pending của sổ đó (giữ file để xem lại).

import { NextResponse } from "next/server";
import {
  computeTune2File,
  ensureTune2File,
  loadTune2File,
  saveTune2File,
  tune2CurrentWithEngine,
  type BookId,
  type Tune2Item,
} from "@/lib/tune2";
import { setOverride } from "@/lib/params-store";
import { syncEngine } from "@/lib/engine";

export const dynamic = "force-dynamic";

const asBook = (v: unknown): BookId | null => (v === "a" || v === "b" || v === "c" ? v : null);

/** Áp MỘT item. Trả về cfg patch sổ B (nếu có) để client đồng bộ localStorage. */
function applyItem(item: Tune2Item): Record<string, number> {
  // floor sổ B — sống trong cfg engine, KHÔNG phải param override
  if (item.book === "b" && item.kind === "floor") {
    const cfg: Record<string, number> = {};
    if (item.param === "minScore" && item.to !== item.from) cfg.minScore = item.to;
    for (const e of item.extras) {
      if (e.to !== e.from) cfg[e.param] = e.to;
    }
    if (Object.keys(cfg).length > 0) syncEngine({ cfg });
    return cfg;
  }
  // mọi núm còn lại là param runtime (pval) — setOverride validates qua EDITABLE
  if (item.to !== item.from) setOverride(item.param, item.to);
  for (const e of item.extras) {
    if (e.to !== e.from) setOverride(e.param, e.to);
  }
  return {};
}

export async function GET() {
  try {
    const file = await ensureTune2File();
    return NextResponse.json(
      { ok: true, ...file, current: tune2CurrentWithEngine() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "tune2 failed" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  try {
    if (body.action === "refresh") {
      const prev = loadTune2File();
      const next = await computeTune2File();
      // giữ trạng thái applied/dismissed của CÙNG (book, kind, param) — đề xuất
      // cũ user đã áp/đã bỏ qua không bật lại thành pending vô explan
      if (prev) {
        const old = new Map(prev.items.filter((i) => i.status !== "pending").map((i) => [`${i.book}:${i.kind}:${i.param}`, i] as const));
        for (const item of next.items) {
          const o = old.get(`${item.book}:${item.kind}:${item.param}`);
          if (o) {
            item.status = o.status;
            item.appliedAt = o.appliedAt;
          }
        }
      }
      saveTune2File(next);
      return NextResponse.json({ ok: true, ...next, current: tune2CurrentWithEngine() });
    }

    if (body.action === "apply" || body.action === "dismiss") {
      const book = asBook(body.book);
      if (!book) return NextResponse.json({ ok: false, error: "book must be a|b|c" }, { status: 400 });
      const file = await ensureTune2File();
      const targets = file.items.filter((i) => i.book === book && i.status === "pending");
      if (targets.length === 0) {
        return NextResponse.json({ ok: true, applied: 0, note: "no pending items", ...file, current: tune2CurrentWithEngine() });
      }
      let cfgPatch: Record<string, number> = {};
      for (const item of targets) {
        if (body.action === "apply") {
          const patch = applyItem(item);
          cfgPatch = { ...cfgPatch, ...patch };
          item.status = "applied";
          item.appliedAt = new Date().toISOString();
        } else {
          item.status = "dismissed";
        }
      }
      saveTune2File(file);
      const note =
        body.action === "apply"
          ? `đã áp ${targets.length} đề xuất sổ ${book.toUpperCase()}`
          : `đã bỏ qua ${targets.length} đề xuất sổ ${book.toUpperCase()}`;
      return NextResponse.json({ ok: true, applied: targets.length, cfgPatch, note, ...file, current: tune2CurrentWithEngine() });
    }

    return NextResponse.json({ ok: false, error: "unknown action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "tune2 post failed" }, { status: 500 });
  }
}
