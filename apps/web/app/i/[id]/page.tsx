import { LinkIcon } from "lucide-react";
import { notFound } from "next/navigation";
import { DetailList, DetailRow } from "@/components/detail-list";
import { InvitationFlow } from "@/components/invitation-flow";
import { TenantShell } from "@/components/tenant-shell";
import { Badge } from "@/components/ui/badge";
import { Group } from "@/components/grouped";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { depositById } from "@/lib/fixtures";
import { getI18n } from "@/lib/i18n/server";
import { yieldGoesTo } from "@/lib/yield-policy";

// Tenant invitation: /i/<id>#c=<code>. Everything shown is read from the chain (get_terms + config),
// never from the URL (WEB-11 v2). The id resolves to the escrow with factory.escrow_of(id).
export default async function Invitation({ params, searchParams }: PageProps<"/i/[id]">) {
  const { id } = await params;
  const { check } = await searchParams; // ?check=fail previews the WEB-14 mismatch state
  const d = depositById(id);
  if (!d) notFound();
  const { t, f } = await getI18n();
  const x = t.invitation;

  if (d.status !== "Proposed") {
    return (
      <TenantShell>
        <Empty className="rounded-2xl bg-card ring-1 ring-foreground/8">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <LinkIcon aria-hidden />
            </EmptyMedia>
            <EmptyTitle>{x.invalid.title}</EmptyTitle>
            <EmptyDescription>{x.invalid.body}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </TenantShell>
    );
  }

  const { terms } = d.data;
  const copy = t.strategies[terms.strategy.id];

  return (
    <TenantShell>
      <InvitationFlow
        amount={f.money(terms.amount)}
        termsMatch={check !== "fail"}
        simulatedRamp
        review={
          <>
            <header className="space-y-2 pt-2 text-center">
              <p className="text-sm font-medium text-muted-foreground">{x.yourDeposit}</p>
              <h1 className="text-5xl font-semibold tracking-tight tabular-nums">{f.money(terms.amount)}</h1>
              <p className="text-muted-foreground">{x.backInFull}</p>
            </header>

            <Group title={x.agreeing}>
              <DetailList>
                <DetailRow label={x.deposit} value={f.money(terms.amount)} strong />
                <DetailRow label={x.contractEnds} value={f.date(terms.end_ts)} />
                <DetailRow label={x.yieldGoesTo} value={yieldGoesTo(t, f, terms.tenant_yield_bps, "tenant")} />
                <DetailRow label={x.twFee} value={x.twFeeValue} />
                <DetailRow label={x.decidedBy} value={x.staffDecides} />
              </DetailList>
            </Group>

            <Group title={x.whereKept} footer={copy.risks}>
              <div className="flex min-h-11 flex-wrap items-center justify-between gap-2 py-3 text-sm">
                <span className="font-medium">{copy.name}</span>
                <span className="flex flex-wrap gap-2">
                  <Badge variant="outline">{t.risk[terms.strategy.risk]}</Badge>
                  {terms.strategy.simulated && <Badge className="bg-warning/10 text-warning">{t.common.simulatedYield}</Badge>}
                </span>
              </div>
            </Group>
          </>
        }
      />
    </TenantShell>
  );
}
