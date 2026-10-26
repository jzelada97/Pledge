export const LOCALES = ["en", "pt", "es"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_COOKIE = "locale";

// BCP 47 tags for Intl formatting. Portuguese is European Portuguese: the MVP runs in Portugal.
export const INTL_TAG: Record<Locale, string> = { en: "en-US", pt: "pt-PT", es: "es-ES" };
export const LOCALE_NAME: Record<Locale, string> = { en: "English", pt: "Português", es: "Español" };

export function asLocale(value: string | null | undefined): Locale | undefined {
  return LOCALES.find((l) => l === value);
}

// First supported language in an Accept-Language header ("pt-PT,pt;q=0.9,en;q=0.8" → "pt").
export function fromAcceptLanguage(header: string | null): Locale | undefined {
  if (!header) return undefined;
  for (const part of header.split(",")) {
    const found = asLocale(part.trim().slice(0, 2).toLowerCase());
    if (found) return found;
  }
  return undefined;
}
