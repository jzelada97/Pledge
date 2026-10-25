import { InboxIcon, OctagonPauseIcon } from "lucide-react";
import { DetailList, DetailRow } from "@/components/detail-list";
import { SignButton } from "@/components/sign-button";
import { StatusBadge } from "@/components/status-badge";
import { TenantShell } from "@/components/tenant-shell";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { DEPOSITS, ME_TENANT, type DepositRow } from "@/lib/fixtures";
import { date, money, nowSecs } from "@/lib/format";
import { breakdown, split } from "@/lib/split";
import { yieldGoesTo } from "@/lib/yield-policy";

export const dynamic = "force-dynamic"; // dates are relative to now

// Tenant home: factory.list_by_tenant → get_fianzas. Mobile-first (375 px).
export default async function TenantHome({ searchParams }: PageProps<"/tenant">) {
  const { view } = await searchParams; // ?view=empty previews the empty state
  const mine = view === "empty" ? [] : DEPOSITS.filter((d) => d.data.tenant === ME_TENANT);

  return (
    <TenantShell>
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">My deposits</h1>
        <p className="text-lg text-muted-foreground">Your deposits come back in full when you and your landlord approve.</p>
      </header>
      {mine.length === 0 ? (
        <Empty className="border bg-card">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <InboxIcon aria-hidden />
            </EmptyMedia>
            <EmptyTitle>No deposits yet</EmptyTitle>
            <EmptyDescription>When your landlord sends you an invitation link, open it to pay your deposit.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="flex flex-col gap-4">
          {mine.map((d) => (
            <li key={d.id.toString()}>
              <DepositCard d={d} />
            </li>
          ))}
        </ul>
      )}
    </TenantShell>
  );
}

function DepositCard({ d }: { d: DepositRow }) {
  const { terms, approvals, settlement } = d.data;
  const s = settlement ?? split(terms.amount, terms.amount + d.accrued_yield, 0n, terms.platform_fee_bps, terms.tenant_yield_bps);
  const b = breakdown(s, terms.amount);
  const iApproved = approvals.approved_by.includes(ME_TENANT);
  const live = d.status === "Active" || d.status === "Ending";
  const canClaim = live && nowSecs() > d.timeout_at;
  const stopped = d.status === "Stopped" || d.status === "UnderReview";
  const hasActions = (live && (canClaim || !iApproved)) || d.status === "Settled";

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <CardTitle>Deposit #{d.id.toString()}</CardTitle>
          <StatusBadge status={d.status} />
        </div>
        {terms.strategy.simulated && <Badge className="w-fit bg-warning/10 text-warning">Simulated yield</Badge>}
      </CardHeader>
      <CardContent className="space-y-4">
        <DetailList>
          <DetailRow label="Your deposit" value={money(terms.amount)} strong />
          {terms.tenant_yield_bps > 0 ? (
            <DetailRow label={settlement ? "Your yield" : "Your yield so far (variable)"} value={money(b.tenantYield)} />
          ) : (
            <DetailRow label="The yield goes to" value={yieldGoesTo(terms.tenant_yield_bps, "tenant")} />
          )}
          <DetailRow label="Contract ends" value={date(terms.end_ts)} />
          {settlement && <DetailRow label="You received" value={money(s.to_tenant)} strong />}
        </DetailList>
        {live && iApproved && <p className="text-sm text-muted-foreground">You approved. Waiting for your landlord.</p>}
        {live && !canClaim && (
          <p className="text-sm text-muted-foreground">If your landlord doesn&apos;t respond, you can claim 100 % from {date(d.timeout_at)}.</p>
        )}
        {stopped && (
          <Alert>
            <OctagonPauseIcon aria-hidden />
            <AlertTitle>Your landlord stopped the release</AlertTitle>
            <AlertDescription>
              An independent expert is reviewing it. If the staff doesn&apos;t decide by {date(d.review_deadline)}, you get your
              deposit back in full.
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
      {hasActions && (
        <CardFooter className="flex-wrap justify-end gap-2">
          {live && canClaim && <SignButton variant="outline" label="Claim my deposit" success="Deposit claimed. It's on its way." />}
          {live && !iApproved && <SignButton label="Approve release" success="Release approved" />}
          {d.status === "Settled" && (
            <>
              <Badge className="bg-warning/10 text-warning">Simulated bank transfer</Badge>
              <SignButton label="Send to my bank" success="Sent to your bank" fail />
            </>
          )}
        </CardFooter>
      )}
    </Card>
  );
}
