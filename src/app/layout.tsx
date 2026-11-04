import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { readFileSync } from "fs";
import path from "path";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import BuildReload from "@/components/build-reload";

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

// Mobile browser chrome matches the terminal background colour (0.2.76: /ai
// moved to a teal-tinted dark #0a100f — imperceptible vs the zinc-950 dashboard).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0a100f",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <BuildReload />
        <Toaster />
      </body>
    </html>
  );
}
