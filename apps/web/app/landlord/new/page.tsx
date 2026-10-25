"use client";

import { useState } from "react";
import { PolicyPicker } from "@/components/policy-picker";
import { SignButton } from "@/components/sign-button";
import { StrategyPicker } from "@/components/strategy-picker";
import { Box, Note, Row, Screen } from "@/components/wire";
import { CONFIG } from "@/lib/fixtures";
import { money, percent, toUnits } from "@/lib/format";
import { breakdown, computeStopBond, split } from "@/lib/split";
import { DEFAULT_STRATEGY_ID, STRATEGY_COPY } from "@/lib/strategies";

const EXAMPLE_APY = 0.065; // placeholder for the live APY read from Strategy.apy_pool

export default function NewDeposit() {
  const [amount, setAmount] = useState(1200);
  const [months, setMonths] = useState(12);
  const [invite, setInvite] = useState(true);
  const [tenantBps, setTenantBps] = useState(10000);
  const [strategyId, setStrategyId] = useState(DEFAULT_STRATEGY_ID);

  const units = toUnits(amount);
  const earns = strategyId === "usdc_fixed" || strategyId === "usdc_mock";
  const exampleYield = earns ? toUnits(amount * EXAMPLE_APY * (months / 12)) : 0n;
  const preview = split(units, units + exampleYield, 0n, CONFIG.platform_fee_bps, tenantBps);
  const b = breakdown(preview, units);
  const bond = computeStopBond(units, CONFIG.stop_bond_min, CONFIG.stop_bond_bps);

  return (
    <Screen title="New deposit" back="/landlord">
      <Box title="1 · Room and amount">
        <label className="flex flex-col gap-1 text-sm">
          Deposit amount (USD)
          <input
            type="number"
            min={1}
            className="rounded border border-neutral-400 p-2"
            value={amount}
            onChange={(e) => setAmount(Number(e.target.value) || 0)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Contract length (months)
          <input
            type="number"
            min={1}
            max={36}
            className="rounded border border-neutral-400 p-2"
            value={months}
            onChange={(e) => setMonths(Number(e.target.value) || 1)}
          />
        </label>
      </Box>

      <Box title="2 · Tenant">
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" checked={invite} onChange={() => setInvite(true)} /> Send an invitation link
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" checked={!invite} onChange={() => setInvite(false)} /> I already have the tenant&apos;s
          account
        </label>
        <Note>The invitation code is generated in this browser and only travels in the link (#c=…).</Note>
      </Box>

      <Box title="3 · Who gets the yield">
        <PolicyPicker bps={tenantBps} onChange={setTenantBps} />
      </Box>

      <Box title="4 · Where the deposit is kept">
        <StrategyPicker value={strategyId} onChange={setStrategyId} />
        <Note>Strategies and risk tiers come from factory.strategies(). APY is read live and never stored.</Note>
      </Box>

      <Box title="5 · Review">
        <Row label="Deposit (goes back to the tenant in full when both approve)" value={money(units)} />
        <Row label="Strategy" value={STRATEGY_COPY[strategyId].name} />
        <Row label={`Example yield over ${months} months (${STRATEGY_COPY[strategyId].apy})`} value={money(exampleYield)} />
        <Row label={`· Platform fee (${percent(CONFIG.platform_fee_bps)} of the yield)`} value={money(preview.to_treasury)} />
        <Row label="· Tenant's share of the yield" value={money(b.tenantYield)} />
        <Row label="· Your share of the yield" value={money(b.landlordYield)} />
        <Row label="Good-faith deposit if you stop the release" value={money(bond)} />
        <Note>Example only: the yield is variable and can be lower, or zero.</Note>
        <SignButton label={invite ? "Create and get the invitation link" : "Create deposit"} disabled={amount <= 0} />
      </Box>
    </Screen>
  );
}
