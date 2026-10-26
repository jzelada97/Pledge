import Link from "next/link";
import { Logo } from "@/components/logo";
import { PreferencesMenu } from "@/components/preferences-menu";

export function SiteHeader() {
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
          <Logo />
        </Link>
        <PreferencesMenu />
      </div>
    </header>
  );
}
