// ─── /api/telegram/diag — pinpoint WHY Telegram calls fail (503 / timeout) ────
// Runs the exact network checks the user cannot easily do themselves, from the
// SERVER side (same machine where tgApi runs):
//   1. DNS   — A + AAAA records of the DIRECT Telegram origin
//   2. IPv4  — forced-IPv4 POST /getMe with a dummy token (401 = path alive)
//   3. IPv6  — same probe with forced IPv6
//   4. Effective base — the origin tgApi actually uses (direct or Worker proxy)
// Any 401/404 still proves the network path: the TLS+HTTP round trip reached a
// server and it answered. Verdict drives a targeted i18n advice in the panel.

import { NextResponse } from "next/server";
import https from "node:https";
import { promises as dns } from "node:dns";
import { effectiveApiBase, effectiveToken, TG_API_BASE_DEFAULT } from "@/lib/telegram-store";

export const dynamic = "force-dynamic";

interface Probe {
  status: number; // 0 = no HTTP response (network error / timeout)
  ms: number;
  err?: string;
}

// invalid by construction — a 401 from it still proves the path is alive
const DUMMY = "0:DIAG-DEAD";

function probeDirect(family: 4 | 6, timeoutMs = 6000): Promise<Probe> {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const done = (status: number, err?: string) => resolve({ status, ms: Date.now() - t0, err });
    try {
      const req = https.request(
        {
          host: new URL(TG_API_BASE_DEFAULT).hostname,
          family, // force the address family — this is the whole point
          servername: "api.telegram.org", // TLS SNI so the cert matches
          path: `/bot${DUMMY}/getMe`,
          method: "POST",
          headers: { Host: "api.telegram.org" },
          timeout: timeoutMs,
        },
        (res) => {
          res.resume();
          res.on("end", () => done(res.statusCode ?? 0));
          res.on("error", () => done(res.statusCode ?? 0));
        },
      );
      req.on("timeout", () => req.destroy(new Error("timeout")));
      req.on("error", (e) => done(0, e.message));
      req.end();
    } catch (e) {
      done(0, e instanceof Error ? e.message : "probe failed");
    }
  });
}

async function probeBase(base: string, token: string | null, timeoutMs = 8000): Promise<Probe> {
  const t0 = Date.now();
  try {
    const res = await fetch(`${base}/bot${token ?? DUMMY}/getMe`, {
      method: "POST",
      signal: AbortSignal.timeout(timeoutMs),
    });
    await res.arrayBuffer().catch(() => null); // drain — connection reuse
    return { status: res.status, ms: Date.now() - t0 };
  } catch (e) {
    return { status: 0, ms: Date.now() - t0, err: e instanceof Error ? e.message : "fetch failed" };
  }
}

// 200 = real answer; 401 = bad token but Telegram reachable; 404 = wrong path
// but TLS+HTTP round trip completed — all three prove the PATH, not the creds.
const PATH_OK = new Set([200, 401, 404]);

export async function POST() {
  const { base, source } = effectiveApiBase();
  const tok = effectiveToken().token;
  const directHost = new URL(TG_API_BASE_DEFAULT).hostname;

  const [a, aaaa, v4, v6, eff] = await Promise.all([
    dns.resolve4(directHost).catch(() => [] as string[]),
    dns.resolve6(directHost).catch(() => [] as string[]),
    probeDirect(4),
    probeDirect(6),
    probeBase(base, tok),
  ]);

  const v4ok = PATH_OK.has(v4.status);
  const v6ok = PATH_OK.has(v6.status);
  let verdict: "ok" | "ipv6" | "blocked" | "proxy-ok" | "proxy-bad" | "token";
  if (source !== "default") {
    verdict = eff.status === 200 ? "proxy-ok" : "proxy-bad";
  } else if (!v4ok && !v6ok) {
    verdict = "blocked"; // ISP / datacenter route throttled — only a proxy helps
  } else if (v4ok && !v6ok) {
    verdict = "ipv6"; // broken v6 + working v4 — ipv4first hardening self-heals
  } else {
    verdict = tok ? (eff.status === 200 ? "ok" : "token") : "ok";
  }

  return NextResponse.json({ base, source, dns: { a, aaaa }, v4, v6, eff, verdict });
}
