// Tipos de la API con rendimiento de Trustless Work: la API v1 de single-release más un vault de
// DeFindex ("Guía de migración a TrustYield", 25-oct-2026; Swagger en <base>/docs). Las respuestas
// de lectura están tomadas de escrows reales en testnet. Importes en decimales: `10` son 10 USDC.

export interface TrustlineRef {
  symbol: string;
  /** Emisor del activo (`G…`). En testnet, el USDC de Blend. */
  address: string;
  /** SAC del activo; solo aparece en las lecturas. */
  contractId?: string;
}

/** Una dirección por rol (v1). */
export interface Roles {
  approver: string;
  serviceProvider: string;
  /** Cobra `platformFee` y es quien puede actualizar el escrow. */
  platformAddress: string;
  releaseSigner: string;
  disputeResolver: string;
  receiver: string;
}

export interface MilestoneInput {
  description: string;
}

export interface DeployBody {
  /** Cuenta G que firma el despliegue (la API no admite una C-address como firmante). */
  signer: string;
  engagementId: string;
  title: string;
  description: string;
  roles: Roles;
  amount: number;
  /** Porcentaje sobre todo lo retirado (capital + rendimiento): `1` es un 1 %. */
  platformFee: number;
  milestones: MilestoneInput[];
  trustline: { symbol: string; address: string };
  /** Vault de DeFindex. Sin él, la API usa el de Trustless Work. */
  vault?: string;
}

export interface FundBody {
  contractId: string;
  signer: string;
  amount: number;
}

export interface ApproveMilestoneBody {
  contractId: string;
  /** Índice del hito como texto ("0"). */
  milestoneIndex: string;
  approver: string;
}

export interface ReleaseFundsBody {
  contractId: string;
  releaseSigner: string;
}

export interface DisputeBody {
  contractId: string;
  signer: string;
}

export interface Distribution {
  address: string;
  amount: number;
}

/** Cuerpo de `resolve-dispute` y de `withdraw-remaining-funds`. */
export interface DistributionsBody {
  contractId: string;
  disputeResolver: string;
  distributions: Distribution[];
}

export interface UnsignedTransactionResponse {
  unsignedTransaction: string;
}

export interface SendTransactionResponse {
  status?: string;
  message?: string;
  /** En el despliegue: la dirección del escrow nuevo. */
  contractId?: string;
  escrow?: Escrow;
}

export interface EscrowMilestone {
  description: string;
  status: string;
  evidence: string;
  approved: boolean;
}

/** Escrow tal y como lo devuelve `GET /helper/get-escrow-by-contract-ids`. */
export interface Escrow {
  contractId: string;
  contractBaseId?: string;
  signer?: string;
  type: string;
  vault?: string;
  engagementId: string;
  title: string;
  description: string;
  amount: number;
  /** Valor actual: con vault crece en cada ledger. */
  balance: number;
  platformFee: number;
  roles: Roles;
  flags: { disputed: boolean; released: boolean; resolved: boolean };
  trustline: TrustlineRef;
  milestones: EscrowMilestone[];
  isActive?: boolean;
}

export interface EscrowBalance {
  address: string;
  balance: number;
}

export interface VaultPosition {
  vault: string;
  shares: number;
  /** Valor en USDC de las shares. Tras liberar o resolver, 0. */
  underlying: number;
}

/** Error de la API (NestJS). */
export interface ApiErrorBody {
  statusCode?: number;
  message?: string | string[];
  timestamp?: string;
  path?: string;
}
