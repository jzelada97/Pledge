// Tipos de la API REST v2 de Trustless Work (Single-Release), según docs.trustlesswork.com
// (v2-en/api-rest). Importes en decimales: `10` son 10 USDC.

export interface TrustlineRef {
  /** SAC del activo (`C…`). Alternativa: `symbol` + `address` (emisor `G…`). */
  contractId?: string;
  symbol?: string;
  address?: string;
}

export interface RolesV2 {
  approvers: string[];
  serviceProviders: string[];
  platform: string;
  releaseSigners: string[];
  disputeResolvers: string[];
  receiver: string;
  admin: string;
  observers?: string[];
}

export interface MilestoneInput {
  description: string;
  status?: string;
  approvalsTarget?: number;
}

export interface DeployV2Body {
  signer: string;
  engagementId: string;
  title: string;
  description: string;
  roles: RolesV2;
  amount: number;
  /** Porcentaje sobre el total: `1` es un 1 %. */
  platformFee: number;
  milestones?: MilestoneInput[];
  trustline: TrustlineRef;
}

export interface FundBody {
  contractId: string;
  signer: string;
  amount: number;
}

export interface ApproveMilestonesBody {
  contractId: string;
  approver: string;
  milestoneIndexes: number[];
}

export interface ApproveAndReleaseBody {
  contractId: string;
  signer: string;
  milestoneIndexes: number[];
}

export interface ReleaseFundsBody {
  contractId: string;
  releaseSigner: string;
}

export interface DisputeBody {
  contractId: string;
  signer: string;
  /** Máximo 500 caracteres; queda en la cadena. */
  reason: string;
}

export interface Distribution {
  address: string;
  amount: number;
}

export interface ResolveDisputeBody {
  contractId: string;
  disputeResolver: string;
  /** Tienen que sumar exactamente el saldo del escrow. */
  distributions: Distribution[];
}

export interface UnsignedTransactionResponse {
  unsignedXdr: string;
  txHash: string;
  /** Solo en el despliegue: la dirección que tendrá el escrow. */
  contractId?: string | null;
}

export interface SendTransactionResponse {
  txHash: string;
  ledger: number;
  contractId?: string;
  escrow?: SingleReleaseV2Escrow;
  code?: "STELLAR_TX_SUBMITTED" | "STELLAR_TX_SUBMITTED_INDEXER_LAGGING";
  message?: string;
}

export interface MilestoneV2 {
  description: string;
  status: string;
  evidence: string;
  approvals: { target: number; approvalCount: number; approvedBy: string[] };
}

export interface SingleReleaseV2Escrow {
  type: string;
  contractId: string;
  contractBaseId: string;
  engagementId: string;
  title: string;
  description: string;
  amount: number;
  balance: number;
  platformFee: number;
  receiverMemo: number;
  trustline: TrustlineRef;
  roles: RolesV2;
  milestones: MilestoneV2[];
  dispute: { isDisputed: boolean; reason: string; resolved: boolean };
  released: boolean;
}

export interface ProblemDetails {
  type?: string;
  title?: string;
  status?: number;
  code?: string;
  detail?: string;
  instance?: string;
  traceId?: string;
  extensions?: Record<string, unknown>;
}
