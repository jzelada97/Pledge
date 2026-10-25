// Vault de DeFindex simulado con las firmas de docs/INTERFACES.md § 5, mientras no exista
// contracts/mock-vault (P2). Igual que DeFindex, `deposit` tira con
// `token.transfer(from, vault, amount)`, así que el árbol de auth del escrow es el real.
// Rendimiento: mintear tokens al vault. Pérdida: `lose(amount)`.
use soroban_sdk::token::Client as TokenClient;
use soroban_sdk::{contract, contractimpl, contracttype, vec, Address, Env, Vec};

#[contracttype]
enum Key {
    Admin,
    Asset,
    Fees,
    Supply,
    Shares(Address),
    Broken,
}

#[contract]
pub struct MockVault;

fn assets(e: &Env) -> i128 {
    let asset: Address = e.storage().instance().get(&Key::Asset).unwrap();
    TokenClient::new(e, &asset).balance(&e.current_contract_address())
}

fn supply(e: &Env) -> i128 {
    e.storage().instance().get(&Key::Supply).unwrap_or(0)
}

fn shares_of(e: &Env, id: &Address) -> i128 {
    e.storage()
        .instance()
        .get(&Key::Shares(id.clone()))
        .unwrap_or(0)
}

fn check_alive(e: &Env) {
    if e.storage().instance().get(&Key::Broken).unwrap_or(false) {
        panic!("vault roto");
    }
}

#[contractimpl]
impl MockVault {
    pub fn __constructor(e: Env, admin: Address, asset: Address) {
        e.storage().instance().set(&Key::Admin, &admin);
        e.storage().instance().set(&Key::Asset, &asset);
        e.storage().instance().set(&Key::Fees, &(100u32, 2_000u32));
    }

    pub fn set_fees(e: Env, vault_fee: u32, protocol_fee: u32) {
        e.storage()
            .instance()
            .set(&Key::Fees, &(vault_fee, protocol_fee));
    }

    pub fn set_broken(e: Env, broken: bool) {
        e.storage().instance().set(&Key::Broken, &broken);
    }

    /// Simula una pérdida: el vault pierde `amount` del activo.
    pub fn lose(e: Env, amount: i128) {
        let asset: Address = e.storage().instance().get(&Key::Asset).unwrap();
        let admin: Address = e.storage().instance().get(&Key::Admin).unwrap();
        TokenClient::new(&e, &asset).transfer(&e.current_contract_address(), &admin, &amount);
    }

    pub fn deposit(
        e: Env,
        amounts_desired: Vec<i128>,
        _amounts_min: Vec<i128>,
        from: Address,
        _invest: bool,
    ) -> (Vec<i128>, i128) {
        check_alive(&e);
        from.require_auth();
        let amount = amounts_desired.get(0).unwrap();
        let (total_assets, total_shares) = (assets(&e), supply(&e));
        let asset: Address = e.storage().instance().get(&Key::Asset).unwrap();
        TokenClient::new(&e, &asset).transfer(&from, e.current_contract_address(), &amount);
        let minted = if total_shares == 0 || total_assets == 0 {
            amount
        } else {
            amount * total_shares / total_assets
        };
        e.storage()
            .instance()
            .set(&Key::Shares(from.clone()), &(shares_of(&e, &from) + minted));
        e.storage()
            .instance()
            .set(&Key::Supply, &(total_shares + minted));
        (vec![&e, amount], minted)
    }

    pub fn withdraw(
        e: Env,
        withdraw_shares: i128,
        _min_amounts_out: Vec<i128>,
        from: Address,
    ) -> Vec<i128> {
        check_alive(&e);
        from.require_auth();
        let owned = shares_of(&e, &from);
        assert!(withdraw_shares <= owned, "shares insuficientes");
        let amount = withdraw_shares * assets(&e) / supply(&e);
        e.storage()
            .instance()
            .set(&Key::Shares(from.clone()), &(owned - withdraw_shares));
        e.storage()
            .instance()
            .set(&Key::Supply, &(supply(&e) - withdraw_shares));
        let asset: Address = e.storage().instance().get(&Key::Asset).unwrap();
        TokenClient::new(&e, &asset).transfer(&e.current_contract_address(), &from, &amount);
        vec![&e, amount]
    }

    pub fn get_asset_amounts_per_shares(e: Env, vault_shares: i128) -> Vec<i128> {
        check_alive(&e);
        let total_shares = supply(&e);
        let value = if total_shares == 0 {
            0
        } else {
            vault_shares * assets(&e) / total_shares
        };
        vec![&e, value]
    }

    pub fn balance(e: Env, id: Address) -> i128 {
        shares_of(&e, &id)
    }

    pub fn total_supply(e: Env) -> i128 {
        supply(&e)
    }

    pub fn get_fees(e: Env) -> (u32, u32) {
        check_alive(&e);
        e.storage().instance().get(&Key::Fees).unwrap()
    }

    pub fn get_manager(e: Env) -> Address {
        e.storage().instance().get(&Key::Admin).unwrap()
    }
}
