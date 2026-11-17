// ─── Entry method fingerprint — tags every dry-run open for self-improve ─────
// methodId encodes the *policy* that allowed the entry (gates, stake, leverage,
// TFs, flip). Live path stats are later grouped by this id so the agent can
// measure / promote / roll back concrete policies — not vague "the model".

import { createHash } from "crypto";
import type { AutoConfig } from "./autotrade";

export interface MethodSnapshot {
  minScore: number;
  minAuc: number;
  minAcc: number;
  riskPct: number;
  leverage: number;
  tpMode: string;
  slPct: number;
  tpPct: number;
  atrCoef: number;
  runTf: string[];
  autoFlip: boolean;
  whaleFilter: boolean;
}

export function methodSnapshot(cfg: AutoConfig, leverage: number): MethodSnapshot {
  return {
    minScore: cfg.minScore,
    minAuc: cfg.minAuc,
    minAcc: cfg.minAcc,
    riskPct: cfg.riskPct,
    leverage,
    tpMode: cfg.tpMode,
    slPct: cfg.slPct,
    tpPct: cfg.tpPct,
    atrCoef: cfg.atrCoef,
    runTf: [...(cfg.runTf ?? [])].sort(),
    autoFlip: cfg.autoFlip === true,
    whaleFilter: cfg.whaleFilter !== false,
  };
}

/** Stable short id — same policy ⇒ same id across restarts. */
export function methodIdOf(snap: MethodSnapshot): string {
  const raw = [
    `sc${snap.minScore}`,
    `auc${snap.minAuc}`,
    `acc${snap.minAcc}`,
    `r${snap.riskPct}`,
    `x${snap.leverage}`,
    `tp${snap.tpMode}`,
    `sl${snap.slPct}`,
    `tpct${snap.tpPct}`,
    `atr${snap.atrCoef}`,
    `tf${snap.runTf.join(",")}`,
    `fl${snap.autoFlip ? 1 : 0}`,
    `wh${snap.whaleFilter ? 1 : 0}`,
  ].join("|");
  return createHash("sha256").update(raw).digest("hex").slice(0, 12);
}

export function methodLabel(snap: MethodSnapshot): string {
  return `sc≥${snap.minScore} auc≥${snap.minAuc} acc≥${snap.minAcc}% risk${snap.riskPct}% ×${snap.leverage} ${snap.tpMode}`;
}
