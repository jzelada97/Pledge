"use client";

import { CircleCheckIcon, ClockIcon, OctagonPauseIcon } from "lucide-react";
import { useParams } from "next/navigation";
import { DepositPass } from "@/components/deposit-pass";
import { DetailList, DetailRow } from "@/components/detail-list";
import { Group } from "@/components/grouped";
import { LiveProvider, LoginGate } from "@/components/live-provider";
import { BottomBar } from "@/components/pane";
import { SignButton } from "@/components/sign-button";
import { TenantShell } from "@/components/tenant-shell";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { useI18n } from "@/lib/i18n/client";
import { shortId, useDeposit } from "@/lib/live";
import { claimFianza, releaseFianza } from "@/lib/pledge";
import { tenantView } from "@/lib/tenant-deposit";
import { yieldGoesTo } from "@/lib/yield-policy";

// Una fianza real del inquilino: recuperarla cuando el casero ha aprobado (release_funds) o reclamarla
// pasado el plazo sin respuesta (#115), las dos firmadas con la passkey.
export default function TenantDeposit() {
  const { id } = useParams<{ id: string }>();
  const { t } = useI18n();
  return (
    <LiveProvider role="tenants">
      {({ address, ready, refresh }) =>
        !ready ? null : !address ? (
          <TenantShell>
            <LoginGate lead={t.live.tenantLead} className="rounded-2xl bg-card ring-1 ring-foreground/8" />
          </TenantShell>
        ) : (
          <Detail id={id} address={address} refreshList={refresh} />
        )
      }
    </LiveProvider>
  );
}

function Detail({ id, address, refreshList }: { id: string; address: string; refreshList: () => Promise<void> }) {
  const i18n = useI18n();
  const { t, f } = i18n;
  const x = t.tenant;
  const { row: d, refresh } = useDeposit(id);
  const back = { href: "/tenant", label: t.common.deposits };

  if (d === undefined) {
    return (
      <TenantShell back={back}>
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner aria-hidden /> {t.common.loading}
        </p>
      </TenantShell>
    );
  }
  if (d === null || d.data.tenant !== address) {
    return (
      <TenantShell back={back}>
        <h1 className="text-2xl font-semibold tracking-tight">{x.notFound.title}</h1>
        <p className="text-muted-foreground">{x.notFound.body}</p>
      </TenantShell>
    );
  }

  const { terms, settlement } = d.data;
  const v = tenantView(d, i18n);
  const canClaim = v.live && !v.landlordApproved && d.live.claimable;
  const waitingDeadline = v.live && !v.landlordApproved && !d.live.claimable && d.live.claimableAt !== null;
  const hasActions = (v.live && v.landlordApproved) || canClaim || d.status === "Settled";
  const done = async () => {
    await Promise.all([refresh(), refreshList()]);
  };

  return (
    <TenantShell back={back}>
      <h1 className="sr-only">{t.common.deposit(shortId(id))}</h1>
      <DepositPass {...v.pass} />

      {v.live && !v.landlordApproved && !canClaim && (
        <p className="flex items-center gap-2 text-sm font-medium">
          <CircleCheckIcon className="size-5 text-success" aria-hidden />
          {x.youApproved}
        </p>
      )}
      {waitingDeadline && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <ClockIcon className="size-5" aria-hidden />
          {t.live.claimableFrom} {f.date(BigInt(d.live.claimableAt!))}
        </p>
      )}
      {canClaim && (
        <Alert>
          <ClockIcon aria-hidden />
          <AlertTitle>{t.live.claimTitle}</AlertTitle>
          <AlertDescription>{t.live.claimBody}</AlertDescription>
        </Alert>
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
          {terms.end_ts > 0n && <DetailRow label={x.contractEnds} value={f.date(terms.end_ts)} />}
          {settlement && <DetailRow label={x.youReceived} value={f.money(v.s.to_tenant)} strong />}
          <DetailRow label={t.live.contract} value={<code className="text-xs break-all">{d.escrow}</code>} />
        </DetailList>
      </Group>

      {hasActions && (
        <BottomBar>
          {v.live && v.landlordApproved && <SignButton size="lg" label={x.approve} success={x.approved} action={() => releaseFianza(d.escrow, address)} onDone={() => void done()} />}
          {canClaim && (
            <SignButton
              size="lg"
              label={t.live.claim}
              success={t.live.claimed}
              action={async () => {
                const step = await claimFianza(d.escrow, address);
                if (step !== "done") throw new Error(t.live.claimPending);
              }}
              onDone={() => void done()}
            />
          )}
          {d.status === "Settled" && (
            <>
              <SignButton size="lg" label={x.sendToBank} success={x.sent} />
              <Badge className="mx-auto w-fit bg-warning/10 text-warning">{t.common.simulatedBank}</Badge>
            </>
          )}
        </BottomBar>
      )}
    </TenantShell>
  );
}
