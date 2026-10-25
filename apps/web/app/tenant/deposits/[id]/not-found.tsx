import { SearchXIcon } from "lucide-react";
import Link from "next/link";
import { TenantShell } from "@/components/tenant-shell";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";

export default function TenantDepositNotFound() {
  return (
    <TenantShell back={{ href: "/tenant", label: "Deposits" }}>
      <Empty className="rounded-2xl bg-card ring-1 ring-foreground/8">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <SearchXIcon aria-hidden />
          </EmptyMedia>
          <EmptyTitle>We can&apos;t find that deposit</EmptyTitle>
          <EmptyDescription>It may have been cancelled, or the link is wrong.</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button asChild>
            <Link href="/tenant">Back to my deposits</Link>
          </Button>
        </EmptyContent>
      </Empty>
    </TenantShell>
  );
}
