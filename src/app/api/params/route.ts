// ─── /api/params — đọc + đặt override tham số runtime (server-only) ──────────
// GET  → catalog các nhóm tham số (giá trị hiệu lực + override + meta cho UI)
// POST { key, value } → đặt override; { key, value: null } → trả về mặc định.
// Mọi thay đổi đều hydrateParams() ngay nên engine có hiệu lực từ tick kế tiếp.

import { NextResponse } from "next/server";
import { getOverrides, paramCatalog, setOverride } from "@/lib/params-store";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { groups, file } = paramCatalog();
    return NextResponse.json({ ok: true, groups, file });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "catalog failed" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as { key?: unknown; value?: unknown } | null;
    const key = typeof body?.key === "string" ? body.key : null;
    if (!key) return NextResponse.json({ ok: false, error: "Missing key" }, { status: 400 });
    // value: null = reset về mặc định; còn lại number | boolean
    const raw = body?.value;
    const value =
      raw === null || raw === undefined
        ? null
        : typeof raw === "boolean"
          ? raw
          : typeof raw === "number" && Number.isFinite(raw)
            ? raw
            : null;
    if (raw != null && value === null) {
      return NextResponse.json({ ok: false, error: "Value must be a number, a boolean or null" }, { status: 400 });
    }
    const r = setOverride(key, value);
    if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 400 });
    const { groups, file } = paramCatalog();
    return NextResponse.json({ ok: true, overrides: getOverrides(), groups, file });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "set failed" }, { status: 500 });
  }
}
