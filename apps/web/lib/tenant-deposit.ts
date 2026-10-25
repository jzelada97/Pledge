import { DEPOSITS, ME_TENANT, type DepositRow } from "./fixtures";
import { date, money, nowSecs } from "./format";
import { breakdown, split } from "./split";

// What the tenant's screens derive from one deposit, shared by the list (passes) and the detail screen.
export function tenantView(d: DepositRow) {
  const { terms, approvals, settlement } = d.data;
  const s = settlement ?? split(terms.amount, terms.amount + d.accrued_yield, 0n, terms.platform_fee_bps, terms.tenant_yield_bps);
  const b = breakdown(s, terms.amount);
  const iApproved = approvals.approved_by.includes(ME_TENANT);
  const live = d.status === "Active" || d.status === "Ending";
  const canClaim = live && nowSecs() > d.timeout_at;
  const stopped = d.status === "Stopped" || d.status === "UnderReview";
  const todo = canClaim ? "You can claim it now" : live && !iApproved ? "Waiting for your approval" : d.status === "Settled" ? "Ready to send to your bank" : undefined;
  return {
    s,
    b,
    iApproved,
    live,
    canClaim,
    stopped,
    todo,
    pass: {
      id: d.id.toString(),
      amount: money(terms.amount),
      status: d.status,
      facts: [
        { label: "Contract ends", value: date(terms.end_ts) },
        { label: d.status === "Settled" ? "You received" : "Comes back", value: d.status === "Settled" ? money(s.to_tenant) : "In full" },
      ],
    },
  };
}

export const myDeposits = () => DEPOSITS.filter((d) => d.data.tenant === ME_TENANT);
