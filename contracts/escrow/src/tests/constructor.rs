use crate::storage::types::{EscrowInit, Status};
use crate::tests::helpers::{Setup, AMOUNT, NOW};
use soroban_sdk::vec;

#[test]
fn constructor_stores_proposed_escrow() {
    let s = Setup::new();
    let escrow = s.escrow_with_invite();

    let data = escrow.get_escrow();
    assert_eq!(data.status, Status::Proposed);
    assert_eq!(data.terms, s.terms());
    assert_eq!(data.tenant, None);
    assert_eq!(data.invite_hash, Some(s.invite_hash()));
    assert_eq!(data.approvals.target, 2);
    assert_eq!(data.approvals.approval_count, 0);
    assert_eq!(data.created_ts, NOW);
    assert_eq!(escrow.get_terms(), s.terms());
}

#[test]
#[should_panic(expected = "Error(Contract, #9)")]
fn constructor_rejects_tenant_and_invite_together() {
    let s = Setup::new();
    s.register(EscrowInit {
        terms: s.terms(),
        tenant: Some(s.tenant.clone()),
        invite_hash: Some(s.invite_hash()),
    });
}

#[test]
#[should_panic(expected = "Error(Contract, #9)")]
fn constructor_rejects_neither_tenant_nor_invite() {
    let s = Setup::new();
    s.register(EscrowInit {
        terms: s.terms(),
        tenant: None,
        invite_hash: None,
    });
}

#[test]
#[should_panic(expected = "Error(Contract, #6)")]
fn constructor_rejects_zero_amount() {
    let s = Setup::new();
    let mut terms = s.terms();
    terms.amount = 0;
    s.register(EscrowInit {
        terms,
        tenant: Some(s.tenant.clone()),
        invite_hash: None,
    });
}

#[test]
#[should_panic(expected = "Error(Contract, #12)")]
fn constructor_rejects_past_end_ts() {
    let s = Setup::new();
    let mut terms = s.terms();
    terms.end_ts = NOW;
    s.register(EscrowInit {
        terms,
        tenant: Some(s.tenant.clone()),
        invite_hash: None,
    });
}

#[test]
#[should_panic(expected = "Error(Contract, #5)")]
fn constructor_rejects_fees_over_100_percent() {
    let s = Setup::new();
    let mut terms = s.terms();
    terms.platform_fee_bps = 9_000;
    terms.tw_fee_bps = 2_000;
    terms.tw_fee_receiver = Some(s.staff.clone());
    s.register(EscrowInit {
        terms,
        tenant: Some(s.tenant.clone()),
        invite_hash: None,
    });
}

#[test]
#[should_panic(expected = "Error(Contract, #23)")]
fn constructor_rejects_duplicate_resolvers() {
    let s = Setup::new();
    let mut terms = s.terms();
    terms.dispute_resolvers = vec![&s.env, s.staff.clone(), s.staff.clone()];
    s.register(EscrowInit {
        terms,
        tenant: Some(s.tenant.clone()),
        invite_hash: None,
    });
}

#[test]
#[should_panic(expected = "Error(Contract, #6)")]
fn constructor_rejects_bond_over_amount() {
    let s = Setup::new();
    let mut terms = s.terms();
    terms.stop_bond = AMOUNT + 1;
    s.register(EscrowInit {
        terms,
        tenant: Some(s.tenant.clone()),
        invite_hash: None,
    });
}
