"use client";

import { useRouter } from "next/navigation";
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { formatters } from "@/lib/format";
import { DEFAULT_LOCALE, LOCALE_COOKIE, type Locale } from "./config";
import { MESSAGES } from "./messages";

const LocaleContext = createContext<Locale>(DEFAULT_LOCALE);

// Only the locale crosses from the server; the dictionaries are imported here, so their functions work.
export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

// For client components: `const { t, f } = useI18n()`.
export function useI18n() {
  const locale = useContext(LocaleContext);
  return useMemo(() => ({ locale, t: MESSAGES[locale], f: formatters(locale) }), [locale]);
}

// Saves the choice for a year and re-renders the server components in the new language.
export function useSetLocale() {
  const router = useRouter();
  return (locale: Locale) => {
    document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  };
}
