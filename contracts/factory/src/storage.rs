use soroban_sdk::{contracttype, Address, BytesN, Env, IntoVal, Symbol, TryFromVal, Val, Vec};

use crate::error::FactoryError;
use crate::escrow::Strategy;
use crate::types::GlobalConfig;

const TTL_THRESHOLD: u32 = 17_280; // ~1 día de ledgers

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    // instance
    Admin,
    WasmHash,
    Config,
    Paused,
    NextId,
    DefaultStrategy,
    StrategyIds,
    ConfigVersion,
    // persistent
    Strategy(Symbol),
    Escrow(u64),
    IdOf(Address),
    Registered(u64), // el inquilino de esta fianza ya está en el índice
    LandlordCount(Address),
    LandlordAt(Address, u32),
    TenantCount(Address),
    TenantAt(Address, u32),
}

pub fn bump_instance(e: &Env) {
    e.storage()
        .instance()
        .extend_ttl(TTL_THRESHOLD, e.storage().max_ttl());
}

fn get_instance<V: TryFromVal<Env, Val>>(e: &Env, key: &DataKey) -> Option<V> {
    e.storage().instance().get(key)
}

fn set_persistent<V: IntoVal<Env, Val>>(e: &Env, key: &DataKey, value: &V) {
    e.storage().persistent().set(key, value);
    e.storage()
        .persistent()
        .extend_ttl(key, TTL_THRESHOLD, e.storage().max_ttl());
}

fn get_persistent<V: TryFromVal<Env, Val>>(e: &Env, key: &DataKey) -> Option<V> {
    e.storage().persistent().get(key)
}

pub fn admin(e: &Env) -> Address {
    get_instance(e, &DataKey::Admin).unwrap()
}

pub fn set_admin(e: &Env, admin: &Address) {
    e.storage().instance().set(&DataKey::Admin, admin);
}

pub fn wasm_hash(e: &Env) -> BytesN<32> {
    get_instance(e, &DataKey::WasmHash).unwrap()
}

pub fn set_wasm_hash(e: &Env, hash: &BytesN<32>) {
    e.storage().instance().set(&DataKey::WasmHash, hash);
}

pub fn config(e: &Env) -> GlobalConfig {
    get_instance(e, &DataKey::Config).unwrap()
}

pub fn set_config(e: &Env, config: &GlobalConfig) {
    e.storage().instance().set(&DataKey::Config, config);
}

pub fn paused(e: &Env) -> bool {
    get_instance(e, &DataKey::Paused).unwrap_or(false)
}

pub fn set_paused(e: &Env, paused: bool) {
    e.storage().instance().set(&DataKey::Paused, &paused);
}

/// FAC-6: sube con cada cambio de admin que afecta a las fianzas nuevas.
pub fn config_version(e: &Env) -> u32 {
    get_instance(e, &DataKey::ConfigVersion).unwrap_or(0)
}

pub fn bump_config_version(e: &Env) -> Result<(), FactoryError> {
    let next = config_version(e)
        .checked_add(1)
        .ok_or(FactoryError::Arithmetic)?;
    e.storage().instance().set(&DataKey::ConfigVersion, &next);
    Ok(())
}

/// Último id asignado (ids `1..=count`).
pub fn count(e: &Env) -> u64 {
    get_instance(e, &DataKey::NextId).unwrap_or(0)
}

pub fn next_id(e: &Env) -> Result<u64, FactoryError> {
    let id = count(e).checked_add(1).ok_or(FactoryError::Arithmetic)?;
    e.storage().instance().set(&DataKey::NextId, &id);
    Ok(id)
}

pub fn strategy_ids(e: &Env) -> Vec<Symbol> {
    get_instance(e, &DataKey::StrategyIds).unwrap_or(Vec::new(e))
}

pub fn strategy(e: &Env, id: &Symbol) -> Result<Strategy, FactoryError> {
    get_persistent(e, &DataKey::Strategy(id.clone())).ok_or(FactoryError::StrategyNotFound)
}

pub fn set_strategy(e: &Env, s: &Strategy) {
    let mut ids = strategy_ids(e);
    if !ids.contains(&s.id) {
        ids.push_back(s.id.clone());
        e.storage().instance().set(&DataKey::StrategyIds, &ids);
    }
    set_persistent(e, &DataKey::Strategy(s.id.clone()), s);
}

pub fn default_strategy_id(e: &Env) -> Option<Symbol> {
    get_instance(e, &DataKey::DefaultStrategy)
}

pub fn set_default_strategy_id(e: &Env, id: &Symbol) {
    e.storage().instance().set(&DataKey::DefaultStrategy, id);
}

pub fn escrow_of(e: &Env, id: u64) -> Result<Address, FactoryError> {
    get_persistent(e, &DataKey::Escrow(id)).ok_or(FactoryError::NotFound)
}

pub fn id_of(e: &Env, escrow: &Address) -> Option<u64> {
    get_persistent(e, &DataKey::IdOf(escrow.clone()))
}

pub fn register_escrow(e: &Env, id: u64, escrow: &Address) {
    set_persistent(e, &DataKey::Escrow(id), escrow);
    set_persistent(e, &DataKey::IdOf(escrow.clone()), &id);
}

pub fn is_registered(e: &Env, id: u64) -> bool {
    e.storage().persistent().has(&DataKey::Registered(id))
}

pub fn mark_registered(e: &Env, id: u64) {
    set_persistent(e, &DataKey::Registered(id), &true);
}

pub fn count_by_landlord(e: &Env, landlord: &Address) -> u32 {
    get_persistent(e, &DataKey::LandlordCount(landlord.clone())).unwrap_or(0)
}

pub fn count_by_tenant(e: &Env, tenant: &Address) -> u32 {
    get_persistent(e, &DataKey::TenantCount(tenant.clone())).unwrap_or(0)
}

pub fn push_landlord(e: &Env, landlord: &Address, id: u64) -> Result<(), FactoryError> {
    let n = count_by_landlord(e, landlord);
    set_persistent(e, &DataKey::LandlordAt(landlord.clone(), n), &id);
    let next = n.checked_add(1).ok_or(FactoryError::Arithmetic)?;
    set_persistent(e, &DataKey::LandlordCount(landlord.clone()), &next);
    Ok(())
}

pub fn push_tenant(e: &Env, tenant: &Address, id: u64) -> Result<(), FactoryError> {
    let n = count_by_tenant(e, tenant);
    set_persistent(e, &DataKey::TenantAt(tenant.clone(), n), &id);
    let next = n.checked_add(1).ok_or(FactoryError::Arithmetic)?;
    set_persistent(e, &DataKey::TenantCount(tenant.clone()), &next);
    Ok(())
}

pub fn landlord_at(e: &Env, landlord: &Address, i: u32) -> Option<u64> {
    get_persistent(e, &DataKey::LandlordAt(landlord.clone(), i))
}

pub fn tenant_at(e: &Env, tenant: &Address, i: u32) -> Option<u64> {
    get_persistent(e, &DataKey::TenantAt(tenant.clone(), i))
}
