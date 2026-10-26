"use client";

import { LandlordShell } from "@/components/landlord-shell";
import { LiveProvider, LoginGate } from "@/components/live-provider";
import { useI18n } from "@/lib/i18n/client";
import { landlordList } from "@/lib/landlord-list";

// Panel del casero con datos reales: la cuenta con passkey de este navegador y sus escrows del plan A
// (get-escrows-by-role, approver). Sin cuenta, la pantalla de entrada ocupa el panel de detalle.
export default function LandlordLayout({ children }: { children: React.ReactNode }) {
  const i18n = useI18n();
  return (
    <LiveProvider role="landlords">
      {(live) => {
        const { items, filters, summary } = landlordList(i18n, live.rows ?? []);
        const gate = live.ready && !live.address ? <LoginGate lead={i18n.t.live.landlordLead} /> : undefined;
        return (
          <LandlordShell items={items} filters={filters} summary={summary} gate={gate}>
            {!live.ready ? null : (gate ?? children)}
          </LandlordShell>
        );
      }}
    </LiveProvider>
  );
}
