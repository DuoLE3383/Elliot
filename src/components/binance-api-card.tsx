"use client";

// ─── BinanceApiCard — setting Binance API cho auto trade (0.2.96) ─────────────
// Nằm trên trang /auto. Lưu key/secret qua /api/binance-keys (server-side JSON
// chmod 600 trong $DATA_DIR). Test kết nối = GET /fapi/v2/account signed —
// chỉ ĐỌC, không đặt lệnh. Secret không bao giờ được trả về/hiển thị lại.

import { useCallback, useEffect, useState } from "react";
import { KeyRound, Loader2, PlugZap, ShieldCheck, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { t, type Lang } from "@/lib/i18n";

interface Status {
  configured: boolean;
  source: "store" | "env" | null;
  apiKeyMasked: string | null;
  updatedAt: string | null;
  lastTest: { at: string; ok: boolean; note: string } | null;
}

export function BinanceApiCard({ lang }: { lang: Lang }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [busy, setBusy] = useState<"" | "save" | "test" | "clear">("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/binance-keys", { cache: "no-store" });
      if (res.ok) setStatus((await res.json()) as Status);
    } catch {
      /* giữ trạng thái cũ */
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const post = useCallback(
    async (action: "save" | "test" | "clear", okText: string) => {
      setBusy(action);
      setMsg(null);
      try {
        const res = await fetch("/api/binance-keys", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(action === "save" ? { action, apiKey, apiSecret } : { action }),
        });
        const json = (await res.json()) as { ok?: boolean; error?: string; note?: string; status?: Status };
        if (json.status) setStatus(json.status);
        if (!res.ok || json.ok === false) {
          setMsg({ ok: false, text: json.error || json.note || `HTTP ${res.status}` });
        } else if (action === "test") {
          setMsg({ ok: true, text: `${t(lang, "bapi.test.ok")} — ${json.note ?? ""}` });
        } else {
          setMsg({ ok: true, text: okText });
          if (action === "save") {
            setApiKey("");
            setApiSecret("");
          }
        }
      } catch (e) {
        setMsg({ ok: false, text: e instanceof Error ? e.message : "network error" });
      } finally {
        setBusy("");
      }
    },
    [apiKey, apiSecret, lang],
  );

  const badge =
    status == null ? null : status.configured ? (
      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-700 bg-emerald-950/60 px-2 py-0.5 text-[11px] font-medium text-emerald-300">
        <ShieldCheck className="h-3 w-3" />
        {status.source === "env" ? t(lang, "bapi.status.env") : t(lang, "bapi.status.store")}
        {status.apiKeyMasked ? ` · ${status.apiKeyMasked}` : ""}
      </span>
    ) : (
      <span className="inline-flex items-center gap-1 rounded-full border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-[11px] text-zinc-400">
        {t(lang, "bapi.status.none")}
      </span>
    );

  return (
    <section className="rounded-xl border border-zinc-800/80 bg-[#020617]/70 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <KeyRound className="h-4 w-4 shrink-0 text-amber-400" />
        <h2 className="text-sm font-semibold text-zinc-100">{t(lang, "bapi.title")}</h2>
        {badge}
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-zinc-500">{t(lang, "bapi.sub")}</p>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <Input
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={t(lang, "bapi.key")}
          autoComplete="off"
          spellCheck={false}
          className="h-9 border-zinc-800 bg-zinc-950/70 font-mono text-xs text-zinc-200"
        />
        <Input
          value={apiSecret}
          onChange={(e) => setApiSecret(e.target.value)}
          placeholder={t(lang, "bapi.secret")}
          type="password"
          autoComplete="new-password"
          spellCheck={false}
          className="h-9 border-zinc-800 bg-zinc-950/70 font-mono text-xs text-zinc-200"
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          className="h-8 gap-1.5 bg-amber-600 px-3 text-xs text-white hover:bg-amber-500"
          disabled={busy !== "" || !apiKey.trim() || !apiSecret.trim()}
          onClick={() => void post("save", t(lang, "bapi.saved"))}
        >
          {busy === "save" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          {t(lang, "bapi.save")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-8 gap-1.5 border-zinc-700 px-3 text-xs text-zinc-300 hover:bg-zinc-800"
          disabled={busy !== "" || !status?.configured}
          onClick={() => void post("test", t(lang, "bapi.test.ok"))}
        >
          {busy === "test" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlugZap className="h-3.5 w-3.5" />}
          {busy === "test" ? t(lang, "bapi.testing") : t(lang, "bapi.test")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-8 gap-1.5 border-rose-900 px-3 text-xs text-rose-300 hover:bg-rose-950"
          disabled={busy !== "" || !status?.configured}
          onClick={() => void post("clear", t(lang, "bapi.cleared"))}
        >
          <Trash2 className="h-3.5 w-3.5" />
          {t(lang, "bapi.clear")}
        </Button>
      </div>

      {msg && (
        <p className={`mt-2 text-xs leading-relaxed ${msg.ok ? "text-emerald-400" : "text-rose-400"}`} role="status">
          {msg.text}
        </p>
      )}
      {status?.lastTest && (
        <p className="mt-1 text-[11px] text-zinc-500">
          lastTest {new Date(status.lastTest.at).toLocaleString()} — {status.lastTest.ok ? "OK" : "FAIL"}: {status.lastTest.note}
        </p>
      )}
      <p className="mt-2 text-[11px] leading-relaxed text-zinc-600">{t(lang, "bapi.note.permission")}</p>
    </section>
  );
}
