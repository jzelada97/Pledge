extern crate std;

use crate::error::EscrowError;
use crate::storage::types::Status;
use crate::tests::helpers::{Setup, AMOUNT, END_TS};
use soroban_sdk::testutils::{Address as _, AuthorizedFunction, AuthorizedInvocation, Ledger};
use soroban_sdk::{symbol_short, Address, BytesN, IntoVal, Symbol};

#[test]
fn fund_with_invite_moves_amount_and_activates() {
    let s = Setup::new();
    let escrow = s.escrow_with_invite();

    let shares = escrow.fund_escrow(&s.tenant, &Some(s.invite_code()), &s.terms());

    assert_eq!(shares, 0);
    assert_eq!(s.token.balance(&escrow.address), AMOUNT);
    assert_eq!(s.token.balance(&s.tenant), AMOUNT);
    let data = escrow.get_escrow();
    assert_eq!(data.status, Status::Active);
    assert_eq!(data.tenant, Some(s.tenant.clone()));
    assert_eq!(s.factory.tenant_of(&1), Some(s.tenant.clone()));
}

#[test]
fn fund_with_fixed_tenant_needs_no_code() {
    let s = Setup::new();
    let escrow = s.escrow_with_tenant();

    escrow.fund_escrow(&s.tenant, &None, &s.terms());

    assert_eq!(escrow.get_escrow().status, Status::Active);
    assert_eq!(s.token.balance(&escrow.address), AMOUNT);
}

// WEB-3: la passkey del inquilino firma fund_escrow con UNA sola subinvocación,
// token.transfer(tenant, escrow, amount). Las llamadas a la factory no piden su firma.
#[test]
fn fund_auth_tree_is_only_tenant_transfer() {
    let s = Setup::new();
    let escrow = s.escrow_with_invite();
    let code = Some(s.invite_code());

    escrow.fund_escrow(&s.tenant, &code, &s.terms());

    assert_eq!(
        s.env.auths(),
        std::vec![(
            s.tenant.clone(),
            AuthorizedInvocation {
                function: AuthorizedFunction::Contract((
                    escrow.address.clone(),
                    Symbol::new(&s.env, "fund_escrow"),
                    (s.tenant.clone(), code, s.terms()).into_val(&s.env),
                )),
                sub_invocations: std::vec![AuthorizedInvocation {
                    function: AuthorizedFunction::Contract((
                        s.token.address.clone(),
                        symbol_short!("transfer"),
                        (s.tenant.clone(), escrow.address.clone(), AMOUNT).into_val(&s.env),
                    )),
                    sub_invocations: std::vec![],
                }],
            }
        )]
    );
}

#[test]
fn fund_rejects_wrong_invite_code() {
    let s = Setup::new();
    let escrow = s.escrow_with_invite();
    let wrong = BytesN::from_array(&s.env, &[8u8; 32]);

    let res = escrow.try_fund_escrow(&s.tenant, &Some(wrong), &s.terms());
    assert_eq!(res, Err(Ok(EscrowError::InvalidInvite)));

    let res = escrow.try_fund_escrow(&s.tenant, &None, &s.terms());
    assert_eq!(res, Err(Ok(EscrowError::InvalidInvite)));
}

#[test]
fn fund_rejects_other_tenant_when_fixed() {
    let s = Setup::new();
    let escrow = s.escrow_with_tenant();
    let intruder = Address::generate(&s.env);

    let res = escrow.try_fund_escrow(&intruder, &None, &s.terms());
    assert_eq!(res, Err(Ok(EscrowError::NotParty)));
}

#[test]
fn fund_rejects_terms_mismatch() {
    let s = Setup::new();
    let escrow = s.escrow_with_invite();
    let mut other = s.terms();
    other.platform_fee_bps = 5_000;

    let res = escrow.try_fund_escrow(&s.tenant, &Some(s.invite_code()), &other);
    assert_eq!(res, Err(Ok(EscrowError::TermsMismatch)));
}

#[test]
fn fund_rejects_landlord_as_tenant() {
    let s = Setup::new();
    let escrow = s.escrow_with_invite();

    let res = escrow.try_fund_escrow(&s.landlord, &Some(s.invite_code()), &s.terms());
    assert_eq!(res, Err(Ok(EscrowError::SameParty)));
}

#[test]
fn fund_rejects_system_role_as_tenant() {
    let s = Setup::new();
    let escrow = s.escrow_with_invite();
    let code = Some(s.invite_code());

    for party in [&s.treasury, &s.staff, &s.factory.address] {
        let res = escrow.try_fund_escrow(party, &code, &s.terms());
        assert_eq!(res, Err(Ok(EscrowError::InvalidParty)));
    }
}

#[test]
fn fund_rejects_when_factory_paused() {
    let s = Setup::new();
    let escrow = s.escrow_with_invite();
    s.factory.set_allowed(&false);

    let res = escrow.try_fund_escrow(&s.tenant, &Some(s.invite_code()), &s.terms());
    assert_eq!(res, Err(Ok(EscrowError::Paused)));
}

#[test]
fn fund_reverts_when_factory_call_fails() {
    let s = Setup::new();
    let escrow = s.escrow_with_invite();
    s.factory.set_fail(&true);

    let res = escrow.try_fund_escrow(&s.tenant, &Some(s.invite_code()), &s.terms());
    assert_eq!(res, Err(Ok(EscrowError::FactoryCall)));
    assert_eq!(s.token.balance(&escrow.address), 0);
    assert_eq!(escrow.get_escrow().status, Status::Proposed);
}

#[test]
fn fund_twice_is_bad_status() {
    let s = Setup::new();
    let escrow = s.escrow_with_invite();
    let code = Some(s.invite_code());
    escrow.fund_escrow(&s.tenant, &code, &s.terms());

    let res = escrow.try_fund_escrow(&s.tenant, &code, &s.terms());
    assert_eq!(res, Err(Ok(EscrowError::BadStatus)));
}

#[test]
fn fund_after_end_ts_is_rejected() {
    let s = Setup::new();
    let escrow = s.escrow_with_invite();
    s.env.ledger().set_timestamp(END_TS);

    let res = escrow.try_fund_escrow(&s.tenant, &Some(s.invite_code()), &s.terms());
    assert_eq!(res, Err(Ok(EscrowError::InvalidEndTs)));
}
