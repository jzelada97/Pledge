"use client";

import { ScanFaceIcon } from "lucide-react";
import { createContext, useContext, type ReactNode } from "react";
import { SignButton } from "@/components/sign-button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { useI18n } from "@/lib/i18n/client";
import { useAccount, useDeposits, type LiveRow, type Role } from "@/lib/live";

// La cuenta con passkey y las fianzas reales de un rol, compartidas por el layout y sus páginas.
export interface Live {
  address: string | null;
  ready: boolean;
  login: () => Promise<void>;
  rows: LiveRow[] | null;
  error: string | null;
  refresh: () => Promise<void>;
}

const LiveContext = createContext<Live | null>(null);

export function useLive(): Live {
  const v = useContext(LiveContext);
  if (!v) throw new Error("useLive fuera de LiveProvider");
  return v;
}

export function LiveProvider({ role, children }: { role: Role; children: (live: Live) => ReactNode }) {
  const { address, ready, login } = useAccount();
  const { rows, error, refresh } = useDeposits(role, address);
  const live: Live = { address, ready, login, rows, error, refresh };
  return <LiveContext.Provider value={live}>{children(live)}</LiveContext.Provider>;
}

// Pantalla de entrada: una sola acción, la passkey (Face ID / Windows Hello). Sin cuenta no hay nada que listar.
export function LoginGate({ lead, className }: { lead: string; className?: string }) {
  const { t } = useI18n();
  const { login } = useLive();
  return (
    <Empty className={className ?? "m-4 rounded-2xl bg-card ring-1 ring-foreground/8"}>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <ScanFaceIcon aria-hidden />
        </EmptyMedia>
        <EmptyTitle>{t.live.signIn}</EmptyTitle>
        <EmptyDescription>{lead}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <SignButton size="lg" label={t.live.signIn} success={t.live.signedIn} action={login} />
      </EmptyContent>
    </Empty>
  );
}
