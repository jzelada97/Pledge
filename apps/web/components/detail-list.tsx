import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// Label/value pairs as a real <dl> so screen readers announce them together.
export function DetailList(props: { children: ReactNode; className?: string }) {
  return <dl className={cn("divide-y divide-border", props.className)}>{props.children}</dl>;
}

export function DetailRow(props: { label: ReactNode; value: ReactNode; strong?: boolean; indent?: boolean }) {
  return (
    <div className="flex min-h-11 items-baseline justify-between gap-4 py-3 text-sm">
      <dt className={cn("text-muted-foreground", props.indent && "pl-4")}>{props.label}</dt>
      <dd className={cn("text-right tabular-nums", props.strong ? "text-base font-semibold" : "font-medium")}>{props.value}</dd>
    </div>
  );
}
