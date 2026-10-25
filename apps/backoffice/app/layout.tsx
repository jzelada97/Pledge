import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Fianzas · Staff",
  description: "Internal staff tool for resolving stopped deposits.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh bg-neutral-50 text-neutral-900 antialiased">{children}</body>
    </html>
  );
}
