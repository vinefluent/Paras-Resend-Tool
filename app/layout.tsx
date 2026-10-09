import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Paras Resend Tool" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
