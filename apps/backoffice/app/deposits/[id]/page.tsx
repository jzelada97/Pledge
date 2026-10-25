"use client";

import { notFound, useParams } from "next/navigation";
import { useState } from "react";
import { SignButton } from "@/components/sign-button";
import { Box, Note, Row, Screen, Tag } from "@/components/wire";
import { commit } from "@/lib/commit";
import { STAFF, stoppedById, type StoppedRow } from "@/lib/fixtures";
import { STATUS_LABEL, date, daysFromNow, money, nowSecs, percent, toUnits } from "@/lib/format";
import { breakdown, split } from "@/lib/split";

export default function ResolveDepositPage() {
  const { id } = useParams<{ id: string }>();
  const d = stoppedById(id);
  if (!d) notFound();
  return <ResolveDeposit d={d} />;
}

function ResolveDeposit({ d }: { d: StoppedRow }) {
  const id = d.id.toString();
  const { terms, dispute } = d.data;
  const [expertRef, setExpertRef] = useState(dispute.expert_ref);
  const [expertName, setExpertName] = useState("");
  const [reportHash, setReportHash] = useState(dispute.report_hash);
  const [pendingReport, setPendingReport] = useState<string | null>(null);
  const [justified, setJustified] = useState<boolean | null>(null);
  const [deductionUsd, setDeductionUsd] = useState(0);

  const deduction = justified ? toUnits(deductionUsd) : 0n;
  const deadlinePassed = nowSecs() > d.review_deadline;
  const tooHigh = deduction > terms.amount;
  const s = split(terms.amount, terms.amount + d.accrued_yield, deduction, terms.platform_fee_bps, terms.tenant_yield_bps);
  const b = breakdown(s, terms.amount);

  async function onReportFile(file: File | undefined) {
    if (!file) return setPendingReport(null);
    const { hash } = await commit(new Uint8Array(await file.arrayBuffer()));
    setPendingReport(hash);
  }

  return (
    <Screen title={`Deposit #${id}`} back="/">
      <div className="flex flex-wrap items-center gap-2">
        <Tag>{STATUS_LABEL[expertRef ? "UnderReview" : d.status]}</Tag>
        <Tag>Connected as {STAFF} · staff ✓</Tag>
      </div>
      <Note>The UI checks the connected account is in terms.dispute_resolvers before showing any action.</Note>

      <Box title="Stop">
        <Row label="Deposit" value={money(terms.amount)} />
        <Row label="Stopped" value={date(dispute.stopped_ts)} />
        <Row label="Good-faith deposit held" value={money(dispute.bond_held)} />
        <Row label="Reason fingerprint" value={<code className="text-xs">{dispute.reason_hash}</code>} />
        <Row label="Review deadline" value={`${date(d.review_deadline)} (${daysFromNow(d.review_deadline)})`} />
      </Box>

      <Box title="1 · Assign an expert">
        {expertRef && <Row label="Expert reference" value={<code className="text-xs">{expertRef}</code>} />}
        <label className="flex flex-col gap-1 text-sm">
          {expertRef ? "Reassign to (clears the recorded report)" : "Expert name or reference"}
          <input className="rounded border border-neutral-400 p-2" value={expertName} onChange={(e) => setExpertName(e.target.value)} />
        </label>
        <SignButton
          label={expertRef ? "Reassign expert" : "Assign expert"}
          disabled={!expertName.trim() || deadlinePassed}
          onDone={async () => {
            setExpertRef((await commit(new TextEncoder().encode(expertName))).hash);
            setReportHash(null);
          }}
        />
      </Box>

      <Box title="2 · Record the expert's report">
        {reportHash && <Row label="Report fingerprint" value={<code className="text-xs">{reportHash}</code>} />}
        <input type="file" disabled={!expertRef} onChange={(e) => onReportFile(e.target.files?.[0])} className="text-sm" />
        {pendingReport && <Row label="New fingerprint" value={<code className="text-xs">{pendingReport}</code>} />}
        <Note>The file never leaves this computer: only its salted SHA-256 is recorded.</Note>
        <SignButton label="Record report" disabled={!pendingReport} onDone={() => setReportHash(pendingReport)} />
      </Box>

      <Box title="3 · Resolve">
        <fieldset className="flex flex-col gap-1 text-sm">
          <legend className="mb-1 font-medium">Was the stop justified?</legend>
          <label className="flex items-center gap-2">
            <input type="radio" name="justified" checked={justified === true} onChange={() => setJustified(true)} />
            Yes: the good-faith deposit goes back to the landlord
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="justified" checked={justified === false} onChange={() => setJustified(false)} />
            No: the good-faith deposit goes to the treasury, which pays the expert. Deduction is 0.
          </label>
        </fieldset>
        <label className="flex flex-col gap-1 text-sm">
          Deduction to the landlord (USD, max {money(terms.amount)})
          <input
            type="number"
            min={0}
            disabled={justified !== true}
            className="rounded border border-neutral-400 p-2 disabled:opacity-40"
            value={justified === true ? deductionUsd : 0}
            onChange={(e) => setDeductionUsd(Number(e.target.value) || 0)}
          />
        </label>
        {tooHigh && <p className="text-sm text-red-700">The deduction can&apos;t be higher than the deposit.</p>}

        <div className="flex flex-col gap-1 rounded bg-neutral-100 p-3">
          <p className="text-xs font-semibold uppercase text-neutral-500">Settlement preview (estimated)</p>
          <Row label="Deposit back to the tenant" value={money(b.depositToTenant)} />
          <Row label="Deduction to the landlord" value={money(b.deduction)} />
          <Row label="Yield so far (variable)" value={money(s.yield_total)} />
          <Row label={`· Platform fee (${percent(terms.platform_fee_bps)})`} value={money(b.platformFee)} />
          <Row label="· Tenant" value={money(b.tenantYield)} />
          <Row label="· Landlord" value={money(b.landlordYield)} />
          <Row
            label="Good-faith deposit"
            value={justified === null ? "—" : `${money(dispute.bond_held)} → ${justified ? "landlord" : "treasury"}`}
          />
        </div>
        <Note>Real numbers come from escrow.preview_settlement(deduction) once the contract is deployed.</Note>

        <SignButton label="Resolve" disabled={!reportHash || justified === null || tooHigh || deadlinePassed} />
        {!reportHash && <p className="text-sm text-neutral-600">Record the expert&apos;s report before resolving.</p>}
      </Box>
    </Screen>
  );
}
