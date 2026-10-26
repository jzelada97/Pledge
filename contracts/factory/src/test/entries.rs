use soroban_sdk::symbol_short;

use crate::error::FactoryError;
use crate::escrow::{self, EscrowError, Status};
use crate::test::setup::Setup;

// La pausa bloquea las entradas (crear y fondear) y nunca las salidas. Hoy la única salida
// del escrow es `cancel`; approve_release, resolve y los claims se añaden a este test
// cuando existan (fases 3b y 5).
#[test]
fn pause_blocks_only_entries() {
    let s = Setup::new();
    let to_fund = s.factory.create_fianza(&s.landlord, &s.params(1));
    let to_cancel = s.factory.create_fianza(&s.landlord, &s.params(2));
    s.factory.pause();

    let res = s.factory.try_create_fianza(&s.landlord, &s.params(3));
    assert_eq!(res, Err(Ok(FactoryError::Paused)));
    assert!(!s.factory.funding_allowed(&symbol_short!("custody")));

    let escrow = escrow::Client::new(&s.env, &to_fund.escrow);
    let res = escrow.try_fund_escrow(&s.tenant, &Some(s.code()), &escrow.get_terms());
    assert_eq!(res, Err(Ok(EscrowError::Paused)));

    let escrow = escrow::Client::new(&s.env, &to_cancel.escrow);
    escrow.cancel();
    assert_eq!(escrow.get_escrow().status, Status::Cancelled);

    s.factory.unpause();
    s.factory.create_fianza(&s.landlord, &s.params(3));
}

#[test]
#[ignore = "necesita approve_release, resolve y los claims del escrow (fases 3b y 5)"]
fn disabled_strategy_does_not_block_exits() {
    todo!()
}
