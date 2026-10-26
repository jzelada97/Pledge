use soroban_sdk::{contractevent, Address, BytesN, Symbol};

use crate::escrow::RiskTier;
use crate::types::GlobalConfig;

#[contractevent(topics = ["f_created"])]
#[derive(Clone)]
pub struct FCreated {
    #[topic]
    pub id: u64,
    pub escrow: Address,
    pub landlord: Address,
    pub amount: i128,
    pub strategy_id: Symbol,
    pub defindex_vault_fee_bps: u32,
    pub defindex_protocol_fee_bps: u32,
    pub wasm_hash: BytesN<32>,
}

#[contractevent(topics = ["f_tenant"])]
#[derive(Clone)]
pub struct FTenant {
    #[topic]
    pub id: u64,
    pub tenant: Address,
}

#[contractevent(topics = ["f_wasm"])]
#[derive(Clone)]
pub struct FWasm {
    pub old: BytesN<32>,
    pub new: BytesN<32>,
}

#[contractevent(topics = ["f_config"])]
#[derive(Clone)]
pub struct FConfig {
    pub config: GlobalConfig,
}

#[contractevent(topics = ["f_strategy"])]
#[derive(Clone)]
pub struct FStrategy {
    pub id: Symbol,
    pub enabled: bool,
    pub is_default: bool,
    pub risk: RiskTier,
    pub max_vault_fee_bps: u32,
}

#[contractevent(topics = ["f_paused"])]
#[derive(Clone)]
pub struct FPaused {
    pub admin: Address,
}

#[contractevent(topics = ["f_unpaused"])]
#[derive(Clone)]
pub struct FUnpaused {
    pub admin: Address,
}
