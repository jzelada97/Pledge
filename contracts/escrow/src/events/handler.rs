// Derived from Trustless-Work/trustlesswork-smart-contract-stellar@1d22d0c (contracts/escrow/src/events/handler.rs), modified. See contracts/escrow/NOTICE.md
// FIANZAS: topics `tw_*` → `fz_*` (un indexer de TW no debe leerlos con su semántica) y topic 1
// = `id` de la fianza. Sin `hash_string`: ya no hay cadenas. Se mantiene el estilo
// `#[contractevent]` con campos con nombre del upstream. Los eventos de aprobación, parada y
// liquidación llegan con sus funciones.
use soroban_sdk::{contractevent, Address, Symbol};

use crate::storage::types::{SettlePath, Settlement};

#[contractevent(topics = ["fz_init"])]
#[derive(Clone)]
pub struct FzInit {
    #[topic]
    pub id: u64,
    pub factory: Address,
    pub landlord: Address,
    pub amount: i128,
    pub end_ts: u64,
    pub tenant_yield_bps: u32,
    pub strategy_id: Symbol,
    pub stop_bond: i128,
    pub has_invite: bool,
    pub platform_fee_bps: u32,
    pub tw_fee_bps: u32,
    pub defindex_vault_fee_bps: u32,
    pub defindex_protocol_fee_bps: u32,
}

#[contractevent(topics = ["fz_cancel"])]
#[derive(Clone)]
pub struct FzCancel {
    #[topic]
    pub id: u64,
    pub landlord: Address,
}

#[contractevent(topics = ["fz_fund"])]
#[derive(Clone)]
pub struct FzFund {
    #[topic]
    pub id: u64,
    pub tenant: Address,
    pub amount: i128,
    pub shares: i128,
}

#[contractevent(topics = ["fz_approve"])]
#[derive(Clone)]
pub struct FzApprove {
    #[topic]
    pub id: u64,
    pub approver: Address,
    pub approval_count: u32,
}

#[contractevent(topics = ["fz_settle"])]
#[derive(Clone)]
pub struct FzSettle {
    #[topic]
    pub id: u64,
    pub settlement: Settlement,
    pub path: SettlePath,
    /// Lectura con `try_` de `get_fees()` para reporting; nunca bloquea la salida.
    pub vault_fees_at_settle: Option<(u32, u32)>,
}
