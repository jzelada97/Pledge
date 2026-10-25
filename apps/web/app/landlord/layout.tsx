import { PlusIcon } from "lucide-react";
import Link from "next/link";
import { NavLink, SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";

export default function LandlordLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteHeader
        nav={
          <>
            <NavLink href="/landlord">Deposits</NavLink>
            <Button asChild className="ml-2">
              <Link href="/landlord/new">
                <PlusIcon data-icon="inline-start" aria-hidden />
                New deposit
              </Link>
            </Button>
          </>
        }
      />
      <main className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6">{children}</main>
    </>
  );
}
