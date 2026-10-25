import type { ReactNode } from "react";
import { NavLink, SiteHeader } from "@/components/site-header";

// Tenant screens are mobile-first: one narrow column, the same width on every device.
export function TenantShell({ children }: { children: ReactNode }) {
  return (
    <>
      <SiteHeader nav={<NavLink href="/tenant">My deposits</NavLink>} />
      <main className="mx-auto flex max-w-md flex-col gap-6 px-4 py-8">{children}</main>
    </>
  );
}
