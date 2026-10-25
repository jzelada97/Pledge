use soroban_sdk::testutils::{Address as _, Ledger, MockAuth, MockAuthInvoke};
use soroban_sdk::IntoVal;

use crate::error::EscrowError;
use crate::storage::types::{EscrowInit, Status};
use crate::tests::helpers::{Setup, AMOUNT, END_TS};

#[test]
fn fund_with_vault_deposits_everything() {
    let s = Setup::new();
    let vault = s.mock_vault();

    let escrow = s.funded_vault_escrow(&vault.address);

    let data = escrow.get_escrow();
    assert_eq!(data.status, Status::Active);
    assert_eq!(data.shares, AMOUNT);
    assert_eq!(vault.balance(&escrow.address), AMOUNT);
    assert_eq!(s.token.balance(&escrow.address), 0);
    assert_eq!(s.token.balance(&vault.address), AMOUNT);
}

// El inquilino firma solo fund_escrow + su transfer. El depósito en el vault lo autoriza el
// propio escrow con authorize_as_current_contract: sin mock_all_auths, falla si sobra o falta.
#[test]
fn deposit_with_exact_contract_auth() {
    let s = Setup::new();
    let vault = s.mock_vault();
    let terms = s.vault_terms(&vault.address);
    let escrow = s.register(EscrowInit {
        terms: terms.clone(),
        tenant: None,
        invite_hash: Some(s.invite_hash()),
    });
    let code = Some(s.invite_code());

    s.env.mock_auths(&[MockAuth {
        address: &s.tenant,
        invoke: &MockAuthInvoke {
            contract: &escrow.address,
            fn_name: "fund_escrow",
            args: (s.tenant.clone(), code.clone(), terms.clone()).into_val(&s.env),
            sub_invokes: &[MockAuthInvoke {
                contract: &s.token.address,
                fn_name: "transfer",
                args: (s.tenant.clone(), escrow.address.clone(), AMOUNT).into_val(&s.env),
                sub_invokes: &[],
            }],
        },
    }]);
    escrow.fund_escrow(&s.tenant, &code, &terms);

    assert_eq!(vault.balance(&escrow.address), AMOUNT);
}

#[test]
fn fund_rejects_vault_fee_increase() {
    let s = Setup::new();
    let vault = s.mock_vault();
    let terms = s.vault_terms(&vault.address);
    let escrow = s.register(EscrowInit {
        terms: terms.clone(),
        tenant: Some(s.tenant.clone()),
        invite_hash: None,
    });

    for (vault_fee, protocol_fee) in [(101, 2_000), (100, 2_001)] {
        vault.set_fees(&vault_fee, &protocol_fee);
        let res = escrow.try_fund_escrow(&s.tenant, &None, &terms);
        assert_eq!(res, Err(Ok(EscrowError::VaultFeeChanged)));
    }
    assert_eq!(s.token.balance(&s.tenant), AMOUNT * 2);
}

#[test]
fn fund_allows_vault_fee_decrease() {
    let s = Setup::new();
    let vault = s.mock_vault();
    vault.set_fees(&50, &1_000);

    s.funded_vault_escrow(&vault.address);
}

#[test]
fn fund_noyield_keeps_principal_liquid() {
    let s = Setup::new();
    let escrow = s.funded_escrow();

    assert_eq!(escrow.get_escrow().shares, 0);
    assert_eq!(s.token.balance(&escrow.address), AMOUNT);
}

#[test]
fn fund_fails_when_vault_is_down() {
    let s = Setup::new();
    let vault = s.mock_vault();
    let terms = s.vault_terms(&vault.address);
    let escrow = s.register(EscrowInit {
        terms: terms.clone(),
        tenant: Some(s.tenant.clone()),
        invite_hash: None,
    });
    vault.set_broken(&true);

    let res = escrow.try_fund_escrow(&s.tenant, &None, &terms);
    assert_eq!(res, Err(Ok(EscrowError::VaultError)));
    assert_eq!(escrow.get_escrow().status, Status::Proposed);
}

// Camino feliz de la demo (MVP Portugal): la fianza entera al inquilino; del rendimiento,
// el 20 % a la plataforma y el resto al casero.
#[test]
fn yield_is_split_on_release() {
    let s = Setup::new();
    let vault = s.mock_vault();
    let escrow = s.funded_vault_escrow(&vault.address);
    s.token_sac.mint(&vault.address, &500_000_000); // +10 %
    assert_eq!(escrow.accrued_yield(), 500_000_000);
    let tenant_before = s.token.balance(&s.tenant);

    escrow.approve_release(&s.landlord);
    let settlement = escrow.approve_release(&s.tenant).unwrap();

    assert_eq!(settlement.total, AMOUNT + 500_000_000);
    assert_eq!(s.token.balance(&s.tenant) - tenant_before, AMOUNT);
    assert_eq!(s.token.balance(&s.treasury), 100_000_000);
    assert_eq!(s.token.balance(&s.landlord), 400_000_000);
    assert_eq!(s.token.balance(&escrow.address), 0);
    assert_eq!(vault.balance(&escrow.address), 0);
    assert_eq!(escrow.get_escrow().shares, 0);
}

// Pérdida del vault: va contra el inquilino (no hay rendimiento que la absorba) y nadie cobra
// comisión. La salida no se bloquea (withdraw con mínimo 0).
#[test]
fn vault_loss_does_not_block_release() {
    let s = Setup::new();
    let vault = s.mock_vault();
    let escrow = s.funded_vault_escrow(&vault.address);
    vault.lose(&250_000_000); // −5 %
    let tenant_before = s.token.balance(&s.tenant);

    escrow.approve_release(&s.tenant);
    let settlement = escrow.approve_release(&s.landlord).unwrap();

    assert_eq!(settlement.total, AMOUNT - 250_000_000);
    assert_eq!(settlement.yield_total, 0);
    assert_eq!(
        s.token.balance(&s.tenant) - tenant_before,
        AMOUNT - 250_000_000
    );
    assert_eq!(s.token.balance(&s.treasury), 0);
    assert_eq!(s.token.balance(&s.landlord), 0);
}

#[test]
fn tw_fee_paid_only_when_receiver_and_positive() {
    let s = Setup::new();
    let vault = s.mock_vault();
    let tw = soroban_sdk::Address::generate(&s.env);
    let mut terms = s.vault_terms(&vault.address);
    terms.tw_fee_bps = 30;
    terms.tw_fee_receiver = Some(tw.clone());
    let escrow = s.register(EscrowInit {
        terms: terms.clone(),
        tenant: Some(s.tenant.clone()),
        invite_hash: None,
    });
    escrow.fund_escrow(&s.tenant, &None, &terms);
    s.token_sac.mint(&vault.address, &1_000_000_000);

    escrow.approve_release(&s.tenant);
    let settlement = escrow.approve_release(&s.landlord).unwrap();

    assert_eq!(settlement.to_tw, 3_000_000); // 0,3 % del rendimiento
    assert_eq!(s.token.balance(&tw), 3_000_000);
}

#[test]
fn reads_survive_vault_failure() {
    let s = Setup::new();
    let vault = s.mock_vault();
    let escrow = s.funded_vault_escrow(&vault.address);
    s.token_sac.mint(&vault.address, &100);
    vault.set_broken(&true);

    assert_eq!(escrow.accrued_yield(), 0);
    let view = escrow.get_view();
    assert_eq!(view.accrued_yield, 0);
    assert_eq!(view.status, Status::Active);
    escrow.get_terms();
    escrow.get_roles();
}

#[test]
fn preview_settlement_matches_release() {
    let s = Setup::new();
    let vault = s.mock_vault();
    let escrow = s.funded_vault_escrow(&vault.address);
    s.token_sac.mint(&vault.address, &500_000_000);

    let preview = escrow.preview_settlement(&0);
    assert_eq!(preview.to_tenant, AMOUNT);
    assert_eq!(preview.to_landlord, 400_000_000);
    // La deducción se recorta a lo que vuelve del principal.
    assert_eq!(escrow.preview_settlement(&(AMOUNT * 2)).deduction, AMOUNT);
    assert_eq!(
        escrow.try_preview_settlement(&-1),
        Err(Ok(EscrowError::InvalidAmount))
    );

    escrow.approve_release(&s.landlord);
    assert_eq!(escrow.approve_release(&s.tenant), Some(preview));
}

#[test]
fn release_after_end_ts_still_works() {
    let s = Setup::new();
    let vault = s.mock_vault();
    let escrow = s.funded_vault_escrow(&vault.address);
    s.env.ledger().set_timestamp(END_TS + 1);

    escrow.approve_release(&s.landlord);
    assert!(escrow.approve_release(&s.tenant).is_some());
}
