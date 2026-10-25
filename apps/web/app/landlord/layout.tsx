import { LandlordNav } from "@/components/landlord-nav";
import { SiteHeader } from "@/components/site-header";

export default function LandlordLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteHeader nav={<LandlordNav />} />
      <main className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6">{children}</main>
    </>
  );
}
