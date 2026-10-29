"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  bestTradeableAvoid,
  closeAutoTrade,
  COOLDOWN_CHOICES,
  CYCLE_CHOICES,
  fetchAutoState,
  liquidationHit,
  loadAutoConfig,
  nearHit,
  openAutoTrade,
  RISK_CHOICES,
  roeOf,
  saveAutoConfig,
  scanAll,
  sendTelegram,
  slTpHit,
  TP_MODES,
  telegramConfigured,
  telegramDiscover,
  telegramSaveChat,
  telegramStatus,
  AUTO_DEFAULTS,
  type AutoState,
  type AutoTradeRow,
  type ComboStat,
  type ScanRow,
  type TgChat,
} from "@/lib/autotrade";
import { fmtPrice, t, type Lang } from "@/lib/i18n";
import type { EngineSettings, Ticker } from "@/lib/types";
import { INTERVALS } from "@/lib/types";
import { Bot, ScanLine, Send, Square } from "lucide-react";

interface Props {
  lang: Lang;
  /** every watched pair (defaults + user customs) */
  pairs: string[];
  /** user leverage — applied to dry-run positions */
  leverage: number;
  /** live ticker prices (refreshed by the page every 30s) */
  tickers: Record<string, Ticker>;
  /** user engine settings — passed through to the trainer */
  settings: EngineSettings;
  onPickPair: (symbol: string, interval: string) => void;
  pushToast: (toast: { kind: "entry" | "flip" | "error" | "wy" | "xgb"; text: string }) => void;
}

/** rescan when the snapshot is older than this */
const SCAN_TTL = 30 * 60_000;
const TOP_N = 6;

/** humanize a seconds count — "45s" · "12m" · "2h 15m" · "3d 6h" (unit-neutral) */
const fmtLeft = (s: number): string => {
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  if (h < 24) return rm ? `${h}h ${rm}m` : `${h}h`;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return rh ? `${d}d ${rh}h` : `${d}d`;
};

// ─── Telegram message builders (HTML parse mode, trading terms) ──────────────

const HR = "━━━━━━━━━━━━━━━━━━";
const levTxt = (x: number): string => `×${x % 1 === 0 ? x : x.toFixed(1)}`;
const sideTxt = (side: string): string => (side === "LONG" ? "LONG 🟢" : side === "SHORT" ? "SHORT 🔴" : "NEUTRAL ⚪");

/** absolute SL price level for a side (price-move %, before leverage) */
const slPrice = (side: string, entry: number, slPct: number): number =>
  side === "SHORT" ? entry * (1 + Math.abs(slPct) / 100) : entry * (1 - Math.abs(slPct) / 100);
/** absolute TP price level for a side */
const tpPrice = (side: string, entry: number, tpPct: number): number =>
  side === "SHORT" ? entry * (1 - Math.abs(tpPct) / 100) : entry * (1 + Math.abs(tpPct) / 100);

const msgOpen = (r: AutoTradeRow, equity: number): string => {
  const stake = (equity * (r.stakePct ?? 100)) / 100;
  const notional = stake * r.leverage;
  const rr = r.slPct > 0 ? r.tpPct / r.slPct : 0;
  const slRoe = -(r.slPct * r.leverage);
  const tpRoe = r.tpPct * r.leverage;
  return [
    `🤖 <b>AUTO OPEN (dry-run) · ${r.side === "LONG" ? "LONG 🟢" : "SHORT 🔴"}</b>`,
    `📌 <b>#${r.symbol}</b> · ${r.interval}`,
    HR,
    `🎯 Entry: <b>${fmtPrice(r.entryPrice)}</b>`,
    `🛑 SL: <b>${fmtPrice(slPrice(r.side, r.entryPrice, r.slPct))}</b> · −${r.slPct.toFixed(1)}% giá (ROE ${slRoe.toFixed(1)}% @ ${levTxt(r.leverage)})`,
    `🏁 TP: <b>${fmtPrice(tpPrice(r.side, r.entryPrice, r.tpPct))}</b> · +${r.tpPct.toFixed(1)}% giá (ROE +${tpRoe.toFixed(1)}% @ ${levTxt(r.leverage)})`,
    `⚖️ Leverage ${levTxt(r.leverage)} · R:R 1:${rr.toFixed(2)}`,
    `📦 Stake: <b>${stake.toFixed(2)}</b> USDT · ${r.stakePct ?? 100}% equity · Notional ${notional.toFixed(2)} USDT`,
    `🧠 Prob ${((r.prob ?? 0) * 100).toFixed(1)}% · AUC ${(r.auc ?? 0).toFixed(2)} · ACC ${(r.acc ?? 0).toFixed(1)}% · Score ${(r.score ?? 0).toFixed(1)}`,
  ].join("\n");
};

const kindTag = (k: string | null): string =>
  k === "tp" ? "TAKE PROFIT ✅" : k === "sl" ? "STOP LOSS 🔻" : "ĐÓNG THỦ CÔNG ✋";

const msgClose = (r: AutoTradeRow, closed: number, winRate: number, netPnlPct: number): string =>
  [
    `🤖 <b>AUTO CLOSE · ${kindTag(r.exitKind)}</b>`,
    `📌 <b>#${r.symbol}</b> · ${r.interval} · ${sideTxt(r.side)}`,
    HR,
    `🎯 Entry ${fmtPrice(r.entryPrice)} → 🚪 Exit <b>${fmtPrice(r.exitPrice ?? 0)}</b>`,
    `💵 PnL (ROE): <b>${(r.pnlPct ?? 0) >= 0 ? "+" : ""}${(r.pnlPct ?? 0).toFixed(2)}%</b>`,
    `💰 Equity: ${(r.capitalBefore ?? 0).toFixed(2)} → <b>${(r.capitalAfter ?? 0).toFixed(2)}</b> USDT`,
    `📈 Track record: ${closed} lệnh · Win rate ${winRate.toFixed(0)}% · Net ROE ${netPnlPct >= 0 ? "+" : ""}${netPnlPct.toFixed(1)}%`,
  ].join("\n");

const msgScan = (rows: ScanRow[], nPairs: number, nTf: number): string => {
  const medals = ["1️⃣", "2️⃣", "3️⃣"];
  const top = rows
    .slice(0, 3)
    .map(
      (r, i) =>
        `${medals[i]} <b>${r.symbol}</b> ${r.interval} ${sideTxt(r.bias)} · Score <b>${r.score.toFixed(1)}</b>${
          i === 0 ? ` · AUC ${r.auc.toFixed(2)} · ACC ${r.acc.toFixed(1)}%` : ""
        }`,
    )
    .join("\n");
  const best = rows[0];
  return [
    `📊 <b>AUTO SCAN · ${nPairs} pair × ${nTf} TF</b>`,
    `✅ ${rows.length}/${nPairs * nTf} combo đạt chuẩn dữ liệu`,
    HR,
    best ? "🏆 <b>Top setups:</b>" : "Không có combo hợp lệ",
    top,
  ]
    .filter(Boolean)
    .join("\n");
};

const TEST_MSG =
  "✅ <b>Elliott Terminal — kết nối Telegram OK</b>\nAuto trade (dry-run) sẽ báo mở/đóng lệnh, cảnh báo sát TP/SL, kết quả quét và báo cáo thống kê tại kênh này.";

const msgNear = (r: AutoTradeRow, price: number, kind: "tp" | "sl"): string => {
  const target = kind === "tp" ? tpPrice(r.side, r.entryPrice, r.tpPct) : slPrice(r.side, r.entryPrice, r.slPct);
  const awayPct = price > 0 ? Math.abs((target - price) / price) * 100 : 0;
  const roe = roeOf(r.side, r.entryPrice, price, r.leverage);
  return [
    kind === "tp" ? "⚠️ <b>GIÁ SÁT TAKE PROFIT — SẴN SÀNG CHỐT LỜI</b>" : "⚠️ <b>GIÁ SÁT STOP LOSS — THEO DÕI RỦI RO</b>",
    `📌 <b>#${r.symbol}</b> · ${r.interval} · ${sideTxt(r.side)}`,
    HR,
    `${kind === "tp" ? "🏁" : "🛑"} ${kind === "tp" ? "Take Profit" : "Stop Loss"} ${fmtPrice(target)} · còn <b>${awayPct.toFixed(2)}%</b>`,
    `📈 Giá ${fmtPrice(price)} · ROE <b>${roe >= 0 ? "+" : ""}${roe.toFixed(1)}%</b> · Lev ${levTxt(r.leverage)}`,
  ].join("\n");
};

const statLines = (st: AutoState, sinceMs: number, title: string, periodLabel: string): string[] => {
  const recent = st.trades.filter((x) => x.status === "closed" && x.exitTime && new Date(x.exitTime).getTime() >= sinceMs);
  const wins = recent.filter((x) => (x.pnlPct ?? 0) > 0).length;
  const net = recent.reduce((a, x) => a + (x.pnlPct ?? 0), 0);
  const lines = [
    title,
    HR,
    `📊 ${periodLabel}: <b>${recent.length} lệnh</b> · Win rate <b>${recent.length ? Math.round((wins / recent.length) * 100) : 0}%</b> · Net ROE <b>${net >= 0 ? "+" : ""}${net.toFixed(2)}%</b>`,
  ];
  if (st.open) lines.push(`🔓 Đang giữ: <b>#${st.open.symbol}</b> ${st.open.interval} ${sideTxt(st.open.side)} @ ${fmtPrice(st.open.entryPrice)}`);
  lines.push(
    `💰 Equity: <b>${st.capital != null ? st.capital.toFixed(2) : "?"}</b> USDT · Tổng ${st.stats.closed} lệnh · WR ${st.stats.winRate.toFixed(0)}%`,
  );
  const best = (st.byCombo ?? []).filter((c) => c.closed >= 3).sort((a, b) => b.winRate - a.winRate)[0];
  if (best) lines.push(`🏆 Combo tốt nhất: <b>#${best.symbol}</b> ${best.interval} · WR ${best.winRate.toFixed(0)}% (${best.closed} lệnh)`);
  return lines;
};

const pad2 = (n: number): string => String(n).padStart(2, "0");

const msgHourly = (st: AutoState, now: Date): string =>
  statLines(st, now.getTime() - 3_600_000, `⏰ <b>BÁO CÁO GIỜ · ${pad2(now.getHours())}:00</b>`, "1 giờ qua").join("\n");

const msgDaily = (st: AutoState, now: Date): string =>
  statLines(st, now.getTime() - 86_400_000, `📅 <b>BÁO CÁO NGÀY · ${pad2(now.getDate())}/${pad2(now.getMonth() + 1)}</b>`, "24 giờ qua").join("\n");

// ─── Component ────────────────────────────────────────────────────────────────

export function AutoPanel({ lang, pairs, leverage, tickers, settings, onPickPair, pushToast }: Props) {
  const [cfg, setCfg] = useState<AutoConfig>(loadAutoConfigSafe());
  const [rows, setRows] = useState<ScanRow[]>([]);
  const [scanAt, setScanAt] = useState<number | null>(null);
  const [scanning, setScanning] = useState<{ done: number; total: number; current: string } | null>(null);
  const [auto, setAuto] = useState<AutoState | null>(null);
  const [tgConfigured, setTgConfigured] = useState<boolean | null>(null);
  const [tgState, setTgState] = useState<"idle" | "sending" | "ok" | "fail">("idle");
  const [tgDetail, setTgDetail] = useState<string | null>(null);
  const [tgHelp, setTgHelp] = useState(false); // step-by-step connect guide (chat not found)
  const [tgChatId, setTgChatId] = useState<string | null>(null); // effective channel
  const [tgChats, setTgChats] = useState<TgChat[] | null>(null); // discover result
  const [tgDiscovering, setTgDiscovering] = useState(false);
  const [tgSaving, setTgSaving] = useState(false);
  const [status, setStatus] = useState<string>("");
  const [countdown, setCountdown] = useState<number | null>(null);

  // refs mirror props/state for the interval callbacks (no stale closures,
  // and the cycle interval is NOT reset every time a prop changes)
  const cfgRef = useRef(cfg);
  const rowsRef = useRef(rows);
  const scanAgeRef = useRef(scanAt);
  const tickersRef = useRef(tickers);
  const pairsRef = useRef(pairs);
  const settingsRef = useRef(settings);
  const leverageRef = useRef(leverage);
  const langRef = useRef(lang);
  const busyRef = useRef(false);
  const scanBusyRef = useRef(false);
  const closingRef = useRef(false);
  const mountedRef = useRef(true);
  const nextAtRef = useRef<number>(0);
  // near-hit warning state — one shot per side per position (persisted so a
  // page reload does not re-warn about the same position)
  const warnedRef = useRef<{ id: string; tp: boolean; sl: boolean }>({ id: "", tp: false, sl: false });
  const statBusyRef = useRef(false);
  const lastHourRef = useRef("");
  const lastDayRef = useRef("");

  useEffect(() => {
    cfgRef.current = cfg;
  }, [cfg]);
  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);
  useEffect(() => {
    scanAgeRef.current = scanAt;
  }, [scanAt]);
  useEffect(() => {
    tickersRef.current = tickers;
  }, [tickers]);
  useEffect(() => {
    pairsRef.current = pairs;
  }, [pairs]);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);
  useEffect(() => {
    leverageRef.current = leverage;
  }, [leverage]);
  useEffect(() => {
    langRef.current = lang;
  }, [lang]);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refreshAuto = useCallback(async (): Promise<AutoState | null> => {
    try {
      const st = await fetchAutoState();
      if (mountedRef.current) setAuto(st);
      return st;
    } catch {
      return null;
    }
  }, []);

  // mirror for the 15s watcher (no stale closures)
  const autoRef = useRef<AutoState | null>(null);
  useEffect(() => {
    autoRef.current = auto;
  }, [auto]);

  /** Close an open dry-run position — shared by the cycle and the intra-cycle watcher. */
  const closeOpen = useCallback(
    async (open: AutoTradeRow, price: number, kind: "sl" | "tp" | "manual"): Promise<AutoTradeRow | null> => {
      if (closingRef.current) return null;
      closingRef.current = true;
      try {
        const closed = await closeAutoTrade(open.id, price, kind);
        if (closed && mountedRef.current) {
          const st = await refreshAuto(); // stats now include this close
          pushToast({
            kind: "flip",
            text: t(langRef.current, "auto.closed", { pair: closed.symbol, tf: closed.interval, pnl: (closed.pnlPct ?? 0).toFixed(2) }),
          });
          void sendTelegram(msgClose(closed, st?.stats.closed ?? 0, st?.stats.winRate ?? 0, st?.stats.netPnlPct ?? 0));
        }
        return closed;
      } finally {
        closingRef.current = false;
      }
    },
    [refreshAuto, pushToast],
  );

  // initial load — position book + telegram configuration probe
  useEffect(() => {
    void refreshAuto();
    void telegramConfigured().then((ok) => mountedRef.current && setTgConfigured(ok));
    void telegramStatus().then((s) => mountedRef.current && setTgChatId(s.chatId));
    // start clocks at the CURRENT hour/day so the first digest goes out at the
    // next boundary, not the second the app opens
    const now = new Date();
    lastHourRef.current = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}`;
    lastDayRef.current = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
    try {
      const raw = localStorage.getItem("utp.auto.warn");
      if (raw) warnedRef.current = JSON.parse(raw) as { id: string; tp: boolean; sl: boolean };
    } catch {
      // stale/corrupt flag — start fresh
    }
  }, [refreshAuto]);

  const doScan = useCallback(async (): Promise<ScanRow[]> => {
    if (scanBusyRef.current) return rowsRef.current;
    scanBusyRef.current = true;
    setScanning({ done: 0, total: pairsRef.current.length * INTERVALS.length, current: "" });
    try {
      const out = await scanAll({
        pairs: pairsRef.current,
        settings: settingsRef.current,
        onProgress: (p) => mountedRef.current && setScanning(p),
      });
      if (mountedRef.current) {
        setRows(out);
        setScanAt(Date.now());
      }
      if (out.length > 0) {
        void sendTelegram(msgScan(out, pairsRef.current.length, INTERVALS.length));
      }
      return out;
    } finally {
      scanBusyRef.current = false;
      if (mountedRef.current) setScanning(null);
    }
  }, []);

  // ── one auto cycle: manage the open position, then maybe enter the best pick
  const runCycle = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    const c = cfgRef.current;
    try {
      const st = await refreshAuto();
      if (!st) {
        setStatus("DB error");
        return;
      }

      // 1) manage the open position against the live price
      if (st.open) {
        const open = st.open;
        const price = tickersRef.current[open.symbol]?.price ?? 0;
        if (price > 0) {
          const kind = slTpHit(open.side, price, open.entryPrice, open.slPct, open.tpPct);
          const liq = liquidationHit(open.side, price, open.entryPrice, open.leverage);
          if (kind || liq) {
            await closeOpen(open, price, liq ? "sl" : (kind ?? "sl"));
          } else {
            const roe = roeOf(open.side, open.entryPrice, price, open.leverage);
            setStatus(`${open.symbol} ${open.interval} ${open.side} · ROE ${roe >= 0 ? "+" : ""}${roe.toFixed(2)}%`);
          }
        }
        return; // one position at a time — no new entry while one is open
      }

      // 2) no open position → rank the scan and enter the best tradeable row
      let current = rowsRef.current;
      if (current.length === 0 || Date.now() - (scanAgeRef.current ?? 0) > SCAN_TTL) {
        setStatus(t(langRef.current, "auto.scan.busy", { done: 0, total: pairsRef.current.length * INTERVALS.length, current: "…" }));
        current = await doScan();
      }
      if (current.length === 0) {
        setStatus(t(langRef.current, "auto.scan.empty"));
        return;
      }
      const { best, allInCooldown } = bestTradeableAvoid(current, c.minAuc, c.minAcc, st.trades, c.cooldownMin);
      if (!best) {
        setStatus(allInCooldown ? t(langRef.current, "auto.cooldown.all") : t(langRef.current, "auto.rank.hint"));
        return;
      }
      const price = tickersRef.current[best.symbol]?.price ?? 0;
      if (price <= 0) return; // no live price for that pair — wait for the next cycle
      const capitalNow = (await refreshAuto())?.capital ?? c.capital;
      const trade = await openAutoTrade({
        symbol: best.symbol,
        interval: best.interval,
        side: best.bias,
        entryPrice: price,
        // manual mode overrides the per-proposal ATR levels with fixed ones
        slPct: c.tpMode === "manual" ? c.slPct : best.slPct,
        tpPct: c.tpMode === "manual" ? c.tpPct : best.tpPct,
        stakePct: c.riskPct,
        leverage: leverageRef.current,
        prob: best.prob,
        acc: best.acc,
        auc: best.auc,
        score: best.score,
        capitalBefore: capitalNow,
      });
      if (trade) {
        pushToast({
          kind: "entry",
          text: t(langRef.current, "auto.opened", { side: trade.side, pair: trade.symbol, tf: trade.interval, price: fmtPrice(trade.entryPrice) }),
        });
        void sendTelegram(msgOpen(trade, capitalNow));
        await refreshAuto();
        setStatus(`${trade.symbol} ${trade.interval} ${trade.side} @ ${fmtPrice(trade.entryPrice)}`);
      }
    } finally {
      busyRef.current = false;
      nextAtRef.current = Date.now() + cfgRef.current.cycleMin * 60_000;
    }
  }, [closeOpen, doScan, pushToast, refreshAuto]);

  // auto cycle — immediate tick on enable, then every cycleMin minutes
  useEffect(() => {
    if (!cfg.on) {
      setCountdown(null);
      return;
    }
    nextAtRef.current = Date.now() + 2_000;
    void runCycle();
    const id = window.setInterval(() => void runCycle(), cfg.cycleMin * 60_000);
    return () => window.clearInterval(id);
  }, [cfg.on, cfg.cycleMin, runCycle]);

  // intra-cycle watcher — SL/TP/liquidation can hit BETWEEN cycles; this books
  // them within ~15s from the live tickers instead of waiting for the next
  // full cycle, then kicks a fresh entry a few seconds later. It also fires
  // the one-shot "approaching TP/SL" Telegram warning (70% of the way there).
  useEffect(() => {
    if (!cfg.on) return;
    const id = window.setInterval(() => {
      const open = autoRef.current?.open;
      if (!open || busyRef.current || closingRef.current) return;
      const price = tickersRef.current[open.symbol]?.price ?? 0;
      if (price <= 0) return;
      const kind = slTpHit(open.side, price, open.entryPrice, open.slPct, open.tpPct);
      const liq = liquidationHit(open.side, price, open.entryPrice, open.leverage);
      if (kind || liq) {
        void closeOpen(open, price, liq ? "sl" : (kind ?? "sl")).then((closed) => {
          if (closed && cfgRef.current.on) {
            window.setTimeout(() => void runCycle(), 3_000);
          }
        });
        return;
      }
      // near-hit warning — once per side per position
      if (warnedRef.current.id !== open.id) {
        warnedRef.current = { id: open.id, tp: false, sl: false };
        try {
          localStorage.setItem("utp.auto.warn", JSON.stringify(warnedRef.current));
        } catch {
          // storage blocked — flags live for this session only
        }
      }
      const near = nearHit(open.side, price, open.entryPrice, open.slPct, open.tpPct);
      if (near && !warnedRef.current[near]) {
        warnedRef.current[near] = true;
        try {
          localStorage.setItem("utp.auto.warn", JSON.stringify(warnedRef.current));
        } catch {
          // storage blocked — flags live for this session only
        }
        void sendTelegram(msgNear(open, price, near));
        pushToast({
          kind: "wy",
          text: t(
            langRef.current,
            near === "tp" ? "auto.near.tp" : "auto.near.sl",
            { pair: open.symbol, tf: open.interval, roe: roeOf(open.side, open.entryPrice, price, open.leverage).toFixed(1) },
          ),
        });
      }
    }, 15_000);
    return () => window.clearInterval(id);
  }, [cfg.on, closeOpen, runCycle, pushToast]);

  // hourly / daily Telegram digests — checked every minute; each boundary
  // (top of the hour, calendar day) sends exactly one stats message.
  // force=true → skip the boundary check (manual "send now" button).
  const sendPeriodicStats = useCallback(async (force = false) => {
    if (statBusyRef.current) return;
    const c = cfgRef.current;
    const now = new Date();
    const hourKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}`;
    const dayKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
    if (force) {
      statBusyRef.current = true;
      try {
        lastHourRef.current = hourKey;
        lastDayRef.current = dayKey;
        const st = await refreshAuto();
        if (st) {
          void sendTelegram(
            statLines(st, now.getTime() - 86_400_000, `📊 <b>AUTO THỐNG KÊ · ${pad2(now.getHours())}:${pad2(now.getMinutes())}</b>`, "24 giờ qua").join("\n"),
          );
        }
      } finally {
        statBusyRef.current = false;
      }
      return;
    }
    const dueHour = c.statHourly && lastHourRef.current !== hourKey;
    const dueDay = c.statDaily && lastDayRef.current !== dayKey;
    if (!dueHour && !dueDay) return;
    statBusyRef.current = true;
    try {
      const st = await refreshAuto();
      if (!st) return;
      if (dueHour) {
        lastHourRef.current = hourKey;
        void sendTelegram(msgHourly(st, now));
      }
      if (dueDay) {
        lastDayRef.current = dayKey;
        void sendTelegram(msgDaily(st, now));
      }
    } finally {
      statBusyRef.current = false;
    }
  }, [refreshAuto]);

  useEffect(() => {
    const id = window.setInterval(() => void sendPeriodicStats(), 60_000);
    return () => window.clearInterval(id);
  }, [sendPeriodicStats]);

  // 1 s countdown to the next cycle
  useEffect(() => {
    if (!cfg.on) return;
    const id = window.setInterval(() => {
      const left = Math.max(0, Math.round((nextAtRef.current - Date.now()) / 1000));
      setCountdown(left);
    }, 1000);
    return () => window.clearInterval(id);
  }, [cfg.on]);

  const updateCfg = (patch: Partial<AutoConfig>) => {
    setCfg((prev) => {
      const next = { ...prev, ...patch };
      saveAutoConfig(next);
      return next;
    });
  };

  const checkTg = async () => {
    setTgState("sending");
    setTgDetail(null);
    const r = await sendTelegram(TEST_MSG);
    if (r.ok) {
      setTgState("ok");
      setTgHelp(false);
      setTgChats(null);
      pushToast({ kind: "xgb", text: t(lang, "auto.tg.sent") });
    } else {
      setTgState("fail");
      setTgDetail(r.detail ?? null);
      if (/chat not found/i.test(r.detail ?? "")) {
        setTgHelp(true); // persistent in-panel guide — a toast disappears too fast
        void telegramStatus().then((s) => mountedRef.current && setTgChatId(s.chatId)); // refresh possibly-stale channel label
      }
      pushToast({
        kind: "error",
        text: /chat not found/i.test(r.detail ?? "")
          ? t(lang, "auto.err.chat")
          : t(lang, "auto.tg.err", { detail: r.detail ?? "?" }),
      });
    }
  };

  // ask the bot which chats it can see → user picks the real channel
  const discoverChats = async () => {
    setTgDiscovering(true);
    const d = await telegramDiscover();
    if (mountedRef.current) {
      setTgChats(d.chats);
      if (d.bot) setTgDetail(d.bot);
    }
    setTgDiscovering(false);
  };

  // persist the picked chat id, then re-test immediately
  const applyChat = async (id: string) => {
    setTgSaving(true);
    const saved = await telegramSaveChat(id);
    if (saved && mountedRef.current) {
      setTgChatId(id);
      pushToast({ kind: "xgb", text: t(lang, "auto.tg.help.saved", { id }) });
      setTgSaving(false);
      void checkTg();
      return;
    }
    setTgSaving(false);
    pushToast({ kind: "error", text: t(lang, "auto.tg.err", { detail: "save failed" }) });
  };

  const closeNow = async () => {
    const open = auto?.open;
    if (!open || busyRef.current) return;
    const price = tickers[open.symbol]?.price ?? open.entryPrice;
    const closed = await closeAutoTrade(open.id, price, "manual");
    if (closed) {
      pushToast({
        kind: "flip",
        text: t(lang, "auto.closed", { pair: closed.symbol, tf: closed.interval, pnl: (closed.pnlPct ?? 0).toFixed(2) }),
      });
      void sendTelegram(msgClose(closed, auto?.stats.closed ?? 0, auto?.stats.winRate ?? 0, auto?.stats.netPnlPct ?? 0));
      await refreshAuto();
    }
  };

  const capitalNow = auto?.capital ?? cfg.capital;
  const open = auto?.open ?? null;
  const best = rows.length > 0 ? rows[0] : null;
  const closedHist = (auto?.trades ?? []).filter((x) => x.status === "closed").slice(0, 4);
  const sideClass = (side: string) => (side === "LONG" ? "text-emerald-400" : "text-rose-400");

  return (
    <Card className="border-zinc-800 bg-zinc-900/60">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-1.5 text-base font-semibold text-zinc-100">
            <Bot className="h-4 w-4 text-teal-400" />
            {t(lang, "auto.title")}
            {cfg.on && <span className="ml-1 inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-400" aria-hidden />}
          </CardTitle>
          <div className="flex items-center gap-2">
            {tgConfigured != null && (
              <span
                className={`h-2 w-2 rounded-full ${tgConfigured ? "bg-teal-400" : "bg-zinc-600"}`}
                title={tgConfigured ? t(lang, "auto.tg.ok") : t(lang, "auto.tg.none")}
                aria-hidden
              />
            )}
            <Switch checked={cfg.on} onCheckedChange={(v) => updateCfg({ on: v })} aria-label={t(lang, "auto.on")} />
          </div>
        </div>
        <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500">{t(lang, "auto.sub")}</p>
      </CardHeader>

      <CardContent className="space-y-3 pt-0">
        {/* config — risk control first: equity share per trade + TP/SL source */}
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-[11px] text-zinc-500">
            {t(lang, "auto.cfg.capital")}
            <Input
              type="number"
              min={1}
              value={cfg.capital}
              onChange={(e) => updateCfg({ capital: Math.max(1, Number(e.target.value) || 0) })}
              className="h-7 w-24 border-zinc-800 bg-zinc-950/60 px-2 font-mono text-xs text-zinc-100"
            />
          </label>
          <div className="flex items-center gap-1" role="group" aria-label={t(lang, "auto.cfg.risk")}>
            <span className="mr-0.5 text-[11px] text-zinc-500">{t(lang, "auto.cfg.risk")}</span>
            {RISK_CHOICES.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => updateCfg({ riskPct: p })}
                className={`h-7 rounded-md border px-2 font-mono text-[11px] ${
                  cfg.riskPct === p
                    ? "border-teal-700 bg-teal-950/40 text-teal-300"
                    : "border-zinc-800 bg-zinc-950/40 text-zinc-400 hover:bg-zinc-800"
                }`}
              >
                {p}%
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1" role="group" aria-label={t(lang, "auto.cfg.tpmode")}>
            <span className="mr-0.5 text-[11px] text-zinc-500">TP/SL</span>
            {TP_MODES.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => updateCfg({ tpMode: m })}
                className={`h-7 rounded-md border px-2 text-[11px] ${
                  cfg.tpMode === m
                    ? "border-teal-700 bg-teal-950/40 text-teal-300"
                    : "border-zinc-800 bg-zinc-950/40 text-zinc-400 hover:bg-zinc-800"
                }`}
              >
                {t(lang, m === "auto" ? "auto.cfg.tpAuto" : "auto.cfg.tpManual")}
              </button>
            ))}
            {cfg.tpMode === "manual" && (
              <label className="flex items-center gap-1 text-[11px] text-zinc-500">
                SL
                <Input
                  type="number"
                  min={0.2}
                  max={20}
                  step={0.1}
                  value={cfg.slPct}
                  onChange={(e) => updateCfg({ slPct: Math.min(20, Math.max(0.2, Number(e.target.value) || 1)) })}
                  className="h-7 w-14 border-rose-900/60 bg-zinc-950/60 px-1.5 font-mono text-xs text-rose-300"
                />
                TP
                <Input
                  type="number"
                  min={0.2}
                  max={30}
                  step={0.1}
                  value={cfg.tpPct}
                  onChange={(e) => updateCfg({ tpPct: Math.min(30, Math.max(0.2, Number(e.target.value) || 1.5)) })}
                  className="h-7 w-14 border-emerald-900/60 bg-zinc-950/60 px-1.5 font-mono text-xs text-emerald-300"
                />
                %
              </label>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1" role="group" aria-label={t(lang, "auto.cfg.cycle")}>
            <span className="mr-0.5 text-[11px] text-zinc-500">{t(lang, "auto.cfg.cycle")}</span>
            {CYCLE_CHOICES.map((c) => (
              <button
                key={c.m}
                type="button"
                onClick={() => updateCfg({ cycleMin: c.m })}
                className={`h-7 rounded-md border px-2 font-mono text-[11px] ${
                  cfg.cycleMin === c.m
                    ? "border-teal-700 bg-teal-950/40 text-teal-300"
                    : "border-zinc-800 bg-zinc-950/40 text-zinc-400 hover:bg-zinc-800"
                }`}
              >
                {c.label}
              </button>
            ))}
            {cfg.cycleMin < 60 && <span className="text-[11px] text-zinc-600">{t(lang, "auto.cfg.cycleUnit")}</span>}
          </div>
          <div className="flex items-center gap-1" role="group" aria-label={t(lang, "auto.cfg.cooldown")}>
            <span className="mr-0.5 text-[11px] text-zinc-500">{t(lang, "auto.cfg.cooldown")}</span>
            {COOLDOWN_CHOICES.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => updateCfg({ cooldownMin: m })}
                className={`h-7 rounded-md border px-2 font-mono text-[11px] ${
                  cfg.cooldownMin === m
                    ? "border-teal-700 bg-teal-950/40 text-teal-300"
                    : "border-zinc-800 bg-zinc-950/40 text-zinc-400 hover:bg-zinc-800"
                }`}
              >
                {m === 0 ? t(lang, "auto.cfg.cooldownOff") : m}
              </button>
            ))}
            <span className="text-[11px] text-zinc-600">{t(lang, "auto.cfg.cooldownUnit")}</span>
          </div>
          <div className="flex items-center gap-1" role="group" aria-label={t(lang, "auto.cfg.stats")}>
            <span className="mr-0.5 text-[11px] text-zinc-500">{t(lang, "auto.cfg.stats")}</span>
            {([
              ["statHourly", "auto.cfg.statHourly"],
              ["statDaily", "auto.cfg.statDaily"],
            ] as const).map(([key, ikey]) => (
              <button
                key={key}
                type="button"
                onClick={() => updateCfg({ [key]: !cfg[key] })}
                aria-pressed={cfg[key]}
                className={`h-7 rounded-md border px-2 font-mono text-[11px] ${
                  cfg[key]
                    ? "border-teal-700 bg-teal-950/40 text-teal-300"
                    : "border-zinc-800 bg-zinc-950/40 text-zinc-400 hover:bg-zinc-800"
                }`}
              >
                {t(lang, ikey)}
              </button>
            ))}
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-[11px] text-zinc-400 hover:bg-zinc-800"
              disabled={tgState === "sending"}
              title={t(lang, "auto.cfg.statNowTip")}
              onClick={() => void sendPeriodicStats(true)}
            >
              <Send className="mr-1 h-3 w-3" />
              {t(lang, "auto.cfg.statNow")}
            </Button>
          </div>
        </div>

        {/* scan actions */}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            className="h-8 bg-teal-600 text-zinc-950 hover:bg-teal-500 disabled:opacity-50"
            disabled={scanning != null || pairs.length === 0}
            onClick={() => void doScan()}
          >
            <ScanLine className="mr-1.5 h-3.5 w-3.5" />
            {t(lang, "auto.scan")} ({pairs.length}×{INTERVALS.length})
          </Button>
          <Button size="sm" variant="outline" className="h-8 border-zinc-700 text-[11px] text-zinc-300 hover:bg-zinc-800" disabled={tgState === "sending"} onClick={() => void checkTg()}>
            <Send className="mr-1.5 h-3 w-3" />
            {t(lang, "auto.tg.check")}
          </Button>
          {scanAt != null && !scanning && (
            <span className="text-[11px] text-zinc-600">
              {t(lang, "auto.scan.ago", { time: new Date(scanAt).toLocaleTimeString(lang === "vi" ? "vi-VN" : "en-GB", { hour: "2-digit", minute: "2-digit" }) })}
            </span>
          )}
        </div>

        {/* telegram connect guide — appears when the channel is unreachable */}
        {tgHelp && (
          <div className="space-y-2 rounded-lg border border-teal-800/50 bg-teal-950/20 p-2.5">
            <div className="flex flex-wrap items-center justify-between gap-1.5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-teal-300">{t(lang, "auto.tg.help.title")}</p>
              {tgChatId && <span className="font-mono text-[10px] text-zinc-500">{t(lang, "auto.tg.current", { id: tgChatId })}</span>}
            </div>
            <ol className="list-decimal space-y-0.5 pl-4 text-[11px] leading-relaxed text-zinc-400">
              <li>{t(lang, "auto.tg.help.s1")}</li>
              <li>{t(lang, "auto.tg.help.s2")}</li>
              <li>{t(lang, "auto.tg.help.s3")}</li>
            </ol>
            {tgDetail && <p className="font-mono text-[10px] text-zinc-500">{tgDetail}</p>}
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                className="h-7 border-teal-700 text-[11px] text-teal-300 hover:bg-teal-950/40"
                disabled={tgDiscovering}
                onClick={() => void discoverChats()}
              >
                <ScanLine className="mr-1.5 h-3 w-3" />
                {tgDiscovering ? t(lang, "auto.tg.help.finding") : t(lang, "auto.tg.help.find")}
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-[11px] text-zinc-400 hover:bg-zinc-800" onClick={() => setTgHelp(false)}>
                {t(lang, "auto.tg.help.hide")}
              </Button>
            </div>
            {tgChats != null &&
              (tgChats.length === 0 ? (
                <p className="text-[11px] leading-relaxed text-zinc-500">{t(lang, "auto.tg.help.none")}</p>
              ) : (
                <div className="space-y-1">
                  <p className="text-[10px] uppercase tracking-wide text-zinc-500">{t(lang, "auto.tg.help.found", { n: tgChats.length })}</p>
                  {tgChats.map((c) => (
                    <div key={c.id} className="flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-950/60 px-2 py-1">
                      <span className="truncate text-[11px] text-zinc-200">{c.title}</span>
                      <span className="shrink-0 font-mono text-[10px] text-zinc-500">{c.id}</span>
                      <span className="shrink-0 text-[9px] uppercase text-zinc-600">{c.type}</span>
                      {c.id === tgChatId ? (
                        <span className="ml-auto shrink-0 text-[10px] text-teal-400">{t(lang, "auto.tg.help.active")}</span>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          className="ml-auto h-6 shrink-0 border-teal-700 px-2 text-[10px] text-teal-300 hover:bg-teal-950/40"
                          disabled={tgSaving}
                          onClick={() => void applyChat(c.id)}
                        >
                          {t(lang, "auto.tg.help.use")}
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              ))}
          </div>
        )}
        {scanning && (
          <div className="space-y-1">
            <p className="font-mono text-[11px] text-teal-300">
              {t(lang, "auto.scan.busy", { done: scanning.done, total: scanning.total, current: scanning.current })}
            </p>
            <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
              <div className="h-full rounded-full bg-teal-500 transition-all" style={{ width: `${scanning.total ? (scanning.done / scanning.total) * 100 : 0}%` }} />
            </div>
          </div>
        )}
        {cfg.on && countdown != null && (
          <p className="text-[11px] text-zinc-500">
            {countdown < 120
              ? t(lang, "auto.cycle.next", { s: countdown })
              : t(lang, "auto.cycle.nextH", { t: fmtLeft(countdown) })}
            {status && <span className="font-mono text-zinc-400">· {status}</span>}
          </p>
        )}
        {!cfg.on && status && <p className="font-mono text-[11px] text-zinc-500">{status}</p>}

        {/* best pick + ranking */}
        {best ? (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between rounded-lg border border-teal-800/60 bg-teal-950/20 px-2.5 py-1.5">
              <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-teal-400">
                {t(lang, "auto.best")}
              </span>
              <button
                type="button"
                className="font-mono text-xs font-bold text-zinc-100 hover:text-teal-300"
                onClick={() => onPickPair(best.symbol, best.interval)}
              >
                {best.symbol} {best.interval} <span className={sideClass(best.bias)}>{best.bias}</span> · {best.score.toFixed(1)}
              </button>
            </div>
            <div className="overflow-hidden rounded-lg border border-zinc-800">
              <div className="grid grid-cols-[1fr_26px_44px_44px_38px_38px_40px] gap-x-1 border-b border-zinc-800 bg-zinc-950/60 px-2 py-1 text-[9px] font-semibold uppercase tracking-wide text-zinc-500">
                <span>{t(lang, "auto.col.pair")}</span>
                <span>{t(lang, "auto.col.tf")}</span>
                <span>{t(lang, "auto.col.side")}</span>
                <span className="text-right">{t(lang, "auto.col.prob")}</span>
                <span className="text-right">{t(lang, "auto.col.auc")}</span>
                <span className="text-right">{t(lang, "auto.col.acc")}</span>
                <span className="text-right">{t(lang, "auto.col.score")}</span>
              </div>
              {rows.slice(0, TOP_N).map((r, i) => {
                const tradeable = r.bias !== "NEUTRAL" && r.auc >= cfg.minAuc && r.acc >= cfg.minAcc;
                return (
                  <button
                    key={`${r.symbol}-${r.interval}`}
                    type="button"
                    onClick={() => onPickPair(r.symbol, r.interval)}
                    className={`grid w-full grid-cols-[1fr_26px_44px_44px_38px_38px_40px] items-center gap-x-1 px-2 py-1 text-left font-mono text-[10px] hover:bg-zinc-800/60 ${
                      i === 0 ? "bg-teal-950/20" : ""
                    }`}
                  >
                    <span className="truncate text-zinc-200">{r.symbol}</span>
                    <span className="text-zinc-500">{r.interval}</span>
                    <span className={sideClass(r.bias)}>{r.bias === "NEUTRAL" ? "—" : r.bias}</span>
                    <span className="text-right text-zinc-300">{(r.prob * 100).toFixed(1)}%</span>
                    <span className={`text-right ${r.auc >= cfg.minAuc ? "text-emerald-400" : "text-zinc-500"}`}>{r.auc.toFixed(2)}</span>
                    <span className={`text-right ${r.acc >= cfg.minAcc ? "text-emerald-400" : "text-zinc-500"}`}>{r.acc.toFixed(0)}%</span>
                    <span className={`text-right font-bold ${tradeable ? "text-teal-300" : "text-zinc-600"}`}>{r.score.toFixed(1)}</span>
                  </button>
                );
              })}
            </div>
            <p className="text-[10px] leading-snug text-zinc-600">{t(lang, "auto.rank.hint")}</p>
          </div>
        ) : (
          !scanning && <p className="text-[11px] text-zinc-600">{t(lang, "auto.scan.empty")}</p>
        )}

        {/* open position */}
        {open ? (
          <div className="rounded-lg border border-zinc-700 bg-zinc-900 p-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">{t(lang, "auto.pos.open")}</span>
              <Badge variant="outline" className={`border-zinc-700 font-mono ${sideClass(open.side)}`}>
                {open.side}
              </Badge>
            </div>
            <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
              <span className="text-zinc-500">{t(lang, "auto.col.pair")}</span>
              <span className="text-right font-mono text-zinc-200">
                {open.symbol} · {open.interval}
              </span>
              <span className="text-zinc-500">{t(lang, "auto.pos.entry")}</span>
              <span className="text-right font-mono text-zinc-200">{fmtPrice(open.entryPrice)}</span>
              <span className="text-zinc-500">{t(lang, "auto.pos.stake")}</span>
              <span className="text-right font-mono text-zinc-200">
                {(((open.capitalBefore ?? capitalNow) * (open.stakePct ?? 100)) / 100).toFixed(2)} USDT · {open.stakePct ?? 100}%
                <span className="text-zinc-500">
                  {" "}
                  · {t(lang, "auto.pos.notional")} {((((open.capitalBefore ?? capitalNow) * (open.stakePct ?? 100)) / 100) * open.leverage).toFixed(2)}
                </span>
              </span>
              <span className="text-zinc-500">SL</span>
              <span className="text-right font-mono text-rose-300">
                {fmtPrice(slPrice(open.side, open.entryPrice, open.slPct))} · −{open.slPct.toFixed(1)}%
                <span className="text-zinc-500"> (ROE −{(open.slPct * open.leverage).toFixed(1)}%)</span>
              </span>
              <span className="text-zinc-500">TP</span>
              <span className="text-right font-mono text-emerald-300">
                {fmtPrice(tpPrice(open.side, open.entryPrice, open.tpPct))} · +{open.tpPct.toFixed(1)}%
                <span className="text-zinc-500"> (ROE +{(open.tpPct * open.leverage).toFixed(1)}%)</span>
              </span>
              <span className="text-zinc-500">{t(lang, "auto.pos.uroe")}</span>
              {(() => {
                const live = tickers[open.symbol]?.price ?? open.entryPrice;
                const roe = roeOf(open.side, open.entryPrice, live, open.leverage);
                return (
                  <span className={`text-right font-mono font-bold ${roe >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                    {roe >= 0 ? "+" : ""}
                    {roe.toFixed(2)}%
                  </span>
                );
              })()}
            </div>
            <Button size="sm" variant="outline" className="mt-2 h-7 w-full border-zinc-700 text-[11px] text-zinc-300 hover:bg-zinc-800" onClick={() => void closeNow()}>
              <Square className="mr-1.5 h-3 w-3" />
              {t(lang, "auto.pos.close")}
            </Button>
          </div>
        ) : (
          rows.length > 0 && <p className="text-[11px] text-zinc-600">{t(lang, "auto.pos.none")}</p>
        )}

        {/* capital + stats */}
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-2">
            <p className="truncate text-[10px] uppercase tracking-wide text-zinc-500">{t(lang, "auto.capital.now")}</p>
            <p className="mt-0.5 truncate font-mono text-sm font-bold text-zinc-100">{capitalNow.toFixed(2)}</p>
            <p className="truncate text-[9px] text-zinc-600">{t(lang, "auto.capital.start", { n: cfg.capital })}</p>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-2">
            <p className="truncate text-[10px] uppercase tracking-wide text-zinc-500">Net ROE</p>
            <p className={`mt-0.5 truncate font-mono text-sm font-bold ${(auto?.stats.netPnlPct ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
              {(auto?.stats.netPnlPct ?? 0) >= 0 ? "+" : ""}
              {(auto?.stats.netPnlPct ?? 0).toFixed(1)}%
            </p>
            <p className="truncate text-[9px] text-zinc-600">{t(lang, "auto.stats.trades", { n: auto?.stats.closed ?? 0 })}</p>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-2">
            <p className="truncate text-[10px] uppercase tracking-wide text-zinc-500">Win</p>
            <p className="mt-0.5 truncate font-mono text-sm font-bold text-zinc-100">{(auto?.stats.winRate ?? 0).toFixed(0)}%</p>
            <p className="truncate text-[9px] text-zinc-600">
              {auto?.stats.wins ?? 0}/{auto?.stats.closed ?? 0}
            </p>
          </div>
        </div>

        {/* win-rate by pair × timeframe */}
        {(auto?.byCombo?.length ?? 0) > 0 && (
          <div className="border-t border-zinc-800 pt-2">
            <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">{t(lang, "auto.combo.title")}</p>
            <div className="mt-1.5 overflow-hidden rounded-lg border border-zinc-800">
              <div className="grid grid-cols-[1fr_30px_44px_44px_54px] gap-x-1 border-b border-zinc-800 bg-zinc-950/60 px-2 py-1 text-[9px] font-semibold uppercase tracking-wide text-zinc-500">
                <span>{t(lang, "auto.col.pair")}</span>
                <span>{t(lang, "auto.col.tf")}</span>
                <span className="text-right">{t(lang, "auto.combo.col.trades")}</span>
                <span className="text-right">{t(lang, "auto.combo.col.win")}</span>
                <span className="text-right">{t(lang, "auto.combo.col.net")}</span>
              </div>
              <div className="rail-scroll max-h-36 overflow-y-auto">
                {(auto?.byCombo ?? []).map((c: ComboStat) => (
                  <button
                    key={`${c.symbol}-${c.interval}`}
                    type="button"
                    onClick={() => onPickPair(c.symbol, c.interval)}
                    className="grid w-full grid-cols-[1fr_30px_44px_44px_54px] items-center gap-x-1 px-2 py-1 text-left font-mono text-[10px] hover:bg-zinc-800/60"
                  >
                    <span className="truncate text-zinc-200">{c.symbol}</span>
                    <span className="text-zinc-500">{c.interval}</span>
                    <span className="text-right text-zinc-400">{c.closed}</span>
                    <span className={`text-right font-bold ${c.winRate >= 50 ? "text-emerald-400" : "text-rose-400"}`}>{c.winRate.toFixed(0)}%</span>
                    <span className={`text-right ${(c.netPnlPct ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                      {c.netPnlPct >= 0 ? "+" : ""}
                      {c.netPnlPct.toFixed(1)}%
                    </span>
                  </button>
                ))}
              </div>
            </div>
            <p className="mt-1 text-[10px] leading-snug text-zinc-600">{t(lang, "auto.combo.hint")}</p>
          </div>
        )}

        {/* history */}
        <div className="border-t border-zinc-800 pt-2">
          <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">{t(lang, "auto.hist")}</p>
          {closedHist.length === 0 ? (
            <p className="mt-1 text-[11px] text-zinc-600">{t(lang, "auto.hist.empty")}</p>
          ) : (
            <div className="rail-scroll mt-1.5 max-h-28 space-y-1 overflow-y-auto pr-0.5">
              {closedHist.map((r) => (
                <div key={r.id} className="flex items-center gap-2 rounded-md border border-zinc-800/80 bg-zinc-950/40 px-2 py-1 text-[10px]">
                  <span className="shrink-0 text-zinc-500">
                    {new Date(r.exitTime ?? r.createdAt).toLocaleTimeString(lang === "vi" ? "vi-VN" : "en-GB", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })}
                  </span>
                  <span className="truncate font-mono text-zinc-300">
                    {r.symbol} {r.interval}
                  </span>
                  <span className={`shrink-0 font-mono ${sideClass(r.side)}`}>{r.side}</span>
                  <span className={`ml-auto shrink-0 font-mono font-bold ${(r.pnlPct ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                    {(r.pnlPct ?? 0) >= 0 ? "+" : ""}
                    {(r.pnlPct ?? 0).toFixed(2)}%
                  </span>
                  <span className="shrink-0 font-mono text-zinc-600">{r.exitKind === "tp" ? "TP" : r.exitKind === "sl" ? "SL" : "…"}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/** localStorage read guarded for SSR — AutoPanel mounts client-only anyway. */
function loadAutoConfigSafe() {
  if (typeof window === "undefined") return AUTO_DEFAULTS;
  return loadAutoConfig();
}
