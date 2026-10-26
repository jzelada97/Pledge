"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CircleCheckIcon } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
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
import { toUnits } from "@/lib/format";
import { useI18n } from "@/lib/i18n/client";
import type { Messages } from "@/lib/i18n/messages";
import { breakdown, computeStopBond, split } from "@/lib/split";
import { DEFAULT_STRATEGY_ID, STRATEGIES } from "@/lib/strategies";
import { useSign } from "@/lib/use-sign";
import { yieldGoesTo } from "@/lib/yield-policy";

const EXAMPLE_APY = 0.065; // placeholder for the live APY read from Strategy.apy_pool

const schemaFor = (e: Messages["landlord"]["create"]["errors"]) =>
  z.object({
    // Empty inputs are null (see numberInput), so they can stay empty while typing and fail here on submit
    amount: z
      .number({ error: e.amountRequired })
      .positive(e.amountPositive)
      .max(100_000, e.amountMax)
      .nullable()
      .refine((v) => v !== null, e.amountRequired),
    months: z
      .number({ error: e.monthsRequired })
      .int(e.monthsInt)
      .min(1, e.monthsMin)
      .max(36, e.monthsMax)
      .nullable()
      .refine((v) => v !== null, e.monthsRequired),
    strategyId: z.string().refine((id) => STRATEGIES.some((s) => s.id === id && s.enabled), e.strategy),
  });
type Fields = z.input<ReturnType<typeof schemaFor>>; // what the inputs hold (null while empty)
type Values = z.output<ReturnType<typeof schemaFor>>; // what a valid submit gives

// null, not undefined: react-hook-form treats undefined as "no value" and puts the default back,
// which made it impossible to delete the last digit.
const numberInput = (onChange: (v: number | null) => void) => (e: React.ChangeEvent<HTMLInputElement>) =>
  onChange(e.target.value === "" ? null : e.target.valueAsNumber);

export default function NewDeposit() {
  const { t, f } = useI18n();
  const c = t.landlord.create;
  const schema = useMemo(() => schemaFor(c.errors), [c]);
  const form = useForm<Fields, unknown, Values>({
    resolver: zodResolver(schema),
    defaultValues: { amount: null, months: null, strategyId: DEFAULT_STRATEGY_ID }, // empty, with an example as placeholder
    mode: "onTouched",
  });
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const { run, busy, phaseText } = useSign({
    success: c.success,
    onDone: () => setInviteUrl(`${window.location.origin}/i/8#c=example-invitation-code`),
  });

  const watched = form.watch();
  const { strategyId } = watched;
  const amount = Number.isFinite(watched.amount) ? (watched.amount ?? 0) : 0;
  const months = watched.months ?? 0;
  const units = toUnits(amount);
  const earns = strategyId === "usdc_fixed" || strategyId === "usdc_mock";
  const exampleYield = earns ? toUnits(amount * EXAMPLE_APY * (months / 12)) : 0n;
  const b = breakdown(split(units, units + exampleYield, 0n, CONFIG.platform_fee_bps, CONFIG.tenant_yield_bps), units);
  const bond = computeStopBond(units, CONFIG.stop_bond_min, CONFIG.stop_bond_bps);
  const copy = t.strategies[strategyId] ?? t.strategies[DEFAULT_STRATEGY_ID];

  if (inviteUrl) {
    return (
      <>
        <PaneToolbar title={c.created} back={{ href: "/landlord", label: t.common.deposits }} />
        <PaneBody className="max-w-xl">
          <header className="space-y-3 text-center">
            <CircleCheckIcon className="mx-auto size-12 text-success" aria-hidden />
            <h2 className="text-3xl font-semibold tracking-tight">{c.sendLink}</h2>
            <p className="text-muted-foreground">{c.sendLinkBody(f.money(units))}</p>
          </header>
          <Group>
            <div className="py-4">
              <InviteLink url={inviteUrl} />
            </div>
          </Group>
          <Button asChild size="lg" className="self-center">
            <Link href="/landlord">{t.common.backToDeposits}</Link>
          </Button>
        </PaneBody>
      </>
    );
  }

  return (
    <>
      <PaneToolbar title={c.title} back={{ href: "/landlord", label: t.common.deposits }} />
      <PaneBody className="max-w-2xl">
        <header>
          <p className="text-lg text-muted-foreground">{c.lead}</p>
        </header>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(run)} noValidate className="flex flex-col gap-8">
            <Group title={c.amountGroup} footer={c.amountFooter}>
              {/* Side by side, both fields share label / input / message rows (subgrid), so the inputs stay level
                  when only one label wraps or only one shows an error */}
              <div className="grid gap-4 py-4 sm:grid-cols-2 sm:grid-rows-[auto_auto_auto] sm:gap-y-2">
                <FormField
                  control={form.control}
                  name="amount"
                  render={({ field }) => (
                    <FormItem className="sm:row-span-3 sm:grid-rows-subgrid">
                      <FormLabel>{c.amount}</FormLabel>
                      <FormControl>
                        <Input type="number" inputMode="decimal" min={1} step="0.01" placeholder="1200" {...field} value={field.value ?? ""} onChange={numberInput(field.onChange)} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="months"
                  render={({ field }) => (
                    <FormItem className="sm:row-span-3 sm:grid-rows-subgrid">
                      <FormLabel>{c.months}</FormLabel>
                      <FormControl>
                        <Input type="number" inputMode="numeric" min={1} max={36} placeholder="12" {...field} value={field.value ?? ""} onChange={numberInput(field.onChange)} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </Group>

            <section className="space-y-2">
              <h3 className="px-4 text-sm font-medium text-muted-foreground">{c.strategyGroup}</h3>
              <FormField
                control={form.control}
                name="strategyId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="sr-only">{c.strategy}</FormLabel>
                    <FormControl>
                      <StrategyPicker value={field.value} onChange={field.onChange} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <p className="px-4 text-sm text-muted-foreground">{c.strategyFooter}</p>
              <DevNote>Strategies and risk tiers come from factory.strategies(). APY is read live and never stored.</DevNote>
            </section>

            <Group title={c.summary} footer={c.summaryFooter}>
              <DetailList>
                <DetailRow label={t.landlord.detail.deposit} value={f.money(units)} strong />
                <DetailRow label={t.landlord.detail.keptIn} value={copy.name} />
                <DetailRow label={c.exampleYield(months || 0)} value={f.money(exampleYield)} />
                <DetailRow indent label={c.platformFee(f.percent(CONFIG.platform_fee_bps))} value={f.money(b.platformFee)} />
                {CONFIG.tenant_yield_bps > 0 && <DetailRow indent label={c.tenantShare} value={f.money(b.tenantYield)} />}
                <DetailRow indent label={c.yourShare} value={f.money(b.landlordYield)} />
                <DetailRow label={c.stopWouldPay} value={f.money(bond)} />
              </DetailList>
            </Group>

            <Alert>
              <AlertTitle>{c.yieldGoesTo(yieldGoesTo(t, f, CONFIG.tenant_yield_bps, "landlord"))}</AlertTitle>
              <AlertDescription>{t.yieldPolicy.note}</AlertDescription>
            </Alert>

            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">{c.inviteNote}</p>
              <DevNote>Always invite_hash, never a known tenant address. The code is generated in this browser and only travels in the link (#c=…).</DevNote>
              <Button type="submit" size="lg" disabled={busy} aria-busy={busy} className="w-full">
                {busy && <Spinner data-icon="inline-start" aria-hidden />}
                {busy ? phaseText : c.submit}
              </Button>
            </div>
          </form>
        </Form>
      </PaneBody>
    </>
  );
}
