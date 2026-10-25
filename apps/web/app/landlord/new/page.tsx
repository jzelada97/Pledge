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
import { PageHeader } from "@/components/page-header";
import { StrategyPicker } from "@/components/strategy-picker";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
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
        <PageHeader title="Deposit created" back={{ href: "/landlord", label: "Deposits" }} />
        <Card className="max-w-2xl">
          <CardHeader>
            <CircleCheckIcon className="size-6 text-success" aria-hidden />
            <CardTitle className="text-xl">Send this link to your tenant</CardTitle>
            <CardDescription>
              They pay the {money(units)} deposit through it from their bank, whether or not they already have an account.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <InviteLink url={inviteUrl} />
          </CardContent>
          <CardFooter className="justify-end">
            <Button asChild>
              <Link href="/landlord">Back to deposits</Link>
            </Button>
          </CardFooter>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="New deposit"
        lead="Set the amount and where it's kept. You'll get an invitation link for your tenant."
        back={{ href: "/landlord", label: "Deposits" }}
      />
      <Form {...form}>
        <form onSubmit={form.handleSubmit(run)} noValidate className="grid gap-6 lg:grid-cols-3">
          <div className="flex flex-col gap-6 lg:col-span-2">
            <Card>
              <CardHeader>
                <CardTitle>Amount and length</CardTitle>
                <CardDescription>The deposit goes back to the tenant in full when you both approve.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
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
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Where the deposit is kept</CardTitle>
                <CardDescription>The yield is always variable. No option is free of risk.</CardDescription>
              </CardHeader>
              <CardContent>
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
                <DevNote>Strategies and risk tiers come from factory.strategies(). APY is read live and never stored.</DevNote>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Tenant</CardTitle>
                <CardDescription>
                  You&apos;ll get an invitation link. Your tenant pays through it, whether or not they already have an account.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <DevNote>Always invite_hash, never a known tenant address. The code is generated in this browser and only travels in the link (#c=…).</DevNote>
              </CardContent>
            </Card>
          </div>

          <aside className="lg:sticky lg:top-6 lg:self-start">
            <Card>
              <CardHeader>
                <CardTitle>Summary</CardTitle>
                <CardDescription>Example figures. The real yield can be lower, or zero.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <DetailList>
                  <DetailRow label="Deposit" value={money(units)} strong />
                  <DetailRow label="Kept in" value={copy.name} />
                  <DetailRow label={`Example yield, ${months || 0} months`} value={money(exampleYield)} />
                  <DetailRow indent label={`Platform fee (${percent(CONFIG.platform_fee_bps)})`} value={money(b.platformFee)} />
                  {CONFIG.tenant_yield_bps > 0 && <DetailRow indent label="Tenant's share" value={money(b.tenantYield)} />}
                  <DetailRow indent label="Your share" value={money(b.landlordYield)} />
                  <DetailRow label="To stop the release you'd pay" value={money(bond)} />
                </DetailList>
                <Alert>
                  <AlertTitle>Yield goes to: {yieldGoesTo(CONFIG.tenant_yield_bps, "landlord")}</AlertTitle>
                  <AlertDescription>{YIELD_POLICY_NOTE}</AlertDescription>
                </Alert>
              </CardContent>
              <CardFooter className="justify-end">
                <Button type="submit" disabled={busy} aria-busy={busy}>
                  {busy && <Spinner data-icon="inline-start" aria-hidden />}
                  {busy ? PHASE_TEXT[phase as "signing" | "sending"] : "Create and get the link"}
                </Button>
              </CardFooter>
            </Card>
          </aside>
        </form>
      </Form>
    </>
  );
}
