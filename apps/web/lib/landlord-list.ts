import { DEPOSITS, ME_LANDLORD, type DepositRow } from "./fixtures";
import { STATUS_LABEL, daysFromNow, money } from "./format";
import type { Status } from "./types";

// Data for the landlord's sidebar and deposit list, computed on the server so the client only gets strings.

export const needsAction = (d: DepositRow) => d.status === "Ending" && !d.data.approvals.approved_by.includes(ME_LANDLORD);

const FILTERS = [
  { id: "all", label: "All deposits", test: () => true },
  { id: "answer", label: "Needs your answer", test: needsAction },
  { id: "waiting", label: "Waiting for tenant", test: (d: DepositRow) => d.status === "Proposed" },
  { id: "active", label: "Active", test: (d: DepositRow) => d.status === "Active" || d.status === "Ending" },
  { id: "stopped", label: "Stopped", test: (d: DepositRow) => d.status === "Stopped" || d.status === "UnderReview" },
  { id: "settled", label: "Settled", test: (d: DepositRow) => d.status === "Settled" || d.status === "Cancelled" },
] as const;

export type FilterId = (typeof FILTERS)[number]["id"];
export type FilterInfo = { id: FilterId; label: string; count: number };
export type ListItem = { id: string; amount: string; status: Status; statusLabel: string; meta: string; needsAction: boolean; filters: FilterId[] };
export type Summary = { held: string; heldCount: number; yieldSoFar: string; answer: number };

function meta(d: DepositRow): string {
  if (d.status === "Proposed") return "Invitation sent";
  if (d.status === "Settled") return "Released";
  if (d.status === "Stopped" || d.status === "UnderReview") return `Decision ${daysFromNow(d.review_deadline)}`;
  return `Ends ${daysFromNow(d.data.terms.end_ts)}`;
}

export function landlordList(deposits: DepositRow[] = DEPOSITS) {
  const items: ListItem[] = deposits.map((d) => ({
    id: d.id.toString(),
    amount: money(d.data.terms.amount),
    status: d.status,
    statusLabel: STATUS_LABEL[d.status],
    meta: meta(d),
    needsAction: needsAction(d),
    filters: FILTERS.filter((f) => f.test(d)).map((f) => f.id),
  }));
  const filters: FilterInfo[] = FILTERS.map((f) => ({ id: f.id, label: f.label, count: deposits.filter(f.test).length }));
  const held = deposits.filter((d) => d.status !== "Proposed" && d.status !== "Settled" && d.status !== "Cancelled");
  const summary: Summary = {
    held: money(held.reduce((s, d) => s + d.data.terms.amount, 0n)),
    heldCount: held.length,
    yieldSoFar: money(held.reduce((s, d) => s + d.accrued_yield, 0n)),
    answer: deposits.filter(needsAction).length,
  };
  return { items, filters, summary };
}
