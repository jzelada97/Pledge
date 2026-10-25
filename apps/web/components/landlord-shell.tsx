"use client";

import {
  BellIcon,
  CircleCheckIcon,
  CircleDotIcon,
  FolderOpenIcon,
  HourglassIcon,
  InboxIcon,
  OctagonPauseIcon,
  PlusIcon,
  ShieldCheckIcon,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { StatusLine } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import type { FilterId, FilterInfo, ListItem, Summary } from "@/lib/landlord-list";
import { cn } from "@/lib/utils";

const ICON: Record<FilterId, LucideIcon> = {
  all: InboxIcon,
  answer: BellIcon,
  waiting: HourglassIcon,
  active: CircleDotIcon,
  stopped: OctagonPauseIcon,
  settled: CircleCheckIcon,
};

type Props = { items: ListItem[]; filters: FilterInfo[]; summary: Summary; children: ReactNode };

// macOS-style split view: sidebar (filters) · deposit list · detail pane, each scrolling on its own.
// Under lg it becomes an iOS navigation stack: the list on /landlord, the pane everywhere else.
export function LandlordShell(props: Props) {
  return (
    <Suspense>
      <Shell {...props} />
    </Suspense>
  );
}

function Shell({ items, filters, summary, children }: Props) {
  const pathname = usePathname();
  const params = useSearchParams();
  const show = (filters.find((f) => f.id === params.get("show"))?.id ?? "all") as FilterId;
  const empty = params.get("view") === "empty"; // ?view=empty previews the empty state
  const list = empty ? [] : items.filter((i) => i.filters.includes(show));
  const selected = pathname.match(/^\/landlord\/deposits\/([^/]+)/)?.[1];
  const atRoot = pathname === "/landlord";
  const query = show === "all" ? "" : `?show=${show}`;
  const ListTitle = atRoot ? "h1" : "h2"; // the detail pane owns the h1 everywhere else

  return (
    <div className="lg:grid lg:h-dvh lg:grid-cols-[15rem_22rem_minmax(0,1fr)]">
      <aside className="hidden flex-col border-r bg-sidebar lg:flex lg:overflow-y-auto">
        <Link
          href="/"
          className="mx-3 mt-4 mb-6 flex items-center gap-2 rounded-lg px-2 py-2 font-semibold tracking-tight focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <ShieldCheckIcon className="size-4" aria-hidden />
          </span>
          Fianzas
        </Link>
        <nav aria-label="Deposits" className="flex flex-col gap-0.5 px-3">
          <p className="px-2 pb-1 text-xs font-medium text-muted-foreground">Deposits</p>
          {filters.map((f) => {
            const Icon = ICON[f.id];
            const current = f.id === show;
            return (
              <Link
                key={f.id}
                href={f.id === "all" ? "/landlord" : `/landlord?show=${f.id}`}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "flex min-h-11 items-center gap-2.5 rounded-lg px-2 text-sm hover:bg-foreground/5 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                  current && "bg-foreground/8 font-semibold hover:bg-foreground/8",
                )}
              >
                <Icon className="size-4 text-primary" aria-hidden />
                <span className="flex-1">{f.label}</span>
                <span className={cn("tabular-nums", current ? "text-foreground" : "text-muted-foreground")}>{f.count}</span>
              </Link>
            );
          })}
        </nav>
        <dl className="mt-auto space-y-3 border-t px-5 py-5 text-sm">
          <div>
            <dt className="text-muted-foreground">Deposits held</dt>
            <dd className="text-lg font-semibold tabular-nums">{summary.held}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Yield so far</dt>
            <dd className="text-lg font-semibold tabular-nums">{summary.yieldSoFar}</dd>
            <dd className="text-xs text-muted-foreground">Estimated, variable</dd>
          </div>
        </dl>
      </aside>

      <section
        aria-labelledby="list-title"
        className={cn("flex-col bg-card lg:flex lg:overflow-y-auto lg:border-r", atRoot ? "flex min-h-dvh lg:min-h-0" : "hidden")}
      >
        <header
          data-glass
          className="sticky top-0 z-10 border-b bg-card supports-backdrop-filter:bg-card/80 supports-backdrop-filter:backdrop-blur-xl"
        >
          <div className="flex items-center justify-between gap-2 px-4 pt-4 lg:pt-3 lg:pb-3">
            <div className="min-w-0">
              <ListTitle id="list-title" className="truncate text-3xl font-semibold tracking-tight lg:text-lg">
                <span className="lg:hidden">Deposits</span>
                <span className="hidden lg:inline">{filters.find((f) => f.id === show)?.label}</span>
              </ListTitle>
              <p className="text-sm text-muted-foreground lg:hidden">
                {summary.held} held · {summary.yieldSoFar} yield so far, variable
              </p>
            </div>
            <Button asChild size="icon" aria-label="New deposit">
              <Link href="/landlord/new">
                <PlusIcon aria-hidden />
              </Link>
            </Button>
          </div>
          {/* Filters as a scrollable segmented row on phones; the sidebar has them on desktop */}
          <nav aria-label="Filter deposits" className="flex gap-2 overflow-x-auto px-4 py-3 lg:hidden">
            {filters.map((f) => (
              <Link
                key={f.id}
                href={f.id === "all" ? "/landlord" : `/landlord?show=${f.id}`}
                aria-current={f.id === show ? "page" : undefined}
                className={cn(
                  "flex min-h-11 shrink-0 items-center gap-1.5 rounded-full px-4 text-sm font-medium ring-1 ring-foreground/10",
                  f.id === show ? "bg-foreground text-background ring-foreground" : "bg-card",
                )}
              >
                {f.label}
                <span className="tabular-nums">{f.count}</span>
              </Link>
            ))}
          </nav>
        </header>

        {list.length === 0 ? (
          <Empty className="m-4">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FolderOpenIcon aria-hidden />
              </EmptyMedia>
              <EmptyTitle>{empty ? "No deposits yet" : "Nothing here"}</EmptyTitle>
              <EmptyDescription>
                {empty ? "Create your first deposit and send the invitation link to your tenant." : "No deposit matches this filter."}
              </EmptyDescription>
            </EmptyHeader>
            {empty && (
              <EmptyContent>
                <Button asChild>
                  <Link href="/landlord/new">New deposit</Link>
                </Button>
              </EmptyContent>
            )}
          </Empty>
        ) : (
          <ul className="flex flex-col p-2">
            {list.map((i) => {
              const current = i.id === selected;
              return (
                <li key={i.id}>
                  <Link
                    href={`/landlord/deposits/${i.id}${query}`}
                    aria-current={current ? "page" : undefined}
                    aria-label={`Deposit #${i.id}, ${i.amount}, ${i.statusLabel}`}
                    className={cn(
                      "grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 rounded-xl px-3 py-3 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                      current ? "bg-primary text-primary-foreground" : "hover:bg-muted",
                    )}
                  >
                    <span className="font-semibold">Deposit #{i.id}</span>
                    <span className="text-right font-semibold tabular-nums">{i.amount}</span>
                    <StatusLine status={i.status} inverted={current} />
                    <span className={cn("text-right text-sm", current ? "text-primary-foreground" : "text-muted-foreground")}>
                      {i.needsAction ? "Answer now" : i.meta}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <main className={cn("min-w-0 lg:block lg:overflow-y-auto", atRoot ? "hidden" : "block min-h-dvh lg:min-h-0")}>{children}</main>
    </div>
  );
}
