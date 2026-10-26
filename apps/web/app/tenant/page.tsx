"use client";

import { InboxIcon } from "lucide-react";
import Link from "next/link";
import { DepositPass } from "@/components/deposit-pass";
import { LiveProvider, LoginGate } from "@/components/live-provider";
import { TenantShell } from "@/components/tenant-shell";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { useI18n } from "@/lib/i18n/client";
import { tenantView } from "@/lib/tenant-deposit";

// Tenant home: las fianzas reales de la cuenta con passkey (get-escrows-by-role, receiver). Mobile-first.
export default function TenantHome() {
  const i18n = useI18n();
  const { t } = i18n;
  return (
    <TenantShell>
      <header className="space-y-1">
        <h1 className="text-4xl font-bold tracking-tight">{t.tenant.title}</h1>
        <p className="text-muted-foreground">{t.tenant.lead}</p>
      </header>
      <LiveProvider role="tenants">
        {({ address, ready, rows, error }) =>
          !ready ? null : !address ? (
            <LoginGate lead={t.live.tenantLead} className="rounded-2xl bg-card ring-1 ring-foreground/8" />
          ) : rows === null ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner aria-hidden /> {error ?? t.common.loadingDeposits}
            </p>
          ) : rows.length === 0 ? (
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
              {rows.map((d) => {
                const v = tenantView(d, i18n);
                const todo = d.live.claimable && !v.landlordApproved && v.live ? t.live.claimTodo : v.todo;
                return (
                  <li key={d.escrow}>
                    <Link
                      href={`/tenant/deposits/${d.escrow}`}
                      aria-label={[t.landlord.rowLabel(v.pass.title, v.pass.amount, v.pass.statusLabel), todo].filter(Boolean).join(". ")}
                      className="block rounded-[1.25rem] transition-transform focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none active:scale-[.98]"
                    >
                      <DepositPass {...v.pass} note={todo} />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )
        }
      </LiveProvider>
    </TenantShell>
  );
}
