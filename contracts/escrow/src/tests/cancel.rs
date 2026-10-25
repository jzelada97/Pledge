extern crate std;

use crate::error::EscrowError;
use crate::storage::types::Status;
use crate::tests::helpers::Setup;
use soroban_sdk::testutils::{AuthorizedFunction, AuthorizedInvocation};
use soroban_sdk::{IntoVal, Symbol};

#[test]
fn landlord_cancels_proposed_escrow() {
    let s = Setup::new();
    let escrow = s.escrow_with_invite();

    escrow.cancel();

    assert_eq!(
        s.env.auths(),
        std::vec![(
            s.landlord.clone(),
            AuthorizedInvocation {
                function: AuthorizedFunction::Contract((
                    escrow.address.clone(),
                    Symbol::new(&s.env, "cancel"),
                    ().into_val(&s.env),
                )),
                sub_invocations: std::vec![],
            }
        )]
    );
    assert_eq!(escrow.get_escrow().status, Status::Cancelled);
}

#[test]
#[should_panic(expected = "Error(Auth, InvalidAction)")]
fn cancel_without_landlord_auth_fails() {
    let s = Setup::new();
    let escrow = s.escrow_with_invite();
    s.env.set_auths(&[]);

    escrow.cancel();
}

#[test]
fn cancel_after_funding_is_bad_status() {
    let s = Setup::new();
    let escrow = s.escrow_with_invite();
    escrow.fund_escrow(&s.tenant, &Some(s.invite_code()), &s.terms());

    assert_eq!(escrow.try_cancel(), Err(Ok(EscrowError::BadStatus)));
}

#[test]
fn fund_after_cancel_is_bad_status() {
    let s = Setup::new();
    let escrow = s.escrow_with_invite();
    escrow.cancel();

    let res = escrow.try_fund_escrow(&s.tenant, &Some(s.invite_code()), &s.terms());
    assert_eq!(res, Err(Ok(EscrowError::BadStatus)));
}
