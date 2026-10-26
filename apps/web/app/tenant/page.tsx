import { InboxIcon } from "lucide-react";
import Link from "next/link";
import { DepositPass } from "@/components/deposit-pass";
import { TenantShell } from "@/components/tenant-shell";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { getI18n } from "@/lib/i18n/server";
import { myDeposits, tenantView } from "@/lib/tenant-deposit";

export const dynamic = "force-dynamic"; // dates are relative to now

// Tenant home: factory.list_by_tenant → get_fianzas. Mobile-first (375 px). Each deposit is a Wallet-style
// pass; tapping it opens the deposit and its actions.
export default async function TenantHome({ searchParams }: PageProps<"/tenant">) {
  const { view } = await searchParams; // ?view=empty previews the empty state
  const i18n = await getI18n();
  const { t } = i18n;
  const mine = view === "empty" ? [] : myDeposits();

  return (
    <TenantShell>
      <header className="space-y-1">
        <h1 className="text-4xl font-bold tracking-tight">{t.tenant.title}</h1>
        <p className="text-muted-foreground">{t.tenant.lead}</p>
      </header>
      {mine.length === 0 ? (
        <Empty className="rounded-2xl bg-card ring-1 ring-foreground/8">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <InboxIcon aria-hidden />
            </EmptyMedia>
            <EmptyTitle>{t.tenant.empty.title}</EmptyTitle>
            <EmptyDescription>{t.tenant.empty.body}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="flex flex-col gap-5">
          {mine.map((d) => {
            const v = tenantView(d, i18n);
            return (
              <li key={d.id.toString()}>
                <Link
                  href={`/tenant/deposits/${d.id}`}
                  aria-label={[t.landlord.rowLabel(d.id.toString(), v.pass.amount, v.pass.statusLabel), v.todo].filter(Boolean).join(". ")}
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
