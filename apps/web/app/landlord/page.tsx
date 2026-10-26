"use client";

import { BellIcon, ChevronRightIcon, LandmarkIcon, SproutIcon } from "lucide-react";
import Link from "next/link";
import { Group } from "@/components/grouped";
import { useLive } from "@/components/live-provider";
import { PaneBody, PaneToolbar } from "@/components/pane";
import { StatusLine } from "@/components/status-badge";
import { Spinner } from "@/components/ui/spinner";
import { useI18n } from "@/lib/i18n/client";
import { landlordList, needsAction } from "@/lib/landlord-list";
import { shortId } from "@/lib/live";
import { cn } from "@/lib/utils";

// Desktop detail pane with no deposit selected: the totals and what needs an answer.
// On phones this pane is hidden and /landlord shows the list instead.
export default function LandlordOverview() {
  const i18n = useI18n();
  const { t, f } = i18n;
  const o = t.landlord.overview;
  const { rows, error } = useLive();
  const { summary } = landlordList(i18n, rows ?? []);
  const waiting = (rows ?? []).filter(needsAction);
  const stats = [
    { icon: LandmarkIcon, label: t.landlord.held, value: summary.held, hint: o.heldHint(summary.heldCount) },
    { icon: SproutIcon, label: t.landlord.yieldSoFar, value: summary.yieldSoFar, hint: t.landlord.estimatedVariable },
    { icon: BellIcon, label: o.answer, value: String(summary.answer), hint: o.answerHint },
  ];

  return (
    <>
      <PaneToolbar title={o.title} />
      <PaneBody>
        {rows === null && !error && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner aria-hidden /> {t.common.loadingDeposits}
          </p>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
        <dl className="grid gap-4 sm:grid-cols-2">
          {stats.map((s, i) => (
            <div
              key={s.label}
              className={cn("space-y-1 rounded-2xl p-6", i === 0 ? "bg-accent text-accent-foreground sm:col-span-2" : i === 2 && summary.answer > 0 ? "bg-highlight-soft ring-1 ring-highlight/50" : "bg-card ring-1 ring-foreground/8")}
            >
              <dt className="flex items-center gap-2 text-sm font-medium">
                <s.icon className={cn("size-4", i === 2 && summary.answer > 0 && "text-highlight-text")} aria-hidden />
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
          <Group title={o.needsAnswer} footer={o.needsAnswerFooter}>
            <ul className="divide-y">
              {waiting.map((d) => (
                <li key={d.escrow}>
                  <Link
                    href={`/landlord/deposits/${d.escrow}?show=answer`}
                    className="-mx-4 flex min-h-14 items-center gap-3 px-4 py-3 hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                  >
                    <span className="flex-1">
                      <span className="block font-semibold">
                        {t.common.deposit(shortId(d.escrow))} · {f.money(d.data.terms.amount)}
                      </span>
                      <StatusLine status={d.status} />
                    </span>
                    <ChevronRightIcon className="size-4 text-muted-foreground" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          </Group>
        )}

        <p className="text-sm text-muted-foreground">{o.disclaimer}</p>
      </PaneBody>
    </>
  );
}
