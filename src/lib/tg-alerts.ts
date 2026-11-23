// ─── tg-alerts — 3 tầng thông báo Telegram cho auto engine (0.2.71) ──────────
// "suggest what user need to notify" — trả lời bằng cấu trúc, không phải cảm
// tính:
//   1. ALERT  🔴 sự kiện chủ bot PHẢI biết NGAY (loss streak, drawdown) —
//      KHÔNG BAO GIỜ bị mute; bắn đúng lúc chạm ngưỡng (crossing/bội N) để
//      không spam mỗi lệnh.
//   2. DIGEST 📊 hourly/daily đã gộp bảng lệnh (0.2.70) — kết quả luôn nhìn
//      được sau 1 tiếng kể cả khi mute push per-trade.
//   3. MUTE   🔕 tin rờm không hành động được (near/veto/autopsy/scan/close)
//      — tắt THEO LOẠI qua TG_MUTE, chỉnh runtime trên panel /ai.
//
// Pure helpers (lossStreakOf/ddCrossOf) tách riêng để test không chạm mạng;
// notifyClosed() là điểm dồn duy nhất sau khi đóng lệnh — thay 5 chỗ gọi
// msgClose rải rác trong engine.ts nên sửa một chỗ là ăn cả 5.

import { pval, TG_DD_ALERT, TG_MUTE, TG_STREAK_ALERT } from "./params";
import { type AutoState, type AutoTradeRow } from "./autotrade";
import { readAutoState } from "./autostate";
import { effectiveChatId, effectiveToken, tgSendMessage } from "./telegram-store";
import { msgClose, msgDrawdown, msgLossStreak } from "./tg-msgs";
import { readUnifiedSettled } from "./unified-balance";

/** các loại tin có thể bị TẮT qua TG_MUTE (alert nằm ngoài danh sách này) */
export type TgMuteCat = "near" | "veto" | "autopsy" | "scan" | "close";

/** cat này có đang bị TẮT không? — đọc runtime override mỗi lần gọi (rẻ:
 *  pval chỉ tra globalThis), token lạ/rỗng bị bỏ qua im lặng. */
export function tgMuted(cat: TgMuteCat): boolean {
  const raw = String(pval("TG_MUTE", TG_MUTE) ?? "");
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .includes(cat);
}

/** hình dạng tối thiểu một lệnh đã đóng cần cho streak/dd — đủ để test ghép */
export type ClosedLike = {
  status: string;
  exitTime?: string | Date | null;
  pnlPct?: number | null;
  capitalBefore?: number | null;
  capitalAfter?: number | null;
};

/** Các lệnh thua LIÊN TIẾP tính tới hiện tại, mới nhất trước (pnl ≤ 0 = thua —
 *  hoà không reset chuỗi; thắng cắt chuỗi ngay). lossStreakOf = .length. */
export function losingStreakTrades<T extends ClosedLike>(trades: T[]): T[] {
  const closed = trades
    .filter((x) => x.status === "closed" && x.exitTime)
    .sort((a, b) => +new Date(b.exitTime ?? 0) - +new Date(a.exitTime ?? 0));
  const out: T[] = [];
  for (const t of closed) {
    if ((t.pnlPct ?? 0) > 0) break;
    out.push(t);
  }
  return out;
}

export function lossStreakOf(trades: ClosedLike[]): number {
  return losingStreakTrades(trades).length;
}

export interface DdCross {
  peak: number;
  level: number;
  nowEq: number;
  ddPct: number;
}

/**
 * Drawdown crossing — đỉnh vốn trong cửa sổ `windowMs` (quãng đường vốn đi
 * qua capitalBefore/capitalAfter của MỌI lệnh đóng trong cửa sổ), mức báo động
 * = peak × (1 − ddPct%). Bắn ĐÚNG LẦN đường vốn đi XUỐNG qua mức đó
 * (trước đó ≥ level, bây giờ < level) — hồi phục rồi phá tiếp mới bắn lại.
 * Không đủ dữ liệu cửa sổ (cold start) → null, không đoán.
 */
export function ddCrossOf(
  trades: ClosedLike[],
  prevEq: number,
  nowEq: number,
  ddPct: number,
  windowMs: number,
  atMs: number,
): DdCross | null {
  if (!(ddPct > 0) || !(windowMs > 0)) return null;
  const win = trades.filter((x) => x.status === "closed" && x.exitTime && +new Date(x.exitTime) >= atMs - windowMs);
  if (win.length === 0) return null;
  let peak = 0;
  for (const t of win) peak = Math.max(peak, t.capitalBefore ?? 0, t.capitalAfter ?? 0);
  if (!(peak > 0)) return null;
  const level = peak * (1 - ddPct / 100);
  if (level <= 0) return null;
  if (prevEq >= level && nowEq < level) return { peak, level, nowEq, ddPct };
  return null;
}

/** tg ready check giống engine (token + chatId đều phải có) */
const tgReady = (): boolean => Boolean(effectiveToken().token && effectiveChatId().id);

/**
 * Điểm dồn SAU KHI ĐÓNG LỆNH — gọi thay cho cụm "if (tgReady) { s2 = await
 * readAutoState(); void tgSendMessage(msgClose(...)) }" lặp 5 chỗ trong
 * engine.ts: (1) push AUTO CLOSE trừ khi mute "close"; (2) 🔴 loss streak
 * khi chuỗi thua chạm bội TG_STREAK_ALERT; (3) 🔴 drawdown khi vốn cắt xuống
 * mức đỉnh 24h × (1 − TG_DD_ALERT%). Telegram là phụ — lỗi gửi không throw.
 */
export async function notifyClosed(closed: AutoTradeRow): Promise<void> {
  if (!tgReady()) return;
  try {
    const st: AutoState = await readAutoState();
    // Unified dry-run Balance (settled wallet, all paper books) — same number
    // /api/capital reports when no position is open. Live Balance comes from
    // the Binance API call, never from this helper.
    const unified = await readUnifiedSettled().catch(() => null);
    const balAfter = unified?.balance ?? st.capital ?? (closed.capitalAfter ?? 0);
    const deltaUsdt = (closed.capitalAfter ?? 0) - (closed.capitalBefore ?? 0);
    const balBefore = balAfter - deltaUsdt;
    if (!tgMuted("close")) {
      await tgSendMessage(
        msgClose(closed, unified?.closed ?? st.stats.closed, unified?.winRate ?? st.stats.winRate, unified?.netPnlPct ?? st.stats.netPnlPct, balAfter),
        "HTML",
      );
    }
    const n = pval("TG_STREAK_ALERT", TG_STREAK_ALERT);
    if (n > 0) {
      const chain = losingStreakTrades(st.trades);
      if (chain.length >= n && chain.length % n === 0) {
        await tgSendMessage(msgLossStreak(chain.length, chain, balAfter), "HTML");
      }
    }
    const dd = pval("TG_DD_ALERT", TG_DD_ALERT);
    if (dd > 0) {
      const x = ddCrossOf(st.trades, balBefore, balAfter, dd, 86_400_000, Date.now());
      if (x) await tgSendMessage(msgDrawdown(x, closed), "HTML");
    }
  } catch {
    // telegram là phụ — không chặn vòng engine
  }
}
