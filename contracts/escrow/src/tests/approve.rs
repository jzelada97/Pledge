extern crate std;

use soroban_sdk::testutils::{Address as _, AuthorizedFunction, AuthorizedInvocation, Events};
use soroban_sdk::{Address, Event, IntoVal, Symbol};

use crate::error::EscrowError;
use crate::events::handler::FzSettle;
use crate::storage::types::{SettlePath, Status};
use crate::tests::helpers::{Setup, AMOUNT};

#[test]
fn approve_order_independent() {
    for landlord_first in [true, false] {
        let s = Setup::new();
        let escrow = s.funded_escrow();
        let (first, second) = if landlord_first {
            (&s.landlord, &s.tenant)
        } else {
            (&s.tenant, &s.landlord)
        };

        assert_eq!(escrow.approve_release(first), None);
        assert_eq!(escrow.get_escrow().status, Status::Active);
        let settlement = escrow.approve_release(second).unwrap();

        assert_eq!(settlement.to_tenant, AMOUNT);
        let data = escrow.get_escrow();
        assert_eq!(
            (data.status, data.path),
            (Status::Settled, SettlePath::Approved)
        );
        assert_eq!(s.token.balance(&escrow.address), 0);
    }
}

#[test]
fn approve_twice_same_party_fails() {
    let s = Setup::new();
    let escrow = s.funded_escrow();
    escrow.approve_release(&s.landlord);

    let res = escrow.try_approve_release(&s.landlord);
    assert_eq!(res, Err(Ok(EscrowError::AlreadyApproved)));
    assert_eq!(escrow.get_escrow().approvals.approval_count, 1);
}

#[test]
fn approve_rejects_non_party() {
    let s = Setup::new();
    let escrow = s.funded_escrow();
    for other in [
        Address::generate(&s.env),
        s.treasury.clone(),
        s.staff.clone(),
    ] {
        assert_eq!(
            escrow.try_approve_release(&other),
            Err(Ok(EscrowError::NotParty))
        );
    }
}

#[test]
fn approve_requires_approver_auth() {
    let s = Setup::new();
    let escrow = s.funded_escrow();

    escrow.approve_release(&s.tenant);

    assert_eq!(
        s.env.auths(),
        std::vec![(
            s.tenant.clone(),
            AuthorizedInvocation {
                function: AuthorizedFunction::Contract((
                    escrow.address.clone(),
                    Symbol::new(&s.env, "approve_release"),
                    (s.tenant.clone(),).into_val(&s.env),
                )),
                sub_invocations: std::vec![],
            }
        )]
    );
}

#[test]
fn approved_by_subset_and_count_consistent() {
    let s = Setup::new();
    let escrow = s.funded_escrow();
    escrow.approve_release(&s.tenant);

    let approvals = escrow.get_escrow().approvals;
    assert_eq!(approvals.target, 2);
    assert_eq!(approvals.approval_count, approvals.approved_by.len());
    assert_eq!(approvals.approved_by.get(0), Some(s.tenant.clone()));
}

#[test]
fn cannot_approve_in_proposed() {
    let s = Setup::new();
    let escrow = s.escrow_with_tenant();
    assert_eq!(
        escrow.try_approve_release(&s.landlord),
        Err(Ok(EscrowError::BadStatus))
    );
}

#[test]
fn settled_is_terminal() {
    let s = Setup::new();
    let escrow = s.funded_escrow();
    escrow.approve_release(&s.landlord);
    escrow.approve_release(&s.tenant);

    assert_eq!(
        escrow.try_approve_release(&s.landlord),
        Err(Ok(EscrowError::BadStatus))
    );
    assert_eq!(escrow.try_cancel(), Err(Ok(EscrowError::BadStatus)));
    assert_eq!(
        escrow.try_fund_escrow(&s.tenant, &Some(s.invite_code()), &s.terms()),
        Err(Ok(EscrowError::BadStatus))
    );
    assert_eq!(
        escrow.try_preview_settlement(&0),
        Err(Ok(EscrowError::BadStatus))
    );
}

// CT-16: con NoYield se reparte `terms.amount`, nunca `balance(escrow)`.
#[test]
fn noyield_total_is_amount_not_balance() {
    let s = Setup::new();
    let escrow = s.funded_escrow();
    s.token_sac.mint(&escrow.address, &123); // tokens enviados de fuera

    escrow.approve_release(&s.landlord);
    let settlement = escrow.approve_release(&s.tenant).unwrap();

    assert_eq!(settlement.total, AMOUNT);
    assert_eq!(settlement.to_tenant, AMOUNT);
    assert_eq!(s.token.balance(&escrow.address), 123);
}

// La dirección del escrow se conoce antes de crearlo: alguien puede mandarle tokens antes.
#[test]
fn prefunded_predicted_address_does_not_change_split() {
    let s = Setup::new();
    let escrow = s.escrow_with_invite();
    s.token_sac.mint(&escrow.address, &1_000);
    escrow.fund_escrow(&s.tenant, &Some(s.invite_code()), &s.terms());

    escrow.approve_release(&s.tenant);
    let settlement = escrow.approve_release(&s.landlord).unwrap();

    assert_eq!(settlement.total, AMOUNT);
    assert_eq!((settlement.to_landlord, settlement.to_treasury), (0, 0));
}

#[test]
fn zero_amount_transfers_skipped() {
    let s = Setup::new();
    let escrow = s.funded_escrow();
    escrow.approve_release(&s.landlord);
    escrow.approve_release(&s.tenant);

    // Sin rendimiento: casero y tesorería no reciben ninguna transferencia (ni de 0).
    assert_eq!(s.token.balance(&s.landlord), 0);
    assert_eq!(s.token.balance(&s.treasury), 0);
    assert_eq!(s.token.balance(&s.tenant), AMOUNT * 2);
}

#[test]
fn settle_event_matches_balances() {
    let s = Setup::new();
    let vault = s.mock_vault();
    let escrow = s.funded_vault_escrow(&vault.address);
    s.token_sac.mint(&vault.address, &500_000_000); // 10 % de rendimiento
    escrow.approve_release(&s.landlord);

    let tenant_before = s.token.balance(&s.tenant);
    let settlement = escrow.approve_release(&s.tenant).unwrap();
    let events = s.env.events().all().filter_by_contract(&escrow.address);

    let expected = FzSettle {
        id: 1,
        settlement: settlement.clone(),
        path: SettlePath::Approved,
        vault_fees_at_settle: Some((100, 2_000)),
    }
    .to_xdr(&s.env, &escrow.address);
    assert!(events.events().contains(&expected));
    assert_eq!(
        s.token.balance(&s.tenant) - tenant_before,
        settlement.to_tenant
    );
    assert_eq!(s.token.balance(&s.landlord), settlement.to_landlord);
    assert_eq!(s.token.balance(&s.treasury), settlement.to_treasury);
}
