// Next.js instrumentation hook — runs once when the server boots (Node runtime).
// Two jobs, both "make the app work on real VPS boxes":
//   1. Load .env manually. `next dev` / `next start` and systemd's
//      EnvironmentFile read .env files, but the STANDALONE server
//      (`bun run start` → node .next/standalone/server.js) does NOT — env vars
//      like TELEGRAM_* / DATABASE_URL / DATA_DIR in the repo .env were silently
//      ignored in manual deployments. We parse the file ourselves and only fill
//      variables that are not already set (systemd / shell always win).
//   2. IPv4-first for ALL outbound lookups. Some VPS / ISP routes have a broken
//      IPv6 path to api.telegram.org which manifests as 503s, hangs or timeouts
//      — IPv4-first removes that failure mode. Safe: hosts without A records
//      still resolve to their AAAA records.

type DnsModule = { setDefaultResultOrder?: (order: "ipv4first" | "verbatim") => void };

/** Minimal dotenv parser: KEY=VALUE, optional quotes, # comments ignored. */
function loadDotenv(): void {
  try {
    const g = process as unknown as { getBuiltinModule?: (id: string) => unknown };
    const fs = g.getBuiltinModule?.("node:fs") as typeof import("node:fs") | undefined;
    const path = g.getBuiltinModule?.("node:path") as typeof import("node:path") | undefined;
    if (!fs || !path) return;
    // server.js chdirs into .next/standalone → repo .env sits two levels up.
    // MERGE every candidate (closest first, first-seen key wins) instead of
    // "first file wins" — a stale .env sitting inside .next/standalone must
    // not shadow the repo .env for keys it doesn't define.
    const candidates = [path.resolve(".env"), path.resolve("../..", ".env")];
    for (const file of candidates) {
      if (!fs.existsSync(file)) continue;
      const text = fs.readFileSync(file, "utf8");
      for (const line of text.split("\n")) {
        const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
        if (!m) continue;
        let v = m[2];
        if (
          (v.startsWith('"') && v.endsWith('"') && v.length >= 2) ||
          (v.startsWith("'") && v.endsWith("'") && v.length >= 2)
        ) {
          v = v.slice(1, -1);
        }
        // set even EMPTY values (KEY= clears a var) — but never override
        // something the shell/systemd already provided
        if (process.env[m[1]] === undefined) process.env[m[1]] = v;
      }
    }
  } catch {
    // unreadable .env — env vars set the normal way still work
  }
}

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // 0. Timestamp EVERY server console line (user request 0.2.68: "thêm thời
  //    gian vào backend log"). pm2 without `--time` shows raw output, so the
  //    app prefixes its own logs: [YYYY-MM-DD HH:MM:SS] in Asia/Ho_Chi_Minh
  //    (UTC+7) — fixed TZ so log lines stay comparable across VPS relocations.
  //    Next internal logs and worker-thread output still flow through the same
  //    console objects, so everything in `pm2 logs elliott` gets the stamp.
  try {
    const fmt = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Ho_Chi_Minh",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    const stamp = (): string => {
      const p = new Map<string, string>();
      for (const part of fmt.formatToParts(new Date())) p.set(part.type, part.value);
      return `[${p.get("year")}-${p.get("month")}-${p.get("day")} ${p.get("hour")}:${p.get("minute")}:${p.get("second")}]`;
    };
    for (const m of ["log", "info", "warn", "error"] as const) {
      const orig = console[m].bind(console);
      console[m] = (...args: unknown[]) => orig(stamp(), ...args);
    }
  } catch {
    // Intl/timezone unavailable — plain unprefixed logs still work
  }
  loadDotenv();
  try {
    // getBuiltinModule = Node ≥22.3 — loads builtins with zero bundler surface,
    // so Turbopack never thinks this file pulls node: modules into the edge bundle
    const g = process as unknown as { getBuiltinModule?: (id: string) => unknown };
    const dns = g.getBuiltinModule?.("node:dns") as DnsModule | undefined;
    dns?.setDefaultResultOrder?.("ipv4first");
  } catch {
    // older Node / exotic runtime — nothing to harden, ignore
  }
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  // 3. Session-open broadcast scheduler — server-side timer that sends the
  //    "đầu phiên" Telegram messages (Sydney/Tokyo/London/New York opens)
  //    with no browser open. Dynamic import keeps the edge bundle clean;
  //    a failure here must never take the app down.
  try {
    const sb = await import("./lib/session-broadcast");
    sb.startSessionBroadcastScheduler();
  } catch {
    // scheduler unavailable — notifications triggered from the UI still work
  }
  // 4. Backend engine scheduler — scan / train / universe / TOP-coin broadcast
  //    / paper-trade cycle / digests ALL run in this Node process now (the
  //    browser is display-only). Idempotent; idle until the first client sync.
  try {
    const en = await import("./lib/engine");
    en.startEngineScheduler();
  } catch {
    // engine unavailable — the UI still works with manual client actions
  }
}
