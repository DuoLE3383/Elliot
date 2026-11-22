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
export const UNIVERSE_BCAST_TOP = 5;
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
/** Ngưỡng composite verdict (session-forecast.ts): |điểm| ≥ band → BULL/BEAR,
 *  còn lại NEUTRAL. Panel /ai chỉnh được (0.2.60). */
export const SESS_CALL_BAND = 25;
/** Trọng số phiếu "liquidation" trong composite verdict (0.2.69) — radar
 *  squeeze (OI + L/S + taker + funding) lên thành phiếu thứ 10. Mặc định 2.5
 *  = phiếu đơn LỚN NHẤT (vượt session/regime 2.0): cascade thanh khoản mặc
 *  giá phiên mạnh hơn thống kê lịch. 0 = tắt (chỉ còn dòng ⛓ thông báo);
 *  chỉnh runtime trên panel /ai, tối đa 4 (~25% tổng phiếu). */
export const SESS_LIQ_WEIGHT = 2.5;
/** Số nến 1d nạp cho thống kê chu kỳ lịch (session-forecast deepDaily).
 *  2000 ≈ 5,5 năm — tối đa hữu ích trên Binance futures (~7 năm có thật).
 *  Cặp mới listing tự ngắn lại theo dữ liệu có. */
export const CYCLE_DAYS = 2000;

// ── 4b · TELEGRAM NOTIFY — tắt ồn + BÁO ĐỘNG (0.2.71) ────────────────────────
// Triết lý 3 tầng: (1) ALERT — sự kiện chủ bot PHẢI biết ngay, không tắt được;
// (2) DIGEST — hourly/daily đã gộp đủ (bảng lệnh 0.2.70); (3) MUTE — tin rờm
// không hành động được, tắt theo loại ở TG_MUTE.

/** Loại tin Telegram bị TẮT — danh sách cách nhau bởi dấu phẩy, chọn trong:
 *  near (⚠️ NEAR TP/SL), veto (🛑 LLM VETO), autopsy (🔬 per-trade autopsy),
 *  scan (tin TOP-coin), close (🤖 AUTO CLOSE — cẩn thận: mất push kết quả,
 *  hourly digest vẫn còn bảng lệnh). Mặc định "near,veto": hai loại này CHẮC
 *  CHẮN xả đúng ~2 tin/lệnh + mỗi entry bị chặn, mà chủ bot không hành động
 *  được gì — bot tự xử. Rỗng = bật lại tất cả. Chỉnh runtime trên /ai. */
export const TG_MUTE = "near,veto";
/** Báo động 🔴 LOSS STREAK sau mỗi N thua LIÊN TIẾP (mỗi bội N báo lại 1 lần:
 *  4, 8, 12...; thắng là reset). Chuỗi thua = tín hiệu regime mismatch —
 *  model đang giao dịch sai thị trường. 0 = tắt. Chỉnh runtime trên /ai. */
export const TG_STREAK_ALERT = 4;
/** Báo động 🔴 DRAWDOWN khi vốn chạm mức đỉnh 24h × (1 − x%) — chỉ bắn ĐÚNG
 *  LẦN chạm ngưỡng (crossing), hồi về trên rồi phá thêm mới bắn tiếp. 0 = tắt.
 *  Chỉnh runtime trên /ai. */
export const TG_DD_ALERT = 5;

// ── 4c · FLIP GATE + SL/TP LEVERAGE (0.2.72) ────────────────────────────────
// Data 0.2.71: 97 lệnh đóng có ~75 flip net −105% ROI trong khi TP:SL là 16:6
// (dương) → exit engine chảy máu, KHÔNG phải entry. Hai nút vít:

/** FLIP BẤT ĐỐI XỨNG — lật chiều phải chắc chắn HƠN mở lệnh (một flip tốn
 *  exit + entry mới + reset SL/TP). prob THEO PHÍA MỚI (bias SHORT → 1−prob)
 *  phải ≥ ngưỡng này, trong khi vào lệnh thường chỉ cần vượt noise band.
 *  0.5 = tắt (hạ về mức vào lệnh). Mặc định 0.62: giữa noise band (~0.56)
 *  và tín hiệu mạnh (0.70). Chỉnh runtime trên /ai. */
export const FLIP_PROB_MIN = 0.62;

/** SHORT CHỌN LỌC (0.2.87) — "rà sổ thấy SHORT thắng tệ hơn LONG": thị trường
 *  crypto trôi lên dài hạn, SHORT cắm đầu theo tín hiệu "vừa đủ gate" là phần
 *  chảy máu lớn nhất của sổ. Vào lệnh SHORT MỚI (không phải flip — flip đã có
 *  FLIP_PROB_MIN riêng) phải chắc chắn theo phía ngắn tối thiểu mức này:
 *  confidence-toward-short = 1 − prob ≥ SHORT_PROB_MIN (0.60 = prob ≤ 0.40,
 *  tức chặt hơn sàn bias 0.44 một bậc). LONG giữ nguyên noise band — bất đối
 *  xứng CÓ SỐ LIỆU, không phải cảm tính. ≤ 0.5 = tắt (đối xứng như cũ).
 *  Chỉnh runtime nhóm Flip / SL-TP trên /ai. */
export const SHORT_PROB_MIN = 0.6;
/** Flip thêm yêu cầu score ≥ sàn vào lệnh (cfg.minScore) + phần bù này.
 *  0 = tắt (dùng đúng sàn vào lệnh). Mặc định +10: combo 66 điểm được mở
 *  lệnh mới nhưng KHÔNG đủ tư cách phá lệnh đang mở. Chỉnh runtime /ai. */
export const FLIP_SCORE_EXTRA = 10;

/** SL/TP ĐỘC LẬP VỚI ĐÒN BẨY — khoảng cách SL/TP (theo % giá) nhân hệ số
 *  chuẩn hoá theo leverage để ROI-at-SL KHÔNG phình theo đòn bẩy:
 *   off  = 1 (legacy — cùng khoảng cách giá mọi leverage, ROI-at-SL ~ lev)
 *   sqrt = √(ref/lev) — mềm, giống công thức trailing 0.2.63
 *   lin  = ref/lev — độc lập hoàn toàn: ROI-at-SL = baseline mọi leverage
 *  Chỉ THU HẸP khi lev > ref; lev ≤ ref giữ nguyên (SL không nới ra ngoài
 *  cấu trúc ATR chỉ vì đòn bẩy thấp — rủi ro chỉ NHỎ HƠN baseline, không to
 *  hơn). tpMode "manual" không nhân hệ số (user tự đặt %), chỉ ăn cap liq. */
export const TP_LEV_MODE = "lin";
/** Leverage tham chiếu — hệ số chuẩn hoá = 1 tại đúng mức này (lin: lev 20
 *  ref 10 → SL/TP × 0.5). Nên đặt bằng leverage bạn vẫn chạy. */
export const TP_LEV_REF = 10;
/** MUI AN TOÀN THANH KHOẢN — SL không bao giờ đặt xa hơn x% quãng đường tới
 *  giá thanh lý (100/lev %). 60 = SL dừng ở tối đa 60% đường tới liq; áp cho
 *  MỌI tpMode (kể cả manual — SL ngoài liq là config tự hoại). TP đi theo để
 *  giữ nguyên R:R. */
export const TP_LIQ_SAFE = 60;

// ── 4b2 · EV GATE + TRẦN LỖ ROI (0.2.89) — từ audit sổ 08/11 (33 lệnh sạch) ──
// Sổ sạch (sau vá 0.2.88) cho thấy lỗ KHÔNG nằm ở toán nữa mà nằm ở cấu trúc:
// • LONG payoff 0.48 — TB thắng +8.49 ROI vs TB thua −17.76: TP hẹp hơn SL
//   ~2.2 lần với WR 47% là kỳ vọng âm chắc chắn mỗi lệnh ~−5.4 ROI;
// • top 5 lỗ nặng nhất đều đòn ×20 — OP −60 ROI vẫn hợp lệ theo mui
//   TP_LIQ_SAFE=60 (SL 2.9% giá × 20). RISK_MAX_STAKE đã chặn stake, nhưng
//   ROI-at-SL thì chưa có trần riêng.
// Hai knob đối xứng với tầng 4e — cả hai giữ nguyên R:R và chỉnh runtime:
/** TRẦN LỖ ROI/LỆNH — ROI-at-SL (slPct × lev) không vượt trần; vượt thì co
 *  SL+TP cùng hệ số (giữ R:R, kiểu mui thanh khoản). 20 = lệnh ×20 không đặt
 *  SL ngoài 1% giá. 0 = tắt. */
export const SL_ROI_MAX = 20;
/** EV GATE — kỳ vọng ROI tối thiểu tại lối vào tính từ prob/tp/sl CỦA CHÍNH
 *  candidate: p×tp×lev − (1−p)×sl×lev − phí round-trip. Lệnh cấu trúc âm
 *  (TP mỏng + SL dày + prob không gánh nổi) chết ở cổng, không đợi sổ phán.
 *  ≤ −100 = tắt. */
export const EV_GATE_MIN = 0;

// ── 4c2 · PHÍ GIAO DỊCH TRONG ROI (0.2.77) ──────────────────────────────────
// "add fees in trade for calculator ROI" — ROI của lệnh dry-run trước nay là
// GROSS (biến động giá × đòn bẩy) nên mọi thống kê tự hoa mắt: flip −1.4%/lệnh
// nhìn như "gần hoà" nhưng thực tế mỗi lệnh còn ăn thêm phí round-trip. Binance
// USDT-M thu phí trên NOTIONAL mỗi lần vào/thoát → mức ăn vào ROI mỗi bên
// = FEE_PCT × leverage (margin = notional/lev). Data 0.2.71: ~75 flip @ ×10
// tốn ~1% ROI phí MỖI lệnh chỉ để đi vòng.

/** Phí giao dịch MỖI BÊN (% notional) — taker chuẩn Binance USDT-M 0.05%
 *  (maker 0.02%; trả phí bằng BNB −10%). Lệnh chốt (tp/sl/trail/flip/manual)
 *  trừ đúng round-trip 2 bên: ×10 → 2 × 0.05 × 10 = −1.0% ROI/lệnh kể cả khi
 *  giá đứng im. ROI realised, net ROI, WR, equity chain, autopsy R, bài học
 *  xgb — tất cả thành số SAU PHÍ; prompt LLM Risk Officer cũng kèm mức phí
 *  (fee_check + ROI tại SL/TP sau phí, 0.2.78). 0 = tắt (về gross như trước
 *  0.2.77). Chỉnh runtime nhóm Flip / SL-TP trên /ai. */
export const FEE_PCT = 0.05;

/** ROI % mà PHÍ GIAO DỊCH ăn vào (0.2.77) — sàn thu phí trên NOTIONAL mỗi lần
 *  vào/thoát, margin = notional / leverage → mỗi bên tốn FEE_PCT% × lev (%
 *  ROI). sides: 1 = chỉ phí entry (đã trả lúc mở), 2 = round-trip entry+exit
 *  (đúng mức một lệnh CHỐT phải gánh). Ví dụ FEE_PCT 0.05 (taker USDT-M):
 *    ×10 → mỗi bên −0.5% ROI, round-trip −1.0% — kể cả khi giá đứng im.
 *  FEE_PCT đọc runtime (pval) nên chỉnh /ai ăn hiệu lực lệnh chốt kế tiếp;
 *  0 hoặc lev ≤ 0 → 0 (off). Pure theo (lev, sides) — không đụng giá/entry.
 *  Sống ở ./params từ 0.2.78 (trước đó định nghĩa trong autotrade.ts): llm.ts
 *  cần CHÍNH công thức này cho prompt fee_check mà không được import
 *  autotrade (autotrade đã import llm → vòng); autotrade re-export để
 *  engine/tg-msgs/route giữ nguyên import — vẫn "một thuật toán, một nguồn". */
export function feeRoi(lev: number, sides = 2): number {
  const f = Number(pval("FEE_PCT", FEE_PCT));
  return f > 0 && lev > 0 ? f * lev * sides : 0;
}

// ── 4e · RISK ENVELOPE — trần exposure tuyệt đối (0.2.79) ────────────────────
// Audit 04/11: leverage ×10 + stake 10% + dcaMax 2 ⇒ 1 lệnh ~100% vốn notional,
// DCA đầy ~300% — margin của vị thế bị quét chỉ sau ~3% giá ngược chiều, và
// cứ 4% ngược chiều ở ×10 là −40% ROI: biên mỏng biến thành swing lớn. Hai tham
// số dưới là LỚP VỎ BẢO HIỂM cấu hình (không phải mục tiêu giao dịch): engine
// vốn ĐƠN VỊ THỂ — findFirst status "open" trước khi mở, không bao giờ chồng
// vị thế chéo — nên exposure tổng = stake × (1 + số bù DCA) × leverage của
// MỘT vị thế duy nhất; trần kẹp cả ba nhân tử đó bất kể Auto panel đặt gì.

/** TRẦN ĐÒN BẨY — leverage hiệu dụng của engine không bao giờ vượt mức này.
 *  Kẹp tại load engine.json + mỗi lần browser sync; vị thế ĐANG MỞ giữ nguyên
 *  leverage lúc mở (không đổi thân phận lệnh giữa chừng). 0 = tắt. Mặc định 5
 *  (audit khuyến nghị ×3-5: sống sót nhiễu bình thường, phí bớt nặng — ở ×10
 *  round-trip taker ăn ~1% ROI/lệnh chỉ để đi vòng). Chỉnh runtime nhóm
 *  Flip / SL-TP trên /ai. */
export const RISK_MAX_LEV = 5;
/** TRẦN STAKE TỔNG — % vốn tối đa MỘT vị thế được CAM (vào lệnh + mọi bù DCA
 *  cộng dồn): entry bị kẹp xuống trần, lệnh DCA làm tổng vượt trần bị TỪ CHỐI
 *  (SL làm việc — bù averaging-down ở stake đầy là martingale). 0 = tắt.
 *  Mặc định 3 (audit: stake 2-3%/lệnh — thanh lý MỘT vị thế mất tối đa 3% vốn).
 *  Muốn chạy dcaMax ≥ 1 thoải mái: hạ stake về ≤ trần/2 hoặc nới trần này. */
export const RISK_MAX_STAKE = 50;

/** Leverage hiệu dụng = min(lev, RISK_MAX_LEV); cap 0/tắt → nguyên giá trị. */
export function clampLev(lev: number): number {
  const cap = pval("RISK_MAX_LEV", RISK_MAX_LEV);
  return cap > 0 && lev > cap ? cap : lev;
}
/** Stake hiệu dụng MỘT lần vào/lật = clamp(pct, 10, RISK_MAX_STAKE). SET CỨNG min 10% / max 50%. */
export function clampStake(pct: number): number {
  const cap = pval("RISK_MAX_STAKE", RISK_MAX_STAKE);
  // SET CỨNG [10, 50] — mọi đường vào (Auto / Force / Flip) đều qua đây
  const v = Number.isFinite(pct) ? pct : 10;
  const floored = v < 10 ? 10 : v;
  return cap > 0 && floored > cap ? cap : floored;
}
/** Bù DCA có được phép không — tổng stake (đã cam + bù mới) phải nằm trong
 *  trần RISK_MAX_STAKE. eps chống sai số dấu phẩy động khi tổng == trần. */
export function allowDcaAdd(curStake: number, addStake: number): boolean {
  const cap = pval("RISK_MAX_STAKE", RISK_MAX_STAKE);
  return !(cap > 0 && curStake + addStake > cap + 1e-9);
}

// ── 4c · WYCKOFF GATE (0.2.96) — cổng cấu trúc cho lệnh LONG sổ B ───────────
// Port ĐÚNG phần đã walk-forward verify trên nến ngày crypto (07/11/2026,
// ~19 symbol × 2.7 năm — scripts/verify-wyckoff-crypto.py):
//   Gate Spring|SOS + breadth≥50 → +3.87%/58.7% vs baseline chop −0.14%/45.6%;
//   SOS chỉ có edge khi regime RISK_ON (+7.10%/65.2% vs −1.77%/28.6%).
// Sổ B SHORT không đụng; chỉ LONG phải qua cổng. Chi tiết trong wyckoff-gate.ts.

/** Bật cổng Wyckoff cho LONG (false = hành vi 0.2.95). */
export const WYCKOFF_GATE = true;
/** Số nến NGÀY của zone range (bản verify dùng 90). */
export const WY_RANGE_LOOKBACK = 60;
/** Width range hợp lệ tối thiểu (% từ đáy tới đỉnh). */
export const WY_RANGE_MIN_W = 3;
/** Width range hợp lệ tối đa (%). Verify: 45. */
export const WY_RANGE_MAX_W = 60;
/** Drift tối đa trong zone (% |đầu–cuối zone|). Verify: 18. */
export const WY_DRIFT_MAX = 25;
/** Spring: vol nến cuối ≥ ×trung bình 5 nến trước. */
export const WY_SPRING_VOL = 1.3;
/** SOS: nến ngày cuối đóng ≥ +this % so với nến trước (khung NGÀY — không hạ
 *  xuống nến 15m, verify chỉ có edge trên nến ngày). */
export const WY_SOS_PCT = 6;
/** SOS: vol nến cuối ≥ ×trung bình 20 nến. */
export const WY_SOS_VOL = 3;
/** Breadth tối thiểu (% symbol universe có close ngày ≥ MA20) để LONG. */
export const WY_BREADTH_MIN = 50;
/** Veto LONG khi nến ngày cuối thủng đỉnh range rồi đóng lại dưới đỉnh (L5). */
export const WY_UPTHRUST_VETO = true;
/** TTL cache breadth (ms) — mỗi lần quét breadth fetch 1d×25 nến/symbol. */
export const WY_BREADTH_TTL_MS = 30 * 60_000;

// ── 4c′ · WYCKOFF GỐC — PHỄU 5 LỚP SỔ C (0.2.97) ────────────────────────────
// Port 1-1 FunnelConfig (YoungCan-Wang/WyckoffTradingAgent core/wyckoff_engine.py)
// lên crypto USDT-M. Tên key WYC_* để KHÁC hẳn bộ WY_* của cổng sổ B (4c):
// cổng sổ B chỉ dùng phần đã verify; sổ C dùng ĐẦY ĐỦ phễu gốc theo thông số
// production của repo gốc (LPS + Compression gốc để OFF → port giữ nguyên OFF).
// Thích nghi crypto (ghi rõ từng chỗ trong wyckoff-engine.ts):
//   · L1 "market cap / giá trị giao dịch" → quote volume 20 ngày (USDT)
//   · L3 "top-5 ngành hot" → breadth regime RISK_ON (crypto không có ngành)
//   · L5 thêm thoát breadth RISK_OFF (verify 07/11: SOS RISK_OFF −1.77%)

/** Bật sổ C — phễu Wyckoff gốc (false = không quét, không vào lệnh mới; vị thế
 *  đang mở vẫn được quản lý exit bình thường). */
export const WYC_C_ON = true;
/** L1 — quote volume trung bình 20 ngày ngày tối thiểu (USDT). Gốc:
 *  min_avg_amount_wan = 4000 (40M CNY) — crypto dùng 5M USDT. */
export const WYC_L1_QUOTE_VOL = 5_000_000;
/** L2 — markup: MA50 > MA200 giữ liên tục ≥ N ngày (markup_ma_crossover_confirm_days). */
export const WYC_MARKUP_CONFIRM_DAYS = 5;
/** L2 — góc MA50 tối thiểu %/5 ngày (markup_ma_angle_min). */
export const WYC_MA50_ANGLE_MIN = 2.0;
/** L2 — bias200 tối đa cho entry markup % (global_entry_max_bias_200). */
export const WYC_BIAS200_MAX = 25.0;
/** L2 — RPS50 tối thiểu (rps_fast_min). */
export const WYC_RPS50_MIN = 65.0;
/** L2 — RPS120 tối thiểu (rps_slow_min). */
export const WYC_RPS120_MIN = 70.0;
/** L2 — bypass: RPS120 ≥ này → RPS50 chỉ cần ≥ 50 (rps_slow_strong_bypass). */
export const WYC_RPS120_STRONG = 80.0;
/** L3 — breadth tối thiểu để coi thị trường "cộng hưởng" (RISK_ON). */
export const WYC_BREADTH_MIN = 50.0;
/** L4 Spring — cửa sổ support (nến ngày, spring_support_window). */
export const WYC_SPRING_WINDOW = 60;
/** L4 Spring — vol nến cuối ≥ ×trung bình 4 nến trước (spring_vol_ratio). */
export const WYC_SPRING_VOL = 1.3;
/** L4 Spring — vol(số tiền thu hồi) / vol(số tiền thăm dò) ≥ (spring_vol_expand_ratio). */
export const WYC_SPRING_EXPAND = 1.15;
/** L4 Spring — range zone tối đa % (spring_tr_max_range_pct) — sàn động theo ATR
 *  ×4, tối thiểu 30, tối đa 60 như gốc. */
export const WYC_SPRING_TR_MAX = 30.0;
/** L4 Spring — drift tối đa % (spring_tr_max_drift_pct). */
export const WYC_SPRING_TR_DRIFT = 12.0;
/** L4 SOS — % tăng nến ngày tối thiểu (sos_pct_min). */
export const WYC_SOS_PCT = 6.0;
/** L4 SOS — vol ratio tối thiểu vs 20 nến (sos_vol_ratio). */
export const WYC_SOS_VOL = 3.0;
/** L4 SOS — cửa sổ breakout ngày (sos_breakout_window). */
export const WYC_SOS_BREAKOUT = 60;
/** L4 SOS — dung sai breakout (sos_breakout_tolerance, 0.01 = 1%). */
export const WYC_SOS_TOL = 0.01;
/** L4 SOS — quantile volume (sos_vol_quantile trên cửa sổ 60). */
export const WYC_SOS_VOL_Q = 0.95;
/** L4 EVR — vol ratio (evr_vol_ratio). */
export const WYC_EVR_VOL = 1.8;
/** L4 EVR — biên độ "lao không thành công" tối đa ±% (evr_max_drop/rise). */
export const WYC_EVR_MOVE = 2.0;
/** L4 TrendPullback — cửa sổ (trend_pb_lookback). */
export const WYC_TP_LOOKBACK = 10;
/** L4 TrendPullback — pullback min/max % (trend_pb_min/max_pullback_pct). */
export const WYC_TP_MIN = 5.0;
export const WYC_TP_MAX = 20.0;
/** L4 TrendPullback — vol thu hẹp tối đa (trend_pb_vol_shrink_ratio). */
export const WYC_TP_VOL = 0.6;
/** L5 — stop vốn: dưới đáy吸筹 thêm % (exit_stop_loss_pct = −7). */
export const WYC_EXIT_SL_PCT = 7.0;
/** L5 — trailing bật khi giá ≥ đáy × (1 + exit_trailing_active_pct/100 = 15%). */
export const WYC_TRAIL_ACT = 15.0;
/** L5 — trailing stop = đỉnh 60n × (1 − exit_trailing_drawdown_pct/100 = 10%). */
export const WYC_TRAIL_DD = 10.0;
/** L5 — cần N ngày đóng dưới stop mới thoát (exit_confirm_days); thâm hụt ≥5%
 *  dưới stop thoát NGAY (deep breach). */
export const WYC_EXIT_CONFIRM = 2;
/** L5 — ngày nào vol < ×(exit_vol_confirm_ratio) của ref 20n coi là RỬA CHUỒNG
 *  (không tính vào confirm thoát). */
export const WYC_EXIT_VOL_WASH = 0.8;
/** L5 — Upthrust: breakout tối thiểu % trên resistance (dist_upthrust_breakout_pct). */
export const WYC_UT_BREAK = 1.0;
/** L5 — Upthrust: đóng lại dưới resistance tối thiểu % (dist_upthrust_close_back_pct). */
export const WYC_UT_BACK = 0.3;
/** L5 — Upthrust: râu trên ≥ ×(dist_upthrust_upper_shadow_ratio) biên ngày. */
export const WYC_UT_SHADOW = 0.35;
/** L5 — Upthrust: vol ≥ ×(dist_upthrust_vol_ratio) 20n trước. */
export const WYC_UT_VOL = 1.5;
/** L5 — Upthrust chỉ đếm khi bias200 ≥ % này (dist_upthrust_min_bias_200_pct). */
export const WYC_UT_BIAS = 15.0;
/** L5 — Distribution: bias200 ≥ % này + N ngày vol < 50% ref 60n → thoát
 *  (dist_high_threshold_pct / dist_confirm_days / dist_vol_dry_ratio 0.5). */
export const WYC_DIST_BIAS = 30.0;
export const WYC_DIST_CONFIRM = 3;
/** Nhịp quét sổ C (ms) — nến ngày nên 20 phút là đủ nhạy với ngày mới đóng. */
export const WYC_TICK_MS = 20 * 60_000;
/** Stake sổ C mỗi lệnh (% vốn chuỗi sổ C) — như sổ A. */
export const WYC_STAKE_PCT = 10;
/** Đòn bẩy sổ C — gốc Wyckoff là spot cổ phiếu → lev 1. */
export const WYC_LEV = 1;

// ── 4d · SELF-IMPROVE FALLBACK — bù chốt methodId reset (0.2.75) ───────────
// methodId là hash của TOÀN BỘ chính sách (sc|auc|acc|r|x|tp|sl|tpct|atr|tf|fl|wh)
// → MỌI thay đổi knob (user chỉnh tay, agent tự +2 minScore, đổi tpMode 0.2.74)
// đúc methodId MỚI, bộ đếm mẫu của method active về 0 và agent 6h ngủ đúng lúc
// vốn đang chảy máu — LLM stats-dive phải "đề xuất thủ công" việc chính agent
// sinh ra để làm. Cửa sổ gần (30 lệnh đóng mới nhất, qua mọi methodId) được
// quyền BÒ CHỈ ĐỂ SIẾT (minScore +2 / minAcc +1 / hạ risk bậc thang) khi đủ n
// và expectancy < 0. KHÔNG BAO GIỜ restore risk qua fallback — nới lỏng phải
// chứng minh dưới CHÍNH method đang chạy (method-pure).

/** Ngưỡng n tối thiểu của cửa sổ gần để fallback có hiệu lực. 0 = tắt (chỉ
 *  method-pure như trước 0.2.75). Mặc định 15 = đúng MIN_N_TIGHTEN — cùng độ
 *  chắc chắn tối thiểu agent vẫn yêu cầu khi đo method-pure. Chỉnh runtime
 *  nhóm "Champion–challenger" trên /ai. */
export const AGENT_FALLBACK_N = 15;

// ── 5 · ENGINE CADENCE — nhịp quét của vòng auto ────────────────────────────

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

/** Bộ hyper ĐANG HIỆU LỰC = XGB_BASE + override runtime (panel tham số /ai).
 *  Gọi NGAY tại chỗ train (không cache module-level) nên chỉnh panel xong,
 *  lần retrain kế tiếp dùng ngay giá trị mới — không cần restart. Grid ứng
 *  viên vẫn patch ĐÈ lên base như cũ (patch > override > mặc định). */
export function xgbBase(): XgbParams {
  return {
    trees: pval("XGB_TREES", XGB_BASE.trees),
    lr: pval("XGB_LR", XGB_BASE.lr),
    depth: pval("XGB_DEPTH", XGB_BASE.depth),
    lambda: pval("XGB_LAMBDA", XGB_BASE.lambda),
    rowSub: pval("XGB_ROWSUB", XGB_BASE.rowSub),
    colSub: pval("XGB_COLSUB", XGB_BASE.colSub),
    minChild: pval("XGB_MINCHILD", XGB_BASE.minChild),
    bins: pval("XGB_BINS", XGB_BASE.bins),
  };
}

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

// ── 7b · COMBO MEMORY + CHAMPION CÔNG BẰNG + STAKE THEO TIN CẬY (0.2.86) ─────
// Ba vòng phản hồi làm "train/xgb TÁC DỤNG vào lệnh kế tiếp" và dừng chảy máu:
//
//  • COMBO MEMORY — metrics train (AUC/ACC) không đo được hiệu quả LIVE; sổ
//    dry-run mới là sự thật. Combo thua streak dài / net ROI gần nhất quá âm
//    bị tạm loại khỏi vòng chọn lệnh (một dạng tự học khép kín).
//  • CHAMP_WINDOW — champion cũ là best-ever SUỐT ĐỜI: một lần train "trúng
//    số" (kể cả train tay difficulty cao, thang AUC khác) nâng thanh ngang vĩnh
//    viễn → mọi lần quét sau bị gắn regressed → combo KHÔNG BAO GIỜ được trade
//    lại ("train còn có hại"). Champion mới = đỉnh trong N lần chạy gần NHẤT
//    và CHỈ đếm run difficulty 0 (quét so quét — cùng thang đo, công bằng).
//  • RISK_TIER — stake phần thưởng độ tin cậy: đạt ngưỡng mạnh mới được dùng
//    trần stake của panel; dưới đó stake hạ về mức nền (giảm rủi ro những tín
//    hiệu "vừa đủ gate").

/** Streak lỗ liên tiếp của combo (theo sổ dry-run) bị TẠM LOẠI khỏi vòng chọn
 *  lệnh — combo đang "không hợp chế độ" thì đừng nhét lệnh mới vào. 0 = tắt. */
export const MEM_LOSE_STREAK = 4;
/** Net ROI (tổng %) của MEM_LOOKBACK lệnh đóng GẦN NHẤT cùng combo dưới mức
 *  này cũng bị tạm loại — streak bắt được chuỗi thua đều, floor bắt được chuỗi
 *  lỗ to lẻ tẻ. 0 = tắt. */
export const MEM_NET_FLOOR = -12;
/** Cửa sổ lệnh gần nhất dùng cho MEM_NET_FLOOR (mỗi combo). */
export const MEM_LOOKBACK = 8;
/** Champion = đỉnh AUC trong N lần chạy GẦN NHẤT mỗi combo (chỉ run difficulty
 *  0 — quét so quét). 0 = legacy all-time (so mọi run từ trước tới nay). */
export const CHAMP_WINDOW = 20;
/** Stake tier — score ≥ minScore + RISK_TIER_SCORE mới được dùng trần stake
 *  panel (cfg.riskPct sau kẹp RISK_MAX_STAKE); dưới đó stake hạ về RISK_TIER_MIN
 *  (vẫn ≤ cfg.riskPct — không bao giờ đặt lớn hơn ý user). 0 = tắt (stake phẳng). */
export const RISK_TIER_SCORE = 15;
/** Mức stake nền cho tín hiệu "vừa đủ gate" (% vốn). */
export const RISK_TIER_MIN = 2;

// ── 8 · LLM RISK OFFICER — kiểm tra rủi ro im lặng trước khi vào lệnh ────────

export const LLM_URL_DEFAULT = "http://127.0.0.8:8888";
export const LLM_MODEL_DEFAULT = "local";
/** Ngân sách chờ MỘT lần gọi LLM (verdict duyệt lệnh lẫn giải phẫu lệnh).
 *  Mặc định 600s (0.2.91 — tăng từ 300s theo log thật: model 9B think-mode trên
 *  CPU chỉ ~12-13 t/s, một lượt think dài + verdict có thể ăn 2-3 phút, schema
 *  retry nữa là gấp đôi — 300s cũ dễ cắt trước khi kịp trả lời. LLM chạy NỀN
 *  (llama-server khác máy/quy trình, engine chỉ chờ khi không có lệnh mở) nên
 *  chậm không sao, chỉ cần trả lời ĐÚNG.
 *  Override được bằng env LLM_TIMEOUT_MS (ms, tối thiểu 10s, tối đa 10 phút)
 *  — đổi env xong phải `pm2 restart elliott --update-env` vì standalone chỉ
 *  đọc env lúc boot; hoặc chỉnh LLM_TIMEOUT_MS ngay panel /ai (runtime). */
export const LLM_TIMEOUT_MS = (() => {
  const n = Number(process.env.LLM_TIMEOUT_MS);
  if (Number.isFinite(n) && n >= 10_000) return Math.min(Math.floor(n), 600_000);
  return 600_000;
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

// ── 10 · TUNE-2 "NÂNG CẤP CẤP 2" (0.3.0) — đúng 2 nhóm núm: RR + quality floor ─
// Cấp 2 = bậc tinh chỉnh NHẸ: chỉ đụng tỉ lệ lãi/lỗ (RR) và sàn chất lượng tín
// hiệu của BA sổ dry-run, KHÔNG đụng stake/đòn bẩy/logic engine. Mỗi sổ một cặp:
//
//   sổ A Vulcan  — RR leg  = VUL_ATR_STOP_MULT (stop = entry ∓ mult×ATR; nhánh
//                             thưởng là ROI ladder/trailing gốc — cố định)
//                  floor   = VUL_VOL_FACTOR  (volume ≥ volMA20 × factor — lọc
//                             breakout không có dòng tiền)
//   sổ B Elliott — RR leg  = RR_TP_RATIO (dyn: TP = SL × ratio; TRƯỚC ĐÂY cứng
//                             1.4 trong dynLevelsAtEntry — giờ thành tham số)
//                  floor   = bộ ba minScore/minAuc/minAcc của Auto panel (cfg)
//   sổ C Wyckoff — RR leg  = WYC_EXIT_SL_PCT (stop cấu trúc −x% đáy吸筹; nhánh
//                             thưởng trailing gốc — cố định)
//                  floor   = WYC_RPS50_MIN / WYC_RPS120_MIN (sàn độ mạnh tương
//                             đối của coin trong universe)
//
// Tất cả đều pval() → override runtime (đề xuất cấp 2 ÁP bằng setOverride, hiệu
// lực tick kế tiếp). RR sửa leg RỦI RO (A/C) vì nhánh thưởng của A/C là cấu
// trúc chiến lược gốc; sổ B dyn ngược lại sửa leg THƯỞNG (ratio) vì SL đã đo
// động theo ATR/heat/vol tại entry.

/** Sổ B — TP = SL × ratio trong tpMode "dyn"/"auto" (mặc định giữ nguyên 1.4
 *  như bản cứng trước 0.3.0). Chỉnh runtime nhóm Flip / SL-TP trên /ai. */
export const RR_TP_RATIO = 1.4;
/** Sổ A — stop = entry ∓ mult×ATR (VulcanDefaults.atrStopMult 2.0). */
export const VUL_ATR_STOP_MULT = 2.0;
/** Sổ A — volume phải ≥ volMA20 × factor để coi breakout có dòng tiền (1.5). */
export const VUL_VOL_FACTOR = 1.5;