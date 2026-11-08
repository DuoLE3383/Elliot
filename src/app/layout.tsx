import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { readFileSync } from "fs";
import path from "path";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import BuildReload from "@/components/build-reload";
import { TechBackground } from "@/components/tech-background";

// Build marker — prebuild ghi public/build-id.txt cho MỖI lần build; id được
// Baked into the HTML at build time on the line below. BuildReload (client) compares it with
// /api/build-id (runtime) và tự reload tab cũ → template/code mới luôn tới
// tay tab đang mở mà không cần F5 tay (chữa tận gốc lỗi "sửa template mà
// Telegram vẫn báo bản cũ" — broadcast sống trong tab, không phải trong pm2).
function readBuildId(): string {
  try {
    return readFileSync(path.join(process.cwd(), "public", "build-id.txt"), "utf8").trim() || "dev";
  } catch {
    return "dev";
  }
}
const BUILD_ID = readBuildId();

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Elliott — Paper Trading Terminal",
  description:
    "Elliott — UT Bot paper trading with SMA gate. A reversal signal closes the current position and opens a new one in the opposite direction.",
  keywords: ["Elliott", "UT Bot", "paper trading", "Binance", "reversal", "SMA gate"],
  icons: {
    icon: "/elliott.svg",
  },
  other: { "elliott-build": BUILD_ID },
};

// Mobile browser chrome matches the terminal background colour (0.2.83: navy
// circuit-tech #020617 — the animated TechBackground paints the same base).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#020617",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-[#020617] text-foreground`}
      >
        {/* 0.2.83 — nền circuit-tech động (mạch cyan + pixel + sao) cho MỌI trang;
            z-[-1] + trang để root trong suốt nên nội dung luôn đè lên nền */}
        <TechBackground />
        {children}
        {/* 0.2.91 — build id NHÌN THẤY trên mọi trang: prebuild ghi
            public/build-id.txt = v{version}-{git sha}-{stamp} MỖI lần build →
            badge tự đúng bản khi deploy, hết đoán "tab đang chạy bản nào"
            (trước đây id chỉ nằm trong meta ẩn elliott-build). */}
        <div
          className="fixed bottom-1 right-2 z-[70] select-none font-mono text-[9px] leading-none text-zinc-600"
          title={`build ${BUILD_ID} — khớp /api/build-id khi server chạy cùng bản`}
        >
          {BUILD_ID}
        </div>
        <BuildReload />
        <Toaster />
      </body>
    </html>
  );
}
