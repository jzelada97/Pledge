// Derived from Trustless-Work/trustlesswork-smart-contract-stellar@1d22d0c (contracts/escrow/src/core/validators/escrow.rs), modified. See contracts/escrow/NOTICE.md
// FIANZAS: de los validadores del upstream se conserva `has_duplicate_addresses` y la idea de
// los solapes de roles, convertida en `validate_parties` (AUTHZ-4). Se eliminan la validación
// de cadenas, los milestones y los cambios de propiedades.
use soroban_sdk::{Address, Env, Vec};

use crate::error::EscrowError;
use crate::storage::types::{EscrowInit, StrategyKind, Terms};

pub const MAX_AMOUNT: i128 = 1_000_000_000_000_000;
const MAX_BPS: u32 = 10_000;
const MAX_RESOLVERS: u32 = 3;

fn has_duplicate_addresses(list: &Vec<Address>) -> bool {
    for i in 0..list.len() {
        for j in (i + 1)..list.len() {
            if list.get(i).unwrap() == list.get(j).unwrap() {
                return true;
            }
        }
    }
    false
}

// FIANZAS: defensa en profundidad del constructor. La factory ya valida lo mismo al crear.
pub fn validate_init(e: &Env, init: &EscrowInit) -> Result<(), EscrowError> {
    let t = &init.terms;
    if t.amount <= 0 || t.amount > MAX_AMOUNT {
        return Err(EscrowError::InvalidAmount);
    }
    if t.end_ts <= e.ledger().timestamp() {
        return Err(EscrowError::InvalidEndTs);
    }
    if t.tenant_yield_bps > MAX_BPS
        || t.platform_fee_bps > MAX_BPS
        || t.tw_fee_bps > MAX_BPS
        || t.platform_fee_bps + t.tw_fee_bps > MAX_BPS
    {
        return Err(EscrowError::InvalidBps);
    }
    if t.tw_fee_bps > 0 && t.tw_fee_receiver.is_none() {
        return Err(EscrowError::InvalidConfig);
    }
    if init.tenant.is_some() == init.invite_hash.is_some() {
        return Err(EscrowError::InvalidInvite);
    }
    let resolvers = t.dispute_resolvers.len();
    if resolvers == 0 || resolvers > MAX_RESOLVERS || has_duplicate_addresses(&t.dispute_resolvers)
    {
        return Err(EscrowError::InvalidConfig);
    }
    if (t.strategy.kind == StrategyKind::DeFindexVault) != t.strategy.vault.is_some() {
        return Err(EscrowError::InvalidConfig);
    }
    if t.stop_bond < 0 || t.stop_bond > t.amount {
        return Err(EscrowError::InvalidAmount);
    }
    Ok(())
}

// FIANZAS: AUTHZ-4. Ninguna parte puede ser un rol del sistema ni un contrato de la fianza.
pub fn validate_parties(e: &Env, terms: &Terms, tenant: &Address) -> Result<(), EscrowError> {
    if *tenant == terms.landlord {
        return Err(EscrowError::SameParty);
    }
    let me = e.current_contract_address();
    let mut forbidden: Vec<Address> = Vec::new(e);
    forbidden.push_back(me);
    forbidden.push_back(terms.factory.clone());
    forbidden.push_back(terms.treasury.clone());
    forbidden.push_back(terms.strategy.asset.clone());
    if let Some(vault) = &terms.strategy.vault {
        forbidden.push_back(vault.clone());
    }
    if let Some(receiver) = &terms.tw_fee_receiver {
        forbidden.push_back(receiver.clone());
    }
    forbidden.append(&terms.dispute_resolvers);
    for party in [&terms.landlord, tenant] {
        if forbidden.contains(party) {
            return Err(EscrowError::InvalidParty);
        }
    }
    Ok(())
}
