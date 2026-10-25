import { ShieldCheckIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

export function SiteHeader({ nav }: { nav?: ReactNode }) {
  return (
    <header
      data-glass
      className="sticky top-0 z-40 border-b bg-card supports-backdrop-filter:bg-card/80 supports-backdrop-filter:backdrop-blur-xl supports-backdrop-filter:backdrop-saturate-150"
    >
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link
          href="/"
          className="flex min-h-11 items-center gap-2 rounded-md font-semibold tracking-tight focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <ShieldCheckIcon className="size-4" aria-hidden />
          </span>
          Fianzas
        </Link>
        {nav && (
          <nav aria-label="Main" className="flex items-center gap-1">
            {nav}
          </nav>
        )}
      </div>
    </header>
  );
}

export function NavLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-full px-4 py-3 text-sm font-medium text-foreground hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      {children}
    </Link>
  );
}
