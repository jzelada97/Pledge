// Datos de prueba compartidos por los tests.
import type { FianzaParties } from "./fianza";
import type { Escrow } from "./types";

// Direcciones con formato válido (no son cuentas reales).
export const LANDLORD = "GLANDLORD".padEnd(56, "A");
export const TENANT = "CTENANT".padEnd(56, "B"); // passkey
export const TREASURY = "GTREASURY".padEnd(56, "C");
export const STAFF = "GSTAFF".padEnd(56, "D");
export const ISSUER = "GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56";
export const ESCROW_ID = "CESCROW".padEnd(56, "G");

export const parties: FianzaParties = { landlord: LANDLORD, tenant: TENANT, treasury: TREASURY, staff: STAFF };

/** Escrow tal y como lo devuelve `GET /helper/get-escrow-by-contract-ids`, con ajustes. */
export function escrowFixture(over: Partial<Escrow> = {}): Escrow {
  return {
    contractId: ESCROW_ID,
    type: "single-release",
    vault: "CCG3G4YUO3FOPCTZXDSXOB3VXLOWVW3G5FB6RJNB45TYQ34SBS7TS7ZJ",
    engagementId: "fianza-1",
    title: "Fianza 1",
    description: "Fianza de habitación",
    amount: 500,
    balance: 500.0000893,
    platformFee: 0,
    roles: {
      approver: LANDLORD,
      serviceProvider: LANDLORD,
      platformAddress: TREASURY,
      releaseSigner: TENANT,
      disputeResolver: STAFF,
      receiver: TENANT,
    },
    flags: { disputed: false, released: false, resolved: false },
    trustline: { symbol: "USDC", address: ISSUER },
    milestones: [{ description: "Devolución de la fianza", status: "pending", evidence: "", approved: false }],
    ...over,
  };
}
