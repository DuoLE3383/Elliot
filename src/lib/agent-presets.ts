// ─── AGENT PRESETS — nguồn duy nhất cho UI + engine + digest Telegram ────────
// Trước đây HERCULES lệch giữa auto-panel.tsx và engine.ts
// → panel set gate 66/0.78/76 trong khi backend chạy 55/0.72/68. Một nguồn
// hết lệch sync. Chỉnh agent ở đây là cả panel, applyAgentPreset, hourly
// header cùng số.

export type AgentId = "ATHENA" | "HERCULES" | "ZEUS" | "OLYMPUS";

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

/** Preset vận hành — engine apply khi user chọn Agent (OLYMPUS lock riêng). */
export const AGENT_PRESETS: Record<AgentId, AgentPreset> = {
  ATHENA: {
    riskPct: 10,
    minAuc: 0.80,
    minAcc: 78,
    minScore: 70,
    runTf: ["15m", "1h"],
    cooldownMin: 120,
    runnerSharePct: 30,
    runnerTpMult: 2,
    runnerTrailLock: 0.7,
    slConfirmTicks: 2,
  },
  // Balanced — khớp gate đang chạy live / Telegram (55/0.72/68)
  HERCULES: {
    riskPct: 10,
    minAuc: 0.74,
    minAcc: 72,
    minScore: 60,
    runTf: ["5m", "15m", "1h"],
    cooldownMin: 60,
    runnerSharePct: 50,
    runnerTpMult: 2,
    runnerTrailLock: 0.5,
    slConfirmTicks: 2,
  },
  ZEUS: {
    riskPct: 10,
    minAuc: 0.72,
    minAcc: 68,
    minScore: 55,
    runTf: ["5m", "15m", "1h", "4h"],
    cooldownMin: 30,
    runnerSharePct: 70,
    runnerTpMult: 2.5,
    runnerTrailLock: 0.3,
    slConfirmTicks: 2,
  },
  OLYMPUS: {
    riskPct: 10,
    minAuc: 0.74,
    minAcc: 72,
    minScore: 60,
    runTf: ["15m", "1h"],
    cooldownMin: 60,
    runnerSharePct: 50,
    runnerTpMult: 2,
    runnerTrailLock: 0.5,
    slConfirmTicks: 2,
  },
};

export const AGENT_META: { id: AgentId; icon: string; desc: string }[] = [
  { id: "ATHENA", icon: "♻️", desc: "Safe" },
  { id: "HERCULES", icon: "☣️", desc: "Balanced" },
  { id: "ZEUS", icon: "🔱", desc: "Aggressive" },
  { id: "OLYMPUS", icon: "👑", desc: "Elliott 🏵" },
];

export function agentPresetOf(id: string | null | undefined): AgentPreset {
  const k = (id || "HERCULES") as AgentId;
  return AGENT_PRESETS[k] ?? AGENT_PRESETS.HERCULES;
}

/** Header digest: [riskPct, minScore, minAuc, minAcc] */
export function agentGateTuple(id: string | null | undefined): [number, number, number, number] {
  const p = agentPresetOf(id);
  return [p.riskPct, p.minScore, p.minAuc, p.minAcc];
}

export function agentIconOf(id: string | null | undefined): string {
  const m = AGENT_META.find((x) => x.id === (id || "HERCULES"));
  return m?.icon ?? "⚖";
}
