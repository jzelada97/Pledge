// Derived from Trustless-Work/trustlesswork-smart-contract-stellar@1d22d0c (contracts/escrow/src/contract.rs), modified. See contracts/escrow/NOTICE.md
// FIANZAS: entrypoints de docs/INTERFACES.md § 2. Se eliminan las funciones del upstream
// (security N-2): `tw_new_single_release_escrow` (pasa a la factory), `initialize_escrow` (lo
// sustituye el constructor), `update_escrow`, `manage_milestones`, `change_milestone_status`,
// `approve_milestones`, `approve_and_release_milestones`, `release_funds`,
// `withdraw_remaining_funds`, `resolve_dispute`, `dispute_escrow`,
// `get_escrow_by_contract_id` y `get_multiple_escrow_balances`. Sin admin ni upgrade.
// Primera entrega: constructor, fondeo, cancelación y lecturas. El resto de funciones de
// INTERFACES § 2 llega en las fases 3b y 5.
use soroban_sdk::{contract, contractimpl, panic_with_error, Address, BytesN, Env};

use crate::core::EscrowManager;
use crate::error::EscrowError;
use crate::events::handler::{FzCancel, FzFund, FzInit};
use crate::storage::types::{Escrow, EscrowInit, Terms};

#[contract]
pub struct EscrowContract;

#[contractimpl]
impl EscrowContract {
    // FIANZAS: `__constructor(admin, approved_wasm_hash)` → `__constructor(init)`. Lo invoca la
    // factory al desplegar, así que no hay ventana sin inicializar ni clave de admin.
    pub fn __constructor(e: Env, init: EscrowInit) {
        let escrow = match EscrowManager::init_from_constructor(&e, init) {
            Ok(escrow) => escrow,
            Err(err) => panic_with_error!(&e, err),
        };
        let t = &escrow.terms;
        FzInit {
            id: t.id,
            factory: t.factory.clone(),
            landlord: t.landlord.clone(),
            amount: t.amount,
            end_ts: t.end_ts,
            tenant_yield_bps: t.tenant_yield_bps,
            strategy_id: t.strategy.id.clone(),
            stop_bond: t.stop_bond,
            has_invite: escrow.invite_hash.is_some(),
            platform_fee_bps: t.platform_fee_bps,
            tw_fee_bps: t.tw_fee_bps,
            defindex_vault_fee_bps: t.defindex_vault_fee_bps,
            defindex_protocol_fee_bps: t.defindex_protocol_fee_bps,
        }
        .publish(&e);
    }

    pub fn cancel(e: Env) -> Result<(), EscrowError> {
        let escrow = EscrowManager::cancel(&e)?;
        FzCancel {
            id: escrow.terms.id,
            landlord: escrow.terms.landlord,
        }
        .publish(&e);
        Ok(())
    }

    pub fn fund_escrow(
        e: Env,
        tenant: Address,
        invite_code: Option<BytesN<32>>,
        expected_terms: Terms,
    ) -> Result<i128, EscrowError> {
        let (escrow, shares) =
            EscrowManager::fund_escrow(&e, &tenant, &invite_code, &expected_terms)?;
        FzFund {
            id: escrow.terms.id,
            tenant,
            amount: escrow.terms.amount,
            shares,
        }
        .publish(&e);
        Ok(shares)
    }

    // FIANZAS: `extend_contract_ttl(admin, …)` → sin permisos y sin argumentos.
    pub fn extend_contract_ttl(e: Env) {
        EscrowManager::extend_ttl(&e);
    }

    pub fn get_escrow(e: Env) -> Result<Escrow, EscrowError> {
        EscrowManager::get_escrow(&e)
    }

    pub fn get_terms(e: Env) -> Result<Terms, EscrowError> {
        Ok(EscrowManager::get_escrow(&e)?.terms)
    }
}
