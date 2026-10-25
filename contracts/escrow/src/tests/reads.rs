use soroban_sdk::testutils::Ledger;
use soroban_sdk::vec;

use crate::storage::types::Status;
use crate::tests::helpers::{Setup, END_TS};

#[test]
fn ending_is_derived_not_stored() {
    let s = Setup::new();
    let escrow = s.funded_escrow();
    s.env.ledger().set_timestamp(END_TS);

    assert_eq!(escrow.get_view().status, Status::Ending);
    assert_eq!(escrow.get_escrow().status, Status::Active);
}

#[test]
fn get_view_has_deadlines() {
    let s = Setup::new();
    let escrow = s.funded_escrow();

    let view = escrow.get_view();
    assert_eq!(view.status, Status::Active);
    assert_eq!(view.timeout_at, END_TS + s.terms().timeout_secs);
    assert_eq!(view.review_deadline, 0);
    assert_eq!(view.accrued_yield, 0);
    assert_eq!(view.data, escrow.get_escrow());
}

#[test]
fn get_roles_has_tw_v2_shape() {
    let s = Setup::new();
    let escrow = s.escrow_with_invite();
    let roles = escrow.get_roles();
    assert_eq!(roles.approvers, vec![&s.env, s.landlord.clone()]);
    assert_eq!(roles.receiver, None);

    escrow.fund_escrow(&s.tenant, &Some(s.invite_code()), &s.terms());
    let roles = escrow.get_roles();
    assert_eq!(
        roles.approvers,
        vec![&s.env, s.landlord.clone(), s.tenant.clone()]
    );
    assert_eq!(roles.release_signers, roles.approvers);
    assert_eq!(roles.service_providers, vec![&s.env, s.landlord.clone()]);
    assert_eq!(roles.platform, s.treasury);
    assert_eq!(roles.dispute_resolvers, vec![&s.env, s.staff.clone()]);
    assert_eq!(roles.receiver, Some(s.tenant.clone()));
    assert_eq!(roles.admin, s.factory.address);
    assert!(roles.observers.is_empty());
}
