import { BellIcon, ChevronRightIcon, LandmarkIcon, SproutIcon } from "lucide-react";
import Link from "next/link";
import { DevNote } from "@/components/dev-note";
import { Group } from "@/components/grouped";
import { PaneBody, PaneToolbar } from "@/components/pane";
import { StatusLine } from "@/components/status-badge";
import { DEPOSITS } from "@/lib/fixtures";
import { daysFromNow, money } from "@/lib/format";
import { landlordList, needsAction } from "@/lib/landlord-list";

export const dynamic = "force-dynamic";

// Desktop detail pane with no deposit selected: the totals and what needs an answer.
// On phones this pane is hidden and /landlord shows the list instead.
export default function LandlordOverview() {
  const { summary } = landlordList();
  const waiting = DEPOSITS.filter(needsAction);
  const stats = [
    { icon: LandmarkIcon, label: "Deposits held", value: summary.held, hint: `Across ${summary.heldCount} deposits` },
    { icon: SproutIcon, label: "Yield so far", value: summary.yieldSoFar, hint: "Estimated, variable" },
    { icon: BellIcon, label: "Need your answer", value: String(summary.answer), hint: "Contract ended, waiting for you" },
  ];

  return (
    <>
      <PaneToolbar title="Overview" />
      <PaneBody>
        <dl className="grid gap-4 sm:grid-cols-2">
          {stats.map((s, i) => (
            <div
              key={s.label}
              className={i === 0 ? "space-y-1 rounded-2xl bg-accent p-6 text-accent-foreground sm:col-span-2" : "space-y-1 rounded-2xl bg-card p-6 ring-1 ring-foreground/8"}
            >
              <dt className="flex items-center gap-2 text-sm font-medium">
                <s.icon className="size-4" aria-hidden />
                {s.label}
              </dt>
              <dd className={i === 0 ? "text-5xl font-semibold tracking-tight tabular-nums" : "text-3xl font-semibold tracking-tight tabular-nums"}>
                {s.value}
              </dd>
              <dd className={i === 0 ? "text-sm" : "text-sm text-muted-foreground"}>{s.hint}</dd>
            </div>
          ))}
        </dl>

        {waiting.length > 0 && (
          <Group title="Needs your answer" footer="If you don't respond in time, the tenant can claim the deposit.">
            <ul className="divide-y">
              {waiting.map((d) => (
                <li key={d.id.toString()}>
                  <Link
                    href={`/landlord/deposits/${d.id}?show=answer`}
                    className="-mx-4 flex min-h-14 items-center gap-3 px-4 py-3 hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                  >
                    <span className="flex-1">
                      <span className="block font-semibold">
                        Deposit #{d.id.toString()} · {money(d.data.terms.amount)}
                      </span>
                      <StatusLine status={d.status} />
                    </span>
                    <span className="text-sm text-muted-foreground">Tenant can claim {daysFromNow(d.timeout_at)}</span>
                    <ChevronRightIcon className="size-4 text-muted-foreground" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          </Group>
        )}

        <p className="text-sm text-muted-foreground">Yield figures are estimates. The yield is variable and can be lower, or zero.</p>
        <DevNote>
          Data: factory.list_by_landlord → get_fianzas (25 per page, no vault calls). Live yield = shares × price per share,
          one read per vault, refreshed every 5 s.
        </DevNote>
      </PaneBody>
    </>
  );
}
