import { SearchXIcon } from "lucide-react";
import Link from "next/link";
import { PaneBody, PaneToolbar } from "@/components/pane";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { getI18n } from "@/lib/i18n/server";

export default async function DepositNotFound() {
  const { t } = await getI18n();
  const n = t.landlord.detail.notFound;
  return (
    <>
      <PaneToolbar title={n.toolbar} back={{ href: "/landlord", label: t.common.deposits }} />
      <PaneBody>
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <SearchXIcon aria-hidden />
            </EmptyMedia>
            <EmptyTitle>{n.title}</EmptyTitle>
            <EmptyDescription>{n.body}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button asChild>
              <Link href="/landlord">{t.common.backToDeposits}</Link>
            </Button>
          </EmptyContent>
        </Empty>
      </PaneBody>
    </>
  );
}
