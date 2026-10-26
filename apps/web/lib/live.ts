"use client";

// Datos reales del plan A para las pantallas del casero y del inquilino: la API de apps/api (misma origin)
// → la forma `DepositRow` que ya dibujan las pantallas (snake_case, bigint). Así las vistas no cambian.
import { useCallback, useEffect, useState } from "react";
import type { DepositRow } from "./fixtures";
import { nowSecs } from "./format";
import { ensureAccount, getFianza, listFianzas, savedAddress, type FianzaView } from "./pledge";
import { split } from "./split";
import { strategyById } from "./strategies";
import type { Status } from "./types";

/** Importe decimal de la API ("500.0000000") → unidades (7 decimales) sin pasar por float. */
export function fromDec(amount: string | number | null | undefined): bigint {
  const [w, f = ""] = String(amount ?? "0").replace(/^-/, "").split(".");
  const units = BigInt(w || "0") * 10_000_000n + BigInt((f + "0000000").slice(0, 7));
  return String(amount).startsWith("-") ? -units : units;
}

/** Etiqueta corta de una fianza: los 4 últimos caracteres del contrato (el título lo lleva la vista). */
export const shortId = (contractId: string) => contractId.slice(-4);

/** Lo que la vista real añade a una fila: el contrato y si el inquilino puede reclamar ya. */
export type LiveRow = DepositRow & { live: { contractId: string; title: string; claimable: boolean; claimableAt: number | null } };

export function toDepositRow(v: FianzaView): LiveRow {
  const amount = fromDec(v.amount as string);
  const accrued = fromDec(v.accruedYield as string);
  const endTs = typeof v.endTs === "number" ? BigInt(v.endTs) : 0n;
  const approvals = (v.approvals ?? {}) as { count?: number; landlordApproved?: boolean };
  const flags = (v.flags ?? {}) as { disputed?: boolean; released?: boolean; resolved?: boolean };
  const fees = (v.fees ?? {}) as { tenantYieldBps?: number };
  const landlord = String(v.landlord);
  const tenant = typeof v.tenant === "string" ? v.tenant : null;
  // El plan A no guarda "Ending": se deriva del fin del contrato, como hacían las fixtures.
  const status: Status = v.status === "Active" && endTs && nowSecs() > endTs ? "Ending" : (v.status as Status);
  const settled = status === "Settled";
  const tenantYieldBps = fees.tenantYieldBps ?? 0;
  return {
    id: 0n,
    escrow: v.contractId,
    status,
    accrued_yield: settled ? 0n : accrued,
    timeout_at: typeof v.claimableAt === "number" ? BigInt(v.claimableAt) : 0n,
    review_deadline: 0n,
    live: { contractId: v.contractId, title: String(v.title ?? ""), claimable: v.claimable === true, claimableAt: typeof v.claimableAt === "number" ? v.claimableAt : null },
    data: {
      terms: {
        factory: "",
        id: 0n,
        landlord,
        amount,
        end_ts: endTs,
        tenant_yield_bps: tenantYieldBps,
        strategy: strategyById("usdc_fixed"),
        platform_fee_bps: 0,
        treasury: String(v.treasury ?? ""),
        dispute_resolvers: v.staff ? [String(v.staff)] : [],
        timeout_secs: typeof v.claimTimeoutSecs === "number" ? BigInt(v.claimTimeoutSecs) : 0n,
        review_timeout_secs: 0n,
        stop_bond: 0n,
      },
      tenant,
      invite_hash: null,
      status: status === "Ending" ? "Active" : status,
      approvals: { target: 2, approval_count: approvals.count ?? 0, approved_by: approvals.landlordApproved ? [landlord] : [] },
      shares: status === "Proposed" ? 0n : amount,
      created_ts: 0n,
      funded_ts: 0n,
      dispute: { reason_hash: flags.disputed ? "on-chain" : null, stopped_ts: 0n, expert_ref: null, report_hash: null, bond_held: 0n, stop_justified: null },
      settlement: settled ? split(amount, amount + accrued, 0n, 0, tenantYieldBps) : null,
      path: flags.released ? "Approved" : flags.resolved ? "Resolved" : null,
    },
  };
}

/** La cuenta con passkey de este navegador: reconecta la guardada o crea una nueva. */
export function useAccount() {
  const [address, setAddress] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setAddress(savedAddress());
    setReady(true);
  }, []);
  const login = useCallback(async () => setAddress(await ensureAccount()), []);
  return { address, ready, login };
}

export type Role = "landlords" | "tenants";

/** Fianzas reales de `address` en el rol dado, refrescadas cada 15 s y a demanda. */
export function useDeposits(role: Role, address: string | null) {
  const [rows, setRows] = useState<LiveRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    if (!address) return;
    try {
      setRows((await listFianzas(role, address)).map(toDepositRow));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [role, address]);
  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 15_000);
    return () => clearInterval(id);
  }, [refresh]);
  return { rows, error, refresh, loading: address !== null && rows === null };
}

/** Una fianza por contrato. */
export function useDeposit(contractId: string | null) {
  const [row, setRow] = useState<LiveRow | null | undefined>(undefined); // undefined = cargando, null = no existe
  const refresh = useCallback(async () => {
    if (!contractId) return;
    try {
      setRow(toDepositRow(await getFianza(contractId)));
    } catch {
      setRow(null);
    }
  }, [contractId]);
  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 15_000);
    return () => clearInterval(id);
  }, [refresh]);
  return { row, refresh };
}
