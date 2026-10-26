use soroban_sdk::{contracttype, Address, BytesN, Symbol, Vec};

use crate::escrow::{Escrow, Status};

pub const MAX_AMOUNT: i128 = 1_000_000_000_000_000;
pub const MAX_TERM_SECS: u64 = 3 * 365 * 86_400;
pub const MAX_PAGE: u32 = 50;
pub const MAX_VIEWS: u32 = 25;
pub const MAX_STRATEGIES: u32 = 10;
pub const MAX_BATCH: u32 = 10;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GlobalConfig {
    pub token: Address,
    pub treasury: Address,
    pub staff: Vec<Address>,
    pub platform_fee_bps: u32,
    pub tw_fee_bps: u32,
    pub tw_fee_receiver: Option<Address>,
    pub timeout_secs: u64,
    pub review_timeout_secs: u64,
    pub stop_bond_min: i128,
    pub stop_bond_bps: u32,
    pub tenant_yield_bps: u32,
    pub vault_manager: Option<Address>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FianzaParams {
    pub tenant: Option<Address>,
    pub invite_hash: Option<BytesN<32>>,
    pub amount: i128,
    pub end_ts: u64,
    pub strategy_id: Option<Symbol>,
    pub nonce: BytesN<32>,
    pub expected_config_version: u32, // FAC-6: el casero firma la versión de config que vio
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Created {
    pub id: u64,
    pub escrow: Address,
    pub wasm_hash: BytesN<32>, // FAC-4
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FianzaSummary {
    pub id: u64,
    pub escrow: Address,
    pub data: Escrow,
    pub status: Status, // efectivo: Ending si Active y now ≥ end_ts
}
