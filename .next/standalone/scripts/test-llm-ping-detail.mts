// v0.2.25 — pingFailureDetail(): badge /ai phải nói được LÝ DO ping hỏng
// (DNS chưa trỏ / refused / timeout) thay vì chỉ "NOT reachable · 2ms".
import { pingFailureDetail } from "../src/lib/llm";

// 1) DNS fail — Node fetch bọc lỗi trong e.cause.code
const dnsErr = new Error("fetch failed", { cause: { code: "ENOTFOUND" } });

// 2) không gì nghe ở cổng đó
const refused = new Error("fetch failed", { cause: { code: "ECONNREFUSED" } });

// 3) timeout — AbortSignal.timeout ném TimeoutError
const timeout = Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });

// 4) AbortError (controller.abort())
const abort = Object.assign(new Error("This operation was aborted"), { name: "AbortError" });

// 5) lỗi lạ không có cause.code
const weird = new Error("boom");

const out = {
  dns: pingFailureDetail(dnsErr),
  refused: pingFailureDetail(refused),
  timeout: pingFailureDetail(timeout),
  abort: pingFailureDetail(abort),
  weird: pingFailureDetail(weird),
  nonError: pingFailureDetail("string any"),
};
console.log(JSON.stringify(out, null, 2));

const pass =
  out.dns === "ENOTFOUND" &&
  out.refused === "ECONNREFUSED" &&
  out.timeout === "timeout" &&
  out.abort === "timeout" &&
  out.weird === "error" &&
  out.nonError === "error";
if (!pass) {
  console.error("FAIL");
  process.exit(1);
}
console.log("PASS: pingFailureDetail map đúng ENOTFOUND/ECONNREFUSED/timeout/error");
