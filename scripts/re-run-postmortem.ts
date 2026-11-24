// Re-run Post-Mortem (ten cu: autopsy) cho toan bo lenh da dong.
// npx tsx scripts/re-run-postmortem.ts --dry-run --limit 5
// npx tsx scripts/re-run-postmortem.ts --force --limit 1
// npx tsx scripts/re-run-postmortem.ts --only-uncovered
import { autopsyClosedTrade } from "../src/lib/autopsy";
import { db } from "../src/lib/db";
const args = new Set(process.argv.slice(2));
const force = args.has("--force");
const onlyMissing = args.has("--only-missing");
const onlyUncovered = args.has("--only-uncovered");
const dryRun = args.has("--dry-run");
const limitArg = process.argv.find((a) => a.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.split("=")[1]) : 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function isUncovered(a: string | null): boolean {
  if (!a) return false;
  try { return (JSON.parse(a) as { ev?: { covered?: boolean } }).ev?.covered === false; } catch { return false; }
}
async function main() {
  const trades = await db.autoTrade.findMany({ where: { status: "closed" }, orderBy: { exitTime: "asc" } });
  console.log(`[postmortem] closed total: ${trades.length} | force=${force} onlyMissing=${onlyMissing} onlyUncovered=${onlyUncovered} dryRun=${dryRun} limit=${limit || "all"}`);
  let run = 0, skipped = 0, failed = 0, attempted = 0;
  for (const t of trades) {
    if (limit && attempted >= limit) break;
    const has = !!t.autopsy;
    if (onlyMissing && has) { skipped++; continue; }
    if (onlyUncovered && !isUncovered(t.autopsy)) { skipped++; continue; }
    if (!force && !onlyMissing && !onlyUncovered && has) { skipped++; continue; }
    attempted++;
    if (dryRun) { run++; continue; }
    // truyen NGUYEN row Prisma (Date, status, id) + force de bypass write-once
    try {
      const res = await autopsyClosedTrade(t as never, { force });
      if (!res) { failed++; console.log(`[postmortem] SKIP ${t.symbol} ${t.id} llm-null`); continue; }
      run++; console.log(`[postmortem] OK ${run} ${t.symbol} ${new Date(t.exitTime!).toISOString().slice(0, 16)}`);
    } catch (e) { failed++; console.log(`[postmortem] FAIL ${t.symbol} ${t.id} ${(e as Error).message}`); }
    await sleep(1500);
  }
  console.log(`[postmortem] DONE run=${run} skipped=${skipped} failed=${failed}`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
