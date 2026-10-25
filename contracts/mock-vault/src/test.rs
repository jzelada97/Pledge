#![cfg(test)]

use super::*;
use soroban_sdk::testutils::{Address as _, Ledger};
use soroban_sdk::{token, Env, Vec};

const USDC: i128 = 10_000_000;

struct Setup {
    e: Env,
    vault: MockVaultClient<'static>,
    vault_id: Address,
    token: token::Client<'static>,
    admin: Address,
    user: Address,
}

fn setup() -> Setup {
    let e = Env::default();
    e.mock_all_auths();
    let admin = Address::generate(&e);
    let user = Address::generate(&e);
    let sac = e.register_stellar_asset_contract_v2(admin.clone());
    let token = token::Client::new(&e, &sac.address());
    token::StellarAssetClient::new(&e, &sac.address()).mint(&user, &(1_000 * USDC));
    let vault_id = e.register(MockVault, (admin.clone(), sac.address()));
    let vault = MockVaultClient::new(&e, &vault_id);
    Setup {
        e,
        vault,
        vault_id,
        token,
        admin,
        user,
    }
}

fn one(e: &Env, v: i128) -> Vec<i128> {
    let mut out = Vec::new(e);
    out.push_back(v);
    out
}

#[test]
fn deposit_mide_shares_y_mueve_el_token() {
    let s = setup();
    let (amounts, shares, _) = s.vault.deposit(
        &one(&s.e, 100 * USDC),
        &one(&s.e, 100 * USDC),
        &s.user,
        &true,
    );
    assert_eq!(amounts.get(0).unwrap(), 100 * USDC);
    assert_eq!(shares, 100 * USDC);
    assert_eq!(s.vault.balance(&s.user), 100 * USDC);
    assert_eq!(s.token.balance(&s.vault_id), 100 * USDC);
    assert_eq!(s.token.balance(&s.user), 900 * USDC);
    assert_eq!(s.vault.get_fees(), (100, 2000));
    assert_eq!(s.vault.get_manager(), s.admin);
}

#[test]
fn el_rendimiento_simulado_crece_con_el_tiempo() {
    let s = setup();
    s.vault.set_rate_bps(&600); // 6 % anual
    s.vault
        .deposit(&one(&s.e, 100 * USDC), &one(&s.e, 0), &s.user, &true);
    let value0 = s
        .vault
        .get_asset_amounts_per_shares(&s.vault.balance(&s.user))
        .get(0)
        .unwrap();
    assert_eq!(value0, 100 * USDC);
    s.e.ledger()
        .with_mut(|l| l.timestamp += SECONDS_PER_YEAR as u64); // un año
    let value1 = s
        .vault
        .get_asset_amounts_per_shares(&s.vault.balance(&s.user))
        .get(0)
        .unwrap();
    assert_eq!(value1, 106 * USDC);
}

#[test]
fn withdraw_paga_el_valor_si_hay_reserva_y_falla_si_no() {
    let s = setup();
    s.vault.set_rate_bps(&600);
    s.vault
        .deposit(&one(&s.e, 100 * USDC), &one(&s.e, 0), &s.user, &true);
    s.e.ledger()
        .with_mut(|l| l.timestamp += SECONDS_PER_YEAR as u64);
    // Valor 106 pero la reserva solo tiene 100 → sin liquidez para el rendimiento.
    let shares = s.vault.balance(&s.user);
    assert_eq!(
        s.vault.try_withdraw(&shares, &one(&s.e, 0), &s.user),
        Err(Ok(MockVaultError::InsufficientReserve))
    );
    // El admin repone la reserva (como haría el pool real al pagar intereses) y el retiro paga 106.
    token::StellarAssetClient::new(&s.e, &s.token.address).mint(&s.vault_id, &(6 * USDC));
    let paid = s.vault.withdraw(&shares, &one(&s.e, 0), &s.user);
    assert_eq!(paid.get(0).unwrap(), 106 * USDC);
    assert_eq!(s.vault.balance(&s.user), 0);
    assert_eq!(s.token.balance(&s.user), 1_006 * USDC);
}

#[test]
fn una_tasa_negativa_devuelve_menos_que_el_principal() {
    let s = setup();
    s.vault
        .deposit(&one(&s.e, 100 * USDC), &one(&s.e, 0), &s.user, &true);
    s.vault.set_rate_bps(&-1000); // −10 % anual
    s.e.ledger()
        .with_mut(|l| l.timestamp += SECONDS_PER_YEAR as u64);
    let paid = s
        .vault
        .withdraw(&s.vault.balance(&s.user), &one(&s.e, 0), &s.user);
    assert_eq!(paid.get(0).unwrap(), 90 * USDC);
}

#[test]
fn set_fail_hace_fallar_deposit_y_withdraw() {
    let s = setup();
    s.vault
        .deposit(&one(&s.e, 10 * USDC), &one(&s.e, 0), &s.user, &true);
    s.vault.set_fail(&true);
    assert_eq!(
        s.vault
            .try_deposit(&one(&s.e, USDC), &one(&s.e, 0), &s.user, &true),
        Err(Ok(MockVaultError::VaultError))
    );
    assert_eq!(
        s.vault.try_withdraw(&USDC, &one(&s.e, 0), &s.user),
        Err(Ok(MockVaultError::VaultError))
    );
    s.vault.set_fail(&false);
    s.vault.withdraw(&USDC, &one(&s.e, 0), &s.user);
}

#[test]
fn set_fees_cambia_lo_que_devuelve_get_fees() {
    let s = setup();
    s.vault.set_fees(&500, &2000);
    assert_eq!(s.vault.get_fees(), (500, 2000));
}

#[test]
fn drain_reserve_simula_iliquidez() {
    let s = setup();
    s.vault
        .deposit(&one(&s.e, 100 * USDC), &one(&s.e, 0), &s.user, &true);
    s.vault.drain_reserve(&s.admin, &(50 * USDC));
    assert_eq!(
        s.vault.try_withdraw(&(100 * USDC), &one(&s.e, 0), &s.user),
        Err(Ok(MockVaultError::InsufficientReserve))
    );
    // Un retiro parcial que cabe en la reserva sí sale.
    let paid = s.vault.withdraw(&(50 * USDC), &one(&s.e, 0), &s.user);
    assert_eq!(paid.get(0).unwrap(), 50 * USDC);
}

#[test]
fn validaciones_de_entrada() {
    let s = setup();
    assert_eq!(
        s.vault
            .try_deposit(&one(&s.e, 0), &one(&s.e, 0), &s.user, &true),
        Err(Ok(MockVaultError::AmountNotAllowed))
    );
    assert_eq!(
        s.vault
            .try_deposit(&one(&s.e, USDC), &one(&s.e, 2 * USDC), &s.user, &true),
        Err(Ok(MockVaultError::BelowMin))
    );
    assert_eq!(
        s.vault.try_withdraw(&USDC, &one(&s.e, 0), &s.user),
        Err(Ok(MockVaultError::InsufficientShares))
    );
    let mut two = Vec::new(&s.e);
    two.push_back(USDC);
    two.push_back(USDC);
    assert_eq!(
        s.vault.try_deposit(&two, &two, &s.user, &true),
        Err(Ok(MockVaultError::WrongAmountsLength))
    );
}
