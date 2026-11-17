"use client";

// ─── params-editor — chỉnh tham số hệ thống NGAY trên /ai (không cần deploy) ──
// "hãy mở setting ở panel trong hình 2" — thẻ knobs cũ chỉ read-only. Giờ:
//   • item EDITABLE → ô nhập + nút reset; POST /api/params lưu vào
//     db/params-override.json và hydrateParams() ngay trên server → engine
//     dùng giá trị mới từ tick kế tiếp.
//   • item khóa (ngoài catalog) → giữ nguyên hàng read-only như trước.
// Nhóm/lý do hiển thị theo catalog server (params-store.ts) — MỘT nguồn.

import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { t, type Lang } from "@/lib/i18n";
import { RotateCcw, SlidersHorizontal } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

interface Item {
  key: string;
  type: "number" | "bool" | "string";
  value: number | boolean | string; // đang hiệu lực (override ?? default)
  view: number | boolean | string; // giá trị ở đơn vị nhập (raw / scale)
  def: number | boolean | string;
  override: number | boolean | string | null;
  min?: number;
  max?: number;
  step?: number;
  int?: boolean;
  scale?: number;
  unit?: string;
  maxLen?: number;
  pattern?: string;
  note: string;
}
interface Group {
  name: string;
  items: Item[];
}

export function ParamsEditor({ lang }: { lang: Lang }) {
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ key: string; ok: boolean; msg: string } | null>(null);
  // giá trị đang gõ theo key — giữ local để không nhảy khi poll
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/params", { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; groups?: Group[]; error?: string } | null;
      if (!res.ok || !json?.ok || !json.groups) throw new Error(json?.error ?? `HTTP ${res.status}`);
      setGroups(json.groups);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "fetch failed");
    }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(id);
  }, [load]);

  const save = useCallback(
    async (key: string, value: number | boolean | string | null) => {
      try {
        const res = await fetch("/api/params", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key, value }),
        });
        const json = (await res.json().catch(() => null)) as { ok?: boolean; groups?: Group[]; error?: string } | null;
        if (!res.ok || !json?.ok) {
          setFlash({ key, ok: false, msg: json?.error ?? t(lang, "ai.knobs.fail") });
          return;
        }
        if (json.groups) setGroups(json.groups);
        setDrafts((d) => {
          const n = { ...d };
          delete n[key];
          return n;
        });
        setFlash({ key, ok: true, msg: t(lang, "ai.knobs.saved") });
      } catch (e) {
        setFlash({ key, ok: false, msg: e instanceof Error ? e.message : t(lang, "ai.knobs.fail") });
      }
    },
    [lang],
  );

  if (err && !groups) {
    return <p className="text-[11px] text-rose-400">{t(lang, "ai.knobs.fail")}: {err}</p>;
  }
  if (!groups) {
    return <p className="text-[11px] text-zinc-500">{t(lang, "ai.knobs.loading")}</p>;
  }

  return (
    <div className="grid gap-3 pt-0 md:grid-cols-2">
      {groups.map((g) => (
        <div key={g.name} className="min-w-0 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
          <p className="flex items-center gap-1.5 text-xs font-bold text-zinc-200">
            <SlidersHorizontal className="h-3 w-3 text-teal-400" />
            {g.name}
          </p>
          <div className="mt-1.5 space-y-1.5">
            {g.items.map((it) => {
              const overridden = it.override !== null && it.override !== undefined;
              const draft = drafts[it.key];
              const shown = draft ?? String(it.view);
              const cls = overridden ? "text-amber-300" : "text-zinc-300";
              return (
                <div key={it.key} className="min-w-0">
                  <div className="flex min-w-0 items-center justify-between gap-3 text-[11px]">
                    <span className="min-w-0 shrink-0 truncate font-mono text-zinc-500" title={it.note}>
                      {it.key}
                      {overridden && (
                        <span className="ml-1 rounded bg-amber-950/60 px-1 text-[9px] font-semibold uppercase text-amber-400">
                          {t(lang, "ai.knobs.edited")}
                        </span>
                      )}
                    </span>
                    {it.type === "bool" ? (
                      <span className="flex shrink-0 items-center gap-2">
                        <Switch
                          checked={Boolean(it.value)}
                          onCheckedChange={(v) => void save(it.key, v)}
                          aria-label={it.key}
                        />
                        {overridden && (
                          <button
                            type="button"
                            title={t(lang, "ai.knobs.reset")}
                            onClick={() => void save(it.key, null)}
                            className="text-zinc-600 transition hover:text-teal-300"
                          >
                            <RotateCcw className="h-3 w-3" />
                          </button>
                        )}
                      </span>
                    ) : it.type === "string" ? (
                      <span className="flex shrink-0 items-center gap-1.5">
                        <Input
                          type="text"
                          value={shown}
                          maxLength={it.maxLen ?? 40}
                          onChange={(e) => setDrafts((d) => ({ ...d, [it.key]: e.target.value }))}
                          onBlur={() => {
                            if (draft == null) return;
                            const s = draft.trim();
                            if (!s || (it.pattern && !new RegExp(it.pattern).test(s))) {
                              setFlash({ key: it.key, ok: false, msg: t(lang, "ai.knobs.invalid") });
                              setDrafts((d) => {
                                const n = { ...d };
                                delete n[it.key];
                                return n;
                              });
                              return;
                            }
                            void save(it.key, s);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                            if (e.key === "Escape") {
                              setDrafts((d) => {
                                const n = { ...d };
                                delete n[it.key];
                                return n;
                              });
                            }
                          }}
                          className={`h-6 w-32 border-zinc-800 bg-zinc-900 px-1.5 font-mono text-[11px] uppercase ${cls}`}
                        />
                        {overridden && (
                          <button
                            type="button"
                            title={t(lang, "ai.knobs.reset")}
                            onClick={() => void save(it.key, null)}
                            className="text-zinc-600 transition hover:text-teal-300"
                          >
                            <RotateCcw className="h-3 w-3" />
                          </button>
                        )}
                      </span>
                    ) : (
                      <span className="flex shrink-0 items-center gap-1.5">
                        <Input
                          type="number"
                          value={shown}
                          min={it.min != null ? (it.scale ? it.min / it.scale : it.min) : undefined}
                          max={it.max != null ? (it.scale ? it.max / it.scale : it.max) : undefined}
                          step={it.step ?? (it.scale ? 0.5 : 1)}
                          onChange={(e) => setDrafts((d) => ({ ...d, [it.key]: e.target.value }))}
                          onBlur={() => {
                            if (draft == null) return;
                            const v = Number(draft);
                            if (!Number.isFinite(v)) {
                              setFlash({ key: it.key, ok: false, msg: t(lang, "ai.knobs.invalid") });
                              setDrafts((d) => {
                                const n = { ...d };
                                delete n[it.key];
                                return n;
                              });
                              return;
                            }
                            void save(it.key, v);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                            if (e.key === "Escape") {
                              setDrafts((d) => {
                                const n = { ...d };
                                delete n[it.key];
                                return n;
                              });
                            }
                          }}
                          className={`h-6 w-24 border-zinc-800 bg-zinc-900 px-1.5 text-right font-mono text-[11px] ${cls}`}
                        />
                        {it.unit && <span className="w-12 text-[10px] text-zinc-600">{it.unit}</span>}
                        {overridden && (
                          <button
                            type="button"
                            title={t(lang, "ai.knobs.reset")}
                            onClick={() => void save(it.key, null)}
                            className="text-zinc-600 transition hover:text-teal-300"
                          >
                            <RotateCcw className="h-3 w-3" />
                          </button>
                        )}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-[9.5px] leading-snug text-zinc-600">{it.note}</p>
                  {flash?.key === it.key && (
                    <p className={`mt-0.5 text-[9.5px] ${flash.ok ? "text-teal-400" : "text-rose-400"}`}>{flash.msg}</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
