//! Lecturas del vault de DeFindex que usa la factory (INTERFACES § 5): `get_fees` y
//! `get_manager`. Se llaman con `try_` y cualquier fallo rechaza la operación (fail-closed).
use soroban_sdk::{vec, Address, Env, Symbol, Val, Vec};

use crate::error::FactoryError;
use crate::escrow::Strategy;
use crate::types::GlobalConfig;

const MAX_BPS: u32 = 10_000;

/// `(vault_fee_bps, defindex_protocol_fee_bps)`.
pub fn fees(e: &Env, vault: &Address) -> Result<(u32, u32), FactoryError> {
    let args: Vec<Val> = vec![e];
    match e.try_invoke_contract::<(u32, u32), soroban_sdk::Error>(
        vault,
        &Symbol::new(e, "get_fees"),
        args,
    ) {
        Ok(Ok(fees)) => Ok(fees),
        _ => Err(FactoryError::VaultFeeTooHigh),
    }
}

fn manager(e: &Env, vault: &Address) -> Result<Address, FactoryError> {
    let args: Vec<Val> = vec![e];
    match e.try_invoke_contract::<Address, soroban_sdk::Error>(
        vault,
        &Symbol::new(e, "get_manager"),
        args,
    ) {
        Ok(Ok(manager)) => Ok(manager),
        _ => Err(FactoryError::VaultNotPlatformManaged),
    }
}

/// FAC-7 y FAC-8: comisiones dentro de los topes de la estrategia y, si la plataforma fija
/// un manager, que el vault siga gestionado por él. Devuelve el snapshot de comisiones que
/// se copia en `Terms`; `(0, 0)` para `NoYield`.
pub fn check(e: &Env, config: &GlobalConfig, s: &Strategy) -> Result<(u32, u32), FactoryError> {
    let Some(vault) = &s.vault else {
        return Ok((0, 0));
    };
    let (vault_fee, protocol_fee) = fees(e, vault)?;
    if vault_fee > s.max_vault_fee_bps || protocol_fee > MAX_BPS {
        return Err(FactoryError::VaultFeeTooHigh);
    }
    if let Some(expected) = &config.vault_manager {
        if manager(e, vault)? != *expected {
            return Err(FactoryError::VaultNotPlatformManaged);
        }
    }
    Ok((vault_fee, protocol_fee))
}
