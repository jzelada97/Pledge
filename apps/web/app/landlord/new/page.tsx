"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CircleCheckIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { DetailList, DetailRow } from "@/components/detail-list";
import { DevNote } from "@/components/dev-note";
import { InviteLink } from "@/components/invite-link";
import { Group } from "@/components/grouped";
import { PaneBody, PaneToolbar } from "@/components/pane";
import { StrategyPicker } from "@/components/strategy-picker";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { CONFIG } from "@/lib/fixtures";
import { money, percent, toUnits } from "@/lib/format";
import { breakdown, computeStopBond, split } from "@/lib/split";
import { DEFAULT_STRATEGY_ID, STRATEGIES, STRATEGY_COPY } from "@/lib/strategies";
import { PHASE_TEXT, useSign } from "@/lib/use-sign";
import { YIELD_POLICY_NOTE, yieldGoesTo } from "@/lib/yield-policy";

const EXAMPLE_APY = 0.065; // placeholder for the live APY read from Strategy.apy_pool

const schema = z.object({
  amount: z
    .number({ error: "Enter the deposit amount." })
    .positive("The amount must be more than 0.")
    .max(100_000, "For now, deposits go up to $100,000."),
  months: z
    .number({ error: "Enter the contract length." })
    .int("Use whole months.")
    .min(1, "At least 1 month.")
    .max(36, "Up to 36 months."),
  strategyId: z.string().refine((id) => STRATEGIES.some((s) => s.id === id && s.enabled), "Choose where to keep the deposit."),
});
type Values = z.infer<typeof schema>;

const numberInput = (onChange: (v: number | undefined) => void) => (e: React.ChangeEvent<HTMLInputElement>) =>
  onChange(e.target.value === "" ? undefined : e.target.valueAsNumber);

export default function NewDeposit() {
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { amount: 1200, months: 12, strategyId: DEFAULT_STRATEGY_ID },
    mode: "onTouched",
  });
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const { phase, run, busy } = useSign({
    success: "Deposit created. Send the link to your tenant.",
    onDone: () => setInviteUrl(`${window.location.origin}/i/8#c=example-invitation-code`),
  });

  const { amount = 0, months = 1, strategyId } = form.watch();
  const units = toUnits(Number.isFinite(amount) ? amount : 0);
  const earns = strategyId === "usdc_fixed" || strategyId === "usdc_mock";
  const exampleYield = earns ? toUnits(amount * EXAMPLE_APY * (months / 12)) : 0n;
  const b = breakdown(split(units, units + exampleYield, 0n, CONFIG.platform_fee_bps, CONFIG.tenant_yield_bps), units);
  const bond = computeStopBond(units, CONFIG.stop_bond_min, CONFIG.stop_bond_bps);
  const copy = STRATEGY_COPY[strategyId] ?? STRATEGY_COPY[DEFAULT_STRATEGY_ID];

  if (inviteUrl) {
    return (
      <>
        <PaneToolbar title="Deposit created" back={{ href: "/landlord", label: "Deposits" }} />
        <PaneBody className="max-w-xl">
          <header className="space-y-3 text-center">
            <CircleCheckIcon className="mx-auto size-12 text-success" aria-hidden />
            <h2 className="text-3xl font-semibold tracking-tight">Send this link to your tenant</h2>
            <p className="text-muted-foreground">
              They pay the {money(units)} deposit through it from their bank, whether or not they already have an account.
            </p>
          </header>
          <Group>
            <div className="py-4">
              <InviteLink url={inviteUrl} />
            </div>
          </Group>
          <Button asChild size="lg" className="self-center">
            <Link href="/landlord">Back to deposits</Link>
          </Button>
        </PaneBody>
      </>
    );
  }

  return (
    <>
      <PaneToolbar title="New deposit" back={{ href: "/landlord", label: "Deposits" }} />
      <PaneBody className="max-w-2xl">
        <header>
          <p className="text-lg text-muted-foreground">Set the amount and where it&apos;s kept. You&apos;ll get an invitation link for your tenant.</p>
        </header>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(run)} noValidate className="flex flex-col gap-8">
            <Group title="Amount and length" footer="The deposit goes back to the tenant in full when you both approve.">
              <div className="grid gap-4 py-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="amount"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Deposit amount (USD)</FormLabel>
                      <FormControl>
                        <Input type="number" inputMode="decimal" min={1} step="0.01" {...field} value={field.value ?? ""} onChange={numberInput(field.onChange)} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="months"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Contract length (months)</FormLabel>
                      <FormControl>
                        <Input type="number" inputMode="numeric" min={1} max={36} {...field} value={field.value ?? ""} onChange={numberInput(field.onChange)} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </Group>

            <section className="space-y-2">
              <h3 className="px-4 text-sm font-medium text-muted-foreground">Where the deposit is kept</h3>
              <FormField
                control={form.control}
                name="strategyId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="sr-only">Strategy</FormLabel>
                    <FormControl>
                      <StrategyPicker value={field.value} onChange={field.onChange} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <p className="px-4 text-sm text-muted-foreground">The yield is always variable. No option is free of risk.</p>
              <DevNote>Strategies and risk tiers come from factory.strategies(). APY is read live and never stored.</DevNote>
            </section>

            <Group title="Summary" footer="Example figures. The real yield can be lower, or zero.">
              <DetailList>
                <DetailRow label="Deposit" value={money(units)} strong />
                <DetailRow label="Kept in" value={copy.name} />
                <DetailRow label={`Example yield, ${months || 0} months`} value={money(exampleYield)} />
                <DetailRow indent label={`Platform fee (${percent(CONFIG.platform_fee_bps)})`} value={money(b.platformFee)} />
                {CONFIG.tenant_yield_bps > 0 && <DetailRow indent label="Tenant's share" value={money(b.tenantYield)} />}
                <DetailRow indent label="Your share" value={money(b.landlordYield)} />
                <DetailRow label="To stop the release you'd pay" value={money(bond)} />
              </DetailList>
            </Group>

            <Alert>
              <AlertTitle>Yield goes to: {yieldGoesTo(CONFIG.tenant_yield_bps, "landlord")}</AlertTitle>
              <AlertDescription>{YIELD_POLICY_NOTE}</AlertDescription>
            </Alert>

            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                You&apos;ll get an invitation link. Your tenant pays through it, whether or not they already have an account.
              </p>
              <DevNote>Always invite_hash, never a known tenant address. The code is generated in this browser and only travels in the link (#c=…).</DevNote>
              <Button type="submit" size="lg" disabled={busy} aria-busy={busy} className="w-full">
                {busy && <Spinner data-icon="inline-start" aria-hidden />}
                {busy ? PHASE_TEXT[phase as "signing" | "sending"] : "Create and get the link"}
              </Button>
            </div>
          </form>
        </Form>
      </PaneBody>
    </>
  );
}
