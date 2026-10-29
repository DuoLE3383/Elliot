// Next.js instrumentation hook — runs once when the server boots (Node runtime).
// Network hardening: prefer IPv4 for ALL outbound lookups. Some VPS / ISP
// routes have a broken IPv6 path to api.telegram.org which manifests as
// 503s, hangs or timeouts — IPv4-first removes that failure mode. Safe:
// hosts without A records still resolve to their AAAA records.

type DnsModule = { setDefaultResultOrder?: (order: "ipv4first" | "verbatim") => void };

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
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
