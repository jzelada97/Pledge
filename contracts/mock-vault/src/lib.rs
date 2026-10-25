//! Mock del vault de DeFindex con el subconjunto que usa el escrow (docs/INTERFACES.md § 5).
//!
//! - Misma firma que DeFindex en `deposit`, `withdraw`, `get_asset_amounts_per_shares`, `balance`,
//!   `get_fees`, `get_manager`, `total_supply`, `name` y `symbol`.
//! - Tira del token exactamente con `token.transfer(from, vault, amount)`, como DeFindex, para que el
//!   árbol de autorización del escrow (`authorize_as_current_contract`) sea idéntico al real.
//! - Rendimiento simulado: `set_rate_bps` (anual, lineal, puede ser negativo → pérdida). El valor total
//!   se actualiza de forma perezosa en cada interacción con el reloj del ledger.
//! - Modos de fallo para los tests del escrow: `set_fail(true)` hace que deposit y withdraw fallen con
//!   `VaultError`; si la reserva (saldo real del token) no cubre un retiro → `InsufficientReserve`.
//!   El admin repone la reserva con una transferencia normal del token al contrato.
#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, token, Address, Env, String, Vec,
};

const SECONDS_PER_YEAR: i128 = 31_536_000;

/// Retorno de `deposit`, con la forma exacta de DeFindex: `(amounts, shares, asset_allocations)`.
pub type DepositResult = (Vec<i128>, i128, Option<Vec<Option<i128>>>);
const BPS: i128 = 10_000;
const DAY: u32 = 17_280;
const TTL_THRESHOLD: u32 = DAY * 7;
const TTL_EXTEND: u32 = DAY * 30;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum MockVaultError {
    AmountNotAllowed = 1,
    InsufficientReserve = 2,
    VaultError = 3,
    InsufficientShares = 4,
    NotAdmin = 5,
    WrongAmountsLength = 6,
    BelowMin = 7,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Asset,
    TotalShares,
    TotalAssets, // valor contable (principal + rendimiento simulado)
    LastUpdate,  // timestamp del último accrue
    RateBps,     // tasa anual simulada (i32, puede ser negativa)
    Fees,        // (vault_fee_bps, protocol_fee_bps)
    Fail,        // bool: deposit/withdraw fallan con VaultError
    Balance(Address),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Fees {
    pub vault_fee_bps: u32,
    pub protocol_fee_bps: u32,
}

#[contract]
pub struct MockVault;

fn get<T: soroban_sdk::TryFromVal<Env, soroban_sdk::Val>>(e: &Env, k: &DataKey) -> Option<T> {
    e.storage().instance().get(k)
}
fn put<T: soroban_sdk::IntoVal<Env, soroban_sdk::Val>>(e: &Env, k: &DataKey, v: &T) {
    e.storage().instance().set(k, v);
}
fn bump(e: &Env) {
    e.storage().instance().extend_ttl(TTL_THRESHOLD, TTL_EXTEND);
}
fn admin(e: &Env) -> Address {
    get(e, &DataKey::Admin).unwrap()
}
fn asset(e: &Env) -> Address {
    get(e, &DataKey::Asset).unwrap()
}
fn total_shares(e: &Env) -> i128 {
    get(e, &DataKey::TotalShares).unwrap_or(0)
}
fn total_assets(e: &Env) -> i128 {
    get(e, &DataKey::TotalAssets).unwrap_or(0)
}
fn shares_of(e: &Env, id: &Address) -> i128 {
    get(e, &DataKey::Balance(id.clone())).unwrap_or(0)
}
fn fail(e: &Env) -> Result<(), MockVaultError> {
    if get::<bool>(e, &DataKey::Fail).unwrap_or(false) {
        return Err(MockVaultError::VaultError);
    }
    Ok(())
}

/// Aplica el rendimiento simulado acumulado desde la última actualización.
fn accrue(e: &Env) {
    let now = e.ledger().timestamp();
    let last: u64 = get(e, &DataKey::LastUpdate).unwrap_or(now);
    let rate: i32 = get(e, &DataKey::RateBps).unwrap_or(0);
    let assets = total_assets(e);
    if now > last && rate != 0 && assets > 0 {
        let dt = (now - last) as i128;
        let delta = assets * rate as i128 * dt / (BPS * SECONDS_PER_YEAR);
        let new_assets = (assets + delta).max(0);
        put(e, &DataKey::TotalAssets, &new_assets);
    }
    put(e, &DataKey::LastUpdate, &now);
}

fn shares_to_assets(e: &Env, shares: i128) -> i128 {
    let ts = total_shares(e);
    if ts == 0 {
        return 0;
    }
    shares * total_assets(e) / ts
}

#[contractimpl]
impl MockVault {
    pub fn __constructor(e: Env, admin: Address, asset: Address) {
        put(&e, &DataKey::Admin, &admin);
        put(&e, &DataKey::Asset, &asset);
        put(&e, &DataKey::TotalShares, &0i128);
        put(&e, &DataKey::TotalAssets, &0i128);
        put(&e, &DataKey::RateBps, &0i32);
        put(
            &e,
            &DataKey::Fees,
            &Fees {
                vault_fee_bps: 100,
                protocol_fee_bps: 2000,
            },
        );
        put(&e, &DataKey::Fail, &false);
        put(&e, &DataKey::LastUpdate, &e.ledger().timestamp());
    }

    // ---- Interfaz de DeFindex que usa el escrow ----

    /// Igual que DeFindex: `(amounts_depositados, shares_emitidas, allocations)`. El escrow ignora el
    /// retorno y mide las shares con `balance(escrow)` antes y después.
    pub fn deposit(
        e: Env,
        amounts_desired: Vec<i128>,
        amounts_min: Vec<i128>,
        from: Address,
        _invest: bool,
    ) -> Result<DepositResult, MockVaultError> {
        from.require_auth();
        fail(&e)?;
        if amounts_desired.len() != 1 || amounts_min.len() != 1 {
            return Err(MockVaultError::WrongAmountsLength);
        }
        let amount = amounts_desired.get(0).unwrap();
        if amount <= 0 {
            return Err(MockVaultError::AmountNotAllowed);
        }
        if amount < amounts_min.get(0).unwrap() {
            return Err(MockVaultError::BelowMin);
        }
        accrue(&e);
        let ts = total_shares(&e);
        let ta = total_assets(&e);
        let shares = if ts == 0 || ta == 0 {
            amount
        } else {
            amount * ts / ta
        };
        if shares <= 0 {
            return Err(MockVaultError::AmountNotAllowed);
        }
        // Exactamente la misma subinvocación que DeFindex: transfer(from, vault, amount).
        token::Client::new(&e, &asset(&e)).transfer(&from, e.current_contract_address(), &amount);
        put(&e, &DataKey::TotalShares, &(ts + shares));
        put(&e, &DataKey::TotalAssets, &(ta + amount));
        put(
            &e,
            &DataKey::Balance(from.clone()),
            &(shares_of(&e, &from) + shares),
        );
        bump(&e);
        let mut out = Vec::new(&e);
        out.push_back(amount);
        Ok((out, shares, None))
    }

    /// Igual que DeFindex: devuelve los importes pagados por activo. Paga desde la reserva real del token;
    /// si no alcanza (pérdida simulada mayor que la reserva o reserva vaciada en tests) → InsufficientReserve.
    pub fn withdraw(
        e: Env,
        withdraw_shares: i128,
        min_amounts_out: Vec<i128>,
        from: Address,
    ) -> Result<Vec<i128>, MockVaultError> {
        from.require_auth();
        fail(&e)?;
        if min_amounts_out.len() != 1 {
            return Err(MockVaultError::WrongAmountsLength);
        }
        if withdraw_shares <= 0 {
            return Err(MockVaultError::AmountNotAllowed);
        }
        let held = shares_of(&e, &from);
        if withdraw_shares > held {
            return Err(MockVaultError::InsufficientShares);
        }
        accrue(&e);
        let amount = shares_to_assets(&e, withdraw_shares);
        if amount < min_amounts_out.get(0).unwrap() {
            return Err(MockVaultError::BelowMin);
        }
        let tok = token::Client::new(&e, &asset(&e));
        let reserve = tok.balance(&e.current_contract_address());
        if amount > reserve {
            return Err(MockVaultError::InsufficientReserve);
        }
        put(
            &e,
            &DataKey::Balance(from.clone()),
            &(held - withdraw_shares),
        );
        put(
            &e,
            &DataKey::TotalShares,
            &(total_shares(&e) - withdraw_shares),
        );
        put(
            &e,
            &DataKey::TotalAssets,
            &(total_assets(&e) - amount).max(0),
        );
        if amount > 0 {
            tok.transfer(&e.current_contract_address(), &from, &amount);
        }
        bump(&e);
        let mut out = Vec::new(&e);
        out.push_back(amount);
        Ok(out)
    }

    /// Valor actual (con el rendimiento simulado hasta ahora) de `vault_shares`, por activo.
    pub fn get_asset_amounts_per_shares(
        e: Env,
        vault_shares: i128,
    ) -> Result<Vec<i128>, MockVaultError> {
        if vault_shares < 0 {
            return Err(MockVaultError::AmountNotAllowed);
        }
        // Lectura: no persiste el accrue, lo calcula al vuelo.
        let now = e.ledger().timestamp();
        let last: u64 = get(&e, &DataKey::LastUpdate).unwrap_or(now);
        let rate: i32 = get(&e, &DataKey::RateBps).unwrap_or(0);
        let ts = total_shares(&e);
        let mut ta = total_assets(&e);
        if now > last && rate != 0 && ta > 0 {
            let dt = (now - last) as i128;
            ta = (ta + ta * rate as i128 * dt / (BPS * SECONDS_PER_YEAR)).max(0);
        }
        let value = if ts == 0 { 0 } else { vault_shares * ta / ts };
        let mut out = Vec::new(&e);
        out.push_back(value);
        Ok(out)
    }

    pub fn balance(e: Env, id: Address) -> i128 {
        shares_of(&e, &id)
    }
    pub fn total_supply(e: Env) -> i128 {
        total_shares(&e)
    }
    pub fn get_fees(e: Env) -> (u32, u32) {
        let f: Fees = get(&e, &DataKey::Fees).unwrap();
        (f.vault_fee_bps, f.protocol_fee_bps)
    }
    pub fn get_manager(e: Env) -> Result<Address, MockVaultError> {
        Ok(admin(&e))
    }
    pub fn get_assets(e: Env) -> Vec<Address> {
        let mut v = Vec::new(&e);
        v.push_back(asset(&e));
        v
    }
    pub fn name(e: Env) -> String {
        String::from_str(&e, "Mock Vault (simulado)")
    }
    pub fn symbol(e: Env) -> String {
        String::from_str(&e, "MOCKV")
    }

    // ---- Controles del mock (solo admin) ----

    /// Tasa anual simulada en bps. Negativa = pérdida. Aplica el accrue pendiente antes de cambiarla.
    pub fn set_rate_bps(e: Env, rate_bps: i32) {
        admin(&e).require_auth();
        accrue(&e);
        put(&e, &DataKey::RateBps, &rate_bps);
        bump(&e);
    }

    /// Cambia las comisiones que devuelve `get_fees` (para probar VaultFeeChanged en el escrow).
    pub fn set_fees(e: Env, vault_fee_bps: u32, protocol_fee_bps: u32) {
        admin(&e).require_auth();
        put(
            &e,
            &DataKey::Fees,
            &Fees {
                vault_fee_bps,
                protocol_fee_bps,
            },
        );
        bump(&e);
    }

    /// Con `true`, deposit y withdraw fallan con VaultError (para probar el manejo de errores del escrow).
    pub fn set_fail(e: Env, fail: bool) {
        admin(&e).require_auth();
        put(&e, &DataKey::Fail, &fail);
        bump(&e);
    }

    /// Fija el valor contable total (simula un salto de ganancia o pérdida sin esperar al reloj).
    pub fn set_total_assets(e: Env, total_assets: i128) -> Result<(), MockVaultError> {
        admin(&e).require_auth();
        if total_assets < 0 {
            return Err(MockVaultError::AmountNotAllowed);
        }
        put(&e, &DataKey::TotalAssets, &total_assets);
        put(&e, &DataKey::LastUpdate, &e.ledger().timestamp());
        bump(&e);
        Ok(())
    }

    /// Saca tokens de la reserva (simula iliquidez: el siguiente withdraw dará InsufficientReserve).
    pub fn drain_reserve(e: Env, to: Address, amount: i128) -> Result<(), MockVaultError> {
        admin(&e).require_auth();
        if amount <= 0 {
            return Err(MockVaultError::AmountNotAllowed);
        }
        token::Client::new(&e, &asset(&e)).transfer(&e.current_contract_address(), &to, &amount);
        Ok(())
    }
}

#[cfg(test)]
mod test;
