"use client";

import { notFound, useParams } from "next/navigation";
import { useState } from "react";
import { SignButton } from "@/components/sign-button";
import { Box, Note, Row, Screen, Tag } from "@/components/wire";
import { STAFF, stoppedById, type StoppedRow } from "@/lib/fixtures";
import { STATUS_LABEL, date, money, percent, toUnits } from "@/lib/format";
import { breakdown, split } from "@/lib/split";

export default function ResolveDepositPage() {
  const { id } = useParams<{ id: string }>();
  const d = stoppedById(id);
  if (!d) notFound();
  return <ResolveDeposit d={d} />;
}

// Resolving a stopped deposit is two steps by the staff: resolve-dispute (deduction to the landlord, the rest
// to the tenant) and then withdraw-remaining-funds for the leftover yield (platform fee, then jurisdiction).
function ResolveDeposit({ d }: { d: StoppedRow }) {
  const id = d.id.toString();
  const { terms, dispute } = d.data;
  const [justified, setJustified] = useState<boolean | null>(null);
  const [deductionUsd, setDeductionUsd] = useState(0);
  const [resolved, setResolved] = useState(false);

  const deduction = justified ? toUnits(deductionUsd) : 0n;
  const tooHigh = deduction > terms.amount;
  const s = split(terms.amount, terms.amount + d.accrued_yield, deduction, terms.platform_fee_bps, terms.tenant_yield_bps);
  const b = breakdown(s, terms.amount);

  return (
    <Screen title={`Deposit #${id}`} back="/">
      <div className="flex flex-wrap items-center gap-2">
        <Tag>{STATUS_LABEL[resolved ? "Settled" : d.status]}</Tag>
        <Tag>Connected as {STAFF} · staff ✓</Tag>
      </div>
      <Note>The UI checks the connected account is the escrow&apos;s dispute resolver before showing any action.</Note>

      <Box title="Stop">
        <Row label="Deposit" value={money(terms.amount)} />
        <Row label="Stopped" value={date(dispute.stopped_ts)} />
        <Row label="Yield so far (variable)" value={money(d.accrued_yield)} />
      </Box>

      <Box title="1 · Resolve">
        <fieldset className="flex flex-col gap-1 text-sm">
          <legend className="mb-1 font-medium">Was the stop justified?</legend>
          <label className="flex items-center gap-2">
            <input type="radio" name="justified" checked={justified === true} onChange={() => setJustified(true)} />
            Yes: the landlord can get a deduction from the deposit
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="justified" checked={justified === false} onChange={() => setJustified(false)} />
            No: the whole deposit goes back to the tenant. Deduction is 0.
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
            onChange={(e) => setDeductionUsd(Math.max(0, Number(e.target.value) || 0))} // min={0} alone doesn't stop typing "-50"
          />
        </label>
        {tooHigh && <p className="text-sm text-red-700">The deduction can&apos;t be higher than the deposit.</p>}

        <div className="flex flex-col gap-1 rounded bg-neutral-100 p-3">
          <p className="text-xs font-semibold uppercase text-neutral-500">Resolution preview (estimated)</p>
          <Row label="Deposit back to the tenant" value={money(b.depositToTenant)} />
          <Row label="Deduction to the landlord" value={money(b.deduction)} />
        </div>
        <Note>
          Trustless Work keeps 0.3% of each payout. Real numbers come from GET /api/fianzas/v1/fianzas/{"{id}"}/preview-settlement.
        </Note>

        <SignButton label="Resolve" disabled={justified === null || tooHigh || resolved} onDone={() => setResolved(true)} />
      </Box>

      <Box title="2 · Share the leftover yield">
        <Row label="Yield so far (variable)" value={money(s.yield_total)} />
        <Row label={`· Platform fee (${percent(terms.platform_fee_bps)})`} value={money(b.platformFee)} />
        {terms.tenant_yield_bps > 0 && <Row label="· Tenant" value={money(b.tenantYield)} />}
        <Row label="· Landlord" value={money(b.landlordYield)} />
        <Note>After resolving, the yield stays in the escrow and is shared by the jurisdiction&apos;s rule (Portugal: to the landlord).</Note>
        <SignButton label="Share yield" disabled={!resolved} />
        {!resolved && <p className="text-sm text-neutral-600">Resolve the deposit first.</p>}
      </Box>
    </Screen>
  );
}
