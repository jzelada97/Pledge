import { ArrowLeftIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

// H1 + muted lead on the left, primary actions anchored top-right (stacked under the title on mobile).
export function PageHeader(props: { title: ReactNode; lead?: ReactNode; back?: { href: string; label: string }; badges?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex flex-col gap-4">
      {props.back && (
        <Link
          href={props.back.href}
          className="inline-flex w-fit items-center gap-1 rounded-md text-sm text-muted-foreground hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <ArrowLeftIcon className="size-4" aria-hidden />
          {props.back.label}
        </Link>
      )}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight text-balance">{props.title}</h1>
          {props.badges && <div className="flex flex-wrap gap-2">{props.badges}</div>}
          {props.lead && <p className="max-w-2xl text-lg text-muted-foreground">{props.lead}</p>}
        </div>
        {props.actions && <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">{props.actions}</div>}
      </div>
    </header>
  );
}
