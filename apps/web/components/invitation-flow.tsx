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

type Step = "review" | 0 | 1 | 2 | "paid";

// iOS onboarding style: first the terms (server-rendered, passed as `review`), then one full screen per step
// (sign in or create account → add money from the bank → accept and pay), each with its action at the bottom.
export function InvitationFlow(props: { amount: string; termsMatch: boolean; simulatedRamp: boolean; review: ReactNode }) {
  const [step, setStep] = useState<Step>("review");
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
            Continue to pay
          </Button>
        </BottomBar>
      </>
    );
  }

  if (step === "paid") {
    return (
      <Screen ref={heading} icon={CircleCheckIcon} iconClass="bg-success/10 text-success" title="Your deposit is paid" description="You'll get it back in full when you and your landlord approve the release.">
        <BottomBar>
          <Button asChild size="lg">
            <Link href="/tenant">See my deposit</Link>
          </Button>
        </BottomBar>
      </Screen>
    );
  }

  return (
    <>
      <ol aria-label="Steps to pay your deposit" className="flex justify-center gap-2">
        {[0, 1, 2].map((i) => (
          <li key={i} aria-current={i === step ? "step" : undefined} className={i <= step ? "h-1.5 w-8 rounded-full bg-primary" : "h-1.5 w-8 rounded-full bg-foreground/15"}>
            <span className="sr-only">
              Step {i + 1}
              {i < step ? ", done" : ""}
            </span>
          </li>
        ))}
      </ol>

      {step === 0 && (
        <Screen ref={heading} n={1} icon={ScanFaceIcon} title="Sign in or create your account" description="Already have an account? Face ID signs you in. New here? We create one for you.">
          <p className="text-center text-sm text-muted-foreground">No app to install, no fees for you.</p>
          <DevNote>wallet.connect() first (silent reconnect); if it returns null, wallet.createAccount().</DevNote>
          <BottomBar>
            <SignButton size="lg" label="Continue with Face ID" success="You're signed in" onDone={() => setStep(1)} />
          </BottomBar>
        </Screen>
      )}

      {step === 1 && (
        <Screen ref={heading} n={2} icon={LandmarkIcon} title="Add the money from your bank" description={`Transfer ${props.amount} from your bank account.`}>
          {props.simulatedRamp && <Badge className="mx-auto bg-warning/10 text-warning">Simulated bank transfer</Badge>}
          <BottomBar>
            <SignButton size="lg" label={`Add ${props.amount} from my bank`} success="Money added" onDone={() => setStep(2)} />
          </BottomBar>
        </Screen>
      )}

      {step === 2 && (
        <Screen ref={heading} n={3} icon={ShieldCheckIcon} title="Accept and pay the deposit" description="Your deposit is held until the contract ends.">
          {!props.termsMatch && (
            <Alert variant="destructive">
              <OctagonXIcon aria-hidden />
              <AlertTitle>These terms don&apos;t match the platform&apos;s</AlertTitle>
              <AlertDescription>For your safety we can&apos;t accept this deposit. Ask your landlord for a new invitation.</AlertDescription>
            </Alert>
          )}
          <DevNote>Before asking for Face ID, the terms are checked against deployments/testnet.json (WEB-14).</DevNote>
          {props.termsMatch && (
            <BottomBar>
              <SignButton size="lg" label="Accept and pay" success="Deposit paid" onDone={() => setStep("paid")} />
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
        {props.n && <p className="text-sm font-medium text-muted-foreground">Step {props.n} of 3</p>}
        <h2 ref={props.ref} tabIndex={-1} className="text-3xl font-semibold tracking-tight text-balance outline-none">
          {props.title}
        </h2>
        <p className="text-muted-foreground">{props.description}</p>
      </div>
      {props.children}
    </section>
  );
}
