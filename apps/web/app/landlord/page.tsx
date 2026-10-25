import { ChevronRightIcon, FolderOpenIcon, PlusIcon } from "lucide-react";
import Link from "next/link";
import { DevNote } from "@/components/dev-note";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DEPOSITS, ME_LANDLORD, type DepositRow } from "@/lib/fixtures";
import { daysFromNow, money } from "@/lib/format";
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
    { label: "Deposits held", value: money(held.reduce((s, d) => s + d.data.terms.amount, 0n)), hint: `${held.length} held` },
    { label: "Yield so far", value: money(held.reduce((s, d) => s + d.accrued_yield, 0n)), hint: "Estimated, variable" },
    { label: "Need your answer", value: String(deposits.filter(needsAction).length), hint: "Contract ended" },
  ];

  return (
    <>
      <PageHeader
        title="Deposits"
        lead="Every room deposit you hold, and what each one needs from you."
        actions={
          <Button asChild>
            <Link href="/landlord/new">
              <PlusIcon data-icon="inline-start" aria-hidden />
              New deposit
            </Link>
          </Button>
        }
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
        <>
          <section aria-label="Summary" className="grid gap-4 sm:grid-cols-3">
            {stats.map((s) => (
              <Card key={s.label}>
                <CardHeader>
                  <CardDescription>{s.label}</CardDescription>
                  <CardTitle className="text-2xl tabular-nums">{s.value}</CardTitle>
                  <p className="text-xs text-muted-foreground">{s.hint}</p>
                </CardHeader>
              </Card>
            ))}
          </section>

          <DevNote>
            Data: factory.list_by_landlord → get_fianzas (25 per page, no vault calls). Live yield = shares × price per
            share, one read per vault, refreshed every 5 s.
          </DevNote>

          {/* Mobile: one card per deposit */}
          <ul className="grid gap-4 md:hidden">
            {deposits.map((d) => (
              <li key={d.id.toString()}>
                <Link
                  href={`/landlord/deposits/${d.id}`}
                  className="block rounded-xl focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  <Card>
                    <CardContent className="flex items-center justify-between gap-4">
                      <div className="space-y-2">
                        <p className="font-semibold">
                          Deposit #{d.id.toString()} · <span className="tabular-nums">{money(d.data.terms.amount)}</span>
                        </p>
                        <StatusBadge status={d.status} />
                        <p className="text-sm text-muted-foreground">
                          Ends {daysFromNow(d.data.terms.end_ts)} · Yield {yieldText(d)}
                        </p>
                      </div>
                      <ChevronRightIcon className="size-5 text-muted-foreground" aria-hidden />
                    </CardContent>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>

          {/* Tablet and desktop: table */}
          <Card className="hidden py-0 md:block">
            <Table>
              <TableCaption className="sr-only">Your deposits</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Deposit</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Yield so far</TableHead>
                  <TableHead>Contract end</TableHead>
                  <TableHead>Tenant can claim</TableHead>
                  <TableHead>Kept in</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {deposits.map((d) => (
                  <TableRow key={d.id.toString()}>
                    <TableCell className="pl-4 font-medium">
                      <Link href={`/landlord/deposits/${d.id}`} className="underline-offset-4 hover:underline">
                        #{d.id.toString()}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={d.status} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{money(d.data.terms.amount)}</TableCell>
                    <TableCell className="text-right tabular-nums">{yieldText(d)}</TableCell>
                    <TableCell>{daysFromNow(d.data.terms.end_ts)}</TableCell>
                    <TableCell>{live(d) ? daysFromNow(d.timeout_at) : "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{STRATEGY_COPY[d.data.terms.strategy.id].name}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
          <p className="text-xs text-muted-foreground">Yield figures are estimates. The yield is variable and can be lower, or zero.</p>
        </>
      )}
    </>
  );
}
