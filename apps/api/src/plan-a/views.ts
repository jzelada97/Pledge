// Escrow de TW → JSON de /fianzas/v1 (camelCase, importes en string decimal de 7 decimales). Mantiene
// los nombres que ya usa el front: status, terms.amount, landlord, tenant, accruedYield…
import {
  TW_FEE_BPS,
  accruedYield,
  expectedPayout,
  fianzaStatus,
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

export function escrowView(e: Escrow, tenantYieldBps: number, position?: VaultPosition | null) {
  const amount = fromDecimal(e.amount);
  const balance = fromDecimal(String(e.balance)); // puede traer más de 7 decimales
  const yieldUnits = position ? accruedYield(position, amount) : balance > amount ? balance - amount : 0n;
  const approved = e.milestones[0]?.approved ?? false;
  return {
    contractId: e.contractId,
    engagementId: e.engagementId,
    title: e.title,
    status: statusOf(e),
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

export function termsView(e: Escrow, tenantYieldBps: number) {
  return {
    contractId: e.contractId,
    engagementId: e.engagementId,
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
