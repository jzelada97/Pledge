import type { ReactNode } from "react";
import { Logo } from "@/components/logo";
import { cn } from "@/lib/utils";

// A deposit drawn like a Wallet pass: brand and status on top, the amount large, two facts at the bottom.
export function DepositPass(props: {
  title: string;
  amount: string;
  statusLabel: string;
  facts: { label: string; value: string }[];
  note?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex aspect-[1.586] flex-col justify-between rounded-[1.25rem] bg-linear-to-br from-(--pass-from) to-(--pass-to) p-5 text-white shadow-[0_8px_24px_rgba(0,0,0,.18)]",
        props.className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <Logo className="h-6" />
        <span className="rounded-full bg-white/15 px-2.5 py-1 text-xs font-medium">{props.statusLabel}</span>
      </div>
      <div>
        <p className="text-sm text-white/80">{props.title}</p>
        <p className="text-4xl font-semibold tracking-tight tabular-nums">{props.amount}</p>
        {props.note && <p className="mt-1 text-sm font-medium text-(--pass-note)">{props.note}</p>}
      </div>
      <dl className="grid grid-cols-2 gap-4 text-sm">
        {props.facts.map((f) => (
          <div key={f.label}>
            <dt className="text-white/80">{f.label}</dt>
            <dd className="font-semibold">{f.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
