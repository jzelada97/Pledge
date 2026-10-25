import { ShieldCheckIcon } from "lucide-react";
import type { ReactNode } from "react";
import { STATUS_LABEL } from "@/lib/format";
import type { Status } from "@/lib/types";
import { cn } from "@/lib/utils";

// A deposit drawn like a Wallet pass: brand and status on top, the amount large, two facts at the bottom.
export function DepositPass(props: {
  id: string;
  amount: string;
  status: Status;
  facts: { label: string; value: string }[];
  note?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex aspect-[1.586] flex-col justify-between rounded-[1.25rem] bg-linear-to-br from-accent to-[color-mix(in_oklch,var(--accent),var(--primary)_35%)] p-5 text-accent-foreground shadow-[0_8px_24px_rgba(0,0,0,.18)]",
        props.className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="flex items-center gap-2 font-semibold tracking-tight">
          <ShieldCheckIcon className="size-5" aria-hidden />
          Fianzas
        </span>
        <span className="rounded-full bg-accent-foreground/15 px-2.5 py-1 text-xs font-medium">{STATUS_LABEL[props.status]}</span>
      </div>
      <div>
        <p className="text-sm text-accent-foreground/80">Deposit #{props.id}</p>
        <p className="text-4xl font-semibold tracking-tight tabular-nums">{props.amount}</p>
        {props.note && <p className="mt-1 text-sm font-medium">{props.note}</p>}
      </div>
      <dl className="grid grid-cols-2 gap-4 text-sm">
        {props.facts.map((f) => (
          <div key={f.label}>
            <dt className="text-accent-foreground/80">{f.label}</dt>
            <dd className="font-semibold">{f.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
