"use client";

import { ChevronLeftIcon, ShieldCheckIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

// Tenant screens are an iOS-style stack: a frosted navigation bar (back button or brand) and one narrow
// column, the same width on every device.
export function TenantShell({ children, back }: { children: ReactNode; back?: { href: string; label: string } }) {
  const pathname = usePathname();
  return (
    <>
      <header
        data-glass
        className="sticky top-0 z-20 border-b bg-card supports-backdrop-filter:bg-card/80 supports-backdrop-filter:backdrop-blur-xl supports-backdrop-filter:backdrop-saturate-150"
      >
        <div className="mx-auto flex min-h-14 max-w-md items-center justify-between gap-2 px-2">
          {back ? (
            <Link
              href={back.href}
              className="inline-flex min-h-11 items-center gap-0.5 rounded-lg pr-2 text-base font-medium text-primary focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              <ChevronLeftIcon className="size-6" aria-hidden />
              {back.label}
            </Link>
          ) : (
            <Link
              href="/"
              className="flex min-h-11 items-center gap-2 rounded-lg px-2 font-semibold tracking-tight focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <ShieldCheckIcon className="size-4" aria-hidden />
              </span>
              Fianzas
            </Link>
          )}
          {!pathname.startsWith("/tenant") && (
            <Link
              href="/tenant"
              className="inline-flex min-h-11 items-center rounded-lg px-3 text-base font-medium text-primary focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              My deposits
            </Link>
          )}
        </div>
      </header>
      <main className="mx-auto flex max-w-md flex-col gap-8 px-4 pt-6 pb-10">{children}</main>
    </>
  );
}
