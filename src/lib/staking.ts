// staking.ts - SINGLE LEDGER: 1 file duy nhat cho tat ca so A/B/C/D.
// Quy uoc: wallet = von kha dung con lai (da tru stake cua cac lenh dang mo).
// Mo: stake(pct) -> stake = wallet x pct% -> wallet -= stake
// Dong: settle(stakeAmt, pnlPct) -> wallet += stakeAmt + stakeAmt x pnlPct%
// Khong dung capitalBefore / capitalAfter / lockedMargin o tung module nua.
import { bumpSettledWallet, readUnifiedSettled } from "./unified-balance";

export async function getWallet(): Promise<number> {
  const u = await readUnifiedSettled().catch(() => null);
  return u?.balance ?? 1000;
}

export async function stake(pct: number): Promise<number> {
  const wallet = await getWallet();
  const amt = Math.round(wallet * (pct / 100) * 100) / 100;
  if (amt > 0) await bumpSettledWallet(-amt).catch(() => null);
  return amt;
}

export async function settle(stakeAmt: number, pnlPct: number): Promise<number> {
  const delta = Math.round(stakeAmt * (pnlPct / 100) * 100) / 100;
  await bumpSettledWallet(stakeAmt + delta).catch(() => null);
  return await getWallet();
}
