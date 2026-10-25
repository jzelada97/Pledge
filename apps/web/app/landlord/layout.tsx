import { LandlordShell } from "@/components/landlord-shell";
import { landlordList } from "@/lib/landlord-list";

export const dynamic = "force-dynamic"; // "in N days" must be computed per request, not at build time

export default function LandlordLayout({ children }: { children: React.ReactNode }) {
  const { items, filters, summary } = landlordList();
  return (
    <LandlordShell items={items} filters={filters} summary={summary}>
      {children}
    </LandlordShell>
  );
}
