// ─── Telegram Bot API reverse proxy (Cloudflare Worker) ──────────────────────
// Fixes persistent HTTP 503 / 429 when the app's server cannot reliably reach
// api.telegram.org (congested VPS routes, ISP interference, datacenter-IP
// throttling). The Worker's clean Cloudflare egress talks to Telegram instead.
//
// SETUP — ~2 minutes, no CLI needed:
//   1. Cloudflare Dashboard → Workers & Pages → Create → Worker → "Deploy"
//   2. Edit code → paste this whole file → Deploy
//      (free subdomain: https://<name>.<account>.workers.dev)
//   3. Optional custom domain: Worker → Settings → Domains & Routes → Add
//      → Custom domain → tg.huyenbao.com (DNS is automatic on the same zone)
//   4. In the app: Auto panel → Telegram → "API base" → paste
//      https://<name>.<account>.workers.dev  (or https://tg.huyenbao.com)
//      → Save. The panel immediately re-tests through the proxy.
//   No token is ever stored on Cloudflare — it only forwards paths verbatim.
//
// Local check:  curl https://<worker>/bot<TOKEN>/getMe   → same JSON as Telegram.

const UPSTREAM = "https://api.telegram.org";

export default {
  async fetch(request) {
    const url = new URL(request.url);

    // health probe for the panel / browser
    if (url.pathname === "/health") return new Response("ok\n");

    // only forward Bot-API shaped paths (/bot<token>/<method>) — this proxy is
    // not a general-purpose open relay
    if (!/^\/bot[0-9A-Za-z:_-]+\/[A-Za-z0-9_]+$/.test(url.pathname)) {
      return new Response("tg-proxy: append /bot<token>/<method>\n", { status: 404 });
    }

    const init = {
      method: request.method,
      headers: { "content-type": "application/json" },
      // keep CF from caching Bot-API answers (getUpdates etc. must be live)
      cf: { cacheTtl: 0 },
    };
    if (request.method !== "GET" && request.method !== "HEAD") {
      init.body = await request.arrayBuffer();
    }

    try {
      const upstream = await fetch(UPSTREAM + url.pathname + url.search, init);
      const res = new Response(upstream.body, upstream);
      res.headers.set("content-type", "application/json");
      res.headers.set("access-control-allow-origin", "*");
      return res;
    } catch (e) {
      return new Response(
        JSON.stringify({ ok: false, description: "tg-proxy upstream error: " + (e && e.message) }),
        { status: 502, headers: { "content-type": "application/json" } },
      );
    }
  },
};
