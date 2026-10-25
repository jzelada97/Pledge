"use client";

import { PlusIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NavLink } from "@/components/site-header";
import { Button } from "@/components/ui/button";

// Only links that lead somewhere else: no "Deposits" on the list, no "New deposit" on the form.
export function LandlordNav() {
  const pathname = usePathname();
  return (
    <>
      {pathname !== "/landlord" && <NavLink href="/landlord">Deposits</NavLink>}
      {pathname !== "/landlord/new" && (
        <Button asChild className="ml-2">
          <Link href="/landlord/new">
            <PlusIcon data-icon="inline-start" aria-hidden />
            New deposit
          </Link>
        </Button>
      )}
    </>
  );
}
