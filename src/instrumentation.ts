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
}
