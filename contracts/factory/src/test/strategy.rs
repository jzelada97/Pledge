extern crate std;

use soroban_sdk::testutils::Address as _;
use soroban_sdk::{symbol_short, Address, String, Symbol};

use crate::error::FactoryError;
use crate::escrow::{RiskTier, StrategyKind};
use crate::test::setup::Setup;

#[test]
fn add_strategy_two_step() {
    let s = Setup::new();
    let mut other = s.custody();
    other.id = symbol_short!("other");

    s.factory.add_strategy(&other);

    assert!(!s.factory.strategy(&symbol_short!("other")).enabled);
    assert!(!s.factory.funding_allowed(&symbol_short!("other")));
    let mut p = s.params(1);
    p.strategy_id = Some(symbol_short!("other"));
    let res = s.factory.try_create_fianza(&s.landlord, &p);
    assert_eq!(res, Err(Ok(FactoryError::StrategyDisabled)));

    s.factory
        .set_strategy_enabled(&symbol_short!("other"), &true);
    let mut p = s.params(1);
    p.strategy_id = Some(symbol_short!("other"));
    s.factory.create_fianza(&s.landlord, &p);
    assert!(s.factory.funding_allowed(&symbol_short!("other")));
}

#[test]
fn add_strategy_rejects_wrong_asset_or_name() {
    let s = Setup::new();
    let fake_token = s
        .env
        .register_stellar_asset_contract_v2(Address::generate(&s.env));

    let mut wrong_asset = s.custody();
    wrong_asset.id = symbol_short!("a");
    wrong_asset.asset = fake_token.address();
    assert_eq!(
        s.factory.try_add_strategy(&wrong_asset),
        Err(Ok(FactoryError::InvalidStrategy))
    );

    // Mismo contrato, nombre de otro emisor: el emisor exacto forma parte del nombre.
    let mut wrong_name = s.custody();
    wrong_name.id = symbol_short!("b");
    wrong_name.asset_name = String::from_str(&s.env, "USDC:GFAKE");
    assert_eq!(
        s.factory.try_add_strategy(&wrong_name),
        Err(Ok(FactoryError::InvalidStrategy))
    );
}

#[test]
fn add_strategy_rejects_forbidden_vault() {
    let s = Setup::new();
    let forbidden = [
        s.token.address.clone(),
        s.factory.address.clone(),
        s.treasury.clone(),
        s.staff.clone(),
    ];
    for vault in forbidden.iter() {
        let st = s.vault_strategy(symbol_short!("v"), vault, 1_000);
        assert_eq!(
            s.factory.try_add_strategy(&st),
            Err(Ok(FactoryError::InvalidStrategy))
        );
    }
}

#[test]
fn add_strategy_kind_consistency() {
    let s = Setup::new();
    let vault = s.mock_vault(100, 2_000);

    let mut no_yield_with_vault = s.custody();
    no_yield_with_vault.id = symbol_short!("a");
    no_yield_with_vault.vault = Some(vault.address.clone());

    let mut vault_without_vault = s.vault_strategy(symbol_short!("b"), &vault.address, 1_000);
    vault_without_vault.vault = None;

    let mut no_yield_with_risk = s.custody();
    no_yield_with_risk.id = symbol_short!("c");
    no_yield_with_risk.risk = RiskTier::Standard;

    let mut vault_with_no_risk = s.vault_strategy(symbol_short!("d"), &vault.address, 1_000);
    vault_with_no_risk.risk = RiskTier::NoYield;

    for st in [
        no_yield_with_vault,
        vault_without_vault,
        no_yield_with_risk,
        vault_with_no_risk,
    ] {
        assert_eq!(
            s.factory.try_add_strategy(&st),
            Err(Ok(FactoryError::InvalidStrategy))
        );
    }
    // Y la válida, sí.
    s.factory
        .add_strategy(&s.vault_strategy(symbol_short!("ok"), &vault.address, 1_000));
    assert_eq!(
        s.factory.strategy(&symbol_short!("ok")).kind,
        StrategyKind::DeFindexVault
    );
}

#[test]
fn add_strategy_fee_caps() {
    let s = Setup::new();
    let vault = s.mock_vault(1_500, 2_000);

    let over_cap = s.vault_strategy(symbol_short!("a"), &vault.address, 2_001);
    assert_eq!(
        s.factory.try_add_strategy(&over_cap),
        Err(Ok(FactoryError::VaultFeeTooHigh))
    );

    // El vault cobra 15 % y la estrategia solo admite 10 %.
    let under_fee = s.vault_strategy(symbol_short!("b"), &vault.address, 1_000);
    assert_eq!(
        s.factory.try_add_strategy(&under_fee),
        Err(Ok(FactoryError::VaultFeeTooHigh))
    );

    // Un vault que no responde se rechaza (fail-closed).
    let broken = s.mock_vault(100, 2_000);
    broken.set_broken(&true);
    let st = s.vault_strategy(symbol_short!("c"), &broken.address, 1_000);
    assert!(s.factory.try_add_strategy(&st).is_err());
}

#[test]
fn add_strategy_requires_platform_manager() {
    let s = Setup::new();
    let mut config = s.factory.config();
    config.vault_manager = Some(s.admin.clone());
    s.factory.set_config(&config);

    let foreign = s.mock_vault(100, 2_000);
    foreign.set_manager(&Address::generate(&s.env));
    let st = s.vault_strategy(symbol_short!("a"), &foreign.address, 1_000);
    assert_eq!(
        s.factory.try_add_strategy(&st),
        Err(Ok(FactoryError::VaultNotPlatformManaged))
    );

    let ours = s.mock_vault(100, 2_000);
    s.factory
        .add_strategy(&s.vault_strategy(symbol_short!("b"), &ours.address, 1_000));
}

// FAC-8. Que las fianzas ya fondeadas sigan liquidando se comprobará cuando el escrow
// deposite en el vault y tenga approve_release (fase 3b).
#[test]
fn manager_change_after_add_blocks_new_fianzas() {
    let s = Setup::new();
    let mut config = s.factory.config();
    config.vault_manager = Some(s.admin.clone());
    s.factory.set_config(&config);
    let vault = s.mock_vault(100, 2_000);
    let id = symbol_short!("vault");
    s.enable_vault_strategy(id.clone(), &vault.address, 1_000);
    let params = |s: &Setup, n| {
        let mut p = s.params(n);
        p.strategy_id = Some(symbol_short!("vault"));
        p
    };
    s.factory.create_fianza(&s.landlord, &params(&s, 1));

    vault.set_manager(&Address::generate(&s.env));

    let res = s.factory.try_create_fianza(&s.landlord, &params(&s, 2));
    assert_eq!(res, Err(Ok(FactoryError::VaultNotPlatformManaged)));
    assert!(!s.factory.funding_allowed(&id));
}

#[test]
fn vault_fee_increase_blocks_create() {
    let s = Setup::new();
    let vault = s.mock_vault(100, 2_000);
    let id = symbol_short!("vault");
    s.enable_vault_strategy(id.clone(), &vault.address, 1_000);
    assert!(s.factory.funding_allowed(&id));

    vault.set_fees(&1_001, &2_000);

    let mut p = s.params(1);
    p.strategy_id = Some(id.clone());
    let res = s.factory.try_create_fianza(&s.landlord, &p);
    assert_eq!(res, Err(Ok(FactoryError::VaultFeeTooHigh)));
    assert!(!s.factory.funding_allowed(&id));
}

#[test]
fn strategy_is_immutable() {
    let s = Setup::new();
    let mut changed = s.custody();
    changed.max_vault_fee_bps = 0;
    changed.simulated = true;

    let res = s.factory.try_add_strategy(&changed);
    assert_eq!(res, Err(Ok(FactoryError::StrategyExists)));
    assert!(!s.factory.strategy(&symbol_short!("custody")).simulated);
}

#[test]
fn add_strategy_max_ten() {
    let s = Setup::new();
    for i in 1..10u32 {
        let mut st = s.custody();
        st.id = Symbol::new(&s.env, &std::format!("s{i}"));
        s.factory.add_strategy(&st);
    }
    let mut eleventh = s.custody();
    eleventh.id = symbol_short!("s11");
    assert_eq!(
        s.factory.try_add_strategy(&eleventh),
        Err(Ok(FactoryError::TooMany))
    );
}

#[test]
fn cannot_disable_default_strategy() {
    let s = Setup::new();
    let custody = symbol_short!("custody");
    let res = s.factory.try_set_strategy_enabled(&custody, &false);
    assert_eq!(res, Err(Ok(FactoryError::InvalidStrategy)));

    let mut other = s.custody();
    other.id = symbol_short!("other");
    s.factory.add_strategy(&other);
    s.factory
        .set_strategy_enabled(&symbol_short!("other"), &true);
    s.factory.set_default_strategy(&symbol_short!("other"));

    s.factory.set_strategy_enabled(&custody, &false);
    assert!(!s.factory.funding_allowed(&custody));
}
