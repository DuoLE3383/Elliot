// GET  /api/self-improve — agent status + method stats + event log
// POST /api/self-improve { force?: true } — run one agent tick now
import { NextRequest, NextResponse } from "next/server";
import { engineSnapshot, syncEngine } from "@/lib/engine";
import { agentSnapshot, runAgentTick } from "@/lib/self-improve";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const snap = engineSnapshot();
    const data = await agentSnapshot(snap.cfg, snap.leverage);
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "agent unavailable" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  let force = false;
  try {
    const body = (await req.json().catch(() => ({}))) as { force?: boolean };
    force = body.force === true;
  } catch {
    /* empty body ok */
  }
  try {
    const snap = engineSnapshot();
    const result = await runAgentTick(
      snap.cfg,
      snap.leverage,
      (patch) => {
        syncEngine({ cfg: patch });
      },
      force,
    );
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "tick failed" },
      { status: 500 },
    );
  }
}
