// Datos de prueba compartidos por los tests.
import type { FianzaParties } from "./fianza";
import type { SingleReleaseV2Escrow } from "./types";

// Direcciones con formato válido (no son cuentas reales).
export const LANDLORD = "GLANDLORD".padEnd(56, "A");
export const TENANT = "GTENANT".padEnd(56, "B");
export const TREASURY = "GTREASURY".padEnd(56, "C");
export const STAFF = "GSTAFF".padEnd(56, "D");
export const ADMIN = "GADMIN".padEnd(56, "E");
export const USDC = "CUSDC".padEnd(56, "F");
export const VAULT = "CDKNUOYYDNSHVOKVT7XNQAYUQ7U4OGNJ4Z5DGXY5QW6AIYG6VUPKDOQO";
export const ESCROW_ID = "CESCROW".padEnd(56, "G");

export const parties: FianzaParties = {
  landlord: LANDLORD,
  tenant: TENANT,
  treasury: TREASURY,
  staff: [STAFF],
  admin: ADMIN,
};

/** Escrow de TW tal y como lo devuelve `GET …/v2/{contractId}`, con ajustes. */
export function escrowFixture(over: Partial<SingleReleaseV2Escrow> = {}): SingleReleaseV2Escrow {
  return {
    type: "single-release-v2",
    contractId: ESCROW_ID,
    contractBaseId: "base",
    engagementId: "fianza-1",
    title: "Fianza 1",
    description: "Fianza de habitación",
    amount: 500,
    balance: 500,
    platformFee: 0,
    receiverMemo: 0,
    trustline: { contractId: USDC },
    roles: {
      approvers: [LANDLORD, TENANT],
      serviceProviders: [LANDLORD],
      platform: TREASURY,
      releaseSigners: [LANDLORD, TENANT],
      disputeResolvers: [STAFF],
      receiver: TENANT,
      admin: ADMIN,
      observers: [],
    },
    milestones: [
      {
        description: "Devolución de la fianza",
        status: "pending",
        evidence: "",
        approvals: { target: 2, approvalCount: 0, approvedBy: [] },
      },
    ],
    dispute: { isDisputed: false, reason: "", resolved: false },
    released: false,
    ...over,
  };
}
