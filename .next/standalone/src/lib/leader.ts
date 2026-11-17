// ─── Tab leader election — one engine per browser, no matter how many tabs ────
// The auto-trade engine (train + scan + cycle + Telegram sends) runs in every
// open tab. Ten tabs of the same site used to mean ten XGBoost trainings, ten
// scan loops and ten duplicate notification streams. This module elects ONE
// "leader" tab per browser via BroadcastChannel:
//
//   • every tab announces itself every 3 s (heartbeat with its tabId)
//   • the tab with the SMALLEST tabId among peers seen within STALE_MS leads
//   • others go on standby — UI keeps working (reads the shared server state),
//     they just don't drive cycles / scans / sends
//   • leader closed/crashed → silent for STALE_MS → next election promotes a
//     standby tab within seconds; the returning old leader steps back down
//
// Deterministic tie-break (smallest id) means every tab computes the SAME
// winner from the same peer list — no split-brain elections.
//
// No BroadcastChannel (very old browser) → every tab runs as before; the
// server-side Telegram dedupe (src/lib/tg-dedupe.ts) still collapses duplicate
// notifications, so worst case is duplicated CPU, never duplicated spam.

"use client";

import { useEffect, useState } from "react";

/** peers not heard from for this long are dead (generous: hidden tabs throttle timers) */
export const STALE_MS = 30_000;
const HEARTBEAT_MS = 3_000;
const ELECT_MS = 2_500;

export interface Peer {
  id: string;
  ts: number; // last heartbeat epoch ms
}

/** the leader = smallest id among ALIVE peers (null when nobody is alive) */
export function pickLeader(peers: Peer[], now: number, maxAgeMs: number = STALE_MS): string | null {
  let best: string | null = null;
  for (const p of peers) {
    if (!p || typeof p.id !== "string" || !p.id) continue;
    if (typeof p.ts !== "number" || now - p.ts > maxAgeMs || now - p.ts < 0) continue;
    if (best === null || p.id < best) best = p.id;
  }
  return best;
}

/** unique-per-tab election id (random suffix breaks Date.now ties) */
export function newTabId(now: number = Date.now()): string {
  return `${now.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export interface LeaderState {
  /** true → THIS tab drives the engine (cycles, scans, sends) */
  leader: boolean;
  /** false → BroadcastChannel unavailable; every tab runs (TG dedupe still on) */
  supported: boolean;
}

/**
 * Elect one leader among the browser tabs of this origin. Default-true before
 * the first election tick so a fresh tab can start working immediately and
 * step down as soon as an older sibling announces itself (≤2.5 s).
 */
export function useLeaderElection(channel = "elliott-leader"): LeaderState {
  const [state, setState] = useState<LeaderState>({ leader: true, supported: true });

  useEffect(() => {
    if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") {
      setState({ leader: true, supported: false });
      return;
    }
    const id = newTabId();
    let alive = true;
    let leader = true;

    const bc = new BroadcastChannel(channel);
    const peers = new Map<string, number>();
    peers.set(id, Date.now());

    const announce = () => {
      try {
        bc.postMessage({ id, ts: Date.now() });
      } catch {
        // channel closed — election loop will notice
      }
    };
    const reelect = () => {
      if (!alive) return;
      const now = Date.now();
      peers.set(id, now); // self is always fresh
      for (const [pid, ts] of peers) {
        if (pid !== id && now - ts > STALE_MS) peers.delete(pid);
      }
      const isLeader = pickLeader([...peers].map(([pid, ts]) => ({ id: pid, ts })), now, STALE_MS) === id;
      if (isLeader !== leader) {
        leader = isLeader;
        setState({ leader, supported: true });
      }
    };

    bc.onmessage = (ev: MessageEvent) => {
      const d = ev.data as { id?: unknown; ts?: unknown } | null;
      if (!d || typeof d.id !== "string" || !d.id || d.id === id) return;
      peers.set(d.id, typeof d.ts === "number" ? d.ts : Date.now());
      reelect(); // a new/returning sibling takes effect immediately
    };

    announce();
    const hb = window.setInterval(announce, HEARTBEAT_MS);
    const el = window.setInterval(reelect, ELECT_MS);
    // a woken-up tab (was throttled while hidden) re-announces right away
    const onVis = () => {
      if (document.visibilityState === "visible") {
        announce();
        reelect();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onVis);

    return () => {
      alive = false;
      window.clearInterval(hb);
      window.clearInterval(el);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onVis);
      try {
        bc.postMessage({ id, ts: Date.now() - STALE_MS - 1 }); // goodbye — instantly stale
      } catch {
        // already closed
      }
      bc.close();
    };
  }, [channel]);

  return state;
}
