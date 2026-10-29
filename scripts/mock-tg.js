#!/usr/bin/env node
// Mock Telegram Bot API for e2e — serves getMe / getUpdates / sendMessage.
// getUpdates synthesizes the "/start <token>" message from the CURRENT start
// token in db/telegram.json (as if the user had just pressed START), and
// returns [] once an offset flush >= 123457 arrives. sendMessage is logged.
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = parseInt(process.argv[2] || "3460", 10);
// the standalone server chdirs into .next/standalone → its db lives there;
// fall back to the project db for dev-mode runs
const CANDIDATES = [
  path.join(__dirname, "..", ".next", "standalone", "db", "telegram.json"),
  path.join(__dirname, "..", "db", "telegram.json"),
];
const LOG = "/tmp/mock-tg-sent.log";

function startToken() {
  for (const f of CANDIDATES) {
    try {
      const db = JSON.parse(fs.readFileSync(f, "utf8"));
      const tok = db?.start?.token ?? null;
      if (tok) return tok;
    } catch {}
  }
  return null;
}

const srv = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const m = req.url.match(/^\/bot[^/]+\/(\w+)/);
    const method = m ? m[1] : "";
    res.setHeader("content-type", "application/json");

    if (method === "getMe") {
      res.end(JSON.stringify({ ok: true, result: { id: 1, is_bot: true, first_name: "Mock", username: "mock_bot" } }));
    } else if (method === "getUpdates") {
      let offset = 0;
      try {
        offset = JSON.parse(body || "{}").offset || 0;
      } catch {}
      const tok = startToken();
      if (offset >= 123457 || !tok) {
        res.end(JSON.stringify({ ok: true, result: [] }));
      } else {
        res.end(
          JSON.stringify({
            ok: true,
            result: [
              {
                update_id: 123456,
                message: {
                  message_id: 7,
                  from: { id: 987654, is_bot: false, first_name: "Tester", username: "tester" },
                  chat: { id: 987654, first_name: "Tester", username: "tester", type: "private" },
                  date: Math.floor(Date.now() / 1000),
                  text: `/start ${tok}`,
                },
              },
            ],
          }),
        );
      }
    } else if (method === "sendMessage") {
      try {
        fs.appendFileSync(LOG, body + "\n");
      } catch {}
      res.end(JSON.stringify({ ok: true, result: { message_id: 42, date: 1, text: "ok", chat: { id: 987654 } } }));
    } else {
      res.end(JSON.stringify({ ok: true, result: {} }));
    }
  });
});

srv.listen(PORT, "127.0.0.1", () => console.log(`mock-tg on ${PORT}`));
