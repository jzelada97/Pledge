import { DEPOSITS, ME_TENANT, type DepositRow } from "./fixtures";
import { nowSecs, type Formatters } from "./format";
import type { Messages } from "./i18n/messages";
import { breakdown, split } from "./split";

// What the tenant's screens derive from one deposit, shared by the list (passes) and the detail screen.
export function tenantView(d: DepositRow, { t, f }: { t: Messages; f: Formatters }) {
  const { terms, approvals, settlement } = d.data;
  const s = settlement ?? split(terms.amount, terms.amount + d.accrued_yield, 0n, terms.platform_fee_bps, terms.tenant_yield_bps);
  const b = breakdown(s, terms.amount);
  const iApproved = approvals.approved_by.includes(ME_TENANT);
  const live = d.status === "Active" || d.status === "Ending";
  const canClaim = live && nowSecs() > d.timeout_at;
  const stopped = d.status === "Stopped" || d.status === "UnderReview";
  const todo = canClaim ? t.tenant.todo.claim : live && !iApproved ? t.tenant.todo.approve : d.status === "Settled" ? t.tenant.todo.bank : undefined;
  return {
    s,
    b,
    iApproved,
    live,
    canClaim,
    stopped,
    todo,
    pass: {
      title: t.common.deposit(d.id.toString()),
      amount: f.money(terms.amount),
      statusLabel: t.status[d.status],
      facts: [
        { label: t.tenant.contractEnds, value: f.date(terms.end_ts) },
        d.status === "Settled"
          ? { label: t.tenant.youReceived, value: f.money(s.to_tenant) }
          : { label: t.tenant.comesBack, value: t.tenant.inFull },
      ],
    },
  };
}

export const myDeposits = () => DEPOSITS.filter((d) => d.data.tenant === ME_TENANT);
