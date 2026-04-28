import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "rekishi-shorts レビュー",
  description: "scene plan の確認 + 動画生成トリガー",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
