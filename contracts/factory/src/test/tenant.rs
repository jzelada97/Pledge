extern crate std;

use soroban_sdk::testutils::{Address as _, AuthorizedFunction, AuthorizedInvocation, Ledger};
use soroban_sdk::{symbol_short, vec, Address, IntoVal, Symbol, Vec};

use crate::error::FactoryError;
use crate::escrow::{self, Status};
use crate::test::setup::{no_args, Impostor, ImpostorClient, Setup, AMOUNT, END_TS};

/// Crea la fianza 1 y la fondea el inquilino con el código de invitación.
fn funded(s: &Setup) -> Address {
    let created = s.factory.create_fianza(&s.landlord, &s.params(1));
    let escrow = escrow::Client::new(&s.env, &created.escrow);
    escrow.fund_escrow(&s.tenant, &Some(s.code()), &escrow.get_terms());
    created.escrow
}

// WEB-3 con la factory real: la passkey del inquilino solo firma fund_escrow y su
// token.transfer; register_tenant lo autoriza el escrow como invocador.
#[test]
fn fund_auth_tree_with_real_factory() {
    let s = Setup::new();
    let created = s.factory.create_fianza(&s.landlord, &s.params(1));
    let escrow = escrow::Client::new(&s.env, &created.escrow);
    let terms = escrow.get_terms();
    let code = Some(s.code());

    escrow.fund_escrow(&s.tenant, &code, &terms);

    assert_eq!(
        s.env.auths(),
        std::vec![(
            s.tenant.clone(),
            AuthorizedInvocation {
                function: AuthorizedFunction::Contract((
                    created.escrow.clone(),
                    Symbol::new(&s.env, "fund_escrow"),
                    (s.tenant.clone(), code, terms).into_val(&s.env),
                )),
                sub_invocations: std::vec![AuthorizedInvocation {
                    function: AuthorizedFunction::Contract((
                        s.token.address.clone(),
                        symbol_short!("transfer"),
                        (s.tenant.clone(), created.escrow.clone(), AMOUNT).into_val(&s.env),
                    )),
                    sub_invocations: std::vec![],
                }],
            }
        )]
    );
}

#[test]
fn register_tenant_rejects_impostor() {
    let s = Setup::new();
    s.factory.create_fianza(&s.landlord, &s.params(1));
    let impostor = ImpostorClient::new(&s.env, &s.env.register(Impostor, ()));
    let victim = Address::generate(&s.env);
    s.env.set_auths(&[]);

    let res = impostor.try_attack(&s.factory.address, &1, &victim);

    assert!(res.is_err());
    assert_eq!(s.factory.count_by_tenant(&victim), 0);
}

#[test]
fn register_tenant_rejects_direct_call() {
    let s = Setup::new();
    s.factory.create_fianza(&s.landlord, &s.params(1));
    s.sign_as(&s.tenant, "register_tenant", no_args(&s.env));

    assert!(s.factory.try_register_tenant(&1, &s.tenant).is_err());
    assert_eq!(s.factory.count_by_tenant(&s.tenant), 0);
}

#[test]
fn register_tenant_once() {
    let s = Setup::new();
    funded(&s);

    // Aunque el escrow volviera a llamar, el inquilino ya está registrado.
    let res = s.factory.try_register_tenant(&1, &s.tenant);
    assert_eq!(res, Err(Ok(FactoryError::AlreadyRegistered)));
    assert_eq!(
        s.factory.try_register_tenant(&2, &s.tenant),
        Err(Ok(FactoryError::NotFound))
    );
    assert_eq!(s.factory.count_by_tenant(&s.tenant), 1);
}

#[test]
fn indexes_only_self() {
    let s = Setup::new();
    let other = Address::generate(&s.env);
    s.factory.create_fianza(&s.landlord, &s.params(1));
    s.factory.create_fianza(&other, &s.params(2));
    s.factory.create_fianza(&s.landlord, &s.params(3));

    assert_eq!(
        s.factory.list_by_landlord(&s.landlord, &0, &10),
        vec![&s.env, 1u64, 3u64]
    );
    assert_eq!(
        s.factory.list_by_landlord(&other, &0, &10),
        vec![&s.env, 2u64]
    );
    // El inquilino solo entra en el índice cuando su escrow lo registra al fondear.
    assert_eq!(s.factory.count_by_tenant(&s.tenant), 0);
    let escrow = escrow::Client::new(&s.env, &s.factory.escrow_of(&1));
    escrow.fund_escrow(&s.tenant, &Some(s.code()), &escrow.get_terms());
    assert_eq!(
        s.factory.list_by_tenant(&s.tenant, &0, &10),
        vec![&s.env, 1u64]
    );
    assert_eq!(s.factory.count_by_tenant(&other), 0);
}

#[test]
fn pagination_limits() {
    let s = Setup::new();
    for n in 1..=3u8 {
        s.factory.create_fianza(&s.landlord, &s.params(n));
    }
    assert_eq!(s.factory.count_by_landlord(&s.landlord), 3);
    assert_eq!(
        s.factory.list_by_landlord(&s.landlord, &1, &10),
        vec![&s.env, 2u64, 3u64]
    );
    assert_eq!(
        s.factory.list_by_landlord(&s.landlord, &5, &10),
        Vec::<u64>::new(&s.env)
    );
    assert_eq!(s.factory.list_by_landlord(&s.landlord, &0, &50).len(), 3);
    assert_eq!(
        s.factory.try_list_by_landlord(&s.landlord, &0, &51),
        Err(Ok(FactoryError::TooMany))
    );
    assert_eq!(
        s.factory.try_list_by_tenant(&s.tenant, &0, &51),
        Err(Ok(FactoryError::TooMany))
    );
}

#[test]
fn get_fianzas_limits_and_skips_missing() {
    let s = Setup::new();
    funded(&s);

    let mut too_many = Vec::new(&s.env);
    for id in 1..=26u64 {
        too_many.push_back(id);
    }
    assert_eq!(
        s.factory.try_get_fianzas(&too_many),
        Err(Ok(FactoryError::TooMany))
    );

    let summaries = s.factory.get_fianzas(&vec![&s.env, 1u64, 99u64]);
    assert_eq!(summaries.len(), 1);
    let first = summaries.get(0).unwrap();
    assert_eq!((first.id, first.status), (1, Status::Active));
    assert_eq!(first.data.tenant, Some(s.tenant.clone()));

    // El estado es el efectivo: Ending al llegar al fin del contrato.
    s.env.ledger().set_timestamp(END_TS);
    let first = s.factory.get_fianzas(&vec![&s.env, 1u64]).get(0).unwrap();
    assert_eq!(first.status, Status::Ending);
    assert_eq!(first.data.status, Status::Active);
}
