import { NextRequest, NextResponse } from "next/server";
import { VALID_INTERVALS, fetchKlinesDirectResolved } from "@/lib/klines-direct";
import { startLiveStream } from "@/lib/live-stream";
import { LIVE_HEARTBEAT_MS, LIVE_MAX_AGE_MS } from "@/lib/params";

/**
 * GET /api/stream?symbol=&interval= — GIÁ REALTIME KIỂU SÀN (SSE).
 *
 * Mỗi tab browser mở MỘT luồng; server bám websocket kline của Binance futures
 * (fstream) và đẩy phần đuôi nến ~1 lần/giây (src/lib/live-stream.ts). Node cũ
 * không có WebSocket thì lib tự rơi về REST poll — luồng vẫn live, chỉ chậm hơn.
 *
 * Kết nối tự đóng sau LIVE_MAX_AGE_MS — EventSource của browser tự nối lại,
 * nên pm2 restart hay cloudflared flip cũng không làm chart "chết" vĩnh viễn.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const symbol = (sp.get("symbol") ?? "BTCUSDT").toUpperCase();
  const interval = sp.get("interval") ?? "5m";

  if (!VALID_INTERVALS.includes(interval as (typeof VALID_INTERVALS)[number])) {
    return NextResponse.json({ error: "invalid interval" }, { status: 400 });
  }
  if (!/^[A-Z0-9]{5,20}$/.test(symbol)) {
    return NextResponse.json({ error: "invalid symbol", symbol }, { status: 400 });
  }

  // Resolve alias NGAY TỪ ĐẦU (PEPEUSDT → 1000PEPEUSDT) để:
  //   • 400 "invalid symbol" / 502 "binance_unreachable" có nghĩa như /api/klines
  //     (EventSource nhận HTTP lỗi → onerror, không treo luồng rác);
  //   • websocket đăng ký đúng stream của perp symbol thật.
  let resolved: string;
  try {
    resolved = (await fetchKlinesDirectResolved(symbol, interval, 2)).symbol;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "fetch failed";
    if (msg === "invalid symbol") {
      return NextResponse.json({ error: "invalid symbol", symbol }, { status: 400 });
    }
    return NextResponse.json({ error: "binance_unreachable", detail: msg }, { status: 502 });
  }

  const encoder = new TextEncoder();
  let teardown: (() => void) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const write = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true; // client đã ngắt — teardown sẽ dọn
        }
      };

      write("retry: 3000\n\n");
      write(`event: hello\ndata: ${JSON.stringify({ symbol: resolved, interval })}\n\n`);

      const stopLive = startLiveStream(resolved, interval, (ev) => {
        write(`event: kline\ndata: ${JSON.stringify(ev)}\n\n`);
      });
      const hb = setInterval(() => write(`: hb ${Date.now()}\n\n`), LIVE_HEARTBEAT_MS);

      const kill = () => {
        if (closed) return;
        closed = true;
        clearInterval(hb);
        stopLive();
        try {
          controller.close();
        } catch {
          // đã đóng rồi
        }
      };
      teardown = kill;
      req.signal.addEventListener("abort", kill);
      // tuổi thọ tối đa — browser EventSource tự reconnect, luồng không bị zombie
      const maxAge = setTimeout(kill, LIVE_MAX_AGE_MS);
      if (typeof maxAge.unref === "function") maxAge.unref();
    },
    cancel() {
      teardown?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
