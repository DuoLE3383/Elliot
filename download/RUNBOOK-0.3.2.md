# RUNBOOK 0.3.2 — floor động tự học + TP1→Runner + SL confirm

> Sandbox làm việc đã MẤT token git (remote URL bị rút credential) nên
> `git push` từ sandbox không thực hiện được. Commit **87e212d** (0.3.2,
> đế trên `0.2.59 = ddc2c7b`) nằm trong bundle/patch dưới đây — cần đẩy lên
> GitHub từ máy có credential (VPS là nơi tiện nhất), rồi deploy như thường.
>
> LƯU Ý QUAN TRỌNG: VPS đang chạy **0.3.1** (commit 8d96254) — các commit
> 0.3.0/0.3.1 KHÔNG có trong sandbox này. Commit 0.3.2 được tạo trên nền
> 0.2.59, nên phải **cherry-pick lên trên 0.3.1** và giải conflict tay (hướng
> dẫn từng file ở mục 3).

## 1. Tệp bàn giao (trong thư mục download/)

| Tệp | Dùng để |
|---|---|
| `elliott-0.3.2-inc.bundle` (34KB) | `git fetch` vào repo VPS — chỉ chứa commit 0.3.2 |
| `0.3.2-on-0.2.59.patch` (111KB) | `git am` nếu thích dạng patch |
| `RUNBOOK-0.3.2.md` | chính là file này |

## 2. Đưa commit 0.3.2 lên main (chạy TRÊN VPS, user có quyền git)

```bash
cd /opt/elliott   # (hoặc ~/Elliot — repo đang chạy 0.3.1)

# a) nạp bundle
git fetch /path/to/elliott-0.3.2-inc.bundle main:0.3.2-from-sandbox

# b) cherry-pick lên main (0.3.1)
git checkout main
git cherry-pick 87e212dc19bf51b2f8bf93311339670a9db5a05b
#   → conflict thì xem mục 3, sau khi sửa xong:
#   git add -A && git cherry-pick --continue --no-verify

# c) đẩy lên GitHub
git push --no-verify origin main
```

(Phương án B — nếu thích patch: `git am --3way /path/to/0.3.2-on-0.2.59.patch`,
conflict giải y hệt mục 3 rồi `git am --continue`.)

## 3. Conflict dự kiến khi cherry-pick lên 0.3.1 (giữ CẢ HAI tính năng)

0.3.2 KHÔNG đụng phần đo ATR động của 0.3.1 (multiplier time/vol lúc đo
SL/TP tại entry) — 0.3.2 quản lý lệnh SAU khi đã có slPct/tpPct trên row.
Khi conflict, giữ logic 0.3.1 và thêm phần 0.3.2 theo danh sách:

- **src/lib/params.ts** — thêm nguyên khối `6d · DYNAMIC FLOOR` (FLOOR_EVERY_MS,
  FLOOR_MIN_SAMPLES=30, FLOW_MIN=0.12, FLOOR_HARD_MIN, FLOOR_STEP) — khối
  độc lập, chèn sau 6c CALIBRATION.
- **src/lib/db.ts** — thêm `CREATE TABLE IF NOT EXISTS "FloorLog"` + index,
  4 ALTER AutoTrade (p1Pct/p1Share/tp2Pct/trailPct), thêm "FloorLog" vào
  MODEL_TABLES. Giữ nguyên WAL/busy_timeout + bảng mới của 0.3.1.
- **src/lib/autotrade.ts** — AutoConfig thêm 6 field (floorAuto/runnerOn/
  runnerSharePct/runnerTpMult/runnerTrailLock/slConfirmTicks), AUTO_DEFAULTS,
  RUNNER_SHARE_CHOICES/SL_CONFIRM_CHOICES, loadAutoConfig parse mới,
  DIGEST_KIND thêm `trail: "🪂"`, AutoTradeRow thêm 4 field nullable.
- **src/lib/engine.ts** — imports (msgFloor/msgTp1/FLOOR_EVERY_MS/NEAR_FRAC/
  trade-mgmt/dynamic-floor), EnginePersisted.slPending (+defaults+loadEngine),
  closeTradeDirect: exitKind + "trail" và combine qua `combineClosePnl`,
  hàm mới `evalExit()` (toàn bộ), watcherTick + cycleTick §1 thay khối
  `slTpHit → closeTradeDirect` bằng `evalExit`, syncEngine đoạn keepFloors,
  scheduler `lastFloor` + khối floor round 6h.
- **src/lib/autopsy.ts / tg-msgs.ts / stats.ts / i18n.ts / autostate.ts /
  self-improve.ts / route.ts / schema.prisma / auto-panel.tsx / ai page** —
  các thay đổi 0.3.2 tự chứa, thường không đụng 0.3.1.

## 4. Deploy (như mọi bản)

```bash
cd /opt/elliott && sudo bash deploy/update.sh     # git pull → build → restart, GIỮ data
pm2 restart elliott --update-env                  # (nếu dùng pm2 thay systemd)
```

## 5. Kiểm sau deploy (2 phút)

```bash
# 1) bootstrap tự tạo bảng + cột — phải thấy "12 tables present" (hoặc hơn nếu 0.3.1 thêm bảng)
pm2 logs elliott --lines 50 --nostream | grep -E "\[db\]|\[floor\]"

# 2) lượt học floor đầu tiên chạy ngay tick đầu (~15s sau boot):
#    đủ mẫu → "[floor] APPLY/KEEP — <lý do>" / thiếu mẫu → "[floor] KEEP — chưa đủ mẫu…"
pm2 logs elliott --nostream | grep "\[floor\]"

# 3) /stats hiện mục mới: "Dynamic floor — ngưỡng tự học (0.3.2)"
#    → floors đang chạy + nguồn AUTO/tay + lý do tiến hoá nguyên văn

# 4) Auto panel: hàng 🧬 Floor AUTO · 🪁 TP1→Runner (30/50/70% · TP× · lock) · SL confirm 0/2/3/5

# 5) Lần TP đầu tiên tới sẽ thấy trong TG: "TP1 PARTIAL — RUNNER ARMED"
#    lần SL bị wick sẽ thấy "[engine] SL confirm … đợi nhịp kế xác nhận"
```

## 6. Tuỳ chỉnh nhanh (nếu muốn khác mặc định)

| Mặc định 0.3.2 | Muốn đổi | Chỗ chỉnh |
|---|---|---|
| Chốt 50% stake tại TP1 | 30% / 70% | Auto panel 🪁 share |
| TP runner ×2 | ×1.5 … ×5 | Auto panel TP× |
| Trail khoá 50% quãng đi | 0.3 … 0.9 | Auto panel lock |
| SL confirm 2 nhịp (40s) | 0 (tắt) / 3 / 5 | Auto panel SL confirm |
| Floor tự học ON | OFF (floor tĩnh như cũ) | Auto panel 🧬 |
| Nhịp học 6h · flow ≥ 12% · sàn 0.55/55/20 | — | params.ts §6d (pval runtime được) |

## 7. Kết quả đã kiểm trên sandbox (trước khi đóng gói)

- `npx tsc --noEmit` — sạch; `npm run build` — OK; boot standalone — OK.
- `[db] schema bootstrap — ok (all 12 tables present)` + FloorLog tạo thật,
  4 cột AutoTrade ALTER thật (PRAGMA xác nhận).
- `[floor] KEEP — chưa đủ mẫu để học: 0/30 trọng số` — learner chạy đúng ngay
  lượt đầu, giữ floor cũ khi thiếu dữ liệu.
- `/api/stats` — 9 sections có `floor` (state ok, note đúng).
- `/api/engine` — floorAuto/runnerOn/50/×2/0.5/×2 đủ field.
- Tests: test-trade-mgmt 30 pass · test-dynamic-floor 19 pass ·
  test-dca / test-params-02-59 / test-atr-sltp / test-confluence ALL PASS.
