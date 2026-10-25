import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// Apple-style grouped section: a small heading, a white inset panel with hairline rows, an optional footnote.
export function Group(props: { title?: ReactNode; footer?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("space-y-2", props.className)}>
      {props.title && <h2 className="px-4 text-sm font-medium text-muted-foreground">{props.title}</h2>}
      <div className="rounded-2xl bg-card px-4 shadow-[0_1px_2px_rgba(0,0,0,.04)] ring-1 ring-foreground/8">{props.children}</div>
      {props.footer && <div className="px-4 text-sm text-muted-foreground">{props.footer}</div>}
    </section>
  );
}
