// Seed 1 DiveReport mẫu để kiểm UI lịch sử dive (chỉ DB local test).
process.env.DATABASE_URL ??= "file:/home/z/my-project/db/custom.db";

const { db } = await import("../src/lib/db");

const count = await db.diveReport.count();
if (count === 0) {
  await db.diveReport.create({
    data: {
      source: "stats-dive",
      model: "local-7b",
      ok: true,
      ms: 113976,
      text: "### Đối chiếu cơ sở logic\n- **sg**: chấm lại toàn bộ outcome bằng outcomeOf — khớp 100%.\n- **combo**: win-rate 42% chưa bù nổi rủi ro, net ROE cộng -46.62%.\n- **universe**: snapshot mới hơn chu kỳ re-rank 8h — đúng.\n\n### Hành động cụ thể\n1. Tăng mẫu backtest tối thiểu 500.\n2. Siết gate theo phía bias.",
      detail: null,
    },
  });
  console.log("seeded 1 report");
} else {
  console.log(`đã có ${count} reports — bỏ qua seed`);
}
process.exit(0);
