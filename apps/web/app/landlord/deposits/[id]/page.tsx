import { CircleCheckIcon, CircleIcon } from "lucide-react";
import { notFound } from "next/navigation";
import { ConfirmSignDialog } from "@/components/confirm-sign-dialog";
import { CopyInviteButton } from "@/components/copy-invite-button";
import { DetailList, DetailRow } from "@/components/detail-list";
import { Group } from "@/components/grouped";
import { BottomBar, PaneBody, PaneToolbar } from "@/components/pane";
import { SignButton } from "@/components/sign-button";
import { StatusBadge } from "@/components/status-badge";
import { StopDialog } from "@/components/stop-dialog";
import { Badge } from "@/components/ui/badge";
import { ME_LANDLORD, depositById } from "@/lib/fixtures";
import { getI18n } from "@/lib/i18n/server";
import { breakdown, split } from "@/lib/split";

export default async function DepositDetail({ params, searchParams }: PageProps<"/landlord/deposits/[id]">) {
  const { id } = await params;
  const { show } = await searchParams;
  const d = depositById(id);
  if (!d) notFound();

  const { t, f } = await getI18n();
  const x = t.landlord.detail;
  const { terms, approvals, dispute } = d.data;
  const landlordApproved = approvals.approved_by.includes(ME_LANDLORD);
  const tenantApproved = d.data.tenant !== null && approvals.approved_by.includes(d.data.tenant);
  const live = d.status === "Active" || d.status === "Ending";
  // Plan A (Trustless Work): el casero puede parar mientras no haya aprobado. Sin depósito por parar ni timeout.
  const canStop = live && !landlordApproved;
  const s = d.data.settlement ?? split(terms.amount, terms.amount + d.accrued_yield, 0n, terms.platform_fee_bps, terms.tenant_yield_bps);
  const b = breakdown(s, terms.amount);
  const strategy = t.strategies[terms.strategy.id];
  const back = { href: typeof show === "string" ? `/landlord?show=${show}` : "/landlord", label: t.common.deposits };

  const actions =
    d.status === "Proposed" ? (
      <>
        <ConfirmSignDialog
          trigger={x.cancel}
          title={x.cancelTitle}
          description={x.cancelBody}
          confirm={x.cancel}
          cancel={x.keepIt}
          success={x.cancelled}
        />
        <CopyInviteButton id={id} />
      </>
    ) : live && !landlordApproved ? (
      <>
        {canStop && <StopDialog />}
        <SignButton label={x.approve} success={x.approved} />
      </>
    ) : undefined;

  return (
    <>
      <PaneToolbar title={t.common.deposit(id)} back={back} actions={actions} />
      <PaneBody>
        <header className="space-y-3 text-center">
          <p className="text-5xl font-semibold tracking-tight tabular-nums">{f.money(terms.amount)}</p>
          <div className="flex flex-wrap justify-center gap-2">
            <StatusBadge status={d.status} />
            <Badge variant="outline">{t.risk[terms.strategy.risk]}</Badge>
            {terms.strategy.simulated && <Badge className="bg-warning/10 text-warning">{t.common.simulatedYield}</Badge>}
          </div>
        </header>

        {live && (
          <Group title={x.release} footer={x.releaseFooter}>
            <ul className="divide-y">
              {[
                { who: x.yourTenant, done: tenantApproved },
                { who: t.common.you, done: landlordApproved },
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

        {(d.status === "Stopped" || d.status === "UnderReview") && (
          <Group title={x.stopped} footer={x.stoppedFooter}>
            <DetailList>
              <DetailRow label={x.stoppedOn} value={f.date(dispute.stopped_ts)} />
            </DetailList>
          </Group>
        )}

        <Group title={d.data.settlement ? x.finalSplit : x.splitToday} footer={x.splitFooter}>
          <DetailList>
            <DetailRow label={x.depositBack} value={f.money(b.depositToTenant)} strong />
            {b.deduction > 0n && <DetailRow label={x.deductionToYou} value={f.money(b.deduction)} />}
            <DetailRow label={d.data.settlement ? x.yield : x.yieldSoFar} value={f.money(s.yield_total)} />
            <DetailRow indent label={x.platformFee} value={f.money(b.platformFee)} />
            {terms.tenant_yield_bps > 0 && <DetailRow indent label={t.common.tenant} value={f.money(b.tenantYield)} />}
            <DetailRow indent label={t.common.you} value={f.money(b.landlordYield)} />
          </DetailList>
        </Group>

        <Group title={x.terms} footer={x.termsFooter}>
          <DetailList>
            <DetailRow label={x.deposit} value={f.money(terms.amount)} strong />
            <DetailRow label={x.contractEnd} value={`${f.date(terms.end_ts)} (${f.daysFromNow(terms.end_ts)})`} />
            <DetailRow label={x.keptIn} value={strategy.name} />
            <DetailRow label={t.invitation.twFee} value={t.invitation.twFeeValue} />
          </DetailList>
        </Group>
      </PaneBody>
      {actions && <BottomBar className="lg:hidden">{actions}</BottomBar>}
    </>
  );
}
