"use client";

// ─── BuildReload — tab mở lâu ngày luôn chạy đúng bundle mới nhất ────────────
// Toàn bộ vòng lặp auto (TOP-coin broadcast 5 phút, universe 8h, stats, cycle)
// sống trong TAB TRÌNH DUYỆT, không phải trong process pm2. Vì thế khi server
// được `npm run build && pm2 restart`, tab cũ vẫn giữ JS bundle cũ trong RAM
// và cứ tiếp tục gửi template cũ — đúng lỗi "đã sửa template mà Telegram vẫn
// báo bản cũ". Vá: layout nướng build id vào HTML lúc build
// (<meta name="elliott-build">), component này hỏi /api/build-id (runtime) mỗi
// 10 phút; hai id khác nhau → tab tự reload MỘT lần để nhận bundle mới.
import { useEffect } from "react";

const POLL_MS = 10 * 60_000;
const FIRST_POLL_DELAY_MS = 15_000;

export default function BuildReload() {
  useEffect(() => {
    if (process.env.NODE_ENV === "development") return; // dev đã có hot reload
    const mine = document.querySelector('meta[name="elliott-build"]')?.getAttribute("content") ?? "";
    if (!mine) return; // không có marker → không có gì để so sánh, không reload mù
    let dead = false;

    const poll = async () => {
      try {
        const res = await fetch("/api/build-id", { cache: "no-store" });
        if (!res.ok) return;
        const { id } = (await res.json()) as { id?: string };
        if (dead || !id || id === "unknown" || id === mine) return;
        try {
          const key = "utp.build.reloaded";
          if (sessionStorage.getItem(key) === id) return; // đã reload cho build này rồi
          sessionStorage.setItem(key, id);
        } catch {
          // storage bị chặn — vẫn reload (guard thôi mà)
        }
        console.log(`[build-reload] ${mine} → ${id} — tải lại trang để nhận bundle mới`);
        setTimeout(() => location.reload(), 800);
      } catch {
        // server đang restart/chập chờn — đợi lần poll sau
      }
    };

    const first = setTimeout(() => void poll(), FIRST_POLL_DELAY_MS);
    const iv = window.setInterval(() => void poll(), POLL_MS);
    return () => {
      dead = true;
      clearTimeout(first);
      window.clearInterval(iv);
    };
  }, []);
  return null;
}
