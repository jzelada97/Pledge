"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { NavLink, SiteHeader } from "@/components/site-header";

// Tenant screens are mobile-first: one narrow column, the same width on every device.
export function TenantShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <>
      <SiteHeader nav={pathname !== "/tenant" ? <NavLink href="/tenant">My deposits</NavLink> : undefined} />
      <main className="mx-auto flex max-w-md flex-col gap-6 px-4 py-8">{children}</main>
    </>
  );
}
