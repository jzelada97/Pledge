import { LandlordShell } from "@/components/landlord-shell";
import { getI18n } from "@/lib/i18n/server";
import { landlordList } from "@/lib/landlord-list";

export const dynamic = "force-dynamic"; // "in N days" must be computed per request, not at build time

export default async function LandlordLayout({ children }: { children: React.ReactNode }) {
  const { items, filters, summary } = landlordList(await getI18n());
  return (
    <LandlordShell items={items} filters={filters} summary={summary}>
      {children}
    </LandlordShell>
  );
}
