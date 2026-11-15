// ─── binance-keys — key Binance API cho auto trade (server-only, 0.2.96) ─────
// Mục đích: sổ dry-run giữ nguyên (KHÔNG gửi lệnh thật), nhưng key được lưu
// sẵn + test kết nối để bước sau (live mode / đọc balance / rate limit cao hơn)
// chỉ cần bật flag — không phải đập lại hạ tầng. Mô hình storage y hệt
// telegram-store: file JSON trong $DATA_DIR (db/binance-keys.json), env làm
// fallback. Secret KHÔNG BAO GIỜ trả về client — GET chỉ cho masked key.
//
// Ký request: HMAC SHA256 query-string (chuẩn Binance USDT-M):
//   GET /fapi/v2/account?timestamp=...&recvWindow=...&signature=HMAC(secret)
//   header X-MBX-APIKEY: <key>
// Host: BINANCE_TRADE_HOST env override (VPS bị cắt route tới fapi giống
// KLINES_HOSTS), mặc định https://fapi.binance.com.

import { createHmac, timingSafeEqual } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "fs";
import path from "path";
import { DATA_DIR, dataFile } from "./data-dir";

export interface BinanceKeyStore {
  apiKey: string;
  apiSecret: string;
  updatedAt: string;
  lastTest?: { at: string; ok: boolean; note: string };
}

const FILE = () => dataFile("binance-keys.json");

function readStore(): BinanceKeyStore | null {
  try {
    const p = FILE();
    if (!existsSync(p)) return null;
    const raw = JSON.parse(readFileSync(p, "utf8")) as Partial<BinanceKeyStore>;
    if (!raw.apiKey || !raw.apiSecret) return null;
    return { apiKey: String(raw.apiKey), apiSecret: String(raw.apiSecret), updatedAt: String(raw.updatedAt ?? ""), lastTest: raw.lastTest };
  } catch {
    return null;
  }
}

function writeStore(st: BinanceKeyStore): void {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    const p = FILE();
    writeFileSync(p, JSON.stringify(st, null, 2), { encoding: "utf8", mode: 0o600 });
    try {
      chmodSync(p, 0o600); // best-effort — một số FS bỏ qua mode của writeFileSync
    } catch {
      /* ok */
    }
  } catch {
    /* DATA_DIR không ghi được — key chỉ sống cho process này qua env */
  }
}

function validFormat(key: string): boolean {
  return /^[A-Za-z0-9]{32,80}$/.test(key); // Binance key/secret: alnum 64 (cho khoảng dự phòng)
}

/** Key hiệu dụng: store (panel) trước → env → không có. */
export function effectiveKeys(): { key: string; secret: string; source: "store" | "env" } | null {
  const st = readStore();
  if (st && validFormat(st.apiKey) && validFormat(st.apiSecret)) return { key: st.apiKey, secret: st.apiSecret, source: "store" };
  const ek = (process.env.BINANCE_API_KEY ?? "").trim();
  const es = (process.env.BINANCE_API_SECRET ?? "").trim();
  if (validFormat(ek) && validFormat(es)) return { key: ek, secret: es, source: "env" };
  return null;
}

export interface BinanceStatus {
  configured: boolean;
  source: "store" | "env" | null;
  apiKeyMasked: string | null;
  updatedAt: string | null;
  lastTest: { at: string; ok: boolean; note: string } | null;
}

export function binanceStatus(): BinanceStatus {
  const st = readStore();
  const eff = effectiveKeys();
  const key = eff?.key ?? null;
  return {
    configured: !!eff,
    source: eff?.source ?? null,
    apiKeyMasked: key ? maskKey(key) : null,
    updatedAt: st?.updatedAt ?? null,
    lastTest: st?.lastTest ?? null,
  };
}

export function maskKey(key: string): string {
  if (key.length <= 8) return "****";
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

/** Lưu key mới (validate format — thiếu/sai định dạng thì từ chối). */
export function saveBinanceKeys(apiKey: string, apiSecret: string): { ok: boolean; error?: string } {
  const k = apiKey.trim();
  const s = apiSecret.trim();
  if (!validFormat(k) || !validFormat(s)) {
    return { ok: false, error: "API key/secret phải là chuỗi chữ-số 32–80 ký tự (Binance cấp 64)" };
  }
  const prev = readStore();
  writeStore({ apiKey: k, apiSecret: s, updatedAt: new Date().toISOString(), lastTest: prev?.lastTest });
  return { ok: true };
}

export function clearBinanceKeys(): void {
  try {
    const p = FILE();
    if (existsSync(p)) writeStore({ apiKey: "cleared", apiSecret: "cleared", updatedAt: new Date().toISOString() });
    // ghi đè bằng rác thay vì xoá file — giữ permission, tránh để file rỗng lộ trạng thái cũ
    writeStore({ apiKey: "cleared", apiSecret: "cleared", updatedAt: new Date().toISOString() });
  } catch {
    /* ok */
  }
  // "cleared" không pass validFormat → effectiveKeys() về null/env — đúng ý xoá
}

function binanceHost(): string {
  const raw = (process.env.BINANCE_TRADE_HOST ?? "").trim().replace(/\/+$/, "");
  return /^https?:\/\//.test(raw) ? raw : "https://fapi.binance.com";
}

/** Request có chữ ký tới Binance USDT-M. Trả {ok, status, body}. */
async function signedRequest(method: "GET" | "POST", endpoint: string, extraParams: Record<string, string> = {}, timeoutMs = 12_000): Promise<{ ok: boolean; status: number; body: unknown }> {
  const eff = effectiveKeys();
  if (!eff) throw new Error("chưa cấu hình API key");
  const ts = Date.now();
  const params = new URLSearchParams({ ...extraParams, timestamp: String(ts), recvWindow: "10000" });
  const sig = createHmac("sha256", eff.secret).update(params.toString()).digest("hex");
  params.set("signature", sig);
  const url = `${binanceHost()}${endpoint}?${params.toString()}`;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method, headers: { "X-MBX-APIKEY": eff.key }, signal: ctl.signal });
    const body: unknown = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, body };
  } finally {
    clearTimeout(t);
  }
}

export interface BinanceTestResult {
  ok: boolean;
  note: string;
  accountType?: string;
  canTrade?: boolean;
  totalWalletBalance?: number;
  permissions?: string[];
  at: string;
}

/** Test kết nối: GET /fapi/v2/account (signed) — đọc được = key/secret hợp lệ
 *  + đủ quyền đọc futures. Không đặt bất kỳ lệnh nào. */
export async function testBinanceKeys(): Promise<BinanceTestResult> {
  const at = new Date().toISOString();
  const eff = effectiveKeys();
  if (!eff) return { ok: false, note: "chưa cấu hình key (lưu ở panel hoặc .env trước)", at };
  try {
    const r = await signedRequest("GET", "/fapi/v2/account");
    if (!r.ok) {
      const b = r.body as { code?: number; msg?: string } | null;
      const note =
        b?.code === -2015 || b?.code === -2014
          ? "key/secret sai hoặc IP chưa nằm trong whitelist Binance (code -2015)"
          : b?.msg
            ? `Binance từ chối: ${b.msg} (code ${b.code})`
            : `HTTP ${r.status}`;
      const out = { ok: false, note, at };
      persistTest(out);
      return out;
    }
    const acc = r.body as { accountType?: string; canTrade?: boolean; totalWalletBalance?: string; permissions?: string[] } | null;
    const out: BinanceTestResult = {
      ok: true,
      note: "kết nối OK — key hợp lệ, đọc được tài khoản Futures",
      accountType: acc?.accountType,
      canTrade: acc?.canTrade,
      totalWalletBalance: acc?.totalWalletBalance != null ? Number(acc.totalWalletBalance) : undefined,
      permissions: acc?.permissions,
      at,
    };
    persistTest(out);
    return out;
  } catch (e) {
    const out = { ok: false, note: `lỗi kết nối: ${e instanceof Error ? e.message : "unknown"}`, at };
    persistTest(out);
    return out;
  }
}

function persistTest(r: BinanceTestResult): void {
  const st = readStore();
  if (st) writeStore({ ...st, lastTest: { at: r.at, ok: r.ok, note: r.note } });
}

/** So sánh secret thời gian hằng (không dùng cho luồng chính — tiện test). */
export function secretMatches(candidate: string): boolean {
  const st = readStore();
  if (!st) return false;
  const a = Buffer.from(st.apiSecret);
  const b = Buffer.from(candidate);
  return a.length === b.length && timingSafeEqual(a, b);
}
