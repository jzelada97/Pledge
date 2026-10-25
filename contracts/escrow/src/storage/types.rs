// Derived from Trustless-Work/trustlesswork-smart-contract-stellar@1d22d0c (contracts/escrow/src/storage/types.rs), modified. See contracts/escrow/NOTICE.md
// FIANZAS: reescrito con los tipos de docs/INTERFACES.md § 2. Sin cadenas (DAT-1), sin
// milestones y con `status` en lugar de `released`/`dispute`. `Approvals` conserva la forma
// de `MilestoneApprovals` de TW v2 y `Roles` la forma TW v2 como tipo de lectura.
// Cambio de interfaz pendiente de G1: `Escrow.settlement` y `Escrow.path` no son `Option`
// porque el SDK 28 no convierte `Option<tipo propio>` a ScVal en los tests (exige
// `Into<ScVal>`). `settlement` está a ceros y `path == Pending` hasta que `status == Settled`.
use soroban_sdk::{contracttype, Address, BytesN, String, Symbol, Vec};

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Status {
    Proposed,
    Active,
    Ending, // derivado, nunca se almacena
    Stopped,
    UnderReview,
    Settled,
    Cancelled,
}

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SettlePath {
    Pending,
    Approved,
    Resolved,
    Timeout,
    ReviewTimeout,
}

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum StrategyKind {
    NoYield,
    DeFindexVault,
}

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RiskTier {
    NoYield,
    Standard,
    High,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Strategy {
    pub id: Symbol,
    pub kind: StrategyKind,
    pub vault: Option<Address>,
    pub asset: Address,
    pub asset_name: String,
    pub defindex_strategy: Option<Address>,
    pub apy_pool: Option<Address>,
    pub risk: RiskTier,
    pub simulated: bool,
    pub enabled: bool,
    pub max_vault_fee_bps: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Terms {
    pub factory: Address,
    pub id: u64,
    pub landlord: Address,
    pub amount: i128,
    pub end_ts: u64,
    pub tenant_yield_bps: u32,
    pub strategy: Strategy,
    pub platform_fee_bps: u32,
    pub tw_fee_bps: u32,
    pub tw_fee_receiver: Option<Address>,
    pub defindex_vault_fee_bps: u32,
    pub defindex_protocol_fee_bps: u32,
    pub treasury: Address,
    pub dispute_resolvers: Vec<Address>,
    pub timeout_secs: u64,
    pub review_timeout_secs: u64,
    pub stop_bond: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EscrowInit {
    pub terms: Terms,
    pub tenant: Option<Address>,
    pub invite_hash: Option<BytesN<32>>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Approvals {
    pub target: u32,
    pub approval_count: u32,
    pub approved_by: Vec<Address>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Dispute {
    pub reason_hash: Option<BytesN<32>>,
    pub stopped_ts: u64,
    pub expert_ref: Option<BytesN<32>>,
    pub report_hash: Option<BytesN<32>>,
    pub bond_held: i128,
    pub stop_justified: Option<bool>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Settlement {
    pub total: i128,
    pub yield_total: i128,
    pub deduction: i128,
    pub to_tenant: i128,
    pub to_landlord: i128,
    pub to_treasury: i128,
    pub to_tw: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Escrow {
    pub terms: Terms,
    pub tenant: Option<Address>,
    pub invite_hash: Option<BytesN<32>>,
    pub status: Status,
    pub approvals: Approvals,
    pub shares: i128,
    pub created_ts: u64,
    pub funded_ts: u64,
    pub dispute: Dispute,
    pub settlement: Settlement,
    pub path: SettlePath,
}

/// Forma TW v2 de los roles, calculada en lectura (no se almacena).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Roles {
    pub approvers: Vec<Address>,
    pub service_providers: Vec<Address>,
    pub platform: Address,
    pub release_signers: Vec<Address>,
    pub dispute_resolvers: Vec<Address>,
    pub receiver: Option<Address>,
    pub admin: Address,
    pub observers: Vec<Address>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EscrowView {
    pub data: Escrow,
    pub status: Status,       // efectivo (Ending incluido)
    pub accrued_yield: i128,  // estimación bruta; 0 si el vault falla (CT-10)
    pub timeout_at: u64,      // end_ts + timeout_secs
    pub review_deadline: u64, // stopped_ts + review_timeout_secs, o 0
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Escrow,
}
