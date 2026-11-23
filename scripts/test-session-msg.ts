// Preview buildSessionOpenMessage with fake klines (no network, no send).
import { buildSessionOpenMessage } from "../src/lib/session-broadcast";

const now = Date.now();
const klines = Array.from({ length: 50 }, (_, i) => {
  const t = now - (50 - i) * 3_600_000;
  const c = 65000 + Math.sin(i / 5) * 500 + i * 2;
  return { t, o: c - 10, h: c + 50, l: c - 50, c, v: 100, tb: 50 };
});

console.log("===== SESSION · PRE-OPEN (London, in 5m) =====");
console.log(buildSessionOpenMessage("london", now, klines, now + 5 * 60_000, null, null));
console.log("");
console.log("===== SESSION · JUST OPENED (London) =====");
console.log(buildSessionOpenMessage("london", now, klines, now, null, null));
