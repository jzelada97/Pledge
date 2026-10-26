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
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { Logo } from "@/components/logo";
import { PreferencesMenu } from "@/components/preferences-menu";
import { StatusLine } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { useI18n } from "@/lib/i18n/client";
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

// `gate`: pantalla de entrada; sustituye a la lista (y al detalle) mientras no hay cuenta.
type Props = { items: ListItem[]; filters: FilterInfo[]; summary: Summary; gate?: ReactNode; children: ReactNode };

// macOS-style split view: sidebar (filters) · deposit list · detail pane, each scrolling on its own.
// Under lg it becomes an iOS navigation stack: the list on /landlord, the pane everywhere else.
export function LandlordShell(props: Props) {
  return (
    <Suspense>
      <Shell {...props} />
    </Suspense>
  );
}

function Shell({ items, filters, summary, gate, children }: Props) {
  const { t } = useI18n();
  const l = t.landlord;
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
        <div className="mx-3 mt-4 mb-6 flex items-center justify-between gap-2">
          <Link
            href="/"
            className="flex min-h-11 items-center gap-2 rounded-lg px-2 font-semibold tracking-tight focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <Logo />
          </Link>
          <PreferencesMenu />
        </div>
        <nav aria-label={t.common.deposits} className="flex flex-col gap-0.5 px-3">
          <p className="px-2 pb-1 text-xs font-medium text-muted-foreground">{t.common.deposits}</p>
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
                <Icon className={cn("size-4", f.id === "answer" ? "text-highlight-text" : "text-primary")} aria-hidden />
                <span className="flex-1">{f.label}</span>
                {f.id === "answer" && f.count > 0 ? (
                  // the one filter that asks for action gets the apricot accent
                  <span className="rounded-full bg-highlight px-2 text-xs leading-5 font-semibold text-highlight-foreground tabular-nums">{f.count}</span>
                ) : (
                  <span className={cn("tabular-nums", current ? "text-foreground" : "text-muted-foreground")}>{f.count}</span>
                )}
              </Link>
            );
          })}
        </nav>
        <dl className="mt-auto space-y-3 border-t px-5 py-5 text-sm">
          <div>
            <dt className="text-muted-foreground">{l.held}</dt>
            <dd className="text-lg font-semibold tabular-nums">{summary.held}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{l.yieldSoFar}</dt>
            <dd className="text-lg font-semibold tabular-nums">{summary.yieldSoFar}</dd>
            <dd className="text-xs text-muted-foreground">{l.estimatedVariable}</dd>
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
                <span className="lg:hidden">{t.common.deposits}</span>
                <span className="hidden lg:inline">{filters.find((f) => f.id === show)?.label}</span>
              </ListTitle>
              <p className="text-sm text-muted-foreground lg:hidden">
                {l.mobileSummary(summary.held, summary.yieldSoFar)}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <PreferencesMenu className="lg:hidden" />
              <Button asChild size="icon" aria-label={l.newDeposit}>
                <Link href="/landlord/new">
                  <PlusIcon aria-hidden />
                </Link>
              </Button>
            </div>
          </div>
          {/* Filters as a scrollable segmented row on phones; the sidebar has them on desktop */}
          <nav aria-label={l.filterNav} className="flex gap-2 overflow-x-auto px-4 py-3 lg:hidden">
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

        {gate ? (
          <div className="lg:hidden">{gate}</div>
        ) : list.length === 0 ? (
          <Empty className="m-4">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FolderOpenIcon aria-hidden />
              </EmptyMedia>
              <EmptyTitle>{empty ? l.empty.title : l.noMatch.title}</EmptyTitle>
              <EmptyDescription>{empty ? l.empty.body : l.noMatch.body}</EmptyDescription>
            </EmptyHeader>
            {empty && (
              <EmptyContent>
                <Button asChild>
                  <Link href="/landlord/new">{l.newDeposit}</Link>
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
                    aria-label={l.rowLabel(i.title, i.amount, i.statusLabel)}
                    className={cn(
                      "grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 rounded-xl px-3 py-3 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                      current ? "bg-primary text-primary-foreground" : "hover:bg-muted",
                    )}
                  >
                    <span className="font-semibold">{i.title}</span>
                    <span className="text-right font-semibold tabular-nums">{i.amount}</span>
                    <StatusLine status={i.status} inverted={current} />
                    <span className={cn("text-right text-sm", current ? "text-primary-foreground" : i.needsAction ? "font-medium text-highlight-text" : "text-muted-foreground")}>
                      {i.needsAction ? l.answerNow : i.meta}
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
