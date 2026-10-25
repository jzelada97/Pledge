// Una fianza como escrow single-release con rendimiento de Trustless Work (API v1 + vault). Este
// módulo traduce nuestro dominio (casero, inquilino, staff, aprobar devolución, parar, resolver) a los
// cuerpos de su API.
//
// Roles v1 (una dirección por rol, sin quórum): el casero es `approver` y `serviceProvider`; el
// inquilino, `releaseSigner` y `receiver`. "Aprobar la devolución" son dos pasos: el casero aprueba el
// hito y el inquilino libera. La API no admite una C-address (passkey) como firmante (issue #61): esas
// acciones se construyen contra el contrato y van por el Relayer (packages/wallet, plan A).
import type {
  ApproveMilestoneBody,
  DeployBody,
  DisputeBody,
  Distribution,
  DistributionsBody,
  Escrow,
  ReleaseFundsBody,
} from "./types";
import { fromDecimal, toDecimal } from "./units";

/** El único hito: la devolución de la fianza. */
export const RELEASE_MILESTONE = "0";
const BPS = 10_000n;

export type FianzaErrorCode =
  | "INVALID_PARTIES"
  | "NOT_PARTY"
  | "NOT_RESOLVER"
  | "NOT_FUNDED"
  | "NOT_APPROVED"
  | "ALREADY_APPROVED"
  | "ALREADY_SETTLED"
  | "DISPUTED"
  | "NOT_DISPUTED"
  | "INVALID_AMOUNT";

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
  /** Recibe la comisión de la plataforma y es quien puede actualizar el escrow: cuenta de la plataforma. */
  treasury: string;
  /** Resolver de disputas (v1: una sola cuenta). */
  staff: string;
}

export interface FianzaDeployInput {
  fianzaId: string | number;
  parties: FianzaParties;
  /** Importe en unidad mínima (7 decimales). */
  amount: bigint;
  /** Emisor del USDC (testnet: el de Blend, `GATALTGT…5V56`). */
  assetIssuer: string;
  title?: string;
  description?: string;
  /** Cuenta G que firma y paga el despliegue. Por defecto, la tesorería (las partes pueden ser passkeys). */
  signer?: string;
  /** Vault de DeFindex; sin él, la API usa el de Trustless Work. */
  vault?: string;
}

export type FianzaStatus = "Proposed" | "Active" | "Stopped" | "Settled";

/** Reglas de roles antes de llamar a la API (fallar pronto y claro). */
export function validateParties(p: FianzaParties): void {
  const fail = (msg: string) => {
    throw new FianzaError("INVALID_PARTIES", msg);
  };
  if (p.landlord === p.tenant) fail("Casero e inquilino no pueden ser la misma cuenta");
  // El resolver no puede tener otro rol: decidiría sobre su propio dinero.
  if ([p.landlord, p.tenant, p.treasury].includes(p.staff)) fail("El staff no puede ser casero, inquilino ni tesorería");
  if ([p.landlord, p.tenant].includes(p.treasury)) fail("La tesorería no puede ser casero ni inquilino");
}

export function engagementId(fianzaId: string | number): string {
  return `fianza-${fianzaId}`;
}

/** Cuerpo de `POST /deployer/single-release` para una fianza. */
export function buildDeployBody(input: FianzaDeployInput): DeployBody {
  const p = input.parties;
  validateParties(p);
  if (input.amount <= 0n) throw new FianzaError("INVALID_AMOUNT", "La fianza debe ser mayor que 0");
  const body: DeployBody = {
    signer: input.signer ?? p.treasury,
    engagementId: engagementId(input.fianzaId),
    title: input.title ?? `Fianza ${input.fianzaId}`,
    description: input.description ?? "Fianza de habitación",
    roles: {
      approver: p.landlord,
      serviceProvider: p.landlord,
      platformAddress: p.treasury,
      releaseSigner: p.tenant,
      disputeResolver: p.staff,
      receiver: p.tenant,
    },
    amount: toDecimal(input.amount),
    // platformFee se cobra sobre todo lo retirado (capital incluido): de momento 0.
    platformFee: 0,
    milestones: [{ description: "Devolución de la fianza" }],
    trustline: { symbol: "USDC", address: input.assetIssuer },
  };
  if (input.vault) body.vault = input.vault;
  return body;
}

export function fianzaStatus(escrow: Escrow): FianzaStatus {
  if (escrow.flags.released || escrow.flags.resolved) return "Settled";
  if (escrow.flags.disputed) return "Stopped";
  // Con vault el saldo puede quedar 1 stroop por debajo del importe justo después de fondear.
  return escrow.balance > 0 ? "Active" : "Proposed";
}

export type ApproveAction =
  | { kind: "approve"; body: ApproveMilestoneBody }
  | { kind: "release"; body: ReleaseFundsBody };

/**
 * "Aprobar devolución". El casero aprueba el hito (`approve-milestone`); después el inquilino libera
 * (`release-funds`), que paga capital + rendimiento menos comisiones.
 */
export function planApproveRelease(escrow: Escrow, who: string): ApproveAction {
  const status = fianzaStatus(escrow);
  if (status === "Settled") throw new FianzaError("ALREADY_SETTLED", "La fianza ya está liquidada");
  if (status === "Stopped") throw new FianzaError("DISPUTED", "La fianza está parada");
  if (status === "Proposed") throw new FianzaError("NOT_FUNDED", "La fianza aún no está depositada");

  const approved = escrow.milestones[Number(RELEASE_MILESTONE)]?.approved ?? false;
  if (who === escrow.roles.approver) {
    if (approved) throw new FianzaError("ALREADY_APPROVED", "El casero ya aprobó la devolución");
    return { kind: "approve", body: { contractId: escrow.contractId, milestoneIndex: RELEASE_MILESTONE, approver: who } };
  }
  if (who === escrow.roles.releaseSigner) {
    if (!approved) throw new FianzaError("NOT_APPROVED", "El casero aún no ha aprobado la devolución");
    return { kind: "release", body: { contractId: escrow.contractId, releaseSigner: who } };
  }
  throw new FianzaError("NOT_PARTY", "Solo el casero o el inquilino pueden aprobar la devolución");
}

/** "Parar": el casero abre la disputa (v1 no guarda motivo on-chain). */
export function buildStopBody(escrow: Escrow, landlord: string): DisputeBody {
  if (landlord !== escrow.roles.serviceProvider) throw new FianzaError("NOT_PARTY", "Solo el casero puede parar la fianza");
  if (fianzaStatus(escrow) !== "Active") throw new FianzaError("NOT_FUNDED", "Solo se puede parar una fianza activa");
  return { contractId: escrow.contractId, signer: landlord };
}

function distributions(parts: [string, bigint][]): Distribution[] {
  return parts.filter(([, amount]) => amount > 0n).map(([address, amount]) => ({ address, amount: toDecimal(amount) }));
}

/**
 * "Resolver": se reparte el importe **fondeado** (lo recomienda TW, porque el saldo crece mientras se
 * construye la transacción). La deducción va al casero y el resto al inquilino. El rendimiento queda
 * en el escrow y se reparte con `buildWithdrawYieldBody`.
 */
export function buildResolveBody(escrow: Escrow, resolver: string, deduction: bigint): DistributionsBody {
  if (resolver !== escrow.roles.disputeResolver) throw new FianzaError("NOT_RESOLVER", "Solo el staff puede resolver");
  if (fianzaStatus(escrow) !== "Stopped") throw new FianzaError("NOT_DISPUTED", "Solo se resuelve una fianza parada");
  const funded = fromDecimal(escrow.amount);
  if (deduction < 0n || deduction > funded) {
    throw new FianzaError("INVALID_AMOUNT", "La deducción debe estar entre 0 y la fianza");
  }
  return {
    contractId: escrow.contractId,
    disputeResolver: resolver,
    distributions: distributions([
      [escrow.roles.receiver, funded - deduction],
      [escrow.roles.serviceProvider, deduction],
    ]),
  };
}

function checkBps(name: string, bps: number): void {
  if (!Number.isInteger(bps) || bps < 0 || bps > 10_000) {
    throw new RangeError(`${name} fuera de rango (0–10000): ${bps}`);
  }
}

/**
 * Reparto del rendimiento que queda en el escrow tras resolver (`withdraw-remaining-funds`):
 * 1. `platformFeeBps` para la tesorería (`platformAddress`). Opcional y 0 por defecto: si la plataforma
 *    cobra en el plan A es una decisión de producto pendiente (ver "Huecos" en CLAUDE.md).
 * 2. Del resto, `tenantYieldBps` para el inquilino según la jurisdicción y lo demás para el casero.
 * `remaining` sale de `getBalances` (ya no está en el vault, así que es exacto). Los redondeos van
 * al casero.
 */
export function buildWithdrawYieldBody(
  escrow: Escrow,
  resolver: string,
  remaining: bigint,
  tenantYieldBps: number,
  platformFeeBps = 0,
): DistributionsBody {
  if (resolver !== escrow.roles.disputeResolver) throw new FianzaError("NOT_RESOLVER", "Solo el staff puede repartir");
  checkBps("tenantYieldBps", tenantYieldBps);
  checkBps("platformFeeBps", platformFeeBps);
  if (remaining < 0n) throw new FianzaError("INVALID_AMOUNT", "El sobrante no puede ser negativo");
  const toTreasury = (remaining * BigInt(platformFeeBps)) / BPS;
  const net = remaining - toTreasury;
  const toTenant = (net * BigInt(tenantYieldBps)) / BPS;
  return {
    contractId: escrow.contractId,
    disputeResolver: resolver,
    distributions: distributions([
      [escrow.roles.platformAddress, toTreasury],
      [escrow.roles.receiver, toTenant],
      [escrow.roles.serviceProvider, net - toTenant],
    ]),
  };
}

// Formato de una dirección de contrato (StrKey): "C" + 55 caracteres en base32. No comprueba el
// checksum (para eso haría falta el SDK de Stellar); basta para no confundir una C-address con otra cosa.
const CONTRACT_ADDRESS_RE = /^C[A-Z2-7]{55}$/;

/** true si la dirección es una cuenta inteligente (passkey): la API de TW no la acepta como firmante. */
export function isContractAddress(address: string): boolean {
  return CONTRACT_ADDRESS_RE.test(address);
}
