"use client";

import { CheckIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { PHASE_TEXT, useSign } from "@/lib/use-sign";

type Props = {
  label: string;
  success: string;
  fail?: boolean;
  onDone?: () => void;
} & Pick<ComponentProps<typeof Button>, "variant" | "size" | "disabled" | "className">;

export function SignButton({ label, success, fail, onDone, disabled, ...button }: Props) {
  const { phase, run, busy } = useSign({ success, fail, onDone });
  const done = phase === "done";

  return (
    <div className="flex flex-col gap-1">
      <Button {...button} onClick={run} disabled={disabled || busy || done} aria-busy={busy}>
        {busy && <Spinner data-icon="inline-start" aria-hidden />}
        {done && <CheckIcon data-icon="inline-start" aria-hidden />}
        {busy ? PHASE_TEXT[phase as "signing" | "sending"] : done ? PHASE_TEXT.done : label}
      </Button>
      <p role="status" aria-live="polite" className="sr-only">
        {phase === "idle" ? "" : PHASE_TEXT[phase]}
      </p>
    </div>
  );
}
