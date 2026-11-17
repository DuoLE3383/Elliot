// ─── /api/dqf — Sàn chất lượng động (0.3.2) ──────────────────────────────────
// GET  → file dqf-state.json (state + hist + công tắc) — KHÔNG đụng DB
//        (bài học vụ integrity_check: poll không được quét DB).
// POST { on: boolean } → bật/tắt DQF (giữ nguyên state + hist để xem lại);
//        engine đọc lại ở chu kỳ kế tiếp (tick cũng refresh file).
import { NextResponse } from "next/server";
import { readDqfFile, setDqfOn } from "@/lib/dqf";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(readDqfFile(), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { on?: unknown };
    if (typeof body.on !== "boolean") {
      return NextResponse.json({ ok: false, error: "body cần { on: boolean }" }, { status: 400 });
    }
    const f = setDqfOn(body.on);
    return NextResponse.json({ ok: true, on: f.on });
  } catch {
    return NextResponse.json({ ok: false, error: "body JSON không hợp lệ" }, { status: 400 });
  }
}
