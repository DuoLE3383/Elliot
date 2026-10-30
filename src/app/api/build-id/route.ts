import { NextResponse } from "next/server";
import { readFileSync } from "fs";
import path from "path";

export const dynamic = "force-dynamic";

/**
 * GET /api/build-id — id của bản build đang chạy trên server (runtime).
 * Tab trình duyệt so id này với <meta name="elliott-build"> được nướng vào
 * HTML lúc build; khác id → tab tự reload (src/components/build-reload.tsx).
 * Đọc public/build-id.txt — file được prebuild ghi lại cho MỖI lần build nên
 * nội dung luôn khớp với bản bundle trên đĩa (cwd chạy standalone là thư mục
 * chứa server.js hoặc root project — thử cả hai vị trí).
 */
function readBuildId(): string {
  for (const p of [
    path.join(process.cwd(), "public", "build-id.txt"),
    path.join(process.cwd(), "..", "public", "build-id.txt"),
  ]) {
    try {
      const v = readFileSync(p, "utf8").trim();
      if (v) return v;
    } catch {
      // thử vị trí kế tiếp
    }
  }
  return "unknown";
}

export async function GET() {
  return NextResponse.json({ id: readBuildId() }, { headers: { "Cache-Control": "no-store" } });
}
