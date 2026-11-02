// ─── PARAMS — MỘT file config dùng chung cho toàn bộ app ─────────────────────
// "các tham số nên đưa vào 1 file config riêng dùng chung cho toàn bộ"
//
// Mọi hằng số tinh chỉnh (tham số) của engine sống ở đây, chia nhóm rõ ràng để
// finetune mà không phải rà soát 6-7 file. File này là NGUỒN ĐỊNH NGHĨA duy
// nhất; các module (bcast-gate, universe, xgb, engine, llm…) import từ đây
// và re-export để chỗ cũ không đổi import — re-export không tạo bản sao,
// nên vẫn đúng nguyên tắc "một thuật toán + một database".
//
// Cách finetune an toàn: chỉnh giá trị → `npx tsx scripts/test-*.ts` chạy bộ
// test liên quan → `npm run build` → deploy. Mỗi tham số có comment nói rõ nó
// kéo Prob/chất lượng theo hướng nào.

// ── 1 · BROADCAST — tin "TOP coin tiềm năng" 5 phút lên Telegram ─────────────

/** $7M 24h quote volume — dưới mức này coin là sa mạc, không đáng đăng. */
export const BCAST_VOL_MIN = 7e6;
/** TP1 ≥ +5% từ entry — tín hiệu phải còn "đường đi" thì mới hứa hẹn. */
export const BCAST_PL1_MIN = 5;
/** Số coin tối đa mỗi tin broadcast. */
export const BCAST_TOP_N = 2;
/** Chống lặp: 1 coin (mọi khung giờ) chỉ được broadcast lại sau mỗi 3 giờ.
 *  RUNE 30m xuất hiện 4 lần trong 15 phút (4:11/4:15/4:21/4:25) vì `seen` cũ
 *  chỉ dùng để tag ⚡NEW chứ không chặn re-pick — đây là bản vá. */
export const BCAST_REPEAT_MS = 3 * 60 * 60_000;
/** Chống tín hiệu tự mâu thuẫn — áp lực mua bán (taker) lệch hẳn phía bên kia
 *  thì loại: BUY khi áp lực mua ≤ 42% hay SELL khi áp lực mua ≥ 58% là đâm
 *  vào phe đang áp đảo. */
export const PRESSURE_FLOOR_LONG = 42; // BUY bị chặn khi áp lực mua ≤ 42%
export const PRESSURE_CAP_SHORT = 58; // SELL bị chặn khi áp lực mua ≥ 58%

// ── 1b · SCAN DIGEST — tin "QUÉT LỆNH · TOP 10" 8 giờ/lần ────────────────────
// "thêm tin nhắn scan lệnh vào telegram, tin nhắn scan top 10 coin chỉ thông
// báo 8 tiếng 1 lần" — tổng hợp 10 combo tốt nhất theo điểm model (KỂ CẢ combo
// chưa đạt cổng, kèm lý do) gửi ĐỀU ĐỊNH 8h/lần; tin "TOP coin đạt cổng" 5
// phút cũ KHÔNG còn tự gửi nữa (phán quyết vẫn cập nhật panel mỗi 5 phút).
/** Nhịp gửi tin tổng hợp quét — 8 giờ. */
export const SCAN_DIGEST_EVERY_MS = 8 * 3_600_000;
/** Lệch pha so với bucket universe (0/8/16h) — digest rơi vào 4/12/20h để hai
 *  tin dài không dồn một lúc. */
export const SCAN_DIGEST_OFFSET_MS = 4 * 3_600_000;
/** Số coin tối đa trong tin quét. */
export const SCAN_DIGEST_TOP_N = 10;
/** Số combo tốt nhất được làm giàu kỹ thuật (kline fetch) trước khi chọn 10. */
export const SCAN_DIGEST_POOL = 14;

// ── 2 · NGƯỠNG CHẤT LƯỢNG CHUNG — MẶC ĐỊNH của setpoint duy nhất ──────────────
// Bộ ba dưới đây là fallback khi engine chưa có cfg (runtime lấy từ
// cfg.minScore/minAuc/minAcc — chỉnh trên Auto panel, xem AUTO_DEFAULTS trong
// autotrade.ts). Cùng bộ ba này áp cho MỌI tầng: mở lệnh, bù DCA, đăng broadcast.
/** Điểm tối thiểu — scoreOf = (AUC−0.5)×100 + (ACC−50) + tin cậy×CONF_W.
 *  AUC .8 + ACC 70 cho sẵn 30+20 = 50 → điểm 60 còn yêu cầu tin cậy ≥ ~2/3:
 *  model đạt ngưỡng metrics nhưng thiếu tự tin vẫn bị giữ lại.
 *  NOTE 31/10: prob đầu vào đã qua calibration (§6c) nên "tin cậy" là số
 *  trung thực — mọi nghi ngờ prob phồng phải sửa ở §6c, không hạ weight mù. */
export const BCAST_SCORE_MIN = 60;
/** Ngưỡng AUC của model — 0.8 nghĩa là model phải xếp hạng thật sự giỏi trên tập
 *  validation (out-of-sample), chỉ hơn tung đồng xu là không đủ tin. */
export const BCAST_AUC_MIN = 0.8;
/** Ngưỡng ACC của model — user nới từ 80 xuống 70 (31/10): vẫn lọc sạch nhiễu
 *  32–38 điểm, nhưng kênh không còn im lặng triền miên vì ngưỡng 80. */
export const BCAST_ACC_MIN = 70;

// ── 3 · UNIVERSE SCAN — "ATR + trending, re-ranks every 8h" ──────────────────
// (danh sách cặp UNIVERSE là DATA — nằm trong universe.ts, không phải tham số)

/** Khung nến dùng chấm điểm universe. */
export const UNIVERSE_INTERVAL = "1h";
/** Nhịp xếp hạng lại universe — mỗi 8 giờ. */
export const UNIVERSE_SCAN_MS = 8 * 3_600_000;
/** Độ dài cửa sổ chấm điểm — 240 nến 1h = 10 ngày giá đóng. */
export const UNIVERSE_LOOKBACK_CANDLES = 10 * 24;
/** Top N "trending pairs" công bố (UI card + Telegram + fallback watchlist). */
export const UNIVERSE_TOP = 30;
/** Số dòng hiển thị trong tin universe broadcast. */
export const UNIVERSE_BCAST_TOP = 10;
/** Số nến tối thiểu một cặp phải có trong scan mới đủ tư cách chấm rank. */
export const UNIVERSE_MIN_CANDLES = 55;

// ── 4 · TRADING SESSIONS — tin "SẮP MỞ PHIÊN" 4 phiên toàn cầu ───────────────
// (giờ mở phiên — SESSIONS — là DATA lịch sử thị trường, nằm trong market.ts)

/** Cặp + khung dùng tính thống kê Bull%/drift cho tin phiên. */
export const SESS_SYMBOL = "BTCUSDT";
export const SESS_INTERVAL = "1h";
/** Số nến nạp cho thống kê — 5000 × 1h, cùng cửa sổ panel đang load. */
export const SESS_KLINE_COUNT = 5000;
/** Báo TRƯỚC mở phiên bao nhiêu phút. */
export const SESS_EARLY_MIN = 5;
/** Tick muộn trong bao nhiêu phút sau giờ mở vẫn gửi bù "VỪA MỞ". */
export const SESS_LATE_WINDOW_MIN = 10;
/** Nhịp scheduler kiểm tra tới hạn — 60s (mỗi pass đã tự dedupe). */
export const SESS_TICK_MS = 60_000;
/** Chiều hướng phiên tới — 3 vùng Bull%: chỉ dám gọi LONG/SHORT khi lệch rõ
 *  (≥60% / ≤40% nến tăng), giữa là SIDEWAYS. Hết kiểu "SIDEWAYS mà P≈50%". */
export const SESS_BULL_LONG_MIN = 60; // Bull% ≥ 60 → LONG
export const SESS_BULL_SHORT_MAX = 40; // Bull% ≤ 40 → SHORT

// ── 5 · ENGINE CADENCE — nhịp quét của vòng auto ─────────────────────────────

/** Metronome 5 phút tái dùng snapshot scan mới hơn 4.5 phút (không quét lại). */
export const SCAN_FRESH_MS = 4.5 * 60_000;
/** Vòng cycle tự quét lại khi snapshot già hơn 30 phút. */
export const SCAN_TTL = 30 * 60_000;
/** Cache ticker 24h — 30s là đủ fresh cho volume + giá đóng lệnh. */
export const TICKERS_TTL = 30_000;

// ── 5b · LIVE CHART — giá realtime kiểu sàn (SSE + websocket Binance) ────────
// /api/stream mở MỘT luồng SSE cho mỗi tab: server bám websocket kline của
// Binance futures (fstream) và đẩy phần đuôi nến về browser ~1 lần/giây; Node
// không có WebSocket (18/20 cũ) thì tự rơi về REST poll. Client cũng nạp đè
// toàn bộ klines định kỳ để vá lịch sử (cửa sổ 500 nến trượt đều).

/** Nhịp gộp tin websocket rồi đẩy về client — 1s là "realtime" mắt thường
 *  trên khung ≥1m, đồng thời giữ số lần recompute engine trên mobile ở mức lành. */
export const LIVE_FLUSH_MS = 1_000;
/** Nhịp REST poll khi server không nói được websocket với Binance. */
export const LIVE_POLL_MS = 2_500;
/** Refresh ticker 24h (giá + % đổi + H/L + vol) cho header chart đang mở. */
export const LIVE_TICKER_MS = 60_000;
/** Heartbeat comment giữ kết nối SSE xuyên qua cloudflared/proxy (15s < mọi idle timeout phổ biến). */
export const LIVE_HEARTBEAT_MS = 15_000;
/** Tuổi thọ tối đa một luồng SSE — đóng cho client tự nối lại (EventSource
 *  reconnect sẵn), tránh dồn kết nối zombie sau khi pm2/cloudflared flip. */
export const LIVE_MAX_AGE_MS = 30 * 60_000;
/** Client nạp đè toàn bộ klines ( vá lịch sử + toast diff) sau mỗi khoảng này. */
export const LIVE_REPAIR_MS = 90_000;
/** Cảnh giác websocket câm: đã thấy dữ liệu rồi nhưng quá lâu không nhận tin
 *  kline nào → đóng để reconnect (hết 2 lần thử → hạ xuống poll). */
export const LIVE_WS_STALE_MS = 60_000;
/** Probe lúc mới nối: 10s mà chưa thấy MỘT message kline nào (mạng/proxy cho
 *  handshake nhưng chặn frame dữ liệu — gặp ở sandbox/VPS ISP) → hạ poll ngay,
 *  đỡ để chart đứng im cả phút đầu. Pair hiếm vốn im lâu cũng chẳng sao: poll
 *  2.5s đường REST vẫn live đầy đủ, chỉ là không sub-giây. */
export const LIVE_WS_PROBE_MS = 10_000;

// ── 6 · TRAIN / PROB — finetune để Prob tổng tăng ─────────────────────────────
// Các tham số ảnh hưởng TRỰC TIẾP tới Prob/confidence:
//  • LESSON_WEIGHT ↑  → model "nhớ" các lệnh đã đóng rõ hơn → Prob quyết đoán
//    hơn trên pattern từng thắng/thua (nhưng quá to → overfit lịch sử ngắn).
//  • NOISE_BAND ↑     → chỉ còn tín hiệu quyết đoán được trade/đăng (Prob tổng
//    trung bình CAO hơn vì coin-flip bị loại khỏi cả entry lẫn phiếu bầu
//    confluence); ↓ → vào lệnh nhiều hơn nhưng lẫn nhiễu.
//  • MAX_DIFFICULTY ↑ → nhiệm vụ train khó dần (horizon xa hơn, dead-zone rộng
//    hơn) → accuracy/Prob nghiêm ngặt hơn. Đừng vượt ~20: sample quá ít.
// (các bước nội bộ của thang difficulty — HORIZON_STEP/CAP, MARGIN_STEP/CAP —
//  là thiết kế thuật toán, nằm cạnh chỗ dùng trong xgb.ts.)
/** Tầng difficulty tối đa của train tăng dần (đạt max là dừng siết). */
export const MAX_DIFFICULTY = 12;
/** Khử nhiễu XGBoost — prob trong 0.5 ± NOISE_BAND là coin-flip: auto không
 *  mở, DCA không bù, confluence bỏ phiếu trắng (logit 0.5 = 0). 0 = tắt. */
export const NOISE_BAND = 0.06;
/** Mỗi lệnh thật đóng được lặp lại 8 lần trong TRAIN split (val split giữ thuần
 *  kline) — model học từ chính track record của mình. */
export const LESSON_WEIGHT = 8;

// ── 6b · BOOSTER HYPERPARAMETERS — champion–challenger finetune ──────────────
// Mỗi lần train, engine chạy QUA TẤT CẢ ứng viên dưới đây trên cùng một split
// train/val và cùng seed (RNG may mắn giữ hằng — khác nhau chỉ hyper), rồi giữ
// bộ thắng theo AUC out-of-sample (hoà → logloss thấp hơn). Đây là "finetune
// để tăng Prob" đúng nghĩa: mỗi combo tự tìm hyper hợp với dữ liệu của nó thay
// vì dùng chung một bộ cứng cho toàn universe. Winner được lưu vào finetuneRun
// (cột params JSON) để sau này nhìn lại combo nào hợp hyper nào.

export interface XgbParams {
  trees: number;
  lr: number;
  depth: number;
  lambda: number;
  rowSub: number;
  colSub: number;
  minChild: number;
  bins: number;
}

/** Bộ gốc — mốc so sánh, luôn có mặt trong grid. */
export const XGB_BASE: XgbParams = {
  trees: 120,
  lr: 0.1,
  depth: 3,
  lambda: 1,
  rowSub: 0.85,
  colSub: 0.85,
  minChild: 8,
  bins: 32,
};

/** Ứng viên thử đấu. Giữ `trees` + `bins` nguyên ở mọi ứng viên → chi phí
 *  train chỉ tăng theo số ứng viên (≈ mỗi ứng viên 1× base), quantisation
 *  giống nhau nên khác biệt thuần là hyper. Thêm ứng viên = thêm 1 dòng patch.
 *  Tắt hẳn grid: TUNE_GRID = false (train đúng 1 bộ base như cũ). */
export const XGB_GRID: { name: string; patch: Partial<XgbParams> }[] = [
  { name: "base", patch: {} }, // bộ gốc — mốc
  { name: "deep", patch: { depth: 4, lr: 0.08 } }, // cây sâu hơn — bắt tương tác, lr bù xuống
  { name: "smooth", patch: { lr: 0.05, lambda: 3, minChild: 16 } }, // siết mạnh — prob mượt, ít nhảy theo nhiễu
  { name: "stumps", patch: { depth: 2, lr: 0.12, minChild: 12 } }, // cây còi — tín hiệu thô nhưng chắc
];
export const TUNE_GRID = true;

// ── 6c · CALIBRATION — prob sát thực tế trước khi thành confidence/score ────
// Vấn đề thật (31/10): XGBoost không được calibrate — 120 cây × lr 0.1 đẩy prob
// ra xa 0.5, LESSON_WEIGHT khuếch đại thêm, nên model AUC 0.74 / ACC 67% lại
// nói "85.7% giá giảm". Nếu prob trung thực thì tỉ lệ thắng của nhóm prob
// 80%+ phải QUANH 80% — thực tế val chỉ cho ~55–65%. Score có thành phần
// confidence × 15 nên prob phồng kéo score phồng theo (ARB: ~10.7/51.3 điểm).
//
// Cách vá: sau khi chọn winner, fit Platt scaling p_cal = σ(a·logit(p) + b)
// trên CHÍNH val split (out-of-sample, 2 tham số — không lo overfit) rồi áp
// lên probNow trước khi tính confidence/bias/score. AUC/ACC/logloss KHÔNG
// đổi (a>0 là biến đổi đơn điệu — gate champion–challenger vẫn so được).
// Nhóm 6b chọn model GIỎI RANK; nhóm này làm prob SÁT THỰC TẾ — hai việc khác
// nhau và cần cả hai.

/** Bật calibration — tắt thì probNow về prob thô như cũ. */
export const CALIBRATE = true;
/** Số mẫu val tối thiểu để fit Platt — ít hơn thì giữ prob thô (2 tham số
 *  vẫn cần đủ điểm; val 25% của dataset thường ≥ 80 nên hiếm khi chạm). */
export const PLATT_MIN_VAL = 40;

// ── 7 · CHAMPION + CONFLUENCE — chất lượng vào lệnh & Prob tổng ──────────────

/** Vô hiệu champion: retrain mới kém hơn champion quá 0.02 AUC là coi như
 *  thoái hoá — combo regressed không được trade. */
export const REGRESS_EPS = 0.02;
/** Cận "gần chạm SL/TP" — 0.7 = còn 30% quãng tới mức là "sát". */
export const NEAR_FRAC = 0.7;

// Confluence pooling (log-odds/Naive-Bayes) — Prob tổng đội lên khi đa khung
// đồng thuận, xả về NEUTRAL khi lệch:
//  • SIBLING_DISCOUNT ↑ (0.5 → ~0.7) → phiếu khung khác có trọng số cao hơn →
//    Prob tổng tăng mạnh hơn khi đồng thuận, NHƯNG khung correlate nên càng
//    gần 1 càng dễ "đếm đôi" một cú move duy nhất. Giữ 0.5 trừ khi có dữ liệu.
//  • PROB_CAP — trần/sàn sau ghép: phiếu correlate không được biến Prob thành
//    tuyệt đối (0.95 = chốt tối đa 90% confidence).
export const SIBLING_DISCOUNT = 0.5;
export const PROB_CAP = 0.95;
/** Trọng số thành phần "tin cậy" trong scoreFrom — tham số hoá từ hằng 15 cứng
 *  (31/10) để hạ nhanh khi nghi prob phồng. Với calibration §6c bật, prob đã
 *  trung thực nên 15 là mức cân bằng hợp lý; tắt calibration thì cân nhắc hạ. */
export const CONF_W = 15;

// ── 8 · LLM RISK OFFICER — kiểm tra rủi ro im lặng trước khi vào lệnh ────────

export const LLM_URL_DEFAULT = "http://127.0.0.8:8888";
export const LLM_MODEL_DEFAULT = "local";
/** Ngân sách chờ MỘT lần gọi LLM (verdict duyệt lệnh lẫn giải phẫu lệnh).
 *  Mặc định 300s — LLM chạy NỀN (llama-server khác máy/quy trình, engine chỉ
 *  chờ khi không có lệnh mở) nên tốc độ không quan trọng, chỉ cần trả lời ĐÚNG.
 *  llama 7B Q4 trên CPU mất 6-15s/verdict khi rảnh nhưng có thể chậm hơn hẳn
 *  khi máy đang bận train/scan — 90s cũ đủ dễ cắt cụt lưng câu trả lời.
 *  Override được bằng env LLM_TIMEOUT_MS (ms, tối thiểu 10s, tối đa 10 phút)
 *  — đổi env xong phải `pm2 restart elliott --update-env` vì standalone chỉ
 *  đọc env lúc boot. */
export const LLM_TIMEOUT_MS = (() => {
  const n = Number(process.env.LLM_TIMEOUT_MS);
  if (Number.isFinite(n) && n >= 10_000) return Math.min(Math.floor(n), 600_000);
  return 300_000;
})();
/** Giải phẫu lệnh (autopsy) — LLM phân tích chuyên sâu lệnh ĐÃ ĐÓNG (cả thắng lẫn thua) rồi
 *  lưu bài học vào DB, nạp lại vào prompt duyệt các lệnh sau. Tắt = engine chỉ
 *  duyệt/rủi ro như 0.2.27, không sinh bài học mới (bài học cũ vẫn được nạp). */
export const AUTOPSY_ON = true;
/** Backfill autopsy — mỗi 6h phân tích bổ sung tối đa vài lệnh đóng còn thiếu autopsy
 *  (lệnh đóng đúng lúc LLM chết từng bị bỏ lượt VĨNH VIỄN — 0.2.33 thêm vòng
 *  eventually-consistent; lượt đầu chạy ngay tick đầu tiên sau boot). */
export const AUTOPSY_BACKFILL_MS = 6 * 3_600_000;
/** LLM chết thì xử lý thế nào?
 *  • false (mặc định, fail-OPEN) — llama-server không trả lời (chết/timeout/JSON
 *    hỏng) → lệnh vẫn vào theo đường XGBoost-only. Nhẹ tay cho paper-trading:
 *    engine không vì một dịch vụ phụ tắt mà ngừng sinh bài học. Lượt duyệt bỏ
 *    qua vẫn được ghi llmLast verdict "unreachable" để trang /ai hiện rõ.
 *  • true (fail-CLOSED) — LLM không trả lời = KHÔNG duyệt = chặn mở lệnh.
 *    Bật khi muốn Risk Officer là chốt chặn CỨNG (VPS không chạy llama-server
 *    + tham số này = engine không bao giờ mở lệnh mới). */
export const LLM_FAIL_CLOSED = false;

// ── 9 · RUNTIME OVERRIDE — chỉnh tham số ngay panel, không cần deploy ────────
// "hãy mở setting ở panel" — một tập tham số an toàn được chọn để chỉnh runtime
// (xem params-store.ts — server-only). Server hydrate giá trị override vào
// globalThis.__elliotParams lúc boot và mỗi lần lưu; pval() đọc từ globalThis
// nên KHÔNG đụng fs/crypto → dùng được cả trong file client graph (autotrade,
// xgb, bcast-gate…). Trên client globalThis.__elliotParams luôn undefined →
// pval() trả về mặc định — đúng ngữ nghĩa: client chỉ hiển thị, engine (server)
// mới là nơi chạy với giá trị override.

export function pval<T>(key: string, def: T): T {
  try {
    const m = (globalThis as { __elliotParams?: Record<string, unknown> }).__elliotParams;
    const v = m?.[key];
    if (v === undefined || v === null) return def;
    if (typeof def === "number") {
      const n = Number(v);
      return (Number.isFinite(n) ? n : def) as unknown as T;
    }
    if (typeof def === "boolean") return (Boolean(v) as unknown as T);
    return v as T;
  } catch {
    return def;
  }
}
