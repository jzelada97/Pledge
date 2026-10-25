"use client";

import { useState } from "react";
import { Btn } from "./wire";

type Phase = "idle" | "signing" | "sending" | "done";

const PHASE_TEXT: Record<Exclude<Phase, "idle">, string> = {
  signing: "Confirm in Freighter…",
  sending: "Sending…",
  done: "Done",
};

// Staff signs with Freighter through Stellar Wallets Kit, outside the Relayer (AD-10). Fake timings for now.
export function SignButton(props: { label: string; disabled?: boolean; onDone?: () => void }) {
  const [phase, setPhase] = useState<Phase>("idle");

  function run() {
    setPhase("signing");
    setTimeout(() => setPhase("sending"), 1000);
    setTimeout(() => {
      setPhase("done");
      props.onDone?.();
    }, 2000);
  }

  return (
    <div className="flex flex-col gap-1">
      <Btn onClick={run} disabled={props.disabled || phase === "signing" || phase === "sending"}>
        {props.label}
      </Btn>
      {phase !== "idle" && (
        <p role="status" className="text-sm text-neutral-600">
          {PHASE_TEXT[phase]}
          {phase === "done" && <span className="ml-2 underline">View on explorer</span>}
        </p>
      )}
    </div>
  );
}
