// QA 0.3.0 — TUNE-2 "NÂNG CẤP CẤP 2": luật đề xuất RR + Quality floor THUẦN SỐ.
//   A. tune2ItemsForBook — ma trận luật cho cả 3 sổ (insufficient / hold / rrUp /
//      rrDown / floorUp / floorRestore), biên clamp, không đề xuất khi at-cap.
//   B. Đúng tham số cho đúng sổ (VUL_ATR_STOP_MULT / VUL_VOL_FACTOR, RR_TP_RATIO
//      + minScore/minAuc/minAcc, WYC_EXIT_SL_PCT + WYC_RPS50/120_MIN) và key
//      i18n có đủ cả vi + en.
//   C. tune2-types thuần (client import được) — không đụng fs/db.
//   D. Round-trip file (load/save) trên DATA_DIR tạm.
import {
  tune2ItemsForBook,
  TUNE2_MIN_N,
  loadTune2File,
  saveTune2File,
  type BookId,
  type Tune2Cur,
  type Tune2Stats,
} from "../src/lib/tune2.ts";
import { TUNE2_MIN_N as MIN_N_TYPES, type Tune2Item } from "../src/lib/tune2-types.ts";
import { readFileSync, mkdirSync, rmSync, existsSync } from "fs";
import path from "path";
import { dataFile } from "../src/lib/data-dir.ts";

let fail = 0;
const check = (name: string, cond: boolean): void => {
  console.log(`${cond ? "PASS" : "FAIL"} — ${name}`);
  if (!cond) fail += 1;
};

const stats = (over: Partial<Tune2Stats> = {}): Tune2Stats => ({
  n: 12,
  wr: 45,
  avgWin: 2.0,
  avgLoss: -2.0,
  payoff: 1.0,
  expectancy: 0,
  netRoe: 0,
  ...over,
});

const curA: Tune2Cur = { rr: 2.0, floor: 1.5 };
const curB: Tune2Cur = { rr: 1.4, floor: 60, floor2: 0.8, floor3: 70 };
const curC: Tune2Cur = { rr: 7, floor: 65, floor2: 70 };

// ── A. ma trận luật ───────────────────────────────────────────────────────────

check("A1: n < 5 → không phát ngôn", tune2ItemsForBook("a", { ...stats(), n: 4 }, curA, 0.5).length === 0);
check("A2: hằng TUNE2_MIN_N = 5 (tune2 + types một nguồn)", TUNE2_MIN_N === 5 && MIN_N_TYPES === 5);

// hold — expectancy dương vừa phải (0..0.3), WR trung bình → không item gì
check(
  "A3: sổ ổn (exp 0.1, WR 50, payoff 1.0) → giữ nguyên",
  (["a", "b", "c"] as BookId[]).every((b) => tune2ItemsForBook(b, stats({ expectancy: 0.1, wr: 50, payoff: 1.0, netRoe: 1.2 }), b === "a" ? curA : b === "b" ? curB : curC, 0.5).length === 0),
);

// rrUp — WR ≥ 55 nhưng payoff < 1.15 và exp ≤ 0.3
const rrUpA = tune2ItemsForBook("a", stats({ wr: 58, payoff: 0.8, expectancy: 0.1, netRoe: 1 }), curA, 0.5);
check("A4: sổ A rrUp — WR 58 payoff 0.8 → ATR×2.0→×2.2 (bước ±0.2, biên 1.4-3.0)", rrUpA.length === 1 && rrUpA[0].kind === "rr" && rrUpA[0].param === "VUL_ATR_STOP_MULT" && rrUpA[0].from === 2.0 && rrUpA[0].to === 2.2);
const rrUpB = tune2ItemsForBook("b", stats({ wr: 60, payoff: 1.0, expectancy: 0.2, netRoe: 2 }), curB, 1.0);
check("A5: sổ B rrUp — WR 60 payoff 1.0 → ratio 1.4→1.6", rrUpB.length === 1 && rrUpB[0].param === "RR_TP_RATIO" && rrUpB[0].to === 1.6);
const rrUpC = tune2ItemsForBook("c", stats({ wr: 55, payoff: 0.9, expectancy: 0.05, netRoe: 0.5 }), curC, 0.1);
check("A6: sổ C rrUp — WR 55 payoff 0.9 → stop 7→5.5", rrUpC.length === 1 && rrUpC[0].param === "WYC_EXIT_SL_PCT" && rrUpC[0].to === 5.5);

// rrUp KHÔNG nổ khi exp > 0.3 (đã khỏe) hay payoff ≥ 1.15
check(
  "A7: rrUp im khi exp 0.4 (healthy) — WR 58 payoff 0.8",
  tune2ItemsForBook("a", stats({ wr: 58, payoff: 0.8, expectancy: 0.4, netRoe: 5 }), curA, 0.5).every((i) => i.kind !== "rr"),
);
check(
  "A8: rrUp im khi payoff 1.2 (đủ đẹp)",
  tune2ItemsForBook("a", stats({ wr: 58, payoff: 1.2, expectancy: 0.2, netRoe: 2 }), curA, 0.5).every((i) => i.kind !== "rr"),
);

// rrDown — WR ≤ 40 nhưng payoff ≥ 1.6
const rrDownA = tune2ItemsForBook("a", stats({ wr: 35, payoff: 1.8, expectancy: 0.1, netRoe: 1 }), curA, 0.5);
check("A9: sổ A rrDown — WR 35 payoff 1.8 → ATR×2.0→×1.8", rrDownA.length === 1 && rrDownA[0].kind === "rr" && rrDownA[0].to === 1.8);
const rrDownB = tune2ItemsForBook("b", stats({ wr: 38, payoff: 2.0, expectancy: 0.15, netRoe: 1.5 }), { rr: 1.6, floor: 60, floor2: 0.8, floor3: 70 }, 1.0);
check("A10: sổ B rrDown — ratio 1.6→1.4 (sàn 1.4)", rrDownB.length === 1 && rrDownB[0].to === 1.4);
const rrDownC = tune2ItemsForBook("c", stats({ wr: 40, payoff: 1.7, expectancy: 0.1, netRoe: 1 }), curC, 0.1);
check("A11: sổ C rrDown — stop 7→8.5", rrDownC.length === 1 && rrDownC[0].to === 8.5);

// floorUp — expectancy < 0
const floorUpA = tune2ItemsForBook("a", stats({ wr: 40, payoff: 1.0, expectancy: -0.5, netRoe: -6 }), curA, 0.5);
check("A12: sổ A floorUp exp −0.5 → volFactor 1.5→1.7", floorUpA.some((i) => i.kind === "floor" && i.param === "VUL_VOL_FACTOR" && i.from === 1.5 && i.to === 1.7));
const floorUpB = tune2ItemsForBook("b", stats({ wr: 42, payoff: 1.0, expectancy: -0.8, netRoe: -9.6 }), curB, 1.0);
const fb = floorUpB.find((i) => i.kind === "floor");
check("A13: sổ B floorUp — Score 60→65 · AUC 0.8→0.82 · ACC 70→72", !!fb && fb.param === "minScore" && fb.to === 65 && fb.extras.length === 2 && fb.extras[0].param === "minAuc" && fb.extras[0].to === 0.82 && fb.extras[1].param === "minAcc" && fb.extras[1].to === 72);
const floorUpC = tune2ItemsForBook("c", stats({ wr: 44, payoff: 1.1, expectancy: -0.3, netRoe: -3 }), curC, 0.1);
const fc = floorUpC.find((i) => i.kind === "floor");
check("A14: sổ C floorUp — RPS50 65→70 · RPS120 70→75", !!fc && fc.param === "WYC_RPS50_MIN" && fc.to === 70 && fc.extras.length === 1 && fc.extras[0].param === "WYC_RPS120_MIN" && fc.extras[0].to === 75);

// RR + floor cùng lúc — độc lập
const bothA = tune2ItemsForBook("a", stats({ wr: 56, payoff: 1.0, expectancy: -0.4, netRoe: -4.8 }), curA, 0.5);
check("A15: sổ A đang máu + WR cao → cả RR lẫn floor cùng lúc", bothA.length === 2 && bothA.some((i) => i.kind === "rr") && bothA.some((i) => i.kind === "floor"));

// floorRestore — khỏe rõ (exp ≥ 0.3, WR ≥ 48, n ≥ 20) + đang nông hơn default
const restoreB = tune2ItemsForBook("b", stats({ n: 25, wr: 52, payoff: 1.3, expectancy: 0.5, netRoe: 12.5 }), { rr: 1.4, floor: 70, floor2: 0.85, floor3: 74 }, 1.0);
const rb = restoreB.find((i) => i.kind === "floor");
check("A16: sổ B khỏe + floor 70/0.85/74 → hạ nhẹ về 65/0.84/73", !!rb && rb.to === 65 && rb.extras[0].to === 0.84 && rb.extras[1].to === 73);
check(
  "A17: sổ B khỏe nhưng floor ĐANG default → không restore",
  tune2ItemsForBook("b", stats({ n: 25, wr: 52, expectancy: 0.5, netRoe: 12.5, payoff: 1.3 }), curB, 1.0).length === 0,
);
check(
  "A18: sổ khỏe nhưng n = 15 (< 20) → không restore",
  tune2ItemsForBook("b", stats({ n: 15, wr: 52, expectancy: 0.5, netRoe: 7.5, payoff: 1.3 }), { rr: 1.4, floor: 70, floor2: 0.85, floor3: 74 }, 1.0).length === 0,
);

// biên — at-cap không đề xuất
check("A19: sổ A stop đã 3.0 (trần) → không rrUp nữa · rr 1.4 (sàn) → không rrDown nữa", tune2ItemsForBook("a", stats({ wr: 58, payoff: 0.8, expectancy: 0.2, netRoe: 2 }), { rr: 3.0, floor: 1.5 }, 0.5).every((i) => i.kind !== "rr") && tune2ItemsForBook("a", stats({ wr: 35, payoff: 1.8, expectancy: 0.2, netRoe: 2 }), { rr: 1.4, floor: 1.5 }, 0.5).every((i) => i.kind !== "rr"));
check("A20: sổ B ratio đã 3.0 (trần) → không rrUp nữa", tune2ItemsForBook("b", stats({ wr: 60, payoff: 1.0, expectancy: 0.2, netRoe: 2 }), { rr: 3.0, floor: 60, floor2: 0.8, floor3: 70 }, 1.0).every((i) => i.kind !== "rr"));
check("A21: sổ B floor đã 85/0.9/85 (trần) → không floorUp nữa", tune2ItemsForBook("b", stats({ wr: 40, payoff: 1.0, expectancy: -0.5, netRoe: -6 }), { rr: 1.4, floor: 85, floor2: 0.9, floor3: 85 }, 1.0).every((i) => i.kind !== "floor"));
check("A22: sổ C stop đã 4.5 (biên) → không rrUp nữa", tune2ItemsForBook("c", stats({ wr: 56, payoff: 0.9, expectancy: 0.2, netRoe: 2 }), { rr: 4.5, floor: 65, floor2: 70 }, 0.1).every((i) => i.kind !== "rr"));

// ── B. lý do + i18n ───────────────────────────────────────────────────────────

const item = rrUpA[0];
check("B1: item rrUp có lý do kèm số (wr/pay/aw/al/n/net/exp/fee/from/to)", ["wr", "pay", "aw", "al", "n", "net", "exp", "fee", "from", "to"].every((k) => k in item.args));
check("B2: lý do rr.up.a kèm số — fee 0.5 (lev 5 × 2 × 0.05)", item.args.fee === 0.5 && item.args.wr === 58 && item.args.from === 2 && item.args.to === 2.2);

const i18n = readFileSync("src/lib/i18n.ts", "utf8");
const keys = [
  "tune2.title", "tune2.sub", "tune2.refresh", "tune2.apply", "tune2.dismiss",
  "tune2.rr.up.a", "tune2.rr.down.a", "tune2.rr.up.b", "tune2.rr.down.b", "tune2.rr.up.c", "tune2.rr.down.c",
  "tune2.floor.up.a", "tune2.floor.restore.a", "tune2.floor.up.b", "tune2.floor.restore.b", "tune2.floor.up.c", "tune2.floor.restore.c",
  "tune2.param.VUL_ATR_STOP_MULT", "tune2.param.RR_TP_RATIO", "tune2.param.WYC_EXIT_SL_PCT",
];
check("B3: mọi key tune2 đủ cả vi + en (2 lần mỗi key)", keys.every((k) => (i18n.match(new RegExp(`"${k.replace(/\./g, "\\.")}":`, "g")) ?? []).length === 2));

// mọi item sinh ra phải có reasonKey tồn tại trong dict (tìm thấy đúng 2 — vi+en)
const allItems = [rrUpA[0], rrDownC[0], fb!, fc!, rb!];
check("B4: mọi reasonKey sinh ra đều có dict vi+en", allItems.every((i) => (i18n.match(new RegExp(`"${i.reasonKey.replace(/\./g, "\\.")}":`, "g")) ?? []).length === 2));

// ── C. types thuần cho client ────────────────────────────────────────────────
const typesSrc = readFileSync("src/lib/tune2-types.ts", "utf8");
check("C1: tune2-types không đụng fs/db/prisma", !/from "\.\/db"|from "fs"|@prisma|node:fs/.test(typesSrc));
const cardSrc = readFileSync("src/components/tune2-card.tsx", "utf8");
check("C2: Tune2Card chỉ import tune2-types (không tune2.ts server-only)", cardSrc.includes('@/lib/tune2-types') && !cardSrc.includes('@/lib/tune2"'));

// ── D. round-trip file (load/save) ────────────────────────────────────────────
// DATA_DIR PHẢI đặt từ command line (DATA_DIR=... bun ...) — dataFile tính
// DATA_DIR MỘT LẦN lúc module load, set env trong test là quá muộn (bài học
// lần chạy đầu: fixture ghi nhầm vào repo db/ → GET trả đề xuất rác).
const tmpDir = process.env.DATA_DIR ?? path.join(process.cwd(), ".tmp-tune2-test");
check("D0: test chạy với DATA_DIR riêng (không đụng repo db/)", tmpDir.endsWith(".tmp-tune2-test"));
mkdirSync(tmpDir, { recursive: true });
const file = { computedAt: new Date().toISOString(), books: { a: stats(), b: null, c: null }, items: [item] as Tune2Item[] };
saveTune2File(file);
check("D1: save → file tồn tại trong DATA_DIR", existsSync(dataFile("tune2-proposal.json")));
const loaded = loadTune2File();
check("D2: load giữ nguyên items + trạng thái", loaded != null && loaded.items.length === 1 && loaded.items[0].reasonKey === item.reasonKey && loaded.books.b === null);
rmSync(tmpDir, { recursive: true, force: true });

// mẹo chống quên: file mẫu đề xuất phải có mọi field UI cần
const ui = loaded!.items[0];
check("D3: item đủ field UI (book/kind/param/extras/from/to/reasonKey/args/status/appliedAt)", ui.book === "a" && ui.kind === "rr" && typeof ui.param === "string" && Array.isArray(ui.extras) && typeof ui.from === "number" && typeof ui.to === "number" && typeof ui.reasonKey === "string" && typeof ui.args === "object" && ui.status === "pending" && ui.appliedAt === null);

check("D4: DATA_DIR tạm đã dọn", !existsSync(tmpDir));

console.log(fail === 0 ? "\nALL_TUNE2_OK" : `\nTUNE2_FAILED: ${fail}`);
process.exit(fail === 0 ? 0 : 1);
