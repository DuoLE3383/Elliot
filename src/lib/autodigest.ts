// ─── autodigest — hourly / daily Telegram stat digests (server core) ─────────
// Boundary check + marker + send, callable from BOTH /api/autotrade/push (the
// client's intent POST) and the backend engine scheduler (no browser needed).
// Markers live in $DATA_DIR/autostat.json so restarts never double-send; a
// failed send rolls its marker back so the next tick retries.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { dataFile } from "./data-dir";
import { statLines } from "./autotrade";
import { readAutoState } from "./autostate";
import { tgSendMessage } from "./telegram-store";

/** digest labels follow the channel's language/country timezone */
const TZ = "Asia/Ho_Chi_Minh";
const at = (opts: Intl.DateTimeFormatOptions): string =>
  new Intl.DateTimeFormat("en-GB", { timeZone: TZ, ...opts }).format(new Date());

type Markers = { lastHour?: number; lastDay?: string };

function readMarkers(): Markers {
  try {
    const FILE = dataFile("autostat.json");
    if (!existsSync(FILE)) return {};
    return (JSON.parse(readFileSync(FILE, "utf8")) as Markers) ?? {};
  } catch {
    return {};
  }
}

function writeMarkers(m: Markers): void {
  try {
    const FILE = dataFile("autostat.json");
    mkdirSync(path.dirname(FILE), { recursive: true });
    writeFileSync(FILE, JSON.stringify(m, null, 2) + "\n", "utf8");
  } catch {
    // best-effort — worst case a digest repeats after a failed write
  }
}

// one push at a time per server process; the marker is written BEFORE the send
// (at-most-once) and rolled back on failure so the next tick can retry
let chain: Promise<unknown> = Promise.resolve();
const enqueue = <T>(fn: () => Promise<T>): Promise<T> => {
  const next = chain.then(fn, fn);
  chain = next.catch(() => undefined);
  return next;
};

/**
 * Send the digests that are DUE. Returns the list actually sent.
 * `force` — extra "gửi ngay" 24h digest, markers untouched.
 * `hourly` / `daily` — boundary-guarded sends (marker per hour / per day).
 */
export async function pushAutoDigests(body: { hourly?: boolean; daily?: boolean; force?: boolean }): Promise<string[]> {
  const force = body.force === true;
  const hourly = body.hourly === true;
  const daily = body.daily === true;
  if (!force && !hourly && !daily) return [];

  return enqueue(async (): Promise<string[]> => {
    const out: string[] = [];
    const nowMs = Date.now();

    if (force) {
      const st = await readAutoState();
      const label = at({ hour: "2-digit", minute: "2-digit", hour12: false });
      const r = await tgSendMessage(
        statLines(st, nowMs - 86_400_000, `📊 <b>AUTO THỐNG KÊ · ${label}</b>`, "24 giờ qua").join("\n"),
        "HTML",
      );
      if (r.ok) out.push("force");
      return out;
    }

    const hourKey = Math.floor(nowMs / 3_600_000); // global top-of-hour counter (TZ-neutral)
    const dayKey = at({ year: "numeric", month: "2-digit", day: "2-digit" }); // digest at local midnight

    if (hourly && readMarkers().lastHour !== hourKey) {
      const st = await readAutoState();
      const hh = at({ hour: "2-digit", hour12: false });
      writeMarkers({ ...readMarkers(), lastHour: hourKey });
      const r = await tgSendMessage(
        statLines(st, nowMs - 3_600_000, `⏰ <b>BÁO CÁO GIỜ · ${hh}:00</b>`, "1 giờ qua").join("\n"),
        "HTML",
      );
      if (r.ok) out.push("hourly");
      else {
        const cur = readMarkers();
        delete cur.lastHour; // failed send → let the next tick retry
        writeMarkers(cur);
      }
    }

    if (daily && readMarkers().lastDay !== dayKey) {
      const st = await readAutoState();
      const dd = at({ day: "2-digit", month: "2-digit" });
      writeMarkers({ ...readMarkers(), lastDay: dayKey });
      const r = await tgSendMessage(
        statLines(st, nowMs - 86_400_000, `📅 <b>BÁO CÁO NGÀY · ${dd}</b>`, "24 giờ qua").join("\n"),
        "HTML",
      );
      if (r.ok) out.push("daily");
      else {
        const cur = readMarkers();
        delete cur.lastDay;
        writeMarkers(cur);
      }
    }

    return out;
  });
}
