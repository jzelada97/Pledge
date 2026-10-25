use soroban_sdk::{
    contract, contractimpl, panic_with_error, token, xdr::ToXdr, Address, Bytes, BytesN,
    ContractExecutable, Env, Symbol, Vec,
};

use crate::bond::compute_stop_bond;
use crate::error::FactoryError;
use crate::escrow::{self, EscrowInit, RiskTier, Status, Strategy, StrategyKind, Terms};
use crate::events::{FConfig, FCreated, FPaused, FStrategy, FTenant, FUnpaused, FWasm};
use crate::storage;
use crate::types::{
    Created, FianzaParams, FianzaSummary, GlobalConfig, MAX_AMOUNT, MAX_BATCH, MAX_PAGE,
    MAX_STRATEGIES, MAX_TERM_SECS, MAX_VIEWS,
};
use crate::vault;

const MAX_BPS: u32 = 10_000;
const MAX_PLATFORM_FEE_BPS: u32 = 5_000;
const MAX_STOP_BOND_BPS: u32 = 2_000;
const MAX_VAULT_FEE_BPS: u32 = 2_000;
const MIN_TIMEOUT_SECS: u64 = 60;
const MAX_STAFF: u32 = 3;

fn has_duplicates(list: &Vec<Address>) -> bool {
    for i in 0..list.len() {
        for j in (i + 1)..list.len() {
            if list.get(i) == list.get(j) {
                return true;
            }
        }
    }
    false
}

fn validate_config(e: &Env, c: &GlobalConfig) -> Result<(), FactoryError> {
    let me = e.current_contract_address();
    let fees_ok = c.platform_fee_bps <= MAX_PLATFORM_FEE_BPS
        && c.tw_fee_bps <= MAX_BPS
        && c.platform_fee_bps + c.tw_fee_bps <= MAX_BPS;
    let staff_ok = !c.staff.is_empty()
        && c.staff.len() <= MAX_STAFF
        && !has_duplicates(&c.staff)
        && !c.staff.contains(&c.treasury)
        && !c.staff.contains(&me);
    if !fees_ok
        || !staff_ok
        || c.stop_bond_bps > MAX_STOP_BOND_BPS
        || c.tenant_yield_bps > MAX_BPS
        || c.timeout_secs < MIN_TIMEOUT_SECS
        || c.review_timeout_secs < MIN_TIMEOUT_SECS
        || c.stop_bond_min < 0
        || c.stop_bond_min > MAX_AMOUNT
        || c.treasury == me
        || (c.tw_fee_bps > 0 && c.tw_fee_receiver.is_none())
    {
        return Err(FactoryError::InvalidConfig);
    }
    Ok(())
}

/// FAC-7: registro de estrategias. Las comisiones y el manager del vault se comprueban
/// aparte con `vault::check`, también al crear y al fondear (FAC-8).
fn validate_strategy(e: &Env, config: &GlobalConfig, s: &Strategy) -> Result<(), FactoryError> {
    // NoYield ⇔ sin vault ⇔ riesgo NoYield.
    let no_yield = s.kind == StrategyKind::NoYield;
    if no_yield == s.vault.is_some() || no_yield != (s.risk == RiskTier::NoYield) {
        return Err(FactoryError::InvalidStrategy);
    }
    if let Some(v) = &s.vault {
        let me = e.current_contract_address();
        if *v == config.token || *v == me || *v == config.treasury || config.staff.contains(v) {
            return Err(FactoryError::InvalidStrategy);
        }
    }
    if s.max_vault_fee_bps > MAX_VAULT_FEE_BPS || (no_yield && s.max_vault_fee_bps != 0) {
        return Err(FactoryError::VaultFeeTooHigh);
    }
    // Fija el emisor exacto: en Stellar hay tokens falsos con el mismo código.
    if s.asset != config.token || token::Client::new(e, &s.asset).name() != s.asset_name {
        return Err(FactoryError::InvalidStrategy);
    }
    Ok(())
}

/// Casero e inquilino no pueden ser roles del sistema ni contratos de la fianza (AUTHZ-4).
fn validate_parties(
    e: &Env,
    config: &GlobalConfig,
    strategy: &Strategy,
    landlord: &Address,
    tenant: &Option<Address>,
) -> Result<(), FactoryError> {
    let mut forbidden = config.staff.clone();
    forbidden.push_back(config.treasury.clone());
    forbidden.push_back(e.current_contract_address());
    forbidden.push_back(config.token.clone());
    if let Some(vault) = &strategy.vault {
        forbidden.push_back(vault.clone());
    }
    if let Some(receiver) = &config.tw_fee_receiver {
        forbidden.push_back(receiver.clone());
    }
    if forbidden.contains(landlord) {
        return Err(FactoryError::InvalidParty);
    }
    if let Some(tenant) = tenant {
        if forbidden.contains(tenant) {
            return Err(FactoryError::InvalidParty);
        }
        if tenant == landlord {
            return Err(FactoryError::SameParty);
        }
    }
    Ok(())
}

/// FAC-3: `salt = sha256(landlord.to_xdr() ‖ nonce)`. Única función de la salt, la usan
/// `create_fianza` y `predict_address`.
fn escrow_salt(e: &Env, landlord: &Address, nonce: &BytesN<32>) -> BytesN<32> {
    let mut preimage: Bytes = landlord.clone().to_xdr(e);
    preimage.append(&Bytes::from_array(e, &nonce.to_array()));
    e.crypto().sha256(&preimage).to_bytes()
}

/// Valida y despliega una fianza. La auth del casero la pide quien llama.
fn create_one(e: &Env, landlord: &Address, p: FianzaParams) -> Result<Created, FactoryError> {
    if storage::paused(e) {
        return Err(FactoryError::Paused);
    }
    // FAC-6: el casero firma la versión de configuración que vio en el front.
    if p.expected_config_version != storage::config_version(e) {
        return Err(FactoryError::ConfigChanged);
    }
    let config = storage::config(e);
    let strategy_id = match &p.strategy_id {
        Some(id) => id.clone(),
        None => storage::default_strategy_id(e).ok_or(FactoryError::StrategyNotFound)?,
    };
    let strategy = storage::strategy(e, &strategy_id)?;
    if !strategy.enabled {
        return Err(FactoryError::StrategyDisabled);
    }
    if p.amount <= 0 || p.amount > MAX_AMOUNT {
        return Err(FactoryError::InvalidAmount);
    }
    let now = e.ledger().timestamp();
    let max_end = now
        .checked_add(MAX_TERM_SECS)
        .ok_or(FactoryError::Arithmetic)?;
    if p.end_ts <= now || p.end_ts > max_end {
        return Err(FactoryError::InvalidEndTs);
    }
    if p.tenant.is_some() == p.invite_hash.is_some() {
        return Err(FactoryError::InvalidInvite);
    }
    validate_parties(e, &config, &strategy, landlord, &p.tenant)?;
    let (vault_fee_bps, protocol_fee_bps) = vault::check(e, &config, &strategy)?;

    let deployer = e
        .deployer()
        .with_current_contract(escrow_salt(e, landlord, &p.nonce));
    if storage::id_of(e, &deployer.deployed_address()).is_some() {
        return Err(FactoryError::NonceUsed);
    }

    let id = storage::next_id(e)?;
    let wasm_hash = storage::wasm_hash(e);
    let terms = Terms {
        factory: e.current_contract_address(),
        id,
        landlord: landlord.clone(),
        amount: p.amount,
        end_ts: p.end_ts,
        tenant_yield_bps: config.tenant_yield_bps,
        strategy: strategy.clone(),
        platform_fee_bps: config.platform_fee_bps,
        tw_fee_bps: config.tw_fee_bps,
        tw_fee_receiver: config.tw_fee_receiver.clone(),
        defindex_vault_fee_bps: vault_fee_bps,
        defindex_protocol_fee_bps: protocol_fee_bps,
        treasury: config.treasury.clone(),
        dispute_resolvers: config.staff.clone(),
        timeout_secs: config.timeout_secs,
        review_timeout_secs: config.review_timeout_secs,
        stop_bond: compute_stop_bond(p.amount, config.stop_bond_min, config.stop_bond_bps)?,
    };
    let init = EscrowInit {
        terms,
        tenant: p.tenant,
        invite_hash: p.invite_hash,
    };
    let escrow = deployer.deploy_contract(ContractExecutable::Wasm(wasm_hash.clone()), (init,));

    storage::register_escrow(e, id, &escrow);
    storage::push_landlord(e, landlord, id)?;
    FCreated {
        id,
        escrow: escrow.clone(),
        landlord: landlord.clone(),
        amount: p.amount,
        strategy_id: strategy.id,
        defindex_vault_fee_bps: vault_fee_bps,
        defindex_protocol_fee_bps: protocol_fee_bps,
        wasm_hash: wasm_hash.clone(),
    }
    .publish(e);
    Ok(Created {
        id,
        escrow,
        wasm_hash,
    })
}

fn require_admin(e: &Env) -> Address {
    let admin = storage::admin(e);
    admin.require_auth();
    admin
}

/// Cierra un cambio de admin: nueva versión de config (FAC-6) y TTL de la instancia.
fn admin_changed(e: &Env) -> Result<(), FactoryError> {
    storage::bump_config_version(e)?;
    storage::bump_instance(e);
    Ok(())
}

fn effective_status(e: &Env, data: &escrow::Escrow) -> Status {
    if data.status == Status::Active && e.ledger().timestamp() >= data.terms.end_ts {
        Status::Ending
    } else {
        data.status.clone()
    }
}

fn page(
    start: u32,
    limit: u32,
    total: u32,
    at: impl Fn(u32) -> Option<u64>,
    e: &Env,
) -> Result<Vec<u64>, FactoryError> {
    if limit > MAX_PAGE {
        return Err(FactoryError::TooMany);
    }
    let end = start.saturating_add(limit).min(total);
    let mut ids = Vec::new(e);
    for i in start..end {
        if let Some(id) = at(i) {
            ids.push_back(id);
        }
    }
    Ok(ids)
}

#[contract]
pub struct FianzaFactory;

#[contractimpl]
impl FianzaFactory {
    pub fn __constructor(
        e: Env,
        admin: Address,
        escrow_wasm_hash: BytesN<32>,
        config: GlobalConfig,
    ) {
        if let Err(err) = validate_config(&e, &config) {
            panic_with_error!(&e, err);
        }
        storage::set_admin(&e, &admin);
        storage::set_wasm_hash(&e, &escrow_wasm_hash);
        storage::set_config(&e, &config);
        storage::set_paused(&e, false);
        storage::bump_instance(&e);
    }

    // ---------- Fianzas ----------

    pub fn create_fianza(
        e: Env,
        landlord: Address,
        p: FianzaParams,
    ) -> Result<Created, FactoryError> {
        landlord.require_auth();
        let created = create_one(&e, &landlord, p)?;
        storage::bump_instance(&e);
        Ok(created)
    }

    /// FAC-9: atómica (un fallo revierte todos los despliegues) y con una sola firma del
    /// casero. No pasa por el Relayer (N-3).
    pub fn create_fianzas_batch(
        e: Env,
        landlord: Address,
        items: Vec<FianzaParams>,
    ) -> Result<Vec<Created>, FactoryError> {
        landlord.require_auth();
        if items.is_empty() || items.len() > MAX_BATCH {
            return Err(FactoryError::TooMany);
        }
        let mut created = Vec::new(&e);
        for p in items.iter() {
            created.push_back(create_one(&e, &landlord, p)?);
        }
        storage::bump_instance(&e);
        Ok(created)
    }

    pub fn predict_address(e: Env, landlord: Address, nonce: BytesN<32>) -> Address {
        e.deployer()
            .with_current_contract(escrow_salt(&e, &landlord, &nonce))
            .deployed_address()
    }

    /// FAC-5: solo la llama el propio escrow desde `fund_escrow` (invocador directo).
    pub fn register_tenant(e: Env, id: u64, tenant: Address) -> Result<(), FactoryError> {
        let escrow = storage::escrow_of(&e, id)?;
        escrow.require_auth();
        if storage::is_registered(&e, id) {
            return Err(FactoryError::AlreadyRegistered);
        }
        storage::mark_registered(&e, id);
        storage::push_tenant(&e, &tenant, id)?;
        storage::bump_instance(&e);
        FTenant { id, tenant }.publish(&e);
        Ok(())
    }

    /// `!paused ∧ strategy.enabled` y, si hay vault, sus comisiones y su manager siguen
    /// dentro de lo admitido (FAC-8, fail-closed).
    pub fn funding_allowed(e: Env, strategy_id: Symbol) -> bool {
        if storage::paused(&e) {
            return false;
        }
        match storage::strategy(&e, &strategy_id) {
            Ok(s) => s.enabled && vault::check(&e, &storage::config(&e), &s).is_ok(),
            Err(_) => false,
        }
    }

    // ---------- Admin ----------

    pub fn set_escrow_wasm_hash(e: Env, hash: BytesN<32>) -> Result<(), FactoryError> {
        require_admin(&e);
        let old = storage::wasm_hash(&e);
        storage::set_wasm_hash(&e, &hash);
        admin_changed(&e)?;
        FWasm { old, new: hash }.publish(&e);
        Ok(())
    }

    pub fn set_config(e: Env, config: GlobalConfig) -> Result<(), FactoryError> {
        require_admin(&e);
        validate_config(&e, &config)?;
        // El token es inmutable desde el constructor (security IV-3).
        if config.token != storage::config(&e).token {
            return Err(FactoryError::InvalidConfig);
        }
        storage::set_config(&e, &config);
        admin_changed(&e)?;
        FConfig { config }.publish(&e);
        Ok(())
    }

    /// Se guarda deshabilitada: el admin la habilita en un segundo paso tras revisar el evento.
    pub fn add_strategy(e: Env, s: Strategy) -> Result<(), FactoryError> {
        require_admin(&e);
        if storage::strategy(&e, &s.id).is_ok() {
            return Err(FactoryError::StrategyExists);
        }
        if storage::strategy_ids(&e).len() >= MAX_STRATEGIES {
            return Err(FactoryError::TooMany);
        }
        let config = storage::config(&e);
        validate_strategy(&e, &config, &s)?;
        vault::check(&e, &config, &s)?;
        let mut s = s;
        s.enabled = false;
        storage::set_strategy(&e, &s);
        admin_changed(&e)?;
        FStrategy {
            id: s.id,
            enabled: false,
            is_default: false,
            risk: s.risk,
            max_vault_fee_bps: s.max_vault_fee_bps,
        }
        .publish(&e);
        Ok(())
    }

    pub fn set_strategy_enabled(e: Env, id: Symbol, enabled: bool) -> Result<(), FactoryError> {
        require_admin(&e);
        let mut s = storage::strategy(&e, &id)?;
        let is_default = storage::default_strategy_id(&e) == Some(id.clone());
        if !enabled && is_default {
            return Err(FactoryError::InvalidStrategy);
        }
        s.enabled = enabled;
        storage::set_strategy(&e, &s);
        admin_changed(&e)?;
        FStrategy {
            id,
            enabled,
            is_default,
            risk: s.risk,
            max_vault_fee_bps: s.max_vault_fee_bps,
        }
        .publish(&e);
        Ok(())
    }

    pub fn set_default_strategy(e: Env, id: Symbol) -> Result<(), FactoryError> {
        require_admin(&e);
        let s = storage::strategy(&e, &id)?;
        if !s.enabled {
            return Err(FactoryError::StrategyDisabled);
        }
        storage::set_default_strategy_id(&e, &id);
        admin_changed(&e)?;
        FStrategy {
            id,
            enabled: true,
            is_default: true,
            risk: s.risk,
            max_vault_fee_bps: s.max_vault_fee_bps,
        }
        .publish(&e);
        Ok(())
    }

    pub fn pause(e: Env) {
        let admin = require_admin(&e);
        storage::set_paused(&e, true);
        storage::bump_instance(&e);
        FPaused { admin }.publish(&e);
    }

    pub fn unpause(e: Env) {
        let admin = require_admin(&e);
        storage::set_paused(&e, false);
        storage::bump_instance(&e);
        FUnpaused { admin }.publish(&e);
    }

    // ---------- Lecturas ----------

    pub fn config(e: Env) -> GlobalConfig {
        storage::config(&e)
    }

    pub fn config_version(e: Env) -> u32 {
        storage::config_version(&e)
    }

    pub fn escrow_wasm_hash(e: Env) -> BytesN<32> {
        storage::wasm_hash(&e)
    }

    pub fn paused(e: Env) -> bool {
        storage::paused(&e)
    }

    pub fn admin(e: Env) -> Address {
        storage::admin(&e)
    }

    pub fn strategies(e: Env) -> Vec<Strategy> {
        let mut out = Vec::new(&e);
        for id in storage::strategy_ids(&e).iter() {
            if let Ok(s) = storage::strategy(&e, &id) {
                out.push_back(s);
            }
        }
        out
    }

    pub fn strategy(e: Env, id: Symbol) -> Result<Strategy, FactoryError> {
        storage::strategy(&e, &id)
    }

    pub fn default_strategy(e: Env) -> Result<Strategy, FactoryError> {
        let id = storage::default_strategy_id(&e).ok_or(FactoryError::NotFound)?;
        storage::strategy(&e, &id)
    }

    pub fn count(e: Env) -> u64 {
        storage::count(&e)
    }

    pub fn escrow_of(e: Env, id: u64) -> Result<Address, FactoryError> {
        storage::escrow_of(&e, id)
    }

    pub fn id_of(e: Env, escrow: Address) -> Result<u64, FactoryError> {
        storage::id_of(&e, &escrow).ok_or(FactoryError::NotFound)
    }

    pub fn list_by_landlord(
        e: Env,
        landlord: Address,
        start: u32,
        limit: u32,
    ) -> Result<Vec<u64>, FactoryError> {
        let total = storage::count_by_landlord(&e, &landlord);
        page(
            start,
            limit,
            total,
            |i| storage::landlord_at(&e, &landlord, i),
            &e,
        )
    }

    pub fn list_by_tenant(
        e: Env,
        tenant: Address,
        start: u32,
        limit: u32,
    ) -> Result<Vec<u64>, FactoryError> {
        let total = storage::count_by_tenant(&e, &tenant);
        page(
            start,
            limit,
            total,
            |i| storage::tenant_at(&e, &tenant, i),
            &e,
        )
    }

    pub fn count_by_landlord(e: Env, landlord: Address) -> u32 {
        storage::count_by_landlord(&e, &landlord)
    }

    pub fn count_by_tenant(e: Env, tenant: Address) -> u32 {
        storage::count_by_tenant(&e, &tenant)
    }

    /// Sin llamar al vault (presupuesto): solo `escrow.get_escrow()` por id.
    pub fn get_fianzas(e: Env, ids: Vec<u64>) -> Result<Vec<FianzaSummary>, FactoryError> {
        if ids.len() > MAX_VIEWS {
            return Err(FactoryError::TooMany);
        }
        let mut out = Vec::new(&e);
        for id in ids.iter() {
            if let Ok(addr) = storage::escrow_of(&e, id) {
                let data = escrow::Client::new(&e, &addr).get_escrow();
                out.push_back(FianzaSummary {
                    id,
                    escrow: addr,
                    status: effective_status(&e, &data),
                    data,
                });
            }
        }
        Ok(out)
    }
}
