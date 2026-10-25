// Una fianza como escrow Single-Release v2 de Trustless Work. Este módulo traduce nuestro
// dominio (casero, inquilino, staff, aprobar devolución, parar, resolver) a los cuerpos de su API.
import { withDefindex, type DefindexStrategy, type DeployWithDefindex } from "./defindex";
import type {
  ApproveAndReleaseBody,
  ApproveMilestonesBody,
  DeployV2Body,
  DisputeBody,
  ResolveDisputeBody,
  SingleReleaseV2Escrow,
  TrustlineRef,
} from "./types";
import { fromDecimal, toDecimal } from "./units";

/** El único hito: la devolución, con las dos aprobaciones (casero e inquilino). */
export const RELEASE_MILESTONE = 0;
export const APPROVALS_TARGET = 2;
const MAX_ROLE = 5;
const MAX_REASON = 500;

export type FianzaErrorCode =
  | "INVALID_PARTIES"
  | "NOT_PARTY"
  | "NOT_RESOLVER"
  | "NOT_FUNDED"
  | "ALREADY_APPROVED"
  | "ALREADY_SETTLED"
  | "DISPUTED"
  | "NOT_DISPUTED"
  | "INVALID_AMOUNT"
  | "INVALID_REASON";

export class FianzaError extends Error {
  constructor(
    readonly code: FianzaErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "FianzaError";
  }
}

export interface FianzaParties {
  landlord: string;
  tenant: string;
  /** Recibe la comisión de la plataforma. */
  treasury: string;
  /** Resolvers de disputas (1–5). */
  staff: string[];
  /** Cuenta de la plataforma que administra el escrow; distinta de todas las demás. */
  admin: string;
}

export interface FianzaDeployInput {
  fianzaId: string | number;
  parties: FianzaParties;
  /** Importe en unidad mínima (7 decimales). */
  amount: bigint;
  asset: TrustlineRef;
  title?: string;
  description?: string;
  /** Quién firma el despliegue. Por defecto, el inquilino al aceptar la invitación. */
  signer?: string;
  /** Rendimiento en DeFindex (ver defindex.ts). */
  defindex?: DefindexStrategy;
}

export type FianzaStatus = "Proposed" | "Active" | "Stopped" | "Settled";

/** Comprueba las reglas de roles de TW v2 antes de llamar a la API (fallar pronto y claro). */
export function validateParties(p: FianzaParties): void {
  const fail = (msg: string) => {
    throw new FianzaError("INVALID_PARTIES", msg);
  };
  if (p.landlord === p.tenant) fail("Casero e inquilino no pueden ser la misma cuenta");
  if (p.staff.length === 0 || p.staff.length > MAX_ROLE) fail("El staff debe tener de 1 a 5 cuentas");
  if (new Set(p.staff).size !== p.staff.length) fail("El staff tiene cuentas repetidas");
  // Un resolver no puede tener un rol que abra disputas (approver, provider, signer, platform, receiver).
  const disputers = new Set([p.landlord, p.tenant, p.treasury]);
  if (p.staff.some((s) => disputers.has(s))) fail("El staff no puede ser casero, inquilino ni tesorería");
  const others = new Set([p.landlord, p.tenant, p.treasury, ...p.staff]);
  if (others.has(p.admin)) fail("El admin debe ser distinto de todos los demás roles");
}

export function engagementId(fianzaId: string | number): string {
  return `fianza-${fianzaId}`;
}

/** Cuerpo de `POST /escrow/single-release/v2/deploy` para una fianza. */
export function buildDeployBody(input: FianzaDeployInput): DeployV2Body | DeployWithDefindex {
  const p = input.parties;
  validateParties(p);
  if (input.amount <= 0n) throw new FianzaError("INVALID_AMOUNT", "La fianza debe ser mayor que 0");
  const body: DeployV2Body = {
    signer: input.signer ?? p.tenant,
    engagementId: engagementId(input.fianzaId),
    title: input.title ?? `Fianza ${input.fianzaId}`,
    description: input.description ?? "Fianza de habitación",
    roles: {
      approvers: [p.landlord, p.tenant],
      serviceProviders: [p.landlord],
      platform: p.treasury,
      releaseSigners: [p.landlord, p.tenant],
      disputeResolvers: [...p.staff],
      receiver: p.tenant,
      admin: p.admin,
      observers: [],
    },
    amount: toDecimal(input.amount),
    // TW cobra platformFee sobre el total; nuestra comisión es solo sobre el rendimiento.
    platformFee: 0,
    milestones: [{ description: "Devolución de la fianza", approvalsTarget: APPROVALS_TARGET }],
    trustline: input.asset,
  };
  return input.defindex ? withDefindex(body, input.defindex) : body;
}

export function fianzaStatus(escrow: SingleReleaseV2Escrow): FianzaStatus {
  if (escrow.released || escrow.dispute.resolved) return "Settled";
  if (escrow.dispute.isDisputed) return "Stopped";
  return escrow.balance > 0 ? "Active" : "Proposed";
}

export type ApproveAction =
  | { kind: "approve"; body: ApproveMilestonesBody }
  | { kind: "approve-and-release"; body: ApproveAndReleaseBody };

/**
 * "Aprobar devolución": si la otra parte ya aprobó, esta aprobación completa el quórum y
 * libera en la misma transacción (`approve-and-release-milestones`); si no, solo aprueba.
 */
export function planApproveRelease(escrow: SingleReleaseV2Escrow, who: string): ApproveAction {
  if (!escrow.roles.approvers.includes(who)) {
    throw new FianzaError("NOT_PARTY", "Solo el casero o el inquilino pueden aprobar");
  }
  const status = fianzaStatus(escrow);
  if (status === "Settled") throw new FianzaError("ALREADY_SETTLED", "La fianza ya está liquidada");
  if (status === "Stopped") throw new FianzaError("DISPUTED", "La fianza está parada");
  if (status === "Proposed") throw new FianzaError("NOT_FUNDED", "La fianza aún no está depositada");

  const approvals = escrow.milestones[RELEASE_MILESTONE].approvals;
  if (approvals.approvedBy.includes(who)) {
    throw new FianzaError("ALREADY_APPROVED", "Esta parte ya aprobó la devolución");
  }
  const milestoneIndexes = [RELEASE_MILESTONE];
  if (approvals.approvalCount + 1 >= approvals.target) {
    return {
      kind: "approve-and-release",
      body: { contractId: escrow.contractId, signer: who, milestoneIndexes },
    };
  }
  return { kind: "approve", body: { contractId: escrow.contractId, approver: who, milestoneIndexes } };
}

/** "Parar": el casero abre la disputa. `reason` debería ser un hash, no el motivo en claro (DAT-2). */
export function buildStopBody(escrow: SingleReleaseV2Escrow, landlord: string, reason: string): DisputeBody {
  if (!escrow.roles.serviceProviders.includes(landlord)) {
    throw new FianzaError("NOT_PARTY", "Solo el casero puede parar la fianza");
  }
  if (fianzaStatus(escrow) !== "Active") {
    throw new FianzaError("NOT_FUNDED", "Solo se puede parar una fianza activa");
  }
  if (reason.length === 0 || reason.length > MAX_REASON) {
    throw new FianzaError("INVALID_REASON", "El motivo debe tener de 1 a 500 caracteres");
  }
  return { contractId: escrow.contractId, signer: landlord, reason };
}

/**
 * "Resolver": la deducción (en unidad mínima) va al casero y el resto del saldo al inquilino.
 * Las distribuciones suman exactamente el saldo, como exige el contrato de TW.
 */
export function buildResolveBody(
  escrow: SingleReleaseV2Escrow,
  resolver: string,
  deduction: bigint,
): ResolveDisputeBody {
  if (!escrow.roles.disputeResolvers.includes(resolver)) {
    throw new FianzaError("NOT_RESOLVER", "Solo el staff puede resolver");
  }
  if (fianzaStatus(escrow) !== "Stopped") {
    throw new FianzaError("NOT_DISPUTED", "Solo se resuelve una fianza parada");
  }
  const balance = fromDecimal(escrow.balance);
  if (deduction < 0n || deduction > balance) {
    throw new FianzaError("INVALID_AMOUNT", "La deducción debe estar entre 0 y el saldo");
  }
  const landlord = escrow.roles.serviceProviders[0];
  const distributions = [
    { address: escrow.roles.receiver, amount: balance - deduction },
    { address: landlord, amount: deduction },
  ]
    .filter((d) => d.amount > 0n)
    .map((d) => ({ address: d.address, amount: toDecimal(d.amount) }));
  return { contractId: escrow.contractId, disputeResolver: resolver, distributions };
}
