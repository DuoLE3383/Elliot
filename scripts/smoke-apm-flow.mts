// Smoke test SSR cho ApmFlowMap — render chuỗi với props mẫu (long + short + gate on)
import { renderToStaticMarkup } from "react-dom/server";
import { ApmFlowMap, type ApmFlowCounts } from "../src/components/apm-flow";

const fc: ApmFlowCounts = {
  universePool: 120,
  publishedTop: 18,
  uptrend: 7,
  scanCombos: 54,
  scanAgeMin: 2,
  gatePass: 3,
  neutral: 11,
  tradesTotal: 42,
  closedTrades: 38,
  tp: 20,
  sl: 9,
  flip: 6,
  manual: 3,
  open: null,
  openPositions: [
    { id: "1", symbol: "BTCUSDT", side: "LONG", roi: 2.4, ageH: 3.2 },
    { id: "2", symbol: "ETHUSDT", side: "SHORT", roi: -1.1, ageH: 8.7 },
  ],
};

const html = renderToStaticMarkup(
  ApmFlowMap({ lang: "vi", f: fc, onNodeClick: () => {}, onSelectPosition: () => {} }) as any,
);

const checks: Array<[string, boolean]> = [
  ["defs neon", html.includes('id="apmNeon"')],
  ["filter dây", html.includes("apmNeonLine")],
  ["quầng halo", html.includes("apmHalo")],
  ["card long xanh #34d399", html.includes("#34d399")],
  ["card short đỏ #fb7185", html.includes("#fb7185")],
  ["4 node AI (theo tiêu đề)", ["Phân tích lệnh · AI", "Đề xuất chiến lược · AI", "Tham số · AI", "Nguyên nhân gốc"].every((s) => html.includes(s))],
  ["ROI +2.40%", html.includes("+2.40%")],
  ["ROI -1.10%", html.includes("-1.10%")],
  ["không lỗi render", !html.includes("Error")],
];

let ok = 0;
for (const [name, pass] of checks) {
  console.log(`${pass ? "✅" : "❌"} ${name}`);
  if (pass) ok++;
}
console.log(`\nSSR smoke: ${ok}/${checks.length} pass`);
if (ok !== checks.length) process.exit(1);
