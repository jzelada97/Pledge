"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useI18n } from "./i18n/client";

export type SignPhase = "idle" | "signing" | "sending" | "done" | "error";

// Every signing action goes through here: signing (Face ID) → sending → done or an error that says
// what to do. Fake timings for now; the real phases come from packages/wallet signAndSend({ onPhase }).
// `phaseText` is the button label for the current phase, in the active language.
export function useSign(opts: { success: string; fail?: boolean; onDone?: () => void }) {
  const { t } = useI18n();
  const [phase, setPhase] = useState<SignPhase>("idle");

  function run() {
    setPhase("signing");
    setTimeout(() => setPhase("sending"), 1000);
    setTimeout(() => {
      if (opts.fail) {
        setPhase("error");
        toast.error(t.sign.error, { action: { label: t.sign.tryAgain, onClick: run } });
        return;
      }
      setPhase("done");
      toast.success(opts.success);
      opts.onDone?.();
    }, 2000);
  }

  const phaseText = phase === "idle" ? "" : t.sign[phase];
  return { phase, run, busy: phase === "signing" || phase === "sending", phaseText };
}
