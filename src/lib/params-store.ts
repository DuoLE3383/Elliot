// ─── params-store — override runtime cho tham số params.ts (SERVER-ONLY) ─────
// "hãy mở setting ở panel trong hình 2" — trang "System parameters" vốn
// read-only (chỉnh = sửa params.ts + deploy). File này cho phép chỉnh MỘT TẬP
// AN TOÀN ngay panel /ai, không cần build lại:
//
//   • Nguồn chân lý: db/params-override.json (DATA_DIR, cùng nơi telegram.json)
//     — chỉ chứa key nằm trong EDITABLE bên dưới, còn lại bị bỏ qua.
//   • hydrateParams() nạp file vào globalThis.__elliotParams (boot + mỗi lần
//     lưu); mọi nơi dùng pval(key, def) của params.ts nên có hiệu lực NGAY
//     tick kế tiếp của engine, không cần restart.
//   • Client KHÔNG được import file này (fs!) — client thấy catalog qua
//     GET /api/params. File nằm ngoài client graph nên không dính lỗi
//     "Can't resolve 'fs'" kiểu 0.2.55.
//
// KhÔNG đưa vào danh sách chỉnh-runtime: các tham số cấu trúc (UNIVERSE_*,
// SESS_*, LIVE_*, LLM_URL/MODEL…) vì chúng được đọc đúng MỘT lúc boot/scheduler
// setup — đổi runtime không có tác dụng, chỉ tạo ảo giác đã chỉnh.

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { DATA_DIR, dataFile } from "./data-dir";
import {
  AUTOPSY_ON,
  BCAST_ACC_MIN,
  BCAST_AUC_MIN,
  BCAST_PL1_MIN,
  BCAST_REPEAT_MS,
  BCAST_SCORE_MIN,
  BCAST_TOP_N,
  BCAST_VOL_MIN,
  CONF_W,
  LESSON_WEIGHT,
  MAX_DIFFICULTY,
  NOISE_BAND,
  PRESSURE_CAP_SHORT,
  PRESSURE_FLOOR_LONG,
  PROB_CAP,
  REGRESS_EPS,
  SCAN_DIGEST_EVERY_MS,
  SCAN_DIGEST_TOP_N,
  SIBLING_DISCOUNT,
  CALIBRATE,
  pval,
} from "./params";

// ── Catalog — meta cho UI + validator ────────────────────────────────────────

export interface ParamMeta {
  key: string;
  /** nhóm hiển thị trên panel (cùng nhóm với thẻ knobs cũ) */
  group: "Quality gate" | "5-minute broadcast" | "Scan digest" | "Train / Prob" | "Champion–challenger" | "LLM Risk Officer";
  type: "number" | "bool";
  def: number | boolean;
  min?: number;
  max?: number;
  /** bước nhập (number) */
  step?: number;
  /** số nguyên bắt buộc (number) */
  int?: boolean;
  /** giá trị nhập/hiển thị = raw / scale (BCAST_VOL_MIN theo triệu $, REPEAT theo giờ) */
  scale?: number;
  /** đơn vị hiển thị cạnh giá trị */
  unit?: string;
  /** chú thích ngắn dưới input — tiếng Anh (ngôn ngữ chính của app) */
  note: string;
}

export const EDITABLE: ParamMeta[] = [
  // Quality gate — cổng chất lượng fallback cho broadcast (engine có thể truyền
  // setpoint riêng từ Auto panel — cfg.minScore/minAuc/minAcc vẫn ưu tiên).
  { key: "BCAST_SCORE_MIN", group: "Quality gate", type: "number", def: BCAST_SCORE_MIN, min: 0, max: 95, step: 1, int: true, note: "Min score for a combo to pass the quality gate (broadcast fallback — Auto panel cfg overrides per-run)." },
  { key: "BCAST_AUC_MIN", group: "Quality gate", type: "number", def: BCAST_AUC_MIN, min: 0.5, max: 0.95, step: 0.01, note: "Min out-of-sample AUC. 0.8 = model must rank clearly better than a coin flip." },
  { key: "BCAST_ACC_MIN", group: "Quality gate", type: "number", def: BCAST_ACC_MIN, min: 50, max: 90, step: 1, int: true, unit: "%", note: "Min validation accuracy. Lower = more signals, noisier channel." },
  // 5-minute broadcast
  { key: "BCAST_VOL_MIN", group: "5-minute broadcast", type: "number", def: BCAST_VOL_MIN, min: 0, max: 2_000, step: 0.5, scale: 1e6, unit: "M USDT", note: "24h quote-volume floor — below this the coin is a desert, not worth posting." },
  { key: "BCAST_PL1_MIN", group: "5-minute broadcast", type: "number", def: BCAST_PL1_MIN, min: 0, max: 50, step: 0.5, unit: "%", note: "TP1 must be ≥ this % from entry — the signal still needs road to run." },
  { key: "BCAST_TOP_N", group: "5-minute broadcast", type: "number", def: BCAST_TOP_N, min: 1, max: 10, step: 1, int: true, note: "Max coins per TOP-coin broadcast message." },
  { key: "BCAST_REPEAT_MS", group: "5-minute broadcast", type: "number", def: BCAST_REPEAT_MS, min: 0, max: 24, step: 0.5, scale: 3_600_000, unit: "h", note: "Anti-repeat: one symbol can only be broadcast again after this long. 0 = off." },
  { key: "PRESSURE_FLOOR_LONG", group: "5-minute broadcast", type: "number", def: PRESSURE_FLOOR_LONG, min: 0, max: 49, step: 1, int: true, unit: "%", note: "Block BUY when taker buy-pressure ≤ this — never trade into the overwhelming side." },
  { key: "PRESSURE_CAP_SHORT", group: "5-minute broadcast", type: "number", def: PRESSURE_CAP_SHORT, min: 51, max: 100, step: 1, int: true, unit: "%", note: "Block SELL when taker buy-pressure ≥ this." },
  // Scan digest (tin QUÉT LỆNH 8h/lần)
  { key: "SCAN_DIGEST_TOP_N", group: "Scan digest", type: "number", def: SCAN_DIGEST_TOP_N, min: 3, max: 20, step: 1, int: true, note: "Rows in the 8-hour scan digest message." },
  { key: "SCAN_DIGEST_EVERY_MS", group: "Scan digest", type: "number", def: SCAN_DIGEST_EVERY_MS, min: 1, max: 24, step: 1, scale: 3_600_000, unit: "h", note: "Scan digest cadence in hours (phase-shifted to avoid stacking with other long messages)." },
  // Train / Prob
  { key: "MAX_DIFFICULTY", group: "Train / Prob", type: "number", def: MAX_DIFFICULTY, min: 1, max: 20, step: 1, int: true, note: "Max training difficulty tier. Don't exceed ~20: samples get too thin." },
  { key: "NOISE_BAND", group: "Train / Prob", type: "number", def: NOISE_BAND, min: 0, max: 0.2, step: 0.01, note: "Prob within 0.5±band = coin flip: no entry, no DCA, no sibling vote. 0 = off." },
  { key: "LESSON_WEIGHT", group: "Train / Prob", type: "number", def: LESSON_WEIGHT, min: 0, max: 32, step: 1, int: true, note: "Each closed trade is repeated this many times in the TRAIN split — model learns its own track record." },
  { key: "CALIBRATE", group: "Train / Prob", type: "bool", def: CALIBRATE, note: "Platt calibration on validation split — keeps Prob honest. Off = raw booster prob." },
  // Champion–challenger / confluence
  { key: "PROB_CAP", group: "Champion–challenger", type: "number", def: PROB_CAP, min: 0.5, max: 0.99, step: 0.01, note: "Ceiling/floor after multi-timeframe pooling — correlated votes can't make Prob absolute." },
  { key: "SIBLING_DISCOUNT", group: "Champion–challenger", type: "number", def: SIBLING_DISCOUNT, min: 0, max: 1, step: 0.05, note: "Vote weight of other timeframes. Higher = stronger consensus boost, more double-counting risk." },
  { key: "CONF_W", group: "Champion–challenger", type: "number", def: CONF_W, min: 0, max: 30, step: 1, int: true, note: "Weight of the confidence term in scoreOf. Lower it if Prob looks inflated." },
  { key: "REGRESS_EPS", group: "Champion–challenger", type: "number", def: REGRESS_EPS, min: 0, max: 0.1, step: 0.01, note: "AUC drop vs the combo champion that marks a retrain as a regression." },
  // LLM Risk Officer — CHỈ AUTOPSY_ON là runtime-được: fail-closed sống trong
  // cfg.llmFailClosed (Auto panel) và LLM_URL/TIMEOUT đọc lúc gọi, không ở đây.
  { key: "AUTOPSY_ON", group: "LLM Risk Officer", type: "bool", def: AUTOPSY_ON, note: "Trade autopsy — LLM dissects every closed trade and stores the lesson for future reviews." },
];

const GROUPS: ParamMeta["group"][] = ["Quality gate", "5-minute broadcast", "Scan digest", "Train / Prob", "Champion–challenger", "LLM Risk Officer"];

// ── Store (db/params-override.json) ──────────────────────────────────────────

type Overrides = Record<string, number | boolean>;

const OVERRIDE_FILE = "params-override.json";

const readOverrides = (): Overrides => {
  try {
    const raw = JSON.parse(readFileSync(dataFile(OVERRIDE_FILE), "utf8")) as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const out: Overrides = {};
    for (const meta of EDITABLE) {
      const v = (raw as Record<string, unknown>)[meta.key];
      if (meta.type === "number" && typeof v === "number" && Number.isFinite(v)) {
        out[meta.key] = clampNum(meta, v);
      } else if (meta.type === "bool" && typeof v === "boolean") {
        out[meta.key] = v;
      }
    }
    return out;
  } catch {
    return {}; // chưa có file / JSON hỏng → dùng toàn bộ mặc định
  }
};

const clampNum = (meta: ParamMeta, raw: number): number => {
  // min/max/step của meta theo ĐƠN VỊ HIỂN THỊ (view) — raw lưu trong file là
  // giá trị đã × scale (VD: nhập 5 M USDT → raw 5e6). Quy về view để kẹp biên.
  let n = meta.scale ? raw / meta.scale : raw;
  if (meta.min != null) n = Math.max(meta.min, n);
  if (meta.max != null) n = Math.min(meta.max, n);
  if (meta.int) n = Math.round(n);
  // tránh số thực bẩn kiểu 0.060000000000000005 sau nhân scale
  return Math.round(n * (meta.scale ?? 1) * 1e9) / 1e9;
};

const writeOverrides = (ov: Overrides): void => {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(dataFile(OVERRIDE_FILE), `${JSON.stringify(ov, null, 2)}\n`, "utf8");
  } catch {
    // read-only FS — override chỉ sống trong bộ nhớ của phiên này
  }
};

/** Nạp override vào globalThis — gọi lúc boot (engine) và sau MỌI lần lưu. */
export function hydrateParams(): void {
  (globalThis as { __elliotParams?: Record<string, unknown> }).__elliotParams = readOverrides();
}

/** Override đang lưu (rỗng = toàn bộ mặc định). */
export function getOverrides(): Overrides {
  return readOverrides();
}

/** Giá trị ĐANG HIỆU LỰC của một tham số (override ?? mặc định) — cho UI. */
export function effectiveValue(meta: ParamMeta): number | boolean {
  return pval(meta.key, meta.def);
}

export interface SetResult {
  ok: boolean;
  error?: string;
  overrides: Overrides;
}

/** Đặt / xoá một override. value = null → trả về mặc định. Lưu xong hydrate ngay. */
export function setOverride(key: string, value: number | boolean | null): SetResult {
  const meta = EDITABLE.find((m) => m.key === key);
  if (!meta) return { ok: false, error: `Unknown parameter: ${key}`, overrides: getOverrides() };
  const ov = getOverrides();
  if (value === null) {
    delete ov[key];
  } else if (meta.type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return { ok: false, error: `${key}: not a finite number`, overrides: ov };
    }
    const scaled = meta.scale ? value * meta.scale : value;
    ov[key] = clampNum(meta, scaled);
  } else {
    if (typeof value !== "boolean") return { ok: false, error: `${key}: expected boolean`, overrides: ov };
    ov[key] = value;
  }
  writeOverrides(ov);
  hydrateParams();
  return { ok: true, overrides: ov };
}

// ── Catalog cho GET /api/params ──────────────────────────────────────────────

export interface ParamGroupOut {
  name: ParamMeta["group"];
  items: {
    key: string;
    type: ParamMeta["type"];
    /** giá trị đang hiệu lực (raw + scaled-view) */
    value: number | boolean;
    view: number | boolean;
    def: number | boolean;
    /** override đang đặt (null = dùng mặc định) */
    override: number | boolean | null;
    min?: number;
    max?: number;
    step?: number;
    int?: boolean;
    scale?: number;
    unit?: string;
    note: string;
  }[];
}

export function paramCatalog(): { groups: ParamGroupOut[]; file: string } {
  const ov = getOverrides();
  const groups = GROUPS.map<ParamGroupOut>((name) => ({
    name,
    items: EDITABLE.filter((m) => m.group === name).map((m) => {
      const value = effectiveValue(m);
      const scale = m.scale ?? 1;
      return {
        key: m.key,
        type: m.type,
        value,
        view: typeof value === "number" ? Math.round((value / scale) * 1e6) / 1e6 : value,
        def: m.def,
        override: ov[m.key] ?? null,
        min: m.min,
        max: m.max,
        step: m.step,
        int: m.int,
        scale: m.scale,
        unit: m.unit,
        note: m.note,
      };
    }),
  }));
  return { groups, file: dataFile(OVERRIDE_FILE) };
}
