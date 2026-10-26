"use client";

import { CircleCheckIcon, LandmarkIcon, OctagonXIcon, ScanFaceIcon, ShieldCheckIcon } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { DevNote } from "@/components/dev-note";
import { BottomBar } from "@/components/pane";
import { SignButton } from "@/components/sign-button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/client";
import { addTestMoney, createFianza, ensureAccount, fundFianza } from "@/lib/pledge";

type Step = "review" | 0 | 1 | 2 | "paid";

// iOS onboarding style: first the terms (server-rendered, passed as `review`), then one full screen per step
// (sign in or create account → add money from the bank → accept and pay), each with its action at the bottom.
export function InvitationFlow(props: { amount: string; amountDec: string; landlord: string; endTs?: number; termsMatch: boolean; simulatedRamp: boolean; review: ReactNode }) {
  const { t } = useI18n();
  const x = t.invitation;
  const [step, setStep] = useState<Step>("review");
  const [tenant, setTenant] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (step !== "review") heading.current?.focus(); // a new screen: move focus to its title
  }, [step]);

  if (step === "review") {
    return (
      <>
        {props.review}
        <BottomBar>
          <Button size="lg" onClick={() => setStep(0)}>
            {x.continue}
          </Button>
        </BottomBar>
      </>
    );
  }

  if (step === "paid") {
    return (
      <Screen ref={heading} icon={CircleCheckIcon} iconClass="bg-success/10 text-success" title={x.paid.title} description={x.paid.body}>
        <BottomBar>
          <Button asChild size="lg">
            <Link href="/tenant">{x.paid.cta}</Link>
          </Button>
        </BottomBar>
      </Screen>
    );
  }

  return (
    <>
      <ol aria-label={x.steps} className="flex justify-center gap-2">
        {[0, 1, 2].map((i) => (
          <li key={i} aria-current={i === step ? "step" : undefined} className={i <= step ? "h-1.5 w-8 rounded-full bg-primary" : "h-1.5 w-8 rounded-full bg-foreground/15"}>
            <span className="sr-only">{x.stepSr(i + 1, i < step)}</span>
          </li>
        ))}
      </ol>

      {step === 0 && (
        <Screen ref={heading} n={1} stepLabel={x.stepOf(1)} icon={ScanFaceIcon} title={x.signIn.title} description={x.signIn.body}>
          <p className="text-center text-sm text-muted-foreground">{x.signIn.note}</p>
          <DevNote>wallet.connect() first (silent reconnect); if it returns null, wallet.createAccount().</DevNote>
          <BottomBar>
            <SignButton size="lg" label={x.signIn.button} success={x.signIn.success} onDone={() => setStep(1)} action={async () => setTenant(await ensureAccount())} />
          </BottomBar>
        </Screen>
      )}

      {step === 1 && (
        <Screen ref={heading} n={2} stepLabel={x.stepOf(2)} icon={LandmarkIcon} title={x.addMoney.title} description={x.addMoney.body(props.amount)}>
          {props.simulatedRamp && <Badge className="mx-auto bg-warning/10 text-warning">{t.common.simulatedBank}</Badge>}
          <BottomBar>
            <SignButton size="lg" label={x.addMoney.button(props.amount)} success={x.addMoney.success} onDone={() => setStep(2)} action={() => addTestMoney(tenant!, props.amountDec)} />
          </BottomBar>
        </Screen>
      )}

      {step === 2 && (
        <Screen ref={heading} n={3} stepLabel={x.stepOf(3)} icon={ShieldCheckIcon} title={x.pay.title} description={x.pay.body}>
          {!props.termsMatch && (
            <Alert variant="destructive">
              <OctagonXIcon aria-hidden />
              <AlertTitle>{x.pay.mismatchTitle}</AlertTitle>
              <AlertDescription>{x.pay.mismatchBody}</AlertDescription>
            </Alert>
          )}
          <DevNote>Before asking for Face ID, the terms are checked against deployments/testnet.json (WEB-14).</DevNote>
          {props.termsMatch && (
            <BottomBar>
              <SignButton size="lg" label={x.pay.button} success={x.pay.success}
                onDone={() => setStep("paid")}
                action={async () => {
                  // Plan A: el escrow de TW se crea ahora que se conoce la cuenta del inquilino, y después se deposita.
                  const contractId = await createFianza(props.landlord, tenant!, props.amountDec, props.endTs);
                  await fundFianza(contractId, tenant!, props.amountDec);
                }}
              />
            </BottomBar>
          )}
        </Screen>
      )}
    </>
  );
}

function Screen(props: {
  ref: React.Ref<HTMLHeadingElement>;
  n?: number;
  stepLabel?: string;
  icon: LucideIcon;
  iconClass?: string;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  const Icon = props.icon;
  return (
    <section className="flex flex-col gap-6 pt-6">
      <div className="space-y-4 text-center">
        <span className={`mx-auto flex size-20 items-center justify-center rounded-3xl ${props.iconClass ?? "bg-primary text-primary-foreground"}`}>
          <Icon className="size-10" strokeWidth={1.5} aria-hidden />
        </span>
        {props.n && <p className="text-sm font-medium text-muted-foreground">{props.stepLabel}</p>}
        <h2 ref={props.ref} tabIndex={-1} className="text-3xl font-semibold tracking-tight text-balance outline-none">
          {props.title}
        </h2>
        <p className="text-muted-foreground">{props.description}</p>
      </div>
      {props.children}
    </section>
  );
}
