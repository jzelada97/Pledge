"use client";

import { CircleCheckIcon, CircleIcon } from "lucide-react";
import { useParams, useSearchParams } from "next/navigation";
import { DetailList, DetailRow } from "@/components/detail-list";
import { Group } from "@/components/grouped";
import { InviteLink } from "@/components/invite-link";
import { useLive } from "@/components/live-provider";
import { BottomBar, PaneBody, PaneToolbar } from "@/components/pane";
import { SignButton } from "@/components/sign-button";
import { StatusBadge } from "@/components/status-badge";
import { StopDialog } from "@/components/stop-dialog";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { useI18n } from "@/lib/i18n/client";
import { shortId, useDeposit } from "@/lib/live";
import { approveRelease, stopFianza } from "@/lib/pledge";
import { breakdown, split } from "@/lib/split";

// Una fianza real del casero: aprobar la devolución (approve_milestone) o pararla (dispute_escrow), ambas
// firmadas con la passkey y enviadas por el Relayer.
export default function DepositDetail() {
  const { id } = useParams<{ id: string }>();
  const show = useSearchParams().get("show");
  const { t, f } = useI18n();
  const { address, refresh: refreshList } = useLive();
  const { row: d, refresh } = useDeposit(id);
  const x = t.landlord.detail;
  const back = { href: typeof show === "string" ? `/landlord?show=${show}` : "/landlord", label: t.common.deposits };
  const title = t.common.deposit(shortId(id));

  if (d === undefined) {
    return (
      <>
        <PaneToolbar title={title} back={back} />
        <PaneBody>
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner aria-hidden /> {t.common.loading}
          </p>
        </PaneBody>
      </>
    );
  }
  if (d === null) {
    return (
      <>
        <PaneToolbar title={x.notFound.toolbar} back={back} />
        <PaneBody>
          <h2 className="text-2xl font-semibold tracking-tight">{x.notFound.title}</h2>
          <p className="text-muted-foreground">{x.notFound.body}</p>
        </PaneBody>
      </>
    );
  }

  const { terms, approvals } = d.data;
  const landlordApproved = approvals.approved_by.includes(terms.landlord);
  const live = d.status === "Active" || d.status === "Ending";
  // Plan A (Trustless Work): el casero puede parar mientras no haya aprobado. Sin depósito por parar.
  const canStop = live && !landlordApproved;
  const s = d.data.settlement ?? split(terms.amount, terms.amount + d.accrued_yield, 0n, terms.platform_fee_bps, terms.tenant_yield_bps);
  const b = breakdown(s, terms.amount);
  const strategy = t.strategies[terms.strategy.id];
  const done = async () => {
    await Promise.all([refresh(), refreshList()]);
  };
  const inviteUrl = typeof window !== "undefined" && address ? `${window.location.origin}/i/1?l=${address}&a=${Number(terms.amount) / 1e7}${terms.end_ts ? `&e=${terms.end_ts}` : ""}` : "";

  const actions =
    live && !landlordApproved && address ? (
      <>
        {canStop && <StopDialog action={() => stopFianza(d.escrow, address)} onDone={() => void done()} />}
        <SignButton label={x.approve} success={x.approved} action={() => approveRelease(d.escrow, address)} onDone={() => void done()} />
      </>
    ) : undefined;

  return (
    <>
      <PaneToolbar title={title} back={back} actions={actions} />
      <PaneBody>
        <header className="space-y-3 text-center">
          <p className="text-5xl font-semibold tracking-tight tabular-nums">{f.money(terms.amount)}</p>
          <div className="flex flex-wrap justify-center gap-2">
            <StatusBadge status={d.status} />
            <Badge variant="outline">{t.risk[terms.strategy.risk]}</Badge>
          </div>
          {d.live.title && <p className="text-sm text-muted-foreground">{d.live.title}</p>}
        </header>

        {d.status === "Proposed" && inviteUrl && (
          <Group title={t.landlord.invite.label} footer={t.landlord.create.inviteNote}>
            <div className="py-4">
              <InviteLink url={inviteUrl} />
            </div>
          </Group>
        )}

        {live && (
          <Group title={x.release} footer={x.releaseFooter}>
            <ul className="divide-y">
              {[
                { who: t.common.you, done: landlordApproved },
                { who: x.yourTenant, done: false },
              ].map((a) => (
                <li key={a.who} className="flex min-h-11 items-center gap-3 py-3 text-sm">
                  {a.done ? <CircleCheckIcon className="size-5 text-success" aria-hidden /> : <CircleIcon className="size-5 text-muted-foreground" aria-hidden />}
                  <span className="flex-1 font-medium">{a.who}</span>
                  <span className="text-muted-foreground">{a.done ? t.common.approved : t.common.notYet}</span>
                </li>
              ))}
            </ul>
          </Group>
        )}

        {d.status === "Stopped" && (
          <Group title={x.stopped} footer={x.stoppedFooter}>
            <DetailList>
              <DetailRow label={x.staffMustDecide} value={t.common.notYet} />
            </DetailList>
          </Group>
        )}

        <Group title={d.data.settlement ? x.finalSplit : x.splitToday} footer={x.splitFooter}>
          <DetailList>
            <DetailRow label={x.depositBack} value={f.money(b.depositToTenant)} strong />
            {b.deduction > 0n && <DetailRow label={x.deductionToYou} value={f.money(b.deduction)} />}
            <DetailRow label={d.data.settlement ? x.yield : x.yieldSoFar} value={f.money(s.yield_total)} />
            {terms.tenant_yield_bps > 0 && <DetailRow indent label={t.common.tenant} value={f.money(b.tenantYield)} />}
            <DetailRow indent label={t.common.you} value={f.money(b.landlordYield)} />
          </DetailList>
        </Group>

        <Group title={x.terms} footer={x.termsFooter}>
          <DetailList>
            <DetailRow label={x.deposit} value={f.money(terms.amount)} strong />
            {terms.end_ts > 0n && <DetailRow label={x.contractEnd} value={`${f.date(terms.end_ts)} (${f.daysFromNow(terms.end_ts)})`} />}
            {d.live.claimableAt !== null && <DetailRow label={t.live.claimableFrom} value={f.date(BigInt(d.live.claimableAt))} />}
            <DetailRow label={x.keptIn} value={strategy.name} />
            <DetailRow label={t.invitation.twFee} value={t.invitation.twFeeValue} />
            <DetailRow label={t.live.contract} value={<code className="text-xs break-all">{d.escrow}</code>} />
          </DetailList>
        </Group>
      </PaneBody>
      {actions && <BottomBar className="lg:hidden">{actions}</BottomBar>}
    </>
  );
}
