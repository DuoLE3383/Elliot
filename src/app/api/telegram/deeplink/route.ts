// ─── /api/telegram/deeplink — t.me/<bot>?start=<token> → press START → bind ───
// mint:  returns the t.me deep link. Uses the cached @username when present so
//        it works even while the network path to Telegram is down (503 days).
// check: lazy getUpdates scan for "/start <token>" — binds that chat id as the
//        notification target, sends a confirmation and flushes the queue.
//        No webhook, no public endpoint, no chat-ID hunting. One-time + 30 min
//        TTL; a new mint invalidates the previous link.

import { NextResponse } from "next/server";
import {
  createStartLink,
  effectiveToken,
  getStoredTokenMeta,
  popStartLink,
  setStoredChatId,
  tgApi,
} from "@/lib/telegram-store";

export const dynamic = "force-dynamic";

interface StartUpdate {
  update_id: number;
  message?: {
    chat?: { id?: number | string; title?: string };
    from?: { first_name?: string };
    text?: string;
  };
}

export async function POST(req: Request) {
  let body: { action?: string } = {};
  try {
    body = await req.json();
  } catch {
    // no/invalid body → fall through to 400 below
  }

  const tok = effectiveToken();
  if (!tok.token) return NextResponse.json({ error: "no_token" }, { status: 400 });

  if (body.action === "mint") {
    // cached @username first — minting must not depend on the flaky network
    let bot = getStoredTokenMeta().bot;
    if (!bot) {
      const me = await tgApi("getMe", undefined, 1, tok.token);
      bot = me.json?.result?.username ?? null;
    }
    if (!bot) {
      return NextResponse.json(
        { error: "no_bot", detail: "getMe failed — check API base / network, or press Test Telegram once" },
        { status: 502 },
      );
    }
    const token = createStartLink();
    return NextResponse.json({ ok: true, url: `https://t.me/${bot}?start=${token}`, bot, expiresInMin: 30 });
  }

  if (body.action === "check") {
    const up = await tgApi("getUpdates", { timeout: 0 }, 1, tok.token);
    if (up.detail && !up.json) {
      // network path down / webhook conflict (409) / etc — surface it
      return NextResponse.json({ error: "net", detail: up.detail }, { status: 502 });
    }
    const updates = (up.json as unknown as { result?: StartUpdate[] } | null)?.result ?? [];

    let maxId = 0;
    let bound: { chatId: string; name: string | null } | null = null;
    for (const u of updates) {
      if (typeof u.update_id === "number" && u.update_id > maxId) maxId = u.update_id;
      const m = u.message;
      const text = m?.text ?? "";
      if (!m || !text.startsWith("/start")) continue;
      const param = text.slice("/start".length).trim().split(/\s+/)[0] ?? "";
      if (popStartLink(param)) {
        bound = { chatId: String(m.chat?.id ?? ""), name: m.from?.first_name ?? m.chat?.title ?? null };
        break; // one bind per check — the link is burned
      }
    }

    if (!bound || !bound.chatId) return NextResponse.json({ ok: true, bound: false });

    setStoredChatId(bound.chatId);
    await tgApi(
      "sendMessage",
      {
        chat_id: bound.chatId,
        text: "✅ Elliott connected — trade alerts will arrive here.",
        disable_web_page_preview: true,
      },
      1,
      tok.token,
    );
    if (maxId > 0) {
      // flush everything up to and including what we just scanned — anything
      // arriving AFTER the scan stays pending for the next check
      await tgApi("getUpdates", { offset: maxId + 1, timeout: 0 }, 1, tok.token);
    }
    return NextResponse.json({ ok: true, bound: true, chatId: bound.chatId, name: bound.name });
  }

  return NextResponse.json({ error: "bad_action" }, { status: 400 });
}
