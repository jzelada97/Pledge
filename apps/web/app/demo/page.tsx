"use client";

// Página de la demo (MVP, plan A): todo real en testnet. El casero crea su cuenta y su link de invitación;
// cada parte ve sus fianzas reales y aprueba (casero) o recupera (inquilino). Ver docs/CONECTAR-FRONT.md.
import { useEffect, useState } from "react";
import { SignButton } from "@/components/sign-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { type FianzaView, approveRelease, ensureAccount, listFianzas, releaseFianza, savedAddress } from "@/lib/pledge";

export default function Demo() {
  const [address, setAddress] = useState<string | null>(null);
  const [amount, setAmount] = useState("10");
  const [asLandlord, setAsLandlord] = useState<FianzaView[]>([]);
  const [asTenant, setAsTenant] = useState<FianzaView[]>([]);

  useEffect(() => setAddress(savedAddress()), []);

  async function refresh(addr = address) {
    if (!addr) return;
    const [l, t] = await Promise.all([listFianzas("landlords", addr).catch(() => []), listFianzas("tenants", addr).catch(() => [])]);
    setAsLandlord(l);
    setAsTenant(t);
  }
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address]);

  const link = address && typeof location !== "undefined" ? `${location.origin}/i/1?l=${address}&a=${amount}` : "";

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 p-4">
      <h1 className="text-3xl font-semibold tracking-tight">Pledge · demo</h1>

      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">1 · Tu cuenta</h2>
        {address ? <p className="break-all text-sm text-muted-foreground">{address}</p> : null}
        <SignButton label="Entrar o crear cuenta con Face ID" success="Cuenta lista" action={async () => setAddress(await ensureAccount())} />
      </section>

      {address && (
        <section className="flex flex-col gap-2">
          <h2 className="font-semibold">2 · Casero: link de invitación</h2>
          <label className="text-sm">
            Fianza (USDC de prueba, máx. 100)
            <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
          <p className="break-all rounded-lg bg-muted p-3 text-sm">{link}</p>
          <Button variant="outline" onClick={() => navigator.clipboard?.writeText(link)}>
            Copiar link
          </Button>
        </section>
      )}

      {address && (
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">3 · Mis fianzas</h2>
            <Button variant="ghost" onClick={() => void refresh()}>
              Actualizar
            </Button>
          </div>
          {[...asLandlord.map((f) => ({ f, role: "landlord" as const })), ...asTenant.map((f) => ({ f, role: "tenant" as const }))].map(({ f, role }) => (
            <div key={`${role}-${f.contractId}`} className="flex flex-col gap-2 rounded-2xl p-4 ring-1 ring-foreground/10">
              <p className="text-sm font-medium">
                {role === "landlord" ? "Como casero" : "Como inquilino"} · {f.amount} USDC · {f.status}
              </p>
              <p className="break-all text-xs text-muted-foreground">{f.contractId}</p>
              {role === "landlord" ? (
                <SignButton label="Aprobar devolución" success="Devolución aprobada" action={() => approveRelease(f.contractId, address)} onDone={() => void refresh()} />
              ) : (
                <SignButton label="Recuperar mi fianza" success="Fianza devuelta" action={() => releaseFianza(f.contractId, address)} onDone={() => void refresh()} />
              )}
            </div>
          ))}
          {asLandlord.length + asTenant.length === 0 && <p className="text-sm text-muted-foreground">Todavía no hay fianzas.</p>}
        </section>
      )}
    </main>
  );
}
