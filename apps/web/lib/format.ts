import { INTL_TAG, type Locale } from "./i18n/config";

const UNIT = 10_000_000; // the token has 7 decimals
export const DAY = 86_400n;

export function toUnits(value: number): bigint {
  return BigInt(Math.round(value * UNIT));
}

export function nowSecs(): bigint {
  return BigInt(Math.floor(Date.now() / 1000));
}

// Locale-aware formatting. Get it from getI18n() on the server or useI18n() in client components.
export function formatters(locale: Locale) {
  const tag = INTL_TAG[locale];
  const currency = new Intl.NumberFormat(tag, { style: "currency", currency: "USD", currencyDisplay: "narrowSymbol" });
  const pct = new Intl.NumberFormat(tag, { style: "percent", maximumFractionDigits: 2 });
  const day = new Intl.DateTimeFormat(tag, { day: "numeric", month: "short", year: "numeric" });
  const relative = new Intl.RelativeTimeFormat(tag, { numeric: "auto" });
  return {
    money: (units: bigint) => currency.format(Number(units) / UNIT),
    percent: (bps: number) => pct.format(bps / 10_000),
    date: (ts: bigint) => day.format(new Date(Number(ts) * 1000)),
    // "in 3 days", "2 days ago", "today" in the active language
    daysFromNow: (ts: bigint) => relative.format(Math.round(Number(ts - nowSecs()) / 86_400), "day"),
  };
}

export type Formatters = ReturnType<typeof formatters>;
