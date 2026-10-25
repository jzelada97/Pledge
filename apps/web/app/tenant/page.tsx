import { SignButton } from "@/components/sign-button";
import { Box, Note, Row, Screen, Tag } from "@/components/wire";
import { DEPOSITS, ME_TENANT, type DepositRow } from "@/lib/fixtures";
import { STATUS_LABEL, date, money, nowSecs } from "@/lib/format";
import { breakdown, split } from "@/lib/split";
import { yieldGoesTo } from "@/lib/yield-policy";

export const dynamic = "force-dynamic"; // dates are relative to now

// Tenant home: factory.list_by_tenant → get_fianzas. Mobile-first (375 px).
export default function TenantHome() {
  const mine = DEPOSITS.filter((d) => d.data.tenant === ME_TENANT);
  return (
    <Screen title="My deposits" back="/" narrow>
      {mine.map((d) => (
        <DepositCard key={d.id.toString()} d={d} />
      ))}
    </Screen>
  );
}

function DepositCard({ d }: { d: DepositRow }) {
  const { terms, approvals, settlement } = d.data;
  const s = settlement ?? split(terms.amount, terms.amount + d.accrued_yield, 0n, terms.platform_fee_bps, terms.tenant_yield_bps);
  const b = breakdown(s, terms.amount);
  const iApproved = approvals.approved_by.includes(ME_TENANT);
  const live = d.status === "Active" || d.status === "Ending";
  const canClaim = live && nowSecs() > d.timeout_at;

  return (
    <Box title={`Deposit #${d.id}`}>
      <Tag>{STATUS_LABEL[d.status]}</Tag>
      <Row label="Your deposit" value={money(terms.amount)} />
      {terms.tenant_yield_bps > 0 ? (
        <Row label={settlement ? "Your yield" : "Your yield so far (variable)"} value={money(b.tenantYield)} />
      ) : (
        <Row label="The yield goes to" value={yieldGoesTo(terms.tenant_yield_bps, "tenant")} />
      )}
      <Row label="Contract ends" value={date(terms.end_ts)} />
      {terms.strategy.simulated && <Tag>Simulated yield</Tag>}

      {live && !iApproved && <SignButton label="Approve release" />}
      {live && iApproved && <p className="text-sm">You approved. Waiting for your landlord.</p>}
      {live && (
        <>
          <SignButton label="Claim my deposit" disabled={!canClaim} />
          {!canClaim && (
            <Note>If your landlord doesn&apos;t respond, you can claim 100 % from {date(d.timeout_at)}.</Note>
          )}
        </>
      )}

      {(d.status === "Stopped" || d.status === "UnderReview") && (
        <Note>
          Your landlord stopped the release and an expert is reviewing it. If the staff doesn&apos;t decide by{" "}
          {date(d.review_deadline)}, you get your deposit back in full.
        </Note>
      )}

      {d.status === "Settled" && (
        <>
          <Row label="You received" value={money(s.to_tenant)} />
          <Tag>Simulated bank transfer</Tag>
          <SignButton label="Send to my bank" />
        </>
      )}
    </Box>
  );
}
