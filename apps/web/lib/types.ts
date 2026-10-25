// Hand-written mirror of docs/INTERFACES.md §2–§3, using the shapes the generated bindings will have
// (snake_case fields, i128/u64 as bigint). Delete when packages/bindings lands and import from there.

export type Status = "Proposed" | "Active" | "Ending" | "Stopped" | "UnderReview" | "Settled" | "Cancelled";
export type SettlePath = "Approved" | "Resolved" | "Timeout" | "ReviewTimeout";
export type StrategyKind = "NoYield" | "DeFindexVault";
export type RiskTier = "NoYield" | "Standard" | "High";

export interface Strategy {
  id: string;
  kind: StrategyKind;
  vault: string | null;
  asset: string;
  asset_name: string;
  defindex_strategy: string | null;
  apy_pool: string | null;
  risk: RiskTier;
  simulated: boolean;
  enabled: boolean;
}

export interface Terms {
  factory: string;
  id: bigint;
  landlord: string;
  amount: bigint;
  end_ts: bigint;
  tenant_yield_bps: number;
  strategy: Strategy;
  platform_fee_bps: number;
  treasury: string;
  dispute_resolvers: string[];
  timeout_secs: bigint;
  review_timeout_secs: bigint;
  stop_bond: bigint;
}

export interface Approvals {
  target: number;
  approval_count: number;
  approved_by: string[];
}

export interface Dispute {
  reason_hash: string | null;
  stopped_ts: bigint;
  expert_ref: string | null;
  report_hash: string | null;
  bond_held: bigint;
  stop_justified: boolean | null;
}

export interface Settlement {
  total: bigint;
  yield_total: bigint;
  deduction: bigint;
  to_tenant: bigint;
  to_landlord: bigint;
  to_treasury: bigint;
}

export interface Escrow {
  terms: Terms;
  tenant: string | null;
  invite_hash: string | null;
  status: Status;
  approvals: Approvals;
  shares: bigint;
  created_ts: bigint;
  funded_ts: bigint;
  dispute: Dispute;
  settlement: Settlement | null;
  path: SettlePath | null;
}

export interface EscrowView {
  data: Escrow;
  status: Status;
  accrued_yield: bigint;
  timeout_at: bigint;
  review_deadline: bigint;
}

export interface FianzaSummary {
  id: bigint;
  escrow: string;
  data: Escrow;
  status: Status;
}
