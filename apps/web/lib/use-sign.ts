"use client";

import { useState } from "react";
import { toast } from "sonner";

export type SignPhase = "idle" | "signing" | "sending" | "done" | "error";

export const PHASE_TEXT: Record<Exclude<SignPhase, "idle">, string> = {
  signing: "Confirm with Face ID…",
  sending: "Sending…",
  done: "Done",
  error: "We couldn't send it. Check your connection and try again.",
};

// Every signing action goes through here: signing (Face ID) → sending → done or an error that says
// what to do. Fake timings for now; the real phases come from packages/wallet signAndSend({ onPhase }).
export function useSign(opts: { success: string; fail?: boolean; onDone?: () => void }) {
  const [phase, setPhase] = useState<SignPhase>("idle");

  function run() {
    setPhase("signing");
    setTimeout(() => setPhase("sending"), 1000);
    setTimeout(() => {
      if (opts.fail) {
        setPhase("error");
        toast.error(PHASE_TEXT.error, { action: { label: "Try again", onClick: run } });
        return;
      }
      setPhase("done");
      toast.success(opts.success);
      opts.onDone?.();
    }, 2000);
  }

  return { phase, run, busy: phase === "signing" || phase === "sending" };
}
