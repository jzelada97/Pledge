extern crate std;

use soroban_sdk::testutils::Address as _;
use soroban_sdk::{symbol_short, vec, Address, BytesN};

use crate::contract::FianzaFactory;
use crate::error::FactoryError;
use crate::escrow;
use crate::test::setup::{base_config, no_args, Setup};
use crate::types::GlobalConfig;

#[test]
fn set_config_validation() {
    let s = Setup::new();
    let base = s.factory.config();
    let other = Address::generate(&s.env);
    let invalid: std::vec::Vec<fn(&mut GlobalConfig, &Setup, &Address)> = std::vec![
        |c, _, _| c.platform_fee_bps = 5_001,
        |c, _, o| {
            c.platform_fee_bps = 5_000;
            c.tw_fee_bps = 5_001;
            c.tw_fee_receiver = Some(o.clone());
        },
        |c, _, _| c.tw_fee_bps = 30, // sin receptor
        |c, _, _| c.stop_bond_bps = 2_001,
        |c, _, _| c.tenant_yield_bps = 10_001,
        |c, _, _| c.timeout_secs = 59,
        |c, _, _| c.review_timeout_secs = 59,
        |c, _, _| c.stop_bond_min = -1,
        |c, _, _| c.stop_bond_min = 1_000_000_000_000_001,
        |c, s, _| c.staff = soroban_sdk::Vec::new(&s.env),
        |c, s, _| {
            c.staff = vec![
                &s.env,
                Address::generate(&s.env),
                Address::generate(&s.env),
                Address::generate(&s.env),
                Address::generate(&s.env),
            ]
        },
        |c, s, _| c.staff = vec![&s.env, s.staff.clone(), s.staff.clone()],
        |c, s, _| c.staff = vec![&s.env, s.staff.clone(), s.treasury.clone()],
        |c, s, _| c.staff = vec![&s.env, s.factory.address.clone()],
        |c, s, _| c.treasury = s.factory.address.clone(),
        |c, _, o| c.token = o.clone(), // el token es inmutable
    ];

    for (i, change) in invalid.iter().enumerate() {
        let mut config = base.clone();
        change(&mut config, &s, &other);
        let res = s.factory.try_set_config(&config);
        assert_eq!(res, Err(Ok(FactoryError::InvalidConfig)), "regla {i}");
    }
    assert_eq!(s.factory.config(), base);
}

#[test]
#[should_panic(expected = "Error(Contract, #3)")]
fn constructor_rejects_invalid_config() {
    let s = Setup::new();
    let mut config = base_config(&s.env, &s.token.address, &s.treasury, &s.staff);
    config.treasury = s.staff.clone();
    let wasm_hash = s.env.deployer().upload_contract_wasm(escrow::WASM);
    s.env
        .register(FianzaFactory, (s.admin.clone(), wasm_hash, config));
}

#[test]
fn admin_fns_require_admin() {
    let s = Setup::new();
    let custody = symbol_short!("custody");
    let mut other = s.custody();
    other.id = symbol_short!("other");
    let config = s.factory.config();
    let hash = BytesN::from_array(&s.env, &[9u8; 32]);
    let version = s.factory.config_version();

    for intruder in [&s.staff, &s.landlord, &s.treasury] {
        s.sign_as(intruder, "set_config", no_args(&s.env));
        assert!(s.factory.try_set_config(&config).is_err());
        s.sign_as(intruder, "set_escrow_wasm_hash", no_args(&s.env));
        assert!(s.factory.try_set_escrow_wasm_hash(&hash).is_err());
        s.sign_as(intruder, "add_strategy", no_args(&s.env));
        assert!(s.factory.try_add_strategy(&other).is_err());
        s.sign_as(intruder, "set_strategy_enabled", no_args(&s.env));
        assert!(s
            .factory
            .try_set_strategy_enabled(&custody, &false)
            .is_err());
        s.sign_as(intruder, "set_default_strategy", no_args(&s.env));
        assert!(s.factory.try_set_default_strategy(&custody).is_err());
        s.sign_as(intruder, "pause", no_args(&s.env));
        assert!(s.factory.try_pause().is_err());
        s.sign_as(intruder, "unpause", no_args(&s.env));
        assert!(s.factory.try_unpause().is_err());
    }
    // Nada ha cambiado.
    assert_eq!(s.factory.config_version(), version);
    assert!(!s.factory.paused());
    assert_ne!(s.factory.escrow_wasm_hash(), hash);
}

// FAC-6: cada cambio de admin que afecta a las fianzas nuevas sube la versión.
#[test]
fn admin_changes_bump_config_version() {
    let s = Setup::new();
    let v0 = s.factory.config_version();
    let mut other = s.custody();
    other.id = symbol_short!("other");

    s.factory.set_config(&s.factory.config());
    s.factory
        .set_escrow_wasm_hash(&s.factory.escrow_wasm_hash());
    s.factory.add_strategy(&other);
    s.factory
        .set_strategy_enabled(&symbol_short!("other"), &true);
    s.factory.set_default_strategy(&symbol_short!("other"));

    assert_eq!(s.factory.config_version(), v0 + 5);
}

#[test]
#[ignore = "FAC-12 [M]: timelock del admin, pendiente"]
fn admin_timelock_enforced() {
    todo!()
}

#[test]
#[ignore = "lo comprueba scripts/ (P2) con `stellar contract info interface` sobre el wasm"]
fn factory_has_no_upgrade_fn() {
    todo!()
}
