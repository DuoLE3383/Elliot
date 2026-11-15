// ─── /api/binance-keys — key Binance API cho auto trade (0.2.96) ─────────────
// GET            → trạng thái (masked key, nguồn store/env, lastTest)
// POST save      → {apiKey, apiSecret} lưu server-side (db/binance-keys.json 600)
// POST test      → gọi /fapi/v2/account signed — chỉ ĐỌC, không đặt lệnh nào
// POST clear     → xoá key khỏi store
// Secret không bao giờ trả về client. Lệnh dry-run KHÔNG đổi — key chỉ nằm
// chờ cho live mode sau này (bật bằng flag riêng, không phải bản này).

import { NextRequest, NextResponse } from "next/server";
import { binanceStatus, clearBinanceKeys, saveBinanceKeys, testBinanceKeys } from "@/lib/binance-keys";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(binanceStatus());
}

export async function POST(req: NextRequest) {
  let body: { action?: string; apiKey?: string; apiSecret?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "body không phải JSON" }, { status: 400 });
  }
  try {
    if (body.action === "save") {
      const r = saveBinanceKeys(String(body.apiKey ?? ""), String(body.apiSecret ?? ""));
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
      return NextResponse.json({ ok: true, status: binanceStatus() });
    }
    if (body.action === "test") {
      const r = await testBinanceKeys();
      return NextResponse.json({ ok: r.ok, note: r.note, result: r, status: binanceStatus() });
    }
    if (body.action === "clear") {
      clearBinanceKeys();
      return NextResponse.json({ ok: true, status: binanceStatus() });
    }
    return NextResponse.json({ error: "action không hợp lệ (save|test|clear)" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "binance-keys failed" }, { status: 500 });
  }
}
