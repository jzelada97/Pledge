extern crate std;

use soroban_sdk::testutils::{Address as _, AuthorizedFunction, AuthorizedInvocation, Events};
use soroban_sdk::{symbol_short, vec, Address, BytesN, Event, IntoVal, Symbol};

use crate::error::FactoryError;
use crate::escrow;
use crate::events::FCreated;
use crate::test::setup::{no_args, Setup, AMOUNT, NOW};

#[test]
fn create_requires_landlord_auth() {
    let s = Setup::new();
    // Firma el inquilino, no el casero.
    s.sign_as(&s.tenant, "create_fianza", no_args(&s.env));

    assert!(s
        .factory
        .try_create_fianza(&s.landlord, &s.params(1))
        .is_err());
    assert_eq!(s.factory.count(), 0);
}

#[test]
fn create_auth_tree_has_no_subinvocations() {
    let s = Setup::new();
    let p = s.params(1);

    s.factory.create_fianza(&s.landlord, &p);

    assert_eq!(
        s.env.auths(),
        std::vec![(
            s.landlord.clone(),
            AuthorizedInvocation {
                function: AuthorizedFunction::Contract((
                    s.factory.address.clone(),
                    Symbol::new(&s.env, "create_fianza"),
                    (s.landlord.clone(), p).into_val(&s.env),
                )),
                sub_invocations: std::vec![],
            }
        )]
    );
}

#[test]
fn predict_address_matches_deployed() {
    let s = Setup::new();
    let p = s.params(1);
    let predicted = s.factory.predict_address(&s.landlord, &p.nonce);

    let created = s.factory.create_fianza(&s.landlord, &p);

    assert_eq!(created.escrow, predicted);
    assert_eq!(s.factory.escrow_of(&created.id), predicted);
    assert_eq!(s.factory.id_of(&predicted), created.id);
}

#[test]
fn salt_binds_landlord() {
    let s = Setup::new();
    let other = Address::generate(&s.env);
    let nonce = BytesN::from_array(&s.env, &[1u8; 32]);
    assert_ne!(
        s.factory.predict_address(&s.landlord, &nonce),
        s.factory.predict_address(&other, &nonce)
    );

    let a = s.factory.create_fianza(&s.landlord, &s.params(1));
    let b = s.factory.create_fianza(&other, &s.params(1));

    assert_ne!(a.escrow, b.escrow);
    assert_eq!((a.id, b.id), (1, 2));
}

#[test]
fn nonce_reuse_fails() {
    let s = Setup::new();
    s.factory.create_fianza(&s.landlord, &s.params(1));

    let res = s.factory.try_create_fianza(&s.landlord, &s.params(1));
    assert_eq!(res, Err(Ok(FactoryError::NonceUsed)));
    assert_eq!(s.factory.count(), 1);
}

#[test]
fn created_returns_wasm_hash() {
    let s = Setup::new();

    let created = s.factory.create_fianza(&s.landlord, &s.params(1));
    // events() refleja la última llamada: se leen antes de cualquier otra.
    let events = s.env.events().all().filter_by_contract(&s.factory.address);

    assert_eq!(created.wasm_hash, s.factory.escrow_wasm_hash());
    let expected = FCreated {
        id: created.id,
        escrow: created.escrow.clone(),
        landlord: s.landlord.clone(),
        amount: AMOUNT,
        strategy_id: symbol_short!("custody"),
        defindex_vault_fee_bps: 0,
        defindex_protocol_fee_bps: 0,
        wasm_hash: created.wasm_hash.clone(),
    }
    .to_xdr(&s.env, &s.factory.address);
    assert!(events.events().contains(&expected));
}

#[test]
fn create_validates_params() {
    let s = Setup::new();
    let try_create = |p| s.factory.try_create_fianza(&s.landlord, &p);

    let mut p = s.params(1);
    p.amount = 0;
    assert_eq!(try_create(p), Err(Ok(FactoryError::InvalidAmount)));

    let mut p = s.params(1);
    p.amount = 1_000_000_000_000_001;
    assert_eq!(try_create(p), Err(Ok(FactoryError::InvalidAmount)));

    let mut p = s.params(1);
    p.end_ts = NOW;
    assert_eq!(try_create(p), Err(Ok(FactoryError::InvalidEndTs)));

    let mut p = s.params(1);
    p.end_ts = NOW + 3 * 365 * 86_400 + 1;
    assert_eq!(try_create(p), Err(Ok(FactoryError::InvalidEndTs)));

    // Los dos (inquilino e invitación) o ninguno.
    let mut p = s.params(1);
    p.tenant = Some(s.tenant.clone());
    assert_eq!(try_create(p), Err(Ok(FactoryError::InvalidInvite)));
    let mut p = s.params(1);
    p.invite_hash = None;
    assert_eq!(try_create(p), Err(Ok(FactoryError::InvalidInvite)));

    let mut p = s.params(1);
    p.invite_hash = None;
    p.tenant = Some(s.landlord.clone());
    assert_eq!(try_create(p), Err(Ok(FactoryError::SameParty)));

    for party in [&s.treasury, &s.staff, &s.factory.address, &s.token.address] {
        let res = s.factory.try_create_fianza(party, &s.params(1));
        assert_eq!(res, Err(Ok(FactoryError::InvalidParty)));
        let mut p = s.params(1);
        p.invite_hash = None;
        p.tenant = Some(party.clone());
        assert_eq!(try_create(p), Err(Ok(FactoryError::InvalidParty)));
    }

    let mut p = s.params(1);
    p.strategy_id = Some(symbol_short!("nope"));
    assert_eq!(try_create(p), Err(Ok(FactoryError::StrategyNotFound)));
    assert_eq!(s.factory.count(), 0);
}

// FAC-6: el admin cambia la config entre que el casero la lee y firma.
#[test]
fn create_rejects_stale_config_version() {
    let s = Setup::new();
    let p = s.params(1);
    let mut config = s.factory.config();
    config.platform_fee_bps = 5_000;
    s.factory.set_config(&config);

    let res = s.factory.try_create_fianza(&s.landlord, &p);
    assert_eq!(res, Err(Ok(FactoryError::ConfigChanged)));
    // Con la versión nueva, sí.
    s.factory.create_fianza(&s.landlord, &s.params(1));
}

#[test]
fn create_copies_config_snapshot_into_terms() {
    let s = Setup::new();
    let vault = s.mock_vault(100, 2_000);
    s.enable_vault_strategy(symbol_short!("vault"), &vault.address, 1_000);
    let mut p = s.params(1);
    p.strategy_id = Some(symbol_short!("vault"));
    p.expected_config_version = s.factory.config_version();

    let created = s.factory.create_fianza(&s.landlord, &p);

    let config = s.factory.config();
    let terms = escrow::Client::new(&s.env, &created.escrow).get_terms();
    assert_eq!(terms.factory, s.factory.address);
    assert_eq!(terms.id, created.id);
    assert_eq!(terms.landlord, s.landlord);
    assert_eq!(terms.amount, AMOUNT);
    assert_eq!(terms.tenant_yield_bps, config.tenant_yield_bps);
    assert_eq!(terms.platform_fee_bps, config.platform_fee_bps);
    assert_eq!(terms.tw_fee_bps, config.tw_fee_bps);
    assert_eq!(terms.tw_fee_receiver, config.tw_fee_receiver);
    assert_eq!(terms.treasury, config.treasury);
    assert_eq!(terms.dispute_resolvers, config.staff);
    assert_eq!(terms.timeout_secs, config.timeout_secs);
    assert_eq!(terms.review_timeout_secs, config.review_timeout_secs);
    assert_eq!(terms.stop_bond, 250_000_000); // 5 % de 500 USDC > mínimo de 10 USDC
    assert_eq!(terms.strategy, s.factory.strategy(&symbol_short!("vault")));
    assert_eq!(terms.defindex_vault_fee_bps, 100);
    assert_eq!(terms.defindex_protocol_fee_bps, 2_000);
}

#[test]
fn config_change_does_not_affect_existing() {
    let s = Setup::new();
    let created = s.factory.create_fianza(&s.landlord, &s.params(1));
    let escrow = escrow::Client::new(&s.env, &created.escrow);
    let before = escrow.get_terms();

    let mut config = s.factory.config();
    config.platform_fee_bps = 1_000;
    config.staff = vec![&s.env, Address::generate(&s.env)];
    config.timeout_secs = 600;
    s.factory.set_config(&config);
    s.factory
        .set_escrow_wasm_hash(&BytesN::from_array(&s.env, &[9u8; 32]));

    assert_eq!(escrow.get_terms(), before);
    assert_eq!(s.factory.escrow_of(&created.id), created.escrow);
    assert_ne!(s.factory.escrow_wasm_hash(), created.wasm_hash);
}
