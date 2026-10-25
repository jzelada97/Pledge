"use client";

import { CircleCheckIcon, OctagonXIcon } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { DevNote } from "@/components/dev-note";
import { SignButton } from "@/components/sign-button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type Step = 0 | 1 | 2 | 3;

// Sign in or create account → add money from the bank → accept and pay. Each step unlocks the next.
export function InvitationFlow(props: { amount: string; termsMatch: boolean; simulatedRamp: boolean }) {
  const [step, setStep] = useState<Step>(0);

  if (step === 3) {
    return (
      <Card>
        <CardHeader>
          <CircleCheckIcon className="size-6 text-success" aria-hidden />
          <CardTitle className="text-xl">Your deposit is paid</CardTitle>
          <CardDescription>You&apos;ll get it back in full when you and your landlord approve the release.</CardDescription>
        </CardHeader>
        <CardContent className="flex justify-end">
          <Button asChild>
            <Link href="/tenant">See my deposit</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <ol className="flex flex-col gap-4" aria-label="Steps to pay your deposit">
      <StepCard n={1} current={step} title="Sign in or create your account" description="Already have an account? Face ID signs you in. New here? We create one for you.">
        <SignButton label="Continue with Face ID" success="You're signed in" onDone={() => setStep(1)} className="w-full" />
        <p className="text-xs text-muted-foreground">No app to install, no fees for you.</p>
        <DevNote>wallet.connect() first (silent reconnect); if it returns null, wallet.createAccount().</DevNote>
      </StepCard>

      <StepCard
        n={2}
        current={step}
        title="Add the money from your bank"
        description={`Transfer ${props.amount} from your bank account.`}
        badge={props.simulatedRamp ? <Badge className="bg-warning/10 text-warning">Simulated bank transfer</Badge> : undefined}
      >
        <SignButton label={`Add ${props.amount} from my bank`} success="Money added" onDone={() => setStep(2)} className="w-full" />
      </StepCard>

      <StepCard n={3} current={step} title="Accept and pay the deposit" description="Your deposit is held until the contract ends.">
        {props.termsMatch ? (
          <SignButton label="Accept and pay" success="Deposit paid" onDone={() => setStep(3)} className="w-full" />
        ) : (
          <Alert variant="destructive">
            <OctagonXIcon aria-hidden />
            <AlertTitle>These terms don&apos;t match the platform&apos;s</AlertTitle>
            <AlertDescription>For your safety we can&apos;t accept this deposit. Ask your landlord for a new invitation.</AlertDescription>
          </Alert>
        )}
        <DevNote>Before asking for Face ID, the terms are checked against deployments/testnet.json (WEB-14).</DevNote>
      </StepCard>
    </ol>
  );
}

function StepCard(props: { n: 1 | 2 | 3; current: Step; title: string; description: string; badge?: ReactNode; children: ReactNode }) {
  const index = props.n - 1;
  const done = props.current > index;
  const active = props.current === index;
  return (
    <li aria-current={active ? "step" : undefined}>
      <Card className={cn(!active && "opacity-80", active && "ring-3 ring-primary/20")}>
        <CardHeader>
          <div className="flex items-center gap-3">
            <span
              className={cn(
                "flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold",
                done ? "bg-success/10 text-success" : active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
              )}
              aria-hidden
            >
              {done ? <CircleCheckIcon className="size-4" /> : props.n}
            </span>
            <CardTitle>
              <span className="sr-only">Step {props.n}{done ? ", done" : ""}: </span>
              {props.title}
            </CardTitle>
          </div>
          <CardDescription className="pl-10">{props.description}</CardDescription>
          {props.badge && <div className="pl-10">{props.badge}</div>}
        </CardHeader>
        {active && <CardContent className="space-y-2">{props.children}</CardContent>}
      </Card>
    </li>
  );
}
