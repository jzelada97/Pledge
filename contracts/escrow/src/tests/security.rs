// Tests de security § 9.1 del camino feliz que no encajan en un solo módulo.
use crate::error::EscrowError;
use crate::storage::types::{EscrowInit, Status};
use crate::tests::evil_vault::{EvilMode, EvilVault, EvilVaultClient};
use crate::tests::helpers::{Setup, AMOUNT};

fn evil_vault<'a>(s: &Setup<'a>) -> EvilVaultClient<'a> {
    let addr = s.env.register(EvilVault, (s.token.address.clone(),));
    EvilVaultClient::new(&s.env, &addr)
}

// V6 / CT-18: un vault no puede volver a entrar en el escrow. El host de Soroban lo impide;
// el escrow ve fallar la llamada al vault y revierte con VaultError sin mover fondos.
#[test]
fn evil_vault_reentry_fails() {
    // Durante el depósito.
    let s = Setup::new();
    let vault = evil_vault(&s);
    let terms = s.vault_terms(&vault.address);
    let escrow = s.register(EscrowInit {
        terms: terms.clone(),
        tenant: Some(s.tenant.clone()),
        invite_hash: None,
    });
    vault.set_target(&escrow.address);
    vault.set_mode(&EvilMode::ReenterOnDeposit);

    let res = escrow.try_fund_escrow(&s.tenant, &None, &terms);
    assert_eq!(res, Err(Ok(EscrowError::VaultError)));
    assert_eq!(escrow.get_escrow().status, Status::Proposed);
    assert_eq!(s.token.balance(&s.tenant), AMOUNT * 2);

    // Durante la retirada que hace la segunda aprobación.
    let s = Setup::new();
    let vault = evil_vault(&s);
    let escrow = s.funded_vault_escrow(&vault.address);
    vault.set_target(&escrow.address);
    vault.set_mode(&EvilMode::ReenterOnWithdraw);
    escrow.approve_release(&s.landlord);

    let res = escrow.try_approve_release(&s.tenant);
    assert_eq!(res, Err(Ok(EscrowError::VaultError)));
    let data = escrow.get_escrow();
    assert_eq!(data.status, Status::Active);
    assert_eq!(data.approvals.approval_count, 1);
    assert_eq!(vault.balance(&escrow.address), AMOUNT);
}

// Las salidas no dependen de la factory: con la factory rota o en pausa se puede aprobar,
// liquidar y cancelar (security § 9.1 y la parte de salidas de pause_blocks_only_entries).
#[test]
fn exits_work_with_broken_factory() {
    let s = Setup::new();
    let funded = s.funded_escrow();
    let proposed = s.escrow_with_tenant();
    s.factory.set_fail(&true);
    s.factory.set_allowed(&false);

    funded.approve_release(&s.landlord);
    let settlement = funded.approve_release(&s.tenant).unwrap();
    assert_eq!(settlement.to_tenant, AMOUNT);
    assert_eq!(funded.get_escrow().status, Status::Settled);

    proposed.cancel();
    assert_eq!(proposed.get_escrow().status, Status::Cancelled);
}

#[test]
fn approve_release_ignores_factory_pause() {
    let s = Setup::new();
    let vault = s.mock_vault();
    let escrow = s.funded_vault_escrow(&vault.address);
    s.factory.set_allowed(&false); // la factory está en pausa

    escrow.approve_release(&s.tenant);
    assert!(escrow.approve_release(&s.landlord).is_some());
    assert_eq!(escrow.get_escrow().status, Status::Settled);
}
