import { SearchXIcon } from "lucide-react";
import Link from "next/link";
import { PaneBody, PaneToolbar } from "@/components/pane";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";

export default function DepositNotFound() {
  return (
    <>
      <PaneToolbar title="Deposit not found" back={{ href: "/landlord", label: "Deposits" }} />
      <PaneBody>
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <SearchXIcon aria-hidden />
            </EmptyMedia>
            <EmptyTitle>We can&apos;t find that deposit</EmptyTitle>
            <EmptyDescription>It may have been cancelled, or the link is wrong.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button asChild>
              <Link href="/landlord">Back to deposits</Link>
            </Button>
          </EmptyContent>
        </Empty>
      </PaneBody>
    </>
  );
}
