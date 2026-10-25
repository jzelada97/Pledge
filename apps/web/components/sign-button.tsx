"use client";

import { useState } from "react";
import { Btn } from "./wire";

type Phase = "idle" | "signing" | "sending" | "done" | "error";

const PHASE_TEXT: Record<Exclude<Phase, "idle">, string> = {
  signing: "Confirm with Face ID…",
  sending: "Sending…",
  done: "Done",
  error: "We couldn't send it. Check your connection and try again.",
};

// Every signing action shows three states: signing (Face ID), sending, and done or an error that says
// what to do. Fake timings for now; the real phases come from packages/wallet signAndSend.
export function SignButton(props: { label: string; disabled?: boolean; fail?: boolean }) {
  const [phase, setPhase] = useState<Phase>("idle");

  function run() {
    setPhase("signing");
    setTimeout(() => setPhase("sending"), 1000);
    setTimeout(() => setPhase(props.fail ? "error" : "done"), 2000);
  }

  return (
    <div className="flex flex-col gap-1">
      <Btn onClick={run} disabled={props.disabled || phase === "signing" || phase === "sending" || phase === "done"}>
        {props.label}
      </Btn>
      {phase !== "idle" && (
        <p role="status" className={`text-sm ${phase === "error" ? "text-red-700" : "text-neutral-600"}`}>
          {PHASE_TEXT[phase]}
          {phase === "error" && (
            <button type="button" className="ml-2 underline" onClick={() => setPhase("idle")}>
              Try again
            </button>
          )}
        </p>
      )}
    </div>
  );
}
