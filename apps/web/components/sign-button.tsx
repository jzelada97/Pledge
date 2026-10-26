"use client";

import { CheckIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useSign } from "@/lib/use-sign";

type Props = {
  label: string;
  success: string;
  fail?: boolean;
  onDone?: () => void;
  action?: () => Promise<unknown>;
} & Pick<ComponentProps<typeof Button>, "variant" | "size" | "disabled" | "className">;

export function SignButton({ label, success, fail, onDone, action, disabled, ...button }: Props) {
  const { phase, run, busy, phaseText } = useSign({ success, fail, onDone, action });
  const done = phase === "done";

  return (
    <div className="flex flex-col gap-1">
      <Button {...button} onClick={run} disabled={disabled || busy || done} aria-busy={busy}>
        {busy && <Spinner data-icon="inline-start" aria-hidden />}
        {done && <CheckIcon data-icon="inline-start" aria-hidden />}
        {busy || done ? phaseText : label}
      </Button>
      <p role="status" aria-live="polite" className="sr-only">
        {phaseText}
      </p>
    </div>
  );
}
