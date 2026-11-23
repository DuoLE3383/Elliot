// SSR smoke test for ApmFlowMap — render with sample props (long + short + gate on)
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
  ["neon defs", html.includes('id="apmNeon"')],
  ["line filter", html.includes("apmNeonLine")],
  ["halo filter", html.includes("apmHalo")],
  ["neon boost blur 4.5", html.includes('stdDeviation="4.5"')],
  ["neon line blur 2.6", html.includes('stdDeviation="2.6"')],
  ["halo blur 11", html.includes('stdDeviation="11"')],
  ["pulse animation on AI loop", html.includes("apm-pulse")],
  ["long card green #34d399", html.includes("#34d399")],
  ["short card red #fb7185", html.includes("#fb7185")],
  ["4 AI nodes (EN titles)", ["Trade autopsy · AI", "Strategy proposals · AI", "Parameters · AI", "Root cause"].every((s) => html.includes(s))],
  ["EN subs (1h signals)", html.includes("1h signals")],
  ["EN subs (Take profit)", html.includes("Take profit")],
  ["EN subs (Stop loss)", html.includes("Stop loss")],
  ["ROI +2.40%", html.includes("+2.40%")],
  ["ROI -1.10%", html.includes("-1.10%")],
  ["no render error", !html.includes("Error")],
];

let ok = 0;
for (const [name, pass] of checks) {
  console.log(`${pass ? "✅" : "❌"} ${name}`);
  if (pass) ok++;
}
console.log(`\nSSR smoke: ${ok}/${checks.length} pass`);
if (ok !== checks.length) process.exit(1);
