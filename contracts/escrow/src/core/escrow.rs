// Derived from Trustless-Work/trustlesswork-smart-contract-stellar@1d22d0c (contracts/escrow/src/core/escrow.rs), modified. See contracts/escrow/NOTICE.md
// FIANZAS: `initialize_escrow` pasa a `init_from_constructor` (inicialización atómica en el
// despliegue) y `fund_escrow` pasa a un único fondeo del inquilino por el importe exacto, con
// invitación y `expected_terms`. Se eliminan `change_escrow_properties`, `manage_milestones`,
// `get_multiple_escrow_balances` y `get_escrow_by_contract_id` (pasan a la factory).
// `release_funds_execute` se moverá a `core/settle.rs`.
use soroban_sdk::{
    token::Client as TokenClient, vec, Address, Bytes, BytesN, Env, IntoVal, Symbol, Val,
};

use crate::core::validators::escrow::{validate_init, validate_parties};
use crate::error::EscrowError;
use crate::storage::types::{
    Approvals, DataKey, Dispute, Escrow, EscrowInit, SettlePath, Settlement, Status, StrategyKind,
    Terms,
};

// FIANZAS: storage persistent (security N-21) con TTL renovado en cada escritura.
const TTL_THRESHOLD: u32 = 17_280; // ~1 día de ledgers

pub struct EscrowManager;

impl EscrowManager {
    pub fn init_from_constructor(e: &Env, init: EscrowInit) -> Result<Escrow, EscrowError> {
        validate_init(e, &init)?;
        let escrow = Escrow {
            terms: init.terms,
            tenant: init.tenant,
            invite_hash: init.invite_hash,
            status: Status::Proposed,
            approvals: Approvals {
                target: 2,
                approval_count: 0,
                approved_by: soroban_sdk::Vec::new(e),
            },
            shares: 0,
            created_ts: e.ledger().timestamp(),
            funded_ts: 0,
            dispute: Dispute {
                reason_hash: None,
                stopped_ts: 0,
                expert_ref: None,
                report_hash: None,
                bond_held: 0,
                stop_justified: None,
            },
            settlement: Settlement {
                total: 0,
                yield_total: 0,
                deduction: 0,
                to_tenant: 0,
                to_landlord: 0,
                to_treasury: 0,
                to_tw: 0,
            },
            path: SettlePath::Pending,
        };
        Self::save(e, &escrow);
        Ok(escrow)
    }

    pub fn cancel(e: &Env) -> Result<Escrow, EscrowError> {
        let mut escrow = Self::get_escrow(e)?;
        escrow.terms.landlord.require_auth();
        if escrow.status != Status::Proposed {
            return Err(EscrowError::BadStatus);
        }
        escrow.status = Status::Cancelled;
        Self::save(e, &escrow);
        Ok(escrow)
    }

    pub fn fund_escrow(
        e: &Env,
        tenant: &Address,
        invite_code: &Option<BytesN<32>>,
        expected_terms: &Terms,
    ) -> Result<(Escrow, i128), EscrowError> {
        tenant.require_auth();
        let mut escrow = Self::get_escrow(e)?;
        if escrow.status != Status::Proposed {
            return Err(EscrowError::BadStatus);
        }
        if e.ledger().timestamp() >= escrow.terms.end_ts {
            return Err(EscrowError::InvalidEndTs);
        }
        if *expected_terms != escrow.terms {
            return Err(EscrowError::TermsMismatch);
        }
        Self::check_tenant(e, &escrow, tenant, invite_code)?;
        validate_parties(e, &escrow.terms, tenant)?;
        Self::check_funding_allowed(e, &escrow.terms)?;

        let me = e.current_contract_address();
        let amount = escrow.terms.amount;
        let token = TokenClient::new(e, &escrow.terms.strategy.asset);
        let before = token.balance(&me);
        token.transfer(tenant, &me, &amount);
        let received = token
            .balance(&me)
            .checked_sub(before)
            .ok_or(EscrowError::Arithmetic)?;
        if received != amount {
            return Err(EscrowError::InvalidAmount);
        }

        // FIANZAS: el depósito en el vault de DeFindex llega con `modules/vault` y el mock-vault.
        // Hasta entonces la factory solo registra estrategias NoYield.
        let shares: i128 = match escrow.terms.strategy.kind {
            StrategyKind::NoYield => 0,
            StrategyKind::DeFindexVault => return Err(EscrowError::VaultError),
        };

        escrow.tenant = Some(tenant.clone());
        escrow.shares = shares;
        escrow.funded_ts = e.ledger().timestamp();
        escrow.status = Status::Active;
        Self::save(e, &escrow);

        Self::register_tenant(e, &escrow.terms, tenant)?;
        Ok((escrow, shares))
    }

    fn check_tenant(
        e: &Env,
        escrow: &Escrow,
        tenant: &Address,
        invite_code: &Option<BytesN<32>>,
    ) -> Result<(), EscrowError> {
        match (&escrow.invite_hash, &escrow.tenant) {
            (Some(hash), _) => {
                let code = invite_code.as_ref().ok_or(EscrowError::InvalidInvite)?;
                let digest: BytesN<32> = e
                    .crypto()
                    .sha256(&Bytes::from_array(e, &code.to_array()))
                    .to_bytes();
                if digest != *hash {
                    return Err(EscrowError::InvalidInvite);
                }
                Ok(())
            }
            (None, Some(fixed)) if fixed == tenant => Ok(()),
            _ => Err(EscrowError::NotParty),
        }
    }

    // FIANZAS: llamadas a la factory con `try_` (security N-1): si fallan, FactoryCall.
    fn check_funding_allowed(e: &Env, terms: &Terms) -> Result<(), EscrowError> {
        let args = vec![e, terms.strategy.id.into_val(e)];
        let allowed = e.try_invoke_contract::<bool, soroban_sdk::Error>(
            &terms.factory,
            &Symbol::new(e, "funding_allowed"),
            args,
        );
        match allowed {
            Ok(Ok(true)) => Ok(()),
            Ok(Ok(false)) => Err(EscrowError::Paused),
            _ => Err(EscrowError::FactoryCall),
        }
    }

    fn register_tenant(e: &Env, terms: &Terms, tenant: &Address) -> Result<(), EscrowError> {
        let args: soroban_sdk::Vec<Val> = vec![e, terms.id.into_val(e), tenant.into_val(e)];
        match e.try_invoke_contract::<(), soroban_sdk::Error>(
            &terms.factory,
            &Symbol::new(e, "register_tenant"),
            args,
        ) {
            Ok(Ok(())) => Ok(()),
            _ => Err(EscrowError::FactoryCall),
        }
    }

    pub fn get_escrow(e: &Env) -> Result<Escrow, EscrowError> {
        e.storage()
            .persistent()
            .get(&DataKey::Escrow)
            .ok_or(EscrowError::BadStatus)
    }

    pub fn extend_ttl(e: &Env) {
        let max = e.storage().max_ttl();
        e.storage().instance().extend_ttl(TTL_THRESHOLD, max);
        if e.storage().persistent().has(&DataKey::Escrow) {
            e.storage()
                .persistent()
                .extend_ttl(&DataKey::Escrow, TTL_THRESHOLD, max);
        }
    }

    fn save(e: &Env, escrow: &Escrow) {
        e.storage().persistent().set(&DataKey::Escrow, escrow);
        Self::extend_ttl(e);
    }
}
