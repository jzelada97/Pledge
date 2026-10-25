import { notFound } from "next/navigation";
import { SignButton } from "@/components/sign-button";
import { StopPanel } from "@/components/stop-panel";
import { Box, Btn, Note, Row, Screen, Tag } from "@/components/wire";
import { ME_LANDLORD, depositById } from "@/lib/fixtures";
import { STATUS_LABEL, date, daysFromNow, money, nowSecs, percent } from "@/lib/format";
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
  const s =
    d.data.settlement ??
    split(terms.amount, terms.amount + d.accrued_yield, 0n, terms.platform_fee_bps, terms.tenant_yield_bps);
  const b = breakdown(s, terms.amount);

  return (
    <Screen title={`Deposit #${id}`} back="/landlord">
      <div className="flex gap-2">
        <Tag>{STATUS_LABEL[d.status]}</Tag>
        <Tag>{STRATEGY_COPY[terms.strategy.id].name}</Tag>
        <Tag>{RISK_LABEL[terms.strategy.risk]}</Tag>
        {terms.strategy.simulated && <Tag>Simulated yield</Tag>}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Box title="Terms">
          <Row label="Deposit" value={money(terms.amount)} />
          <Row label="Contract end" value={`${date(terms.end_ts)} (${daysFromNow(terms.end_ts)})`} />
          <Row label="Yield after the platform fee goes to" value={yieldGoesTo(terms.tenant_yield_bps, "landlord")} />
          <Row label="Platform fee (on the yield only)" value={percent(terms.platform_fee_bps)} />
          <Row label="Good-faith deposit to stop" value={money(terms.stop_bond)} />
          {live && <Row label="If you don't respond, the tenant can claim" value={daysFromNow(d.timeout_at)} />}
        </Box>

        <Box title={d.data.settlement ? "Final split" : "Split if released today (estimated)"}>
          <Row label="Deposit back to the tenant" value={money(b.depositToTenant)} />
          {b.deduction > 0n && <Row label="Deduction to you" value={money(b.deduction)} />}
          <Row label={d.data.settlement ? "Yield (variable)" : "Yield so far (variable)"} value={money(s.yield_total)} />
          <Row label="· Platform fee" value={money(b.platformFee)} />
          {terms.tenant_yield_bps > 0 && <Row label="· Tenant" value={money(b.tenantYield)} />}
          <Row label="· You" value={money(b.landlordYield)} />
          <Note>The deposit and the yield are always shown apart. The deposit itself never pays fees.</Note>
        </Box>
      </div>

      {d.status === "Proposed" && (
        <Box title="Waiting for the tenant">
          <Btn secondary>Copy invitation link</Btn>
          <SignButton label="Cancel this deposit" />
        </Box>
      )}

      {live && (
        <Box title="Release">
          <Row label="Tenant" value={tenantApproved ? "Approved the release" : "Not yet"} />
          <Row label="You" value={landlordApproved ? "Approved the release" : "Not yet"} />
          {!landlordApproved && <SignButton label="Approve release" />}
          {canStop && <StopPanel bond={terms.stop_bond} />}
          <Note>The second approval settles the deposit. Once you approve, you can no longer stop it.</Note>
        </Box>
      )}

      {(d.status === "Stopped" || d.status === "UnderReview") && (
        <Box title="Release stopped">
          <Row label="Stopped" value={date(dispute.stopped_ts)} />
          <Row label="Good-faith deposit held" value={money(dispute.bond_held)} />
          <Row label="Expert assigned" value={dispute.expert_ref ? "Yes" : "Not yet"} />
          <Row label="Staff must resolve" value={daysFromNow(d.review_deadline)} />
          <Note>If the staff doesn&apos;t resolve in time, the tenant gets the deposit back and you get your good-faith deposit back.</Note>
        </Box>
      )}
    </Screen>
  );
}
