// Mock OpenAI-compatible llama-server for e2e-testing /api/llm/review.
// Serves GET /v1/models and POST /v1/chat/completions with a fixed verdict.
// Usage: node mock-llama.js <port> <go|skip>
const http = require("http");
const port = Number(process.argv[2] || 8899);
const verdict = process.argv[3] === "skip" ? "skip" : "go";

http
  .createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.method === "GET" && req.url === "/v1/models") {
      res.end(JSON.stringify({ data: [{ id: "mock-model" }] }));
      return;
    }
    if (req.method === "POST" && req.url === "/v1/chat/completions") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        res.end(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    verdict,
                    confidence: 0.7,
                    reasons:
                      verdict === "skip"
                        ? ["liquidation too close to SL for x10"]
                        : ["risk profile consistent with evidence"],
                  }),
                },
              },
            ],
          }),
        );
      });
      return;
    }
    res.statusCode = 404;
    res.end("{}");
  })
  .listen(port, "127.0.0.1", () => console.log(`mock-llama on 127.0.0.1:${port} → ${verdict}`));
