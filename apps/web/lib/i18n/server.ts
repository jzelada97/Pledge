import { cookies, headers } from "next/headers";
import { cache } from "react";
import { formatters } from "@/lib/format";
import { DEFAULT_LOCALE, LOCALE_COOKIE, asLocale, fromAcceptLanguage, type Locale } from "./config";
import { MESSAGES } from "./messages";

// The language is the `locale` cookie set by the preferences menu; on a first visit, the browser's language.
export const getLocale = cache(async (): Promise<Locale> => {
  const saved = asLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  return saved ?? fromAcceptLanguage((await headers()).get("accept-language")) ?? DEFAULT_LOCALE;
});

// For server components: `const { t, f } = await getI18n()`.
export async function getI18n() {
  const locale = await getLocale();
  return { locale, t: MESSAGES[locale], f: formatters(locale) };
}
