import { LinkIcon } from "lucide-react";
import { notFound } from "next/navigation";
import { DetailList, DetailRow } from "@/components/detail-list";
import { InvitationFlow } from "@/components/invitation-flow";
import { TenantShell } from "@/components/tenant-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { depositById } from "@/lib/fixtures";
import { date, money, percent } from "@/lib/format";
import { RISK_LABEL, STRATEGY_COPY } from "@/lib/strategies";
import { yieldGoesTo } from "@/lib/yield-policy";

// Tenant invitation: /i/<id>#c=<code>. Everything shown is read from the chain (get_terms + config),
// never from the URL (WEB-11 v2). The id resolves to the escrow with factory.escrow_of(id).
export default async function Invitation({ params, searchParams }: PageProps<"/i/[id]">) {
  const { id } = await params;
  const { check } = await searchParams; // ?check=fail previews the WEB-14 mismatch state
  const d = depositById(id);
  if (!d) notFound();

  if (d.status !== "Proposed") {
    return (
      <TenantShell>
        <Empty className="border bg-card">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <LinkIcon aria-hidden />
            </EmptyMedia>
            <EmptyTitle>This link is no longer valid</EmptyTitle>
            <EmptyDescription>The deposit was already paid or cancelled. Ask your landlord to send you a new invitation.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </TenantShell>
    );
  }

  const { terms } = d.data;
  const copy = STRATEGY_COPY[terms.strategy.id];
  const reviewDays = Number(terms.review_timeout_secs) / 86_400;

  return (
    <TenantShell>
      <header className="space-y-2">
        <p className="text-sm font-medium text-primary">Invitation from your landlord</p>
        <h1 className="text-3xl font-semibold tracking-tight">Your room deposit</h1>
        <p className="text-lg text-muted-foreground">
          {money(terms.amount)}, back to you in full when you and your landlord approve.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>What you&apos;re agreeing to</CardTitle>
        </CardHeader>
        <CardContent>
          <DetailList>
            <DetailRow label="Deposit" value={money(terms.amount)} strong />
            <DetailRow label="Contract ends" value={date(terms.end_ts)} />
            <DetailRow label="If your landlord doesn't respond" value={`Claim it from ${date(d.timeout_at)}`} />
            <DetailRow label="The yield goes to" value={yieldGoesTo(terms.tenant_yield_bps, "tenant")} />
            <DetailRow label="Platform fee (on the yield only)" value={percent(terms.platform_fee_bps)} />
            <DetailRow label="Your landlord pays to stop the release" value={money(terms.stop_bond)} />
            <DetailRow label="If stopped, decided by" value={`Fianzas staff, within ${reviewDays} days`} />
          </DetailList>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Where your deposit is kept</CardTitle>
          <CardDescription>{copy.name}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">{RISK_LABEL[terms.strategy.risk]}</Badge>
            {terms.strategy.simulated && <Badge className="bg-warning/10 text-warning">Simulated yield</Badge>}
          </div>
          <p className="text-sm text-muted-foreground">{copy.risks}</p>
        </CardContent>
      </Card>

      <section aria-labelledby="pay-title" className="space-y-4">
        <h2 id="pay-title" className="text-xl font-semibold tracking-tight">
          Pay your deposit
        </h2>
        <InvitationFlow amount={money(terms.amount)} termsMatch={check !== "fail"} simulatedRamp />
      </section>
    </TenantShell>
  );
}
