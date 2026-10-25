import { ChevronLeftIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// Detail-pane toolbar: back button on phones, title, and the pane's actions on the right (desktop).
export function PaneToolbar(props: { title: ReactNode; back?: { href: string; label: string }; actions?: ReactNode }) {
  return (
    <header
      data-glass
      className="sticky top-0 z-10 border-b bg-background supports-backdrop-filter:bg-background/80 supports-backdrop-filter:backdrop-blur-xl supports-backdrop-filter:backdrop-saturate-150"
    >
      <div className="flex min-h-14 items-center gap-3 px-2 lg:px-6">
        {props.back && (
          <Link
            href={props.back.href}
            className="inline-flex min-h-11 items-center gap-0.5 rounded-lg pr-2 text-base font-medium text-primary focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none lg:hidden"
          >
            <ChevronLeftIcon className="size-6" aria-hidden />
            {props.back.label}
          </Link>
        )}
        <h1 className={cn("min-w-0 flex-1 truncate font-semibold", !props.back && "px-2 lg:px-0")}>{props.title}</h1>
        {props.actions && <div className="hidden shrink-0 items-start gap-2 lg:flex">{props.actions}</div>}
      </div>
    </header>
  );
}

export function PaneBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("mx-auto flex max-w-3xl flex-col gap-8 px-4 py-8 lg:px-8", className)}>{children}</div>;
}

// Bottom action bar on phones, in the thumb zone; on desktop the same actions live in the toolbar.
export function BottomBar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <>
      <div aria-hidden className={cn("h-28", className)} />
      <div
        data-glass
        className={cn(
          "fixed inset-x-0 bottom-0 z-20 border-t bg-card supports-backdrop-filter:bg-card/80 supports-backdrop-filter:backdrop-blur-xl",
          className,
        )}
      >
        <div className="mx-auto flex max-w-md flex-col gap-2 px-4 pt-3 pb-[max(env(safe-area-inset-bottom),1rem)] *:w-full [&_button]:w-full">
          {children}
        </div>
      </div>
    </>
  );
}
