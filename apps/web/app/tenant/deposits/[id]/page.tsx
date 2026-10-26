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
import { getI18n } from "@/lib/i18n/server";
import { tenantView } from "@/lib/tenant-deposit";
import { yieldGoesTo } from "@/lib/yield-policy";

export const dynamic = "force-dynamic";

// One deposit, iOS style: the pass on top, what's happening, the details as a grouped list, and the action
// pinned to the bottom of the screen.
export default async function TenantDeposit({ params }: PageProps<"/tenant/deposits/[id]">) {
  const { id } = await params;
  const d = depositById(id);
  if (!d || d.data.tenant !== ME_TENANT) notFound();

  const i18n = await getI18n();
  const { t, f } = i18n;
  const x = t.tenant;
  const { terms, settlement } = d.data;
  const v = tenantView(d, i18n);
  const hasActions = (v.live && v.landlordApproved) || d.status === "Settled";

  return (
    <TenantShell back={{ href: "/tenant", label: t.common.deposits }}>
      <h1 className="sr-only">{t.common.deposit(id)}</h1>
      <DepositPass {...v.pass} />

      {v.live && !v.landlordApproved && (
        <p className="flex items-center gap-2 text-sm font-medium">
          <CircleCheckIcon className="size-5 text-success" aria-hidden />
          {x.youApproved}
        </p>
      )}
      {v.stopped && (
        <Alert>
          <OctagonPauseIcon aria-hidden />
          <AlertTitle>{x.stoppedTitle}</AlertTitle>
          <AlertDescription>{x.stoppedBody}</AlertDescription>
        </Alert>
      )}

      <Group title={x.details}>
        <DetailList>
          <DetailRow label={x.yourDeposit} value={f.money(terms.amount)} strong />
          {terms.tenant_yield_bps > 0 ? (
            <DetailRow label={settlement ? x.yourYield : x.yourYieldSoFar} value={f.money(v.b.tenantYield)} />
          ) : (
            <DetailRow label={x.yieldGoesTo} value={yieldGoesTo(t, f, terms.tenant_yield_bps, "tenant")} />
          )}
          <DetailRow label={x.contractEnds} value={f.date(terms.end_ts)} />
          {settlement && <DetailRow label={x.youReceived} value={f.money(v.s.to_tenant)} strong />}
        </DetailList>
      </Group>

      {terms.strategy.simulated && <Badge className="w-fit bg-warning/10 text-warning">{t.common.simulatedYield}</Badge>}

      {hasActions && (
        <BottomBar>
          {v.live && v.landlordApproved && <SignButton size="lg" label={x.approve} success={x.approved} />}
          {d.status === "Settled" && (
            <>
              <SignButton size="lg" label={x.sendToBank} success={x.sent} fail />
              <Badge className="mx-auto w-fit bg-warning/10 text-warning">{t.common.simulatedBank}</Badge>
            </>
          )}
        </BottomBar>
      )}
    </TenantShell>
  );
}
