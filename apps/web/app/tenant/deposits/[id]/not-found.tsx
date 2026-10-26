import { SearchXIcon } from "lucide-react";
import Link from "next/link";
import { TenantShell } from "@/components/tenant-shell";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { getI18n } from "@/lib/i18n/server";

export default async function TenantDepositNotFound() {
  const { t } = await getI18n();
  return (
    <TenantShell back={{ href: "/tenant", label: t.common.deposits }}>
      <Empty className="rounded-2xl bg-card ring-1 ring-foreground/8">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <SearchXIcon aria-hidden />
          </EmptyMedia>
          <EmptyTitle>{t.tenant.notFound.title}</EmptyTitle>
          <EmptyDescription>{t.tenant.notFound.body}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button asChild>
            <Link href="/tenant">{t.common.backToMyDeposits}</Link>
          </Button>
        </EmptyContent>
      </Empty>
    </TenantShell>
  );
}
