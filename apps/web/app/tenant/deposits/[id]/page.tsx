import { CircleCheckIcon, OctagonPauseIcon } from "lucide-react";
import { notFound } from "next/navigation";
import { DepositPass } from "@/components/deposit-pass";
import { DetailList, DetailRow } from "@/components/detail-list";
import { Group } from "@/components/grouped";
import { BottomBar } from "@/components/pane";
import { SignButton } from "@/components/sign-button";
import { TenantShell } from "@/components/tenant-shell";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ME_TENANT, depositById } from "@/lib/fixtures";
import { date, money } from "@/lib/format";
import { tenantView } from "@/lib/tenant-deposit";
import { yieldGoesTo } from "@/lib/yield-policy";

export const dynamic = "force-dynamic";

// One deposit, iOS style: the pass on top, what's happening, the details as a grouped list, and the action
// pinned to the bottom of the screen.
export default async function TenantDeposit({ params }: PageProps<"/tenant/deposits/[id]">) {
  const { id } = await params;
  const d = depositById(id);
  if (!d || d.data.tenant !== ME_TENANT) notFound();

  const { terms, settlement } = d.data;
  const v = tenantView(d);
  const hasActions = (v.live && (v.canClaim || !v.iApproved)) || d.status === "Settled";

  return (
    <TenantShell back={{ href: "/tenant", label: "Deposits" }}>
      <h1 className="sr-only">Deposit #{id}</h1>
      <DepositPass {...v.pass} />

      {v.live && v.iApproved && (
        <p className="flex items-center gap-2 text-sm font-medium">
          <CircleCheckIcon className="size-5 text-success" aria-hidden />
          You approved. Waiting for your landlord.
        </p>
      )}
      {v.stopped && (
        <Alert>
          <OctagonPauseIcon aria-hidden />
          <AlertTitle>Your landlord stopped the release</AlertTitle>
          <AlertDescription>
            An independent expert is reviewing it. If the staff doesn&apos;t decide by {date(d.review_deadline)}, you get your
            deposit back in full.
          </AlertDescription>
        </Alert>
      )}

      <Group
        title="Details"
        footer={v.live && !v.canClaim ? `If your landlord doesn't respond, you can claim 100 % from ${date(d.timeout_at)}.` : undefined}
      >
        <DetailList>
          <DetailRow label="Your deposit" value={money(terms.amount)} strong />
          {terms.tenant_yield_bps > 0 ? (
            <DetailRow label={settlement ? "Your yield" : "Your yield so far (variable)"} value={money(v.b.tenantYield)} />
          ) : (
            <DetailRow label="The yield goes to" value={yieldGoesTo(terms.tenant_yield_bps, "tenant")} />
          )}
          <DetailRow label="Contract ends" value={date(terms.end_ts)} />
          {settlement && <DetailRow label="You received" value={money(v.s.to_tenant)} strong />}
        </DetailList>
      </Group>

      {terms.strategy.simulated && (
        <Badge className="w-fit bg-warning/10 text-warning">Simulated yield</Badge>
      )}

      {hasActions && (
        <BottomBar>
          {v.live && v.canClaim && <SignButton size="lg" variant="outline" label="Claim my deposit" success="Deposit claimed. It's on its way." />}
          {v.live && !v.iApproved && <SignButton size="lg" label="Approve release" success="Release approved" />}
          {d.status === "Settled" && (
            <>
              <SignButton size="lg" label="Send to my bank" success="Sent to your bank" fail />
              <Badge className="mx-auto w-fit bg-warning/10 text-warning">Simulated bank transfer</Badge>
            </>
          )}
        </BottomBar>
      )}
    </TenantShell>
  );
}
