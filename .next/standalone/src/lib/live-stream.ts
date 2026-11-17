// ─── live-stream — lõi giá realtime kiểu sàn cho /api/stream ─────────────────
// Server bám websocket kline của Binance futures (wss://fstream.binance.com) và
// đẩy phần ĐUÔI dãy nến (2 nến cuối) về client qua SSE ~1 lần/giây. Node cũ
// không có WebSocket global (18/20 trước 21) thì tự rơi về REST poll.
//
// Dependency-free on purpose (chỉ ./types + ./params + ./klines-direct — bản
// thân klines-direct đã dependency-free để esbuild bundle được) nên file này:
//   • import được từ route SSE, từ test script (.mts) lẫn từ CLIENT
//     (page.tsx chỉ lấy mergeTail — hàm thuần, không đụng node API nào).
//
// Dữ liệu đẩy đi luôn là TailEvent { symbol, interval, src, tail, tk, ts }:
//   • tail — 1-2 nến cuối (nến đang chạy + nến vừa đóng khi lăn nến);
//   • tk   — ticker 24h tươi cho header (refresh LIVE_TICKER_MS, có thể undefined);
//   • src  — "ws" khi đang bám websocket, "poll" khi đang REST poll.

import type { Kline } from "./types";
import { LIVE_FLUSH_MS, LIVE_POLL_MS, LIVE_TICKER_MS, LIVE_WS_PROBE_MS, LIVE_WS_STALE_MS } from "./params";
import { fetchKlinesDirectResolved, fetchTicker24Direct, type TickerRow } from "./klines-direct";

const FSTREAM_WS = "wss://fstream.binance.com/ws";

export type LiveSrc = "ws" | "poll";

export interface TailEvent {
  symbol: string;
  interval: string;
  src: LiveSrc;
  /** 1-2 nến cuối để client vá đuôi dãy klines của nó */
  tail: Kline[];
  /** ticker 24h tươi (header chart) — có thể không có */
  tk?: Pick<TickerRow, "price" | "changePct" | "high" | "low" | "quoteVolume">;
  ts: number;
}

/**
 * Vá đuôi dãy klines bằng tail từ luồng live — THUẦN, client lẫn test đều dùng:
 *   • cùng open time  → thay nến cuối (nến đang chạy nhảy từng tick);
 *   • open time mới   → nối nến mới, trượt cửa sổ (giữ nguyên chiều dài maxLen);
 *   • open time cũ hơn → bỏ qua (tin đến trễ sau khi client đã nạp đè toàn bộ).
 * prev rỗng → trả nguyên prev (đợi full load đầu tiên định hình lịch sử).
 */
export function mergeTail(prev: Kline[], tail: Kline[], maxLen: number): Kline[] {
  if (!prev.length || !tail.length) return prev;
  const lastT = prev[prev.length - 1].t;
  const fresh = tail.filter((k) => k.t >= lastT);
  if (!fresh.length) return prev;
  let next = prev;
  for (const k of fresh) {
    if (k.t === next[next.length - 1].t) {
      next = next.slice();
      next[next.length - 1] = k;
    } else {
      next = [...next, k];
    }
  }
  if (next.length > maxLen) next = next.slice(next.length - maxLen);
  // fresh chỉ toàn nến giống hệt nến cuối cũ → giữ nguyên object để React bỏ qua re-render
  return next === prev || next[next.length - 1] === prev[prev.length - 1] ? prev : next;
}

/** websocket kline message (USDT-M futures) → Kline; V = taker-buy base volume. */
const wsKToKline = (k: {
  t: number;
  o: string;
  h: string;
  l: string;
  c: string;
  v: string;
  V?: string;
}): Kline => ({
  t: k.t,
  o: Number(k.o),
  h: Number(k.h),
  l: Number(k.l),
  c: Number(k.c),
  v: Number(k.v),
  tb: Number(k.V) || 0,
});

/**
 * Bắt đầu luồng live cho 1 cặp/khung đã resolve (alias 1000PEPE… phải resolve
 * TRƯỚC khi gọi — route dùng fetchKlinesDirectResolved để 400/502 đúng nghĩa).
 * Gọi `onEvent` mỗi lần flush (chỉ khi đuôi đổi) hoặc khi ticker 24h refresh.
 * Trả hàm dọn dẹp; mọi timer/websocket đều được thu hồi, an toàn khi gọi 2 lần.
 */
export function startLiveStream(
  symbol: string,
  interval: string,
  onEvent: (ev: TailEvent) => void,
): () => void {
  let stopped = false;
  let mode: LiveSrc = typeof WebSocket === "function" ? "ws" : "poll";
  let lastTwo: Kline[] = [];
  let lastSig = ""; // chữ ký đuôi đã gửi → không spam khi thị trường câm
  let tk: TailEvent["tk"] | undefined;
  let wsTries = 0;
  let ws: WebSocket | null = null;
  let wsStaleAt = 0;
  let wsOpenedAt = 0;
  let wsMsgs = 0; // số message kline đã nhận — probe lúc mới nối dựa vào đây

  const timers = new Set<ReturnType<typeof setTimeout>>();
  const later = (ms: number, fn: () => void) => {
    const id = setTimeout(() => {
      timers.delete(id);
      if (!stopped) fn();
    }, ms);
    timers.add(id);
    return id;
  };
  const cleanup = () => {
    stopped = true;
    try {
      ws?.close();
    } catch {
      // đã đóng
    }
    for (const id of timers) clearTimeout(id);
    timers.clear();
  };

  const push = (tail: Kline[], withTk: boolean) => {
    if (stopped) return;
    onEvent({
      symbol,
      interval,
      src: mode,
      tail,
      ...(withTk && tk ? { tk } : {}),
      ts: Date.now(),
    });
  };

  const sendIfChanged = (force = false) => {
    if (!lastTwo.length) return;
    const sig = JSON.stringify(lastTwo);
    if (sig === lastSig && !force) return;
    lastSig = sig;
    push(lastTwo, true);
  };

  /** websocket kline → buffer 2 nến cuối (thay cùng t / nối t mới) */
  const feed = (k: Kline) => {
    const last = lastTwo[lastTwo.length - 1];
    if (!last || k.t > last.t) lastTwo = [...lastTwo.slice(-1), k];
    else if (k.t === last.t) lastTwo = [...lastTwo.slice(0, -1), k];
    else return;
    wsMsgs++;
    wsStaleAt = Date.now();
  };

  const downgradeToPoll = () => {
    if (stopped || mode === "poll") return;
    mode = "poll";
    // KHÔNG reset lastSig: nếu đuôi poll về y hệt lần gửi cuối (đóng băng bởi
    // proxy chẳng hạn) thì im — client đã có data đó rồi, gửi lại là spam.
    void pollOnce();
  };

  const openWs = () => {
    if (stopped || mode === "poll") return;
    let sock: WebSocket;
    try {
      sock = new WebSocket(`${FSTREAM_WS}/${symbol.toLowerCase()}@kline_${interval}`);
    } catch {
      downgradeToPoll();
      return;
    }
    ws = sock;
    sock.onmessage = (ev: MessageEvent) => {
      try {
        const j = JSON.parse(String(ev.data)) as {
          k?: { i?: string } & Parameters<typeof wsKToKline>[0];
        };
        if (j?.k && j.k.i === interval) feed(wsKToKline(j.k));
      } catch {
        // frame bẩn → bỏ qua
      }
    };
    sock.onopen = () => {
      if (stopped) return;
      wsTries = 0;
      wsOpenedAt = Date.now();
      wsStaleAt = Date.now();
    };
    sock.onclose = () => {
      if (stopped || ws !== sock) return;
      ws = null;
      if (++wsTries <= 2) later(3_000, openWs);
      else downgradeToPoll();
    };
    sock.onerror = () => {
      try {
        sock.close();
      } catch {
        // onclose sẽ xử lý tiếp
      }
    };
  };

  /** REST poll — vòng setTimeout tránh chồng vòng khi fetch chậm */
  const pollOnce = async () => {
    if (stopped || mode !== "poll") return;
    try {
      const { klines } = await fetchKlinesDirectResolved(symbol, interval, 2);
      if (stopped) return;
      if (klines.length) lastTwo = klines.slice(-2);
      sendIfChanged();
    } catch {
      // Binance lapsed → thử lại sau với chu kỳ dài hơn nhờ ack qua `later`
    }
    if (stopped || mode !== "poll") return;
    later(LIVE_POLL_MS, () => void pollOnce());
  };

  // watchdog websocket: (a) probe lúc mới nối — LIVE_WS_PROBE_MS chưa thấy
  // message nào là mạng/proxy cho handshake nhưng chặn frame dữ liệu → hạ poll
  // NGAY (không qua vòng reconnect), đừng để chart im cả phút đầu; (b) đã thấy
  // dữ liệu rồi nhưng câm quá LIVE_WS_STALE_MS → đóng để reconnect, hết 2 lần
  // thử thì hạ hẳn xuống poll — client vẫn live, chỉ chậm hơn (REST 2.5s).
  const wsWatchdog = setInterval(() => {
    if (stopped || mode !== "ws") return;
    const silentFor = Date.now() - (wsMsgs ? wsStaleAt : wsOpenedAt || Date.now());
    if (wsMsgs === 0 ? silentFor > LIVE_WS_PROBE_MS : silentFor > LIVE_WS_STALE_MS) {
      if (wsMsgs === 0) {
        downgradeToPoll(); // chặn frame dữ liệu — poll đáp ứng tốt hơn ngay lập tức
        try {
          ws?.close();
        } catch {
          // mode đã "poll" → onclose bỏ qua
        }
      } else {
        try {
          ws?.close();
        } catch {
          // onclose xử lý
        }
      }
    }
  }, 5_000);

  // ticker 24h — refresh định kỳ và đẩy NGAY cả khi đuôi không đổi (header cần)
  const tickerLoop = async () => {
    if (stopped) return;
    const row = await fetchTicker24Direct(symbol);
    if (stopped) return;
    if (row && row.price > 0) {
      tk = {
        price: row.price,
        changePct: row.changePct,
        high: row.high,
        low: row.low,
        quoteVolume: row.quoteVolume,
      };
      sendIfChanged(true);
    }
    if (!stopped) later(LIVE_TICKER_MS, () => void tickerLoop());
  };

  // flush 1s — chỉ đẩy khi đuôi đổi (tin kèm ticker mới vẫn ép gửi qua force)
  const flush = setInterval(() => sendIfChanged(), LIVE_FLUSH_MS);

  // khởi động: seed đuôi bằng REST (chắc có dữ liệu ngay) rồi nối websocket
  void (async () => {
    try {
      const { klines } = await fetchKlinesDirectResolved(symbol, interval, 2);
      if (stopped) return;
      if (klines.length) lastTwo = klines.slice(-2);
      sendIfChanged(true);
    } catch {
      // route đã resolve thành công trước đó → hụt lần này thì ws/poll sẽ lấp
    }
    if (mode === "ws") openWs();
    void tickerLoop();
  })();

  return () => {
    clearInterval(flush);
    clearInterval(wsWatchdog);
    cleanup();
  };
}
