"use client";

import { useState } from "react";
import { money } from "@/lib/format";
import { SignButton } from "./sign-button";
import { Btn, Note } from "./wire";

// Stop release: before signing, show what the good-faith deposit costs and the rule for getting it back.
export function StopPanel(props: { bond: bigint }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");

  if (!open) {
    return (
      <Btn secondary onClick={() => setOpen(true)}>
        Stop release
      </Btn>
    );
  }
  return (
    <div className="flex flex-col gap-2 rounded border-2 border-neutral-800 p-3">
      <p className="text-sm font-medium">Stopping costs a good-faith deposit of {money(props.bond)}.</p>
      <p className="text-sm">
        If the expert agrees with you, you get it back. If not, it goes to pay the expert.
      </p>
      <label className="flex flex-col gap-1 text-sm">
        Why are you stopping the release?
        <textarea
          className="rounded border border-neutral-400 p-2"
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      <Note>Only a salted fingerprint of the reason is recorded publicly (DAT-2). The text stays private.</Note>
      <SignButton label={`Pay ${money(props.bond)} and stop`} disabled={!reason.trim()} />
      <Btn secondary onClick={() => setOpen(false)}>
        Cancel
      </Btn>
    </div>
  );
}
