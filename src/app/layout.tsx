import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

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
    "Elliott — mô phỏng paper trading theo tín hiệu UT Bot với cổng SMA. Tín hiệu đảo chiều đóng lệnh hiện tại và mở lệnh mới theo hướng ngược lại.",
  keywords: ["Elliott", "UT Bot", "paper trading", "Binance", "reversal", "SMA gate"],
  icons: {
    icon: "/elliott.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="vi" className="dark" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
