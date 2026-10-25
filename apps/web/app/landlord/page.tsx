import { BellIcon, ChevronRightIcon, FolderOpenIcon, LandmarkIcon, SproutIcon } from "lucide-react";
import Link from "next/link";
import { DevNote } from "@/components/dev-note";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { DetailList, DetailRow } from "@/components/detail-list";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { DEPOSITS, ME_LANDLORD, type DepositRow } from "@/lib/fixtures";
import { STATUS_LABEL, daysFromNow, money } from "@/lib/format";
import { STRATEGY_COPY } from "@/lib/strategies";

export const dynamic = "force-dynamic"; // "in N days" must be computed per request, not at build time

const live = (d: DepositRow) => d.status === "Active" || d.status === "Ending";
const yieldText = (d: DepositRow) => (d.status === "Proposed" || d.status === "Settled" ? "—" : money(d.accrued_yield));
const needsAction = (d: DepositRow) => d.status === "Ending" && !d.data.approvals.approved_by.includes(ME_LANDLORD);

export default async function LandlordDashboard({ searchParams }: PageProps<"/landlord">) {
  const { view } = await searchParams;
  const deposits = view === "empty" ? [] : DEPOSITS; // ?view=empty previews the empty state

  const held = deposits.filter((d) => d.status !== "Proposed" && d.status !== "Settled" && d.status !== "Cancelled");
  const stats = [
    { icon: LandmarkIcon, label: "Deposits held", value: money(held.reduce((s, d) => s + d.data.terms.amount, 0n)), hint: `Across ${held.length} deposits` },
    { icon: SproutIcon, label: "Yield so far", value: money(held.reduce((s, d) => s + d.accrued_yield, 0n)), hint: "Estimated, variable" },
    { icon: BellIcon, label: "Need your answer", value: String(deposits.filter(needsAction).length), hint: "Contract ended, waiting for you" },
  ];

  return (
    <>
      <PageHeader
        title="Deposits"
        lead="Every room deposit you hold, and what each one needs from you."
      />

      {deposits.length === 0 ? (
        <Empty className="border bg-card">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FolderOpenIcon aria-hidden />
            </EmptyMedia>
            <EmptyTitle>No deposits yet</EmptyTitle>
            <EmptyDescription>Create your first deposit and send the invitation link to your tenant.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button asChild>
              <Link href="/landlord/new">New deposit</Link>
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <div className="flex flex-col gap-10">
          {/* Stats: one tinted panel, so they don't read as deposit cards */}
          <section aria-labelledby="overview-title" className="space-y-3">
            <h2 id="overview-title" className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
              Overview
            </h2>
            <dl className="grid divide-y divide-accent-foreground/15 rounded-xl bg-accent text-accent-foreground sm:grid-cols-3 sm:divide-x sm:divide-y-0">
              {stats.map((s) => (
                <div key={s.label} className="space-y-1 p-6">
                  <dt className="flex items-center gap-2 text-sm font-medium">
                    <s.icon className="size-4 text-primary" aria-hidden />
                    {s.label}
                  </dt>
                  <dd className="text-3xl font-semibold tracking-tight tabular-nums">{s.value}</dd>
                  <dd className="text-xs">{s.hint}</dd>
                </div>
              ))}
            </dl>
          </section>

          <DevNote>
            Data: factory.list_by_landlord → get_fianzas (25 per page, no vault calls). Live yield = shares × price per
            share, one read per vault, refreshed every 5 s.
          </DevNote>

          <section aria-labelledby="deposits-title" className="space-y-4">
            <div className="flex items-baseline gap-2">
              <h2 id="deposits-title" className="text-xl font-semibold tracking-tight">
                Your deposits
              </h2>
              <span className="text-sm text-muted-foreground">{deposits.length}</span>
            </div>
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {deposits.map((d) => (
                <li key={d.id.toString()}>
                  <Link
                    href={`/landlord/deposits/${d.id}`}
                    aria-label={`Deposit #${d.id}, ${money(d.data.terms.amount)}, ${STATUS_LABEL[d.status]}`}
                    className="group block h-full rounded-xl focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                  >
                    <Card className="h-full transition-colors group-hover:border-primary/40 group-hover:bg-accent/40">
                      <CardHeader>
                        <div className="flex items-start justify-between gap-2">
                          <CardDescription>Deposit #{d.id.toString()}</CardDescription>
                          <StatusBadge status={d.status} />
                        </div>
                        <CardTitle className="text-2xl tabular-nums">{money(d.data.terms.amount)}</CardTitle>
                      </CardHeader>
                      <CardContent className="flex-1">
                        <DetailList>
                          <DetailRow label="Contract end" value={daysFromNow(d.data.terms.end_ts)} />
                          <DetailRow label="Yield so far" value={yieldText(d)} />
                          {live(d) && <DetailRow label="Tenant can claim" value={daysFromNow(d.timeout_at)} />}
                          <DetailRow label="Kept in" value={STRATEGY_COPY[d.data.terms.strategy.id].name} />
                        </DetailList>
                      </CardContent>
                      <CardFooter className="justify-end text-sm font-medium text-primary">
                        {needsAction(d) ? "Answer now" : "View deposit"}
                        <ChevronRightIcon className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
                      </CardFooter>
                    </Card>
                  </Link>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">Yield figures are estimates. The yield is variable and can be lower, or zero.</p>
          </section>
        </div>
      )}
    </>
  );
}
