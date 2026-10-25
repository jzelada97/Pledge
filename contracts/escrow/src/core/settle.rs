//! Liquidación (código nuevo del fork; sustituye a `release_funds_execute` del upstream, que
//! pagaba `escrow.amount` con la comisión sobre el bruto). Es el único sitio que paga principal
//! y rendimiento.
use soroban_sdk::token::Client as TokenClient;
use soroban_sdk::{Address, Env};

use crate::core::EscrowManager;
use crate::error::EscrowError;
use crate::events::handler::FzSettle;
use crate::modules::split::split;
use crate::modules::vault;
use crate::storage::types::{Escrow, SettlePath, Settlement, Status, StrategyKind, Terms};

/// Lo que hay para repartir: lo retirado del vault, o el principal líquido si es `NoYield`
/// (nunca `balance(escrow)`, que podría incluir el bond o tokens enviados de fuera; CT-16).
fn withdraw_total(e: &Env, escrow: &Escrow) -> Result<i128, EscrowError> {
    let t = &escrow.terms;
    match (&t.strategy.kind, &t.strategy.vault) {
        (StrategyKind::NoYield, _) => Ok(t.amount),
        (StrategyKind::DeFindexVault, Some(v)) => {
            vault::withdraw_all(e, v, &t.strategy.asset, escrow.shares)
        }
        (StrategyKind::DeFindexVault, None) => Err(EscrowError::VaultError),
    }
}

/// Lo que se repartiría hoy, sin mover fondos (para `preview_settlement`).
pub fn preview_total(e: &Env, escrow: &Escrow) -> i128 {
    let t = &escrow.terms;
    match &t.strategy.vault {
        Some(v) => vault::preview_value(e, v, escrow.shares),
        None => t.amount,
    }
}

/// `split()` con la deducción recortada a lo que vuelve del principal (CT-7).
pub fn compute(total: i128, terms: &Terms, deduction: i128) -> Result<Settlement, EscrowError> {
    let deduction = deduction.min(total.min(terms.amount)).max(0);
    split(
        total,
        terms.amount,
        deduction,
        terms.platform_fee_bps,
        terms.tw_fee_bps,
        terms.tenant_yield_bps,
    )
}

fn pay(e: &Env, token: &TokenClient, to: &Address, amount: i128) {
    if amount > 0 {
        token.transfer(&e.current_contract_address(), to, &amount);
    }
}

/// Retira del vault, reparte, guarda `Settled` y después paga. Destinos fijos de `Terms`.
pub fn settle(
    e: &Env,
    escrow: &mut Escrow,
    deduction: i128,
    path: SettlePath,
) -> Result<Settlement, EscrowError> {
    let tenant = escrow.tenant.clone().ok_or(EscrowError::BadStatus)?;
    let total = withdraw_total(e, escrow)?;
    let settlement = compute(total, &escrow.terms, deduction)?;

    escrow.status = Status::Settled;
    escrow.settlement = settlement.clone();
    escrow.path = path;
    escrow.shares = 0;
    EscrowManager::save(e, escrow);

    let t = &escrow.terms;
    let token = TokenClient::new(e, &t.strategy.asset);
    pay(e, &token, &tenant, settlement.to_tenant);
    pay(e, &token, &t.landlord, settlement.to_landlord);
    pay(e, &token, &t.treasury, settlement.to_treasury);
    if let Some(receiver) = &t.tw_fee_receiver {
        pay(e, &token, receiver, settlement.to_tw);
    }

    FzSettle {
        id: t.id,
        settlement: settlement.clone(),
        path,
        vault_fees_at_settle: t
            .strategy
            .vault
            .as_ref()
            .and_then(|v| vault::current_fees(e, v)),
    }
    .publish(e);
    Ok(settlement)
}
