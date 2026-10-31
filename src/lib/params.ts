// ─── PARAMS — MỘT file config dùng chung cho toàn bộ app ─────────────────────
// "các tham số nên đưa vào 1 file config riêng dùng chung cho toàn bộ"
//
// Mọi hằng số tinh chỉnh (knob) của engine sống ở đây, chia nhóm rõ ràng để
// finetune mà không phải rà soát 6-7 file. File này là NGUỒN ĐỊNH NGHĨA duy
// nhất; các module (bcast-gate, universe, xgb, engine, llm…) import từ đây
// và re-export để chỗ cũ không đổi import — re-export không tạo bản sao,
// nên vẫn đúng nguyên tắc "một thuật toán + một database".
//
// Cách finetune an toàn: chỉnh giá trị → `npx tsx scripts/test-*.ts` chạy bộ
// test liên quan → `npm run build` → deploy. Mỗi knob có comment nói rõ nó
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

// ── 2 · SÀN CHẤT LƯỢNG CHUNG — MẶC ĐỊNH của setpoint duy nhất ────────────────
// Bộ ba dưới đây là fallback khi engine chưa có cfg (runtime lấy từ
// cfg.minScore/minAuc/minAcc — chỉnh trên Auto panel, xem AUTO_DEFAULTS trong
// autotrade.ts). Cùng bộ ba này áp cho MỌI tầng: mở lệnh, bù DCA, đăng broadcast.
/** Điểm tối thiểu — scoreOf = (AUC−0.5)×100 + (ACC−50) + tin cậy×15.
 *  AUC .8 + ACC 70 cho sẵn 30+20 = 50 → điểm 60 còn yêu cầu tin cậy ≥ ~2/3:
 *  model đạt sàn metrics nhưng thiếu tự tin vẫn bị giữ lại. */
export const BCAST_SCORE_MIN = 60;
/** Sàn AUC của model — 0.8 nghĩa là model phải xếp hạng thật sự giỏi trên tập
 *  validation (out-of-sample), chỉ hơn tung đồng xu là không đủ tin. */
export const BCAST_AUC_MIN = 0.8;
/** Sàn ACC của model — user nới từ 80 xuống 70 (31/10): vẫn lọc sạch nhiễu
 *  32–38 điểm, nhưng kênh không còn im lặng triền miên vì sàn 80. */
export const BCAST_ACC_MIN = 70;

// ── 3 · UNIVERSE SCAN — "ATR + trending, re-ranks every 8h" ──────────────────
// (danh sách cặp UNIVERSE là DATA — nằm trong universe.ts, không phải knob)

/** Khung nến dùng chấm điểm universe. */
export const UNIVERSE_INTERVAL = "1h";
/** Nhịp xếp hạng lại vũ trụ — mỗi 8 giờ. */
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
/** Số nến nạp cho thống kê — 500 × 1h ≈ 20 ngày, cùng cửa sổ panel đang load. */
export const SESS_KLINE_COUNT = 500;
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

// ── 6 · TRAIN / PROB — finetune để Prob tổng tăng ─────────────────────────────
// Các knob ảnh hưởng TRỰC TIẾP tới Prob/confidence:
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
// vì ăn theo một bộ cứng cho toàn vũ trụ. Winner được lưu vào finetuneRun
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

// ── 8 · LLM RISK OFFICER — kiểm tra rủi ro im lặng trước khi vào lệnh ────────

export const LLM_URL_DEFAULT = "http://127.0.0.8:8888";
export const LLM_MODEL_DEFAULT = "local";
export const LLM_TIMEOUT_MS = 12_000;
