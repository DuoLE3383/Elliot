"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { t, type Lang } from "@/lib/i18n";
import { DEFAULT_SETTINGS, EngineSettings, PRESET_PINE, PRESET_WIDE } from "@/lib/types";

interface Props {
  lang: Lang;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  settings: EngineSettings;
  onApply: (s: EngineSettings) => void;
}

type PresetKey = "wide" | "pine" | "custom";

const sameSettings = (a: EngineSettings, b: EngineSettings) =>
  a.slPct === b.slPct && a.tpPct === b.tpPct && a.atrKey === b.atrKey && a.atrPeriod === b.atrPeriod && a.smaPeriod === b.smaPeriod;

export function SettingsDialog({ lang, open, onOpenChange, settings, onApply }: Props) {
  // parent remounts this component (key={open}) each time the dialog opens,
  // so lazy initializers below always start from the current settings
  const [draft, setDraft] = useState<EngineSettings>(settings);
  const [preset, setPreset] = useState<PresetKey>(() =>
    sameSettings(settings, PRESET_WIDE)
      ? "wide"
      : sameSettings(settings, PRESET_PINE)
        ? "pine"
        : "custom",
  );

  const num = (v: string, fallback: number) => {
    const n = Number(v);
    return isFinite(n) && n > 0 ? n : fallback;
  };

  const choosePreset = (key: PresetKey) => {
    setPreset(key);
    if (key === "wide") setDraft(PRESET_WIDE);
    if (key === "pine") setDraft(PRESET_PINE);
    if (key === "custom") setDraft({ ...DEFAULT_SETTINGS });
  };

  const apply = () => {
    onApply({
      slPct: Math.min(50, num(String(draft.slPct), 6)),
      tpPct: Math.min(100, num(String(draft.tpPct), 3.2)),
      atrKey: Math.min(10, num(String(draft.atrKey), 2)),
      atrPeriod: Math.min(100, Math.round(num(String(draft.atrPeriod), 10))),
      smaPeriod: Math.min(400, Math.round(num(String(draft.smaPeriod), 200))),
    });
    onOpenChange(false);
  };

  const presets: { key: PresetKey; label: string }[] = [
    { key: "wide", label: t(lang, "settings.presetWide") },
    { key: "pine", label: t(lang, "settings.presetPine") },
    { key: "custom", label: t(lang, "settings.presetCustom") },
  ];

  const fields: { key: keyof EngineSettings; label: string; step: string }[] = [
    { key: "slPct", label: t(lang, "settings.sl"), step: "0.1" },
    { key: "tpPct", label: t(lang, "settings.tp"), step: "0.1" },
    { key: "atrKey", label: t(lang, "settings.atrKey"), step: "0.1" },
    { key: "atrPeriod", label: t(lang, "settings.atrPeriod"), step: "1" },
    { key: "smaPeriod", label: t(lang, "settings.smaPeriod"), step: "10" },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-zinc-800 bg-zinc-900 text-zinc-100 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t(lang, "settings.title")}</DialogTitle>
          <DialogDescription className="text-zinc-500">{t(lang, "settings.note")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label className="text-xs text-zinc-400">{t(lang, "settings.preset")}</Label>
            <div className="mt-1.5 grid gap-1.5">
              {presets.map((p) => (
                <button
                  key={p.key}
                  onClick={() => choosePreset(p.key)}
                  className={`rounded-md border px-3 py-2 text-left text-xs transition ${
                    preset === p.key
                      ? "border-amber-600 bg-amber-950/40 text-amber-200"
                      : "border-zinc-700 bg-zinc-900 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {fields.map((f) => (
              <div key={f.key} className="space-y-1">
                <Label className="text-[11px] text-zinc-500">{f.label}</Label>
                <Input
                  type="number"
                  inputMode="decimal"
                  step={f.step}
                  min="0"
                  value={draft[f.key]}
                  disabled={preset !== "custom" && f.key !== "slPct" && f.key !== "tpPct"}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, [f.key]: e.target.value === "" ? 0 : Number(e.target.value) }))
                  }
                  className="h-8 border-zinc-700 bg-zinc-950 font-mono text-sm"
                />
              </div>
            ))}
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            className="border-zinc-700 text-zinc-300 hover:bg-zinc-800"
            onClick={() => onOpenChange(false)}
          >
            OK
          </Button>
          <Button className="bg-amber-600 text-zinc-950 hover:bg-amber-500" onClick={apply}>
            {t(lang, "settings.apply")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
