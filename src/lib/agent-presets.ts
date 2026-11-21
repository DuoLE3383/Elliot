// ─── AGENT PRESETS — nguồn duy nhất cho UI + engine + digest Telegram ────────
// Trước đây HEDGE lệch giữa auto-panel.tsx và engine.ts
// → panel set gate 66/0.78/76 trong khi backend chạy 55/0.72/68. Một nguồn
// hết lệch sync. Chỉnh agent ở đây là cả panel, applyAgentPreset, hourly
// header cùng số.

export type AgentId = "VAULT" | "HEDGE" | "ALPHA" | "GRAIL";

export interface AgentPreset {
  riskPct: number;
  minAuc: number;
  minAcc: number;
  minScore: number;
  runTf: string[];
  cooldownMin: number;
  runnerSharePct: number;
  runnerTpMult: number;
  runnerTrailLock: number;
  slConfirmTicks: number;
}

/** Preset vận hành — engine apply khi user chọn Agent (GRAIL lock riêng). */
export const AGENT_PRESETS: Record<AgentId, AgentPreset> = {
  VAULT: {
    riskPct: 0.5,
    minAuc: 0.82,
    minAcc: 80,
    minScore: 72,
    runTf: ["15m", "1h"],
    cooldownMin: 120,
    runnerSharePct: 30,
    runnerTpMult: 2,
    runnerTrailLock: 0.7,
    slConfirmTicks: 2,
  },
  // Balanced — khớp gate đang chạy live / Telegram (55/0.72/68)
  HEDGE: {
    riskPct: 1.0,
    minAuc: 0.72,
    minAcc: 68,
    minScore: 55,
    runTf: ["5m", "15m", "1h"],
    cooldownMin: 60,
    runnerSharePct: 50,
    runnerTpMult: 2,
    runnerTrailLock: 0.5,
    slConfirmTicks: 2,
  },
  ALPHA: {
    riskPct: 2.0,
    minAuc: 0.74,
    minAcc: 72,
    minScore: 60,
    runTf: ["5m", "15m", "1h", "4h"],
    cooldownMin: 30,
    runnerSharePct: 70,
    runnerTpMult: 2.5,
    runnerTrailLock: 0.3,
    slConfirmTicks: 2,
  },
  GRAIL: {
    riskPct: 1.0,
    minAuc: 0.8,
    minAcc: 78,
    minScore: 70,
    runTf: ["15m", "1h"],
    cooldownMin: 60,
    runnerSharePct: 50,
    runnerTpMult: 2,
    runnerTrailLock: 0.5,
    slConfirmTicks: 2,
  },
};

export const AGENT_META: { id: AgentId; icon: string; desc: string }[] = [
  { id: "VAULT", icon: "🗄", desc: "Safe" },
  { id: "HEDGE", icon: "⚖", desc: "Balanced" },
  { id: "ALPHA", icon: "🚀", desc: "Aggressive" },
  { id: "GRAIL", icon: "👑", desc: "Elliott 🏵" },
];

export function agentPresetOf(id: string | null | undefined): AgentPreset {
  const k = (id || "HEDGE") as AgentId;
  return AGENT_PRESETS[k] ?? AGENT_PRESETS.HEDGE;
}

/** Header digest: [riskPct, minScore, minAuc, minAcc] */
export function agentGateTuple(id: string | null | undefined): [number, number, number, number] {
  const p = agentPresetOf(id);
  return [p.riskPct, p.minScore, p.minAuc, p.minAcc];
}

export function agentIconOf(id: string | null | undefined): string {
  const m = AGENT_META.find((x) => x.id === (id || "HEDGE"));
  return m?.icon ?? "⚖";
}
