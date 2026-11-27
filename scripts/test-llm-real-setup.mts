// v0.2.24 — nút "Duyệt thử" dùng setup THẬT (llmTestSetup: top scan engine,
// đúng bộ lọc auto-cycle) thay setup giả; engine kèm track record vào prompt.
import http from "node:http";
import { llmTestSetup, type AutoTradeRow, type ScanRow } from "../src/lib/autotrade";
import { llmReviewDebug, type LlmSetup } from "../src/lib/llm";

const row = (over: Partial<ScanRow>): ScanRow => ({
  symbol: "SOLUSDT",
  interval: "15m",
  acc: 71.2,
  auc: 0.81,
  prob: 0.66,
  confidence: 0.32,
  bias: "LONG",
  slPct: 1.1,
  tpPct: 2.3,
  atrCoef: 1.5,
  score: 64.1,
  samples: 48000,
  valSamples: 12000,
  horizon: 8,
  trainedAt: Date.now(),
  whale: { volZ: 1.1, risk: 0.2, tag: "calm" },
  champAuc: 0.82,
  champAcc: 72,
  regressed: false,
  ...over,
});

const cfg = { minAuc: 0.8, minAcc: 70, minScore: 60, tpMode: "dyn" as const, slPct: 1, tpPct: 1.5, riskPct: 25 };

// 1) có ứng viên đạt gate → chọn top, nhãn "đạt gate", số liệu THẬT
const gated = llmTestSetup(
  [row({ auc: 0.72, acc: 58.3, score: 41, samples: 1200 }), row({ symbol: "ETHUSDT", interval: "1h" })],
  cfg,
  10,
);

// 2) không ai đạt gate → top scan kèm nhãn "CHƯA đạt gate"
const ungated = llmTestSetup([row({ auc: 0.72, acc: 58.3, score: 41, samples: 1200 })], cfg, 10);

// 3) scan rỗng → null; 4) toàn NEUTRAL → null
const empty = llmTestSetup([], cfg, 10);
const neutral = llmTestSetup([row({ bias: "NEUTRAL", prob: 0.5, confidence: 0 })], cfg, 10);

// 5) tpMode manual → sl/tp lấy từ cfg, không phải từ row
const manual = llmTestSetup([row()], { ...cfg, tpMode: "manual" as const }, 10);

// 6) engine gửi track → prompt phải chứa dòng bot_track_record
const seen: string[] = [];
const srv = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c: Buffer) => (body += c));
  req.on("end", () => {
    seen.push((JSON.parse(body).messages as { content: string }[]).map((m) => m.content).join("\n"));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { content: '{"verdict":"go","confidence":0.7,"reasons":["ok"]}' } }] }));
  });
});
await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
const port = (srv.address() as { port: number }).port;
const withTrack: LlmSetup = { ...(gated?.setup as LlmSetup), track: "31W/19L · win rate 62% · net +12.4% ROI (50 paper trades)" };
await llmReviewDebug(`http://127.0.0.1:${port}`, "m", withTrack, 3000);
srv.close();

console.log(
  JSON.stringify(
    {
      gated: gated?.source,
      gatedSamples: gated?.setup.samples,
      ungated: ungated?.source,
      empty: empty === null,
      neutral: neutral === null,
      manualSl: manual?.setup.slPct,
      manualTp: manual?.setup.tpPct,
      promptHasTrack: seen[0]?.includes("bot_track_record: 31W/19L"),
    },
    null,
    2,
  ),
);

void (0 as unknown as AutoTradeRow | undefined); // kiểu chỉ để chắc import không gãy

const pass =
  gated?.source.includes("gate passed") === true &&
  gated?.setup.symbol === "ETHUSDT" &&
  gated?.setup.samples === 48000 &&
  ungated?.source.includes("gate NOT passed") === true &&
  ungated?.setup.samples === 1200 &&
  empty === null &&
  neutral === null &&
  manual?.setup.slPct === 1 &&
  manual?.setup.tpPct === 1.5 &&
  seen[0]?.includes("bot_track_record: 31W/19L") === true;
if (!pass) {
  console.error("FAIL");
  process.exit(1);
}
console.log("PASS: llmTestSetup chọn đúng top scan (đạt/chưa đạt gate) + track record vào prompt");
