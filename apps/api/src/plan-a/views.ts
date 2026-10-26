// Escrow de TW → JSON de /fianzas/v1 (camelCase, importes en string decimal de 7 decimales). Mantiene
// los nombres que ya usa el front: status, terms.amount, landlord, tenant, accruedYield…
import {
  TW_FEE_BPS,
  accruedYield,
  expectedPayout,
  fianzaStatus,
  floorToUnits,
  fromDecimal,
  type Escrow,
  type FianzaStatus,
  type VaultPosition,
} from "@fianzas/trustless";
import { toDecimal } from "../chain";

/** Estado del plan A en los nombres del front (INTERFACES § 2). `Ending` no existe en TW. */
export function statusOf(e: Escrow): FianzaStatus {
  return fianzaStatus(e);
}

// El escrow de TW no guarda la fecha de fin del alquiler: va en nuestro engagementId, que es inmutable
// (`fianza-<id>-end<endTs>`). Es la base de la liberación a plazo (#115).
const DEADLINE_RE = /-end(\d{1,12})$/;

export function engagementIdWithDeadline(fianzaId: string | number, endTs: number | undefined): string {
  return endTs === undefined ? String(fianzaId) : `${fianzaId}-end${endTs}`;
}

/** `endTs` (unix seconds) codificado en el engagementId, o null si la fianza se creó sin fecha de fin. */
export function deadlineOf(e: Escrow): number | null {
  const m = DEADLINE_RE.exec(e.engagementId);
  return m ? Number(m[1]) : null;
}

/** Plazos de la liberación a plazo: `claimableAt = endTs + claimTimeoutSecs`. */
export function deadlineView(e: Escrow, claimTimeoutSecs: number, now = Math.floor(Date.now() / 1000)) {
  const endTs = deadlineOf(e);
  const claimableAt = endTs === null ? null : endTs + claimTimeoutSecs;
  const approved = e.milestones[0]?.approved ?? false;
  return {
    endTs,
    claimableAt,
    claimTimeoutSecs,
    // El inquilino puede reclamar: plazo pasado, fianza activa o ya parada por él, y sin aprobación del casero.
    claimable: claimableAt !== null && now > claimableAt && !approved && ["Active", "Stopped"].includes(statusOf(e)),
  };
}

/** Plazo configurado y "ahora" (unix seconds) con los que se calcula `claimable`; por defecto 30 días y el reloj. */
export interface DeadlineOpts {
  claimTimeoutSecs?: number;
  nowSecs?: number;
}
const deadlineOpts = (o: DeadlineOpts) => [o.claimTimeoutSecs ?? 30 * 24 * 3600, o.nowSecs ?? Math.floor(Date.now() / 1000)] as const;

export function escrowView(e: Escrow, tenantYieldBps: number, position?: VaultPosition | null, deadline: DeadlineOpts = {}) {
  const amount = fromDecimal(e.amount);
  // El saldo puede traer más de 7 decimales o venir en notación exponencial (1e-7): se trunca.
  const balance = floorToUnits(e.balance);
  const yieldUnits = position ? accruedYield(position, amount) : balance > amount ? balance - amount : 0n;
  const approved = e.milestones[0]?.approved ?? false;
  return {
    contractId: e.contractId,
    engagementId: e.engagementId,
    title: e.title,
    status: statusOf(e),
    ...deadlineView(e, ...deadlineOpts(deadline)),
    landlord: e.roles.approver,
    tenant: e.roles.receiver,
    treasury: e.roles.platformAddress,
    staff: e.roles.disputeResolver,
    amount: toDecimal(amount),
    balance: toDecimal(balance),
    accruedYield: toDecimal(yieldUnits),
    // Lo que recibiría el inquilino hoy al liberar (TW cobra su 0,3 % sobre todo lo retirado).
    expectedPayout: toDecimal(expectedPayout(balance, e.platformFee)),
    approvals: { target: 2, count: approved ? 1 : 0, landlordApproved: approved },
    flags: e.flags,
    vault: e.vault ?? null,
    fees: { twFeeBps: TW_FEE_BPS, platformFeePercent: e.platformFee, tenantYieldBps },
  };
}

export function termsView(e: Escrow, tenantYieldBps: number, deadline: DeadlineOpts = {}) {
  const { endTs, claimableAt, claimTimeoutSecs } = deadlineView(e, ...deadlineOpts(deadline));
  return {
    contractId: e.contractId,
    engagementId: e.engagementId,
    endTs,
    claimableAt,
    claimTimeoutSecs,
    landlord: e.roles.approver,
    tenant: e.roles.receiver,
    treasury: e.roles.platformAddress,
    disputeResolvers: [e.roles.disputeResolver],
    amount: toDecimal(fromDecimal(e.amount)),
    token: e.trustline.contractId ?? null,
    tokenIssuer: e.trustline.address,
    vault: e.vault ?? null,
    // Comisiones del plan A (INTERFACES § 9 adaptado): TW cobra sobre todo lo retirado, capital incluido.
    twFeeBps: TW_FEE_BPS,
    twFeeOnPrincipal: true,
    platformFeeBps: e.platformFee * 100,
    tenantYieldBps,
  };
}
