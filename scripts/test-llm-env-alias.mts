// v0.2.22 — llmEnvEndpoint(): LLM_URL/LLM_MODEL là tên chuẩn, và giờ nhận thêm
// BÍ DANH LLAMA_SERVER_URL/LLAMA_SERVER_MODEL (tên user từng đặt trong .env).
// Ưu tiên: LLM_URL > LLAMA_SERVER_URL > "" (caller tự rơi về cfg/default).
import { llmApiKey, llmEnvEndpoint } from "../src/lib/llm";

const clean = () => {
  delete process.env.LLM_URL;
  delete process.env.LLAMA_SERVER_URL;
  delete process.env.LLM_MODEL;
  delete process.env.LLAMA_SERVER_MODEL;
  delete process.env.LLM_API_KEY;
};

// 1) chỉ đặt bí danh → được dùng
clean();
process.env.LLAMA_SERVER_URL = "http://172.31.144.1:8888";
process.env.LLAMA_SERVER_MODEL = "qwen-local";
const a = llmEnvEndpoint();

// 2) cả hai → LLM_URL thắng
process.env.LLM_URL = "https://llm.huyenbao.com";
process.env.LLM_MODEL = "local";
const b = llmEnvEndpoint();

// 3) không đặt gì → "" (caller tự fallback)
clean();
const c = llmEnvEndpoint();

// 4) khoảng trắng hai đầu được trim
process.env.LLAMA_SERVER_URL = "  http://host:8888  ";
const d = llmEnvEndpoint();

// 5) LLM_API_KEY → llmApiKey() trả key đã trim; không có → ""
process.env.LLM_API_KEY = " secret-123 ";
const e = llmApiKey();
clean();
const f = llmApiKey();

console.log(JSON.stringify({ a, b, c, d, e, f }, null, 2));

const pass =
  a.url === "http://172.31.144.1:8888" &&
  a.model === "qwen-local" &&
  b.url === "https://llm.huyenbao.com" &&
  b.model === "local" &&
  c.url === "" &&
  c.model === "" &&
  d.url === "http://host:8888" &&
  e === "secret-123" &&
  f === "";
if (!pass) {
  console.error("FAIL");
  process.exit(1);
}
console.log("PASS: bí danh LLAMA_SERVER_URL/MODEL ăn khi thiếu LLM_URL, LLM_URL thắng khi có cả hai, trim + LLM_API_KEY đúng");
