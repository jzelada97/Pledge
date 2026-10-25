import { NavLink, SiteHeader } from "@/components/site-header";

export default function LandlordLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteHeader
        nav={
          <>
            <NavLink href="/landlord">Deposits</NavLink>
            <NavLink href="/landlord/new">New deposit</NavLink>
          </>
        }
      />
      <main className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6">{children}</main>
    </>
  );
}
