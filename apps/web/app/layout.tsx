import { headers } from "next/headers";
import { connection } from "next/server";
import type { Metadata, Viewport } from "next";
import { Geist_Mono, Inter, Montserrat } from "next/font/google";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import { INTL_TAG } from "@/lib/i18n/config";
import { I18nProvider } from "@/lib/i18n/client";
import { getI18n } from "@/lib/i18n/server";
import { cn } from "@/lib/utils";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" });
const montserrat = Montserrat({ subsets: ["latin"], weight: "700", variable: "--font-logo" }); // logo wordmark only

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: { default: "Pledge", template: "%s · Pledge" }, description: t.meta.description };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  await connection(); // render per request: the CSP nonce from proxy.ts only reaches dynamic pages
  const { locale } = await getI18n();
  const nonce = (await headers()).get("x-nonce") ?? undefined; // next-themes' inline script needs it or the CSP blocks it
  return (
    // next-themes sets the `dark` class on <html> before paint, so the server markup can't match it
    <html lang={INTL_TAG[locale]} className={cn("font-sans", inter.variable, geistMono.variable, montserrat.variable)} suppressHydrationWarning>
      <body className="min-h-dvh bg-background text-foreground antialiased">
        <ThemeProvider nonce={nonce} attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <I18nProvider locale={locale}>
            {children}
            <Toaster position="top-center" richColors={false} />
          </I18nProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
