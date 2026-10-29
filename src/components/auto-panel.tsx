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
  fetchAutoState,
  liquidationHit,
  loadAutoConfig,
  openAutoTrade,
  roeOf,
  saveAutoConfig,
  scanAll,
  sendTelegram,
  slTpHit,
  telegramConfigured,
  telegramDiscover,
  telegramSaveChat,
  telegramStatus,
  AUTO_DEFAULTS,
  type AutoState,
  type AutoTradeRow,
  type ScanRow,
  type TgChat,
} from "@/lib/autotrade";
import { fmtPrice, t, type Lang } from "@/lib/i18n";
import type { EngineSettings, Ticker } from "@/lib/types";
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
const CYCLES = [5, 10, 15, 30];

// ─── Telegram message builders (channel language: Vietnamese) ────────────────

const msgOpen = (r: AutoTradeRow, capital: number): string =>
  [
    "🤖 AUTO MỞ LỆNH (dry-run)",
    `#${r.symbol} · ${r.interval} · ${r.side}`,
    `Vào: ${fmtPrice(r.entryPrice)}`,
    `SL −${r.slPct.toFixed(1)}% · TP +${r.tpPct.toFixed(1)}% · đòn bẩy ×${r.leverage % 1 === 0 ? r.leverage : r.leverage.toFixed(1)}`,
    `Prob ${(r.prob != null ? r.prob * 100 : 0).toFixed(1)}% · AUC ${(r.auc ?? 0).toFixed(2)} · ACC ${(r.acc ?? 0).toFixed(1)}% · Điểm ${(r.score ?? 0).toFixed(1)}`,
    `Vốn: ${capital.toFixed(2)} USDT`,
  ].join("\n");

const kindVi = (k: string | null): string => (k === "tp" ? "CHẠM TP ✅" : k === "sl" ? "CẮT LỖ 🔻" : "ĐÓNG THỦ CÔNG");

const msgClose = (r: AutoTradeRow, closed: number, winRate: number, netPnlPct: number): string =>
  [
    `🤖 AUTO ĐÓNG LỆNH · ${kindVi(r.exitKind)}`,
    `#${r.symbol} ${r.interval} ${r.side}`,
    `Ra: ${fmtPrice(r.exitPrice ?? 0)} · ROE ${(r.pnlPct ?? 0) >= 0 ? "+" : ""}${(r.pnlPct ?? 0).toFixed(2)}%`,
    `Vốn: ${(r.capitalBefore ?? 0).toFixed(2)} → ${(r.capitalAfter ?? 0).toFixed(2)} USDT`,
    `Tổng: ${closed} lệnh · win ${winRate.toFixed(0)}% · net ROE ${netPnlPct >= 0 ? "+" : ""}${netPnlPct.toFixed(1)}%`,
  ].join("\n");

const msgScan = (rows: ScanRow[], nPairs: number, nTf: number): string => {
  const top3 = rows
    .slice(0, 3)
    .map((r) => `${r.symbol} ${r.interval} (${r.score.toFixed(1)})`)
    .join(" · ");
  const best = rows[0];
  return [
    "📊 AUTO QUÉT XONG",
    `${nPairs} pair × ${nTf} khung = ${nPairs * nTf} combo · ${rows.length} hợp lệ`,
    best
      ? `Tốt nhất: #${best.symbol} ${best.interval} ${best.bias} · AUC ${best.auc.toFixed(2)} · ACC ${best.acc.toFixed(1)}% · Điểm ${best.score.toFixed(1)}`
      : "Không có combo hợp lệ",
    top3 ? `Top 3: ${top3}` : "",
  ]
    .filter(Boolean)
    .join("\n");
};

const TEST_MSG = "✅ Elliott terminal — kết nối Telegram OK.\nAuto trade (dry-run) sẽ báo mở/đóng lệnh và kết quả quét tại kênh này.";

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
  }, [refreshAuto]);

  const doScan = useCallback(async (): Promise<ScanRow[]> => {
    if (scanBusyRef.current) return rowsRef.current;
    scanBusyRef.current = true;
    setScanning({ done: 0, total: pairsRef.current.length * 5, current: "" });
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
        void sendTelegram(msgScan(out, pairsRef.current.length, 5));
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
        setStatus(t(langRef.current, "auto.scan.busy", { done: 0, total: pairsRef.current.length * 5, current: "…" }));
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
        slPct: best.slPct,
        tpPct: best.tpPct,
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
  // full cycle, then kicks a fresh entry a few seconds later
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
      }
    }, 15_000);
    return () => window.clearInterval(id);
  }, [cfg.on, closeOpen, runCycle]);

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
        {/* config */}
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
          <div className="flex items-center gap-1" role="group" aria-label={t(lang, "auto.cfg.cycle")}>
            <span className="mr-0.5 text-[11px] text-zinc-500">{t(lang, "auto.cfg.cycle")}</span>
            {CYCLES.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => updateCfg({ cycleMin: m })}
                className={`h-7 rounded-md border px-2 font-mono text-[11px] ${
                  cfg.cycleMin === m
                    ? "border-teal-700 bg-teal-950/40 text-teal-300"
                    : "border-zinc-800 bg-zinc-950/40 text-zinc-400 hover:bg-zinc-800"
                }`}
              >
                {m}
              </button>
            ))}
            <span className="text-[11px] text-zinc-600">{t(lang, "auto.cfg.cycleUnit")}</span>
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
        </div>
        <p className="text-[11px] text-zinc-600">{t(lang, "auto.cfg.min", { auc: cfg.minAuc.toFixed(2), acc: cfg.minAcc })}</p>

        {/* scan actions */}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            className="h-8 bg-teal-600 text-zinc-950 hover:bg-teal-500 disabled:opacity-50"
            disabled={scanning != null || pairs.length === 0}
            onClick={() => void doScan()}
          >
            <ScanLine className="mr-1.5 h-3.5 w-3.5" />
            {t(lang, "auto.scan")} ({pairs.length}×5)
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
            {t(lang, "auto.cycle.next", { s: countdown })} {status && <span className="font-mono text-zinc-400">· {status}</span>}
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
              <span className="text-zinc-500">SL / TP</span>
              <span className="text-right font-mono">
                <span className="text-rose-300">−{open.slPct.toFixed(1)}%</span> / <span className="text-emerald-300">+{open.tpPct.toFixed(1)}%</span> · ×{open.leverage}
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
