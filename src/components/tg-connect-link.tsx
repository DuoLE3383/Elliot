"use client";

// ─── TgLinkBootstrap — ?tg=<secret> auto-connect on page load ─────────────────
// Mounted once at the app root (outside any tab) so opening a connect link on
// ANY view consumes the one-time secret, installs the bound bot token server
// side and shows a small self-dismissing confirmation. The secret is stripped
// from the address bar immediately so it never lingers in history/scroll.

import { useEffect, useState } from "react";
import { telegramLinkConnect } from "@/lib/autotrade";
import { t, type Lang } from "@/lib/i18n";

export function TgLinkBootstrap() {
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const secret = sp.get("tg");
    if (!secret) return;
    // English is the main language (0.2.58) — only a VI choice saved this
    // session flips the toast; anything else boots EN.
    const lang: Lang = localStorage.getItem("utp.lang") === "vi" ? "vi" : "en";
    // burn the param out of the URL first — refreshes/share must not reuse it
    window.history.replaceState(null, "", window.location.pathname);
    let cancelled = false;
    void (async () => {
      const r = await telegramLinkConnect(secret);
      if (cancelled) return;
      setNote({
        ok: r.ok,
        text: r.ok
          ? t(lang, "tgboot.ok", { bot: r.bot ? `@${r.bot}` : "" }).trim()
          : t(lang, "tgboot.fail"),
      });
      window.setTimeout(() => !cancelled && setNote(null), 6000);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!note) return null;
  return (
    <div
      role="status"
      className={`fixed bottom-4 left-1/2 z-[80] -translate-x-1/2 rounded-lg border px-3 py-2 text-xs font-medium shadow-lg ${
        note.ok
          ? "border-teal-700 bg-teal-950/90 text-teal-200"
          : "border-rose-800 bg-rose-950/90 text-rose-200"
      }`}
    >
      {note.text}
    </div>
  );
}
