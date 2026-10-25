// Vault malicioso para los tests de seguridad (security § 16: evil_vault.rs obligatorio).
// Se comporta como un vault honesto 1:1 salvo en el modo configurado. De momento: intentar
// volver a entrar en el escrow durante `deposit` o `withdraw` (V6, CT-18).
use soroban_sdk::token::Client as TokenClient;
use soroban_sdk::{contract, contractimpl, contracttype, vec, Address, Env, Vec};

use crate::contract::EscrowContractClient;

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum EvilMode {
    Honest,
    ReenterOnDeposit,
    ReenterOnWithdraw,
}

#[contracttype]
enum Key {
    Asset,
    Mode,
    Target,
    Shares(Address),
}

#[contract]
pub struct EvilVault;

fn mode(e: &Env) -> EvilMode {
    e.storage()
        .instance()
        .get(&Key::Mode)
        .unwrap_or(EvilMode::Honest)
}

fn token(e: &Env) -> TokenClient<'_> {
    let asset: Address = e.storage().instance().get(&Key::Asset).unwrap();
    TokenClient::new(e, &asset)
}

fn shares_of(e: &Env, id: &Address) -> i128 {
    e.storage()
        .instance()
        .get(&Key::Shares(id.clone()))
        .unwrap_or(0)
}

/// Llama al escrow que tiene en la pila: el host debe rechazar la reentrada.
fn reenter(e: &Env) {
    let target: Address = e.storage().instance().get(&Key::Target).unwrap();
    EscrowContractClient::new(e, &target).approve_release(&e.current_contract_address());
}

#[contractimpl]
impl EvilVault {
    pub fn __constructor(e: Env, asset: Address) {
        e.storage().instance().set(&Key::Asset, &asset);
    }

    pub fn set_mode(e: Env, mode: EvilMode) {
        e.storage().instance().set(&Key::Mode, &mode);
    }

    pub fn set_target(e: Env, escrow: Address) {
        e.storage().instance().set(&Key::Target, &escrow);
    }

    pub fn deposit(
        e: Env,
        amounts_desired: Vec<i128>,
        _amounts_min: Vec<i128>,
        from: Address,
        _invest: bool,
    ) -> (Vec<i128>, i128) {
        from.require_auth();
        if mode(&e) == EvilMode::ReenterOnDeposit {
            reenter(&e);
        }
        let amount = amounts_desired.get(0).unwrap();
        token(&e).transfer(&from, e.current_contract_address(), &amount);
        e.storage()
            .instance()
            .set(&Key::Shares(from.clone()), &(shares_of(&e, &from) + amount));
        (vec![&e, amount], amount)
    }

    pub fn withdraw(
        e: Env,
        withdraw_shares: i128,
        _min_amounts_out: Vec<i128>,
        from: Address,
    ) -> Vec<i128> {
        from.require_auth();
        if mode(&e) == EvilMode::ReenterOnWithdraw {
            reenter(&e);
        }
        e.storage().instance().set(
            &Key::Shares(from.clone()),
            &(shares_of(&e, &from) - withdraw_shares),
        );
        token(&e).transfer(&e.current_contract_address(), &from, &withdraw_shares);
        vec![&e, withdraw_shares]
    }

    pub fn get_asset_amounts_per_shares(e: Env, vault_shares: i128) -> Vec<i128> {
        vec![&e, vault_shares]
    }

    pub fn balance(e: Env, id: Address) -> i128 {
        shares_of(&e, &id)
    }

    pub fn get_fees(_e: Env) -> (u32, u32) {
        (100, 2_000)
    }
}
