import type { Status } from "./types";

const UNIT = 10_000_000; // the token has 7 decimals
export const DAY = 86_400n;

export function toUnits(value: number): bigint {
  return BigInt(Math.round(value * UNIT));
}

export function money(units: bigint): string {
  return (Number(units) / UNIT).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function percent(bps: number): string {
  return `${(bps / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })} %`;
}

export function nowSecs(): bigint {
  return BigInt(Math.floor(Date.now() / 1000));
}

export function date(ts: bigint): string {
  return new Date(Number(ts) * 1000).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });
}

export function daysFromNow(ts: bigint): string {
  const days = Math.round(Number(ts - nowSecs()) / 86_400);
  if (days === 0) return "today";
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
}

export const STATUS_LABEL: Record<Status, string> = {
  Proposed: "Waiting for tenant",
  Active: "Active",
  Ending: "Contract ended",
  Stopped: "Release stopped",
  UnderReview: "Under review",
  Settled: "Settled",
  Cancelled: "Cancelled",
};
