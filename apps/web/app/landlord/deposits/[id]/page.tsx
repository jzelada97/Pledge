import { CircleCheckIcon, CircleIcon, InfoIcon } from "lucide-react";
import { notFound } from "next/navigation";
import { ConfirmSignDialog } from "@/components/confirm-sign-dialog";
import { CopyInviteButton } from "@/components/copy-invite-button";
import { DetailList, DetailRow } from "@/components/detail-list";
import { PageHeader } from "@/components/page-header";
import { SignButton } from "@/components/sign-button";
import { StatusBadge } from "@/components/status-badge";
import { StopDialog } from "@/components/stop-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ME_LANDLORD, depositById } from "@/lib/fixtures";
import { date, daysFromNow, money, nowSecs, percent } from "@/lib/format";
import { breakdown, split } from "@/lib/split";
import { RISK_LABEL, STRATEGY_COPY } from "@/lib/strategies";
import { yieldGoesTo } from "@/lib/yield-policy";

export default async function DepositDetail({ params }: PageProps<"/landlord/deposits/[id]">) {
  const { id } = await params;
  const d = depositById(id);
  if (!d) notFound();

  const { terms, approvals, dispute } = d.data;
  const landlordApproved = approvals.approved_by.includes(ME_LANDLORD);
  const tenantApproved = d.data.tenant !== null && approvals.approved_by.includes(d.data.tenant);
  const live = d.status === "Active" || d.status === "Ending";
  const canStop = live && !landlordApproved && nowSecs() <= d.timeout_at;
  const s = d.data.settlement ?? split(terms.amount, terms.amount + d.accrued_yield, 0n, terms.platform_fee_bps, terms.tenant_yield_bps);
  const b = breakdown(s, terms.amount);
  const strategy = STRATEGY_COPY[terms.strategy.id];

  const actions =
    d.status === "Proposed" ? (
      <>
        <ConfirmSignDialog
          trigger="Cancel deposit"
          title="Cancel this deposit?"
          description="The invitation link stops working and your tenant can no longer pay it. This can't be undone."
          confirm="Cancel deposit"
          success="Deposit cancelled"
        />
        <CopyInviteButton id={id} />
      </>
    ) : live && !landlordApproved ? (
      <>
        {canStop && <StopDialog bond={terms.stop_bond} />}
        <SignButton label="Approve release" success="Release approved" />
      </>
    ) : undefined;

  return (
    <>
      <PageHeader
        title={`Deposit #${id}`}
        back={{ href: "/landlord", label: "Deposits" }}
        badges={
          <>
            <StatusBadge status={d.status} />
            <Badge variant="outline">{RISK_LABEL[terms.strategy.risk]}</Badge>
            {terms.strategy.simulated && <Badge className="bg-warning/10 text-warning">Simulated yield</Badge>}
          </>
        }
        actions={actions}
      />

      {live && (
        <Alert>
          <InfoIcon aria-hidden />
          <AlertTitle>The second approval settles the deposit</AlertTitle>
          <AlertDescription>
            Once you approve, you can no longer stop it. If you don&apos;t respond, your tenant can claim it {daysFromNow(d.timeout_at)}.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Terms</CardTitle>
            <CardDescription>Fixed when the deposit was created.</CardDescription>
          </CardHeader>
          <CardContent>
            <DetailList>
              <DetailRow label="Deposit" value={money(terms.amount)} strong />
              <DetailRow label="Contract end" value={`${date(terms.end_ts)} (${daysFromNow(terms.end_ts)})`} />
              <DetailRow label="Kept in" value={strategy.name} />
              <DetailRow label="Yield after the platform fee goes to" value={yieldGoesTo(terms.tenant_yield_bps, "landlord")} />
              <DetailRow label="Platform fee (on the yield only)" value={percent(terms.platform_fee_bps)} />
              <DetailRow label="Good-faith deposit to stop" value={money(terms.stop_bond)} />
            </DetailList>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{d.data.settlement ? "Final split" : "Split if released today"}</CardTitle>
            <CardDescription>The deposit and the yield are always shown apart. The deposit never pays fees.</CardDescription>
          </CardHeader>
          <CardContent>
            <DetailList>
              <DetailRow label="Deposit back to the tenant" value={money(b.depositToTenant)} strong />
              {b.deduction > 0n && <DetailRow label="Deduction to you" value={money(b.deduction)} />}
              <DetailRow label={d.data.settlement ? "Yield" : "Yield so far (estimated, variable)"} value={money(s.yield_total)} />
              <DetailRow indent label="Platform fee" value={money(b.platformFee)} />
              {terms.tenant_yield_bps > 0 && <DetailRow indent label="Tenant" value={money(b.tenantYield)} />}
              <DetailRow indent label="You" value={money(b.landlordYield)} />
            </DetailList>
          </CardContent>
        </Card>

        {live && (
          <Card>
            <CardHeader>
              <CardTitle>Release</CardTitle>
              <CardDescription>Both of you need to approve.</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3 text-sm">
                {[
                  { who: "Your tenant", done: tenantApproved },
                  { who: "You", done: landlordApproved },
                ].map((a) => (
                  <li key={a.who} className="flex items-center gap-2">
                    {a.done ? <CircleCheckIcon className="size-5 text-success" aria-hidden /> : <CircleIcon className="size-5 text-muted-foreground" aria-hidden />}
                    <span className="font-medium">{a.who}</span>
                    <span className="text-muted-foreground">{a.done ? "approved" : "hasn't approved yet"}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {(d.status === "Stopped" || d.status === "UnderReview") && (
          <Card>
            <CardHeader>
              <CardTitle>Release stopped</CardTitle>
              <CardDescription>An independent expert reviews it and the staff decides.</CardDescription>
            </CardHeader>
            <CardContent>
              <DetailList>
                <DetailRow label="Stopped on" value={date(dispute.stopped_ts)} />
                <DetailRow label="Good-faith deposit held" value={money(dispute.bond_held)} />
                <DetailRow label="Expert assigned" value={dispute.expert_ref ? "Yes" : "Not yet"} />
                <DetailRow label="Staff must decide" value={daysFromNow(d.review_deadline)} />
              </DetailList>
              <p className="mt-4 text-sm text-muted-foreground">
                If the staff doesn&apos;t decide in time, the tenant gets the deposit back and you get your good-faith deposit back.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
