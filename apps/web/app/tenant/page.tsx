import { InboxIcon } from "lucide-react";
import Link from "next/link";
import { DepositPass } from "@/components/deposit-pass";
import { TenantShell } from "@/components/tenant-shell";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { STATUS_LABEL, money } from "@/lib/format";
import { myDeposits, tenantView } from "@/lib/tenant-deposit";

export const dynamic = "force-dynamic"; // dates are relative to now

// Tenant home: factory.list_by_tenant → get_fianzas. Mobile-first (375 px). Each deposit is a Wallet-style
// pass; tapping it opens the deposit and its actions.
export default async function TenantHome({ searchParams }: PageProps<"/tenant">) {
  const { view } = await searchParams; // ?view=empty previews the empty state
  const mine = view === "empty" ? [] : myDeposits();

  return (
    <TenantShell>
      <header className="space-y-1">
        <h1 className="text-4xl font-bold tracking-tight">Deposits</h1>
        <p className="text-muted-foreground">They come back in full when you and your landlord approve.</p>
      </header>
      {mine.length === 0 ? (
        <Empty className="rounded-2xl bg-card ring-1 ring-foreground/8">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <InboxIcon aria-hidden />
            </EmptyMedia>
            <EmptyTitle>No deposits yet</EmptyTitle>
            <EmptyDescription>When your landlord sends you an invitation link, open it to pay your deposit.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="flex flex-col gap-5">
          {mine.map((d) => {
            const v = tenantView(d);
            return (
              <li key={d.id.toString()}>
                <Link
                  href={`/tenant/deposits/${d.id}`}
                  aria-label={`Deposit #${d.id}, ${money(d.data.terms.amount)}, ${STATUS_LABEL[d.status]}${v.todo ? `. ${v.todo}` : ""}`}
                  className="block rounded-[1.25rem] transition-transform focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none active:scale-[.98]"
                >
                  <DepositPass {...v.pass} note={v.todo} />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </TenantShell>
  );
}
