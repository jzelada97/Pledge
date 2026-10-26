import { DEPOSITS, ME_LANDLORD, type DepositRow } from "./fixtures";
import type { Formatters } from "./format";
import type { Messages } from "./i18n/messages";
import type { Status } from "./types";

// Data for the landlord's sidebar and deposit list, computed on the server so the client only gets strings.

export const needsAction = (d: DepositRow) => d.status === "Ending" && !d.data.approvals.approved_by.includes(ME_LANDLORD);

const FILTERS = [
  { id: "all", test: () => true },
  { id: "answer", test: needsAction },
  { id: "waiting", test: (d: DepositRow) => d.status === "Proposed" },
  { id: "active", test: (d: DepositRow) => d.status === "Active" || d.status === "Ending" },
  { id: "stopped", test: (d: DepositRow) => d.status === "Stopped" || d.status === "UnderReview" },
  { id: "settled", test: (d: DepositRow) => d.status === "Settled" || d.status === "Cancelled" },
] as const;

export type FilterId = (typeof FILTERS)[number]["id"];
export type FilterInfo = { id: FilterId; label: string; count: number };
export type ListItem = { id: string; amount: string; status: Status; statusLabel: string; meta: string; needsAction: boolean; filters: FilterId[] };
export type Summary = { held: string; heldCount: number; yieldSoFar: string; answer: number };

function meta(d: DepositRow, t: Messages, f: Formatters): string {
  const m = t.landlord.meta;
  if (d.status === "Proposed") return m.invitationSent;
  if (d.status === "Settled") return m.released;
  if (d.status === "Stopped" || d.status === "UnderReview") return m.underReview;
  return m.ends(f.daysFromNow(d.data.terms.end_ts));
}

export function landlordList({ t, f }: { t: Messages; f: Formatters }, deposits: DepositRow[] = DEPOSITS) {
  const items: ListItem[] = deposits.map((d) => ({
    id: d.id.toString(),
    amount: f.money(d.data.terms.amount),
    status: d.status,
    statusLabel: t.status[d.status],
    meta: meta(d, t, f),
    needsAction: needsAction(d),
    filters: FILTERS.filter((x) => x.test(d)).map((x) => x.id),
  }));
  const filters: FilterInfo[] = FILTERS.map((x) => ({ id: x.id, label: t.landlord.filters[x.id], count: deposits.filter(x.test).length }));
  const held = deposits.filter((d) => d.status !== "Proposed" && d.status !== "Settled" && d.status !== "Cancelled");
  const summary: Summary = {
    held: f.money(held.reduce((s, d) => s + d.data.terms.amount, 0n)),
    heldCount: held.length,
    yieldSoFar: f.money(held.reduce((s, d) => s + d.accrued_yield, 0n)),
    answer: deposits.filter(needsAction).length,
  };
  return { items, filters, summary };
}
