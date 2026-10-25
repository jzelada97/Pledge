extern crate std;

use soroban_sdk::testutils::{Address as _, AuthorizedFunction, AuthorizedInvocation, Ledger};
use soroban_sdk::{symbol_short, token, vec, Address, Bytes, BytesN, Env, IntoVal, Symbol};

use crate::contract::{FianzaFactory, FianzaFactoryClient};
use crate::error::FactoryError;
use crate::escrow::{self, RiskTier, Status, Strategy, StrategyKind};
use crate::types::{FianzaParams, GlobalConfig};

const AMOUNT: i128 = 5_000_000_000; // 500 USDC
const NOW: u64 = 1_000_000;
const END_TS: u64 = NOW + 30 * 86_400;

struct Setup<'a> {
    env: Env,
    factory: FianzaFactoryClient<'a>,
    token: token::Client<'a>,
    admin: Address,
    treasury: Address,
    staff: Address,
    landlord: Address,
    tenant: Address,
}

impl<'a> Setup<'a> {
    fn new() -> Self {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_timestamp(NOW);
        let admin = Address::generate(&env);
        let sac = env.register_stellar_asset_contract_v2(Address::generate(&env));
        let token = token::Client::new(&env, &sac.address());
        let tenant = Address::generate(&env);
        token::StellarAssetClient::new(&env, &sac.address()).mint(&tenant, &AMOUNT);
        let treasury = Address::generate(&env);
        let staff = Address::generate(&env);
        let config = GlobalConfig {
            token: token.address.clone(),
            treasury: treasury.clone(),
            staff: vec![&env, staff.clone()],
            platform_fee_bps: 2_000,
            tw_fee_bps: 0,
            tw_fee_receiver: None,
            timeout_secs: 120,
            review_timeout_secs: 300,
            stop_bond_min: 100_000_000,
            stop_bond_bps: 500,
            tenant_yield_bps: 0,
            vault_manager: None,
        };
        let wasm_hash = env.deployer().upload_contract_wasm(escrow::WASM);
        let factory = FianzaFactoryClient::new(
            &env,
            &env.register(FianzaFactory, (admin.clone(), wasm_hash, config)),
        );
        let s = Setup {
            landlord: Address::generate(&env),
            env,
            factory,
            token,
            admin,
            treasury,
            staff,
            tenant,
        };
        s.factory.add_strategy(&s.custody());
        s.factory
            .set_strategy_enabled(&symbol_short!("custody"), &true);
        s.factory.set_default_strategy(&symbol_short!("custody"));
        s
    }

    fn custody(&self) -> Strategy {
        Strategy {
            id: symbol_short!("custody"),
            kind: StrategyKind::NoYield,
            vault: None,
            asset: self.token.address.clone(),
            asset_name: self.token.name(),
            defindex_strategy: None,
            apy_pool: None,
            risk: RiskTier::NoYield,
            simulated: false,
            enabled: true,
            max_vault_fee_bps: 0,
        }
    }

    fn code(&self) -> BytesN<32> {
        BytesN::from_array(&self.env, &[7u8; 32])
    }

    fn params(&self, nonce: u8) -> FianzaParams {
        let code = Bytes::from_array(&self.env, &self.code().to_array());
        FianzaParams {
            tenant: None,
            invite_hash: Some(self.env.crypto().sha256(&code).to_bytes()),
            amount: AMOUNT,
            end_ts: END_TS,
            strategy_id: None,
            nonce: BytesN::from_array(&self.env, &[nonce; 32]),
        }
    }
}

// ---------- create_fianza ----------

#[test]
fn create_fianza_deploys_escrow_with_terms() {
    let s = Setup::new();
    let p = s.params(1);
    let predicted = s.factory.predict_address(&s.landlord, &p.nonce);

    let created = s.factory.create_fianza(&s.landlord, &p);

    assert_eq!(created.id, 1);
    assert_eq!(created.escrow, predicted);
    assert_eq!(s.factory.escrow_of(&1), created.escrow);
    assert_eq!(s.factory.id_of(&created.escrow), 1);
    assert_eq!(s.factory.count(), 1);
    assert_eq!(
        s.factory.list_by_landlord(&s.landlord, &0, &10),
        vec![&s.env, 1u64]
    );

    let terms = escrow::Client::new(&s.env, &created.escrow).get_terms();
    assert_eq!(terms.factory, s.factory.address);
    assert_eq!(terms.landlord, s.landlord);
    assert_eq!(terms.amount, AMOUNT);
    assert_eq!(terms.tenant_yield_bps, 0);
    assert_eq!(terms.platform_fee_bps, 2_000);
    assert_eq!(terms.strategy, s.factory.default_strategy());
    assert_eq!(terms.dispute_resolvers, vec![&s.env, s.staff.clone()]);
    assert_eq!(terms.stop_bond, 250_000_000); // 5 % de 500 USDC > mínimo de 10 USDC
}

#[test]
fn create_fianza_auth_is_only_landlord() {
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
fn create_fianza_rejects_reused_nonce() {
    let s = Setup::new();
    s.factory.create_fianza(&s.landlord, &s.params(1));

    let res = s.factory.try_create_fianza(&s.landlord, &s.params(1));
    assert_eq!(res, Err(Ok(FactoryError::NonceUsed)));
}

#[test]
fn create_fianza_validates_params() {
    let s = Setup::new();

    let mut p = s.params(1);
    p.amount = 0;
    assert_eq!(
        s.factory.try_create_fianza(&s.landlord, &p),
        Err(Ok(FactoryError::InvalidAmount))
    );

    let mut p = s.params(1);
    p.end_ts = NOW;
    assert_eq!(
        s.factory.try_create_fianza(&s.landlord, &p),
        Err(Ok(FactoryError::InvalidEndTs))
    );

    let mut p = s.params(1);
    p.tenant = Some(s.tenant.clone());
    assert_eq!(
        s.factory.try_create_fianza(&s.landlord, &p),
        Err(Ok(FactoryError::InvalidInvite))
    );

    let mut p = s.params(1);
    p.invite_hash = None;
    p.tenant = Some(s.landlord.clone());
    assert_eq!(
        s.factory.try_create_fianza(&s.landlord, &p),
        Err(Ok(FactoryError::SameParty))
    );

    assert_eq!(
        s.factory.try_create_fianza(&s.treasury, &s.params(1)),
        Err(Ok(FactoryError::InvalidParty))
    );

    let mut p = s.params(1);
    p.strategy_id = Some(symbol_short!("nope"));
    assert_eq!(
        s.factory.try_create_fianza(&s.landlord, &p),
        Err(Ok(FactoryError::StrategyNotFound))
    );
}

#[test]
fn create_fianza_rejects_when_paused() {
    let s = Setup::new();
    s.factory.pause();

    let res = s.factory.try_create_fianza(&s.landlord, &s.params(1));
    assert_eq!(res, Err(Ok(FactoryError::Paused)));
    assert!(!s.factory.funding_allowed(&symbol_short!("custody")));
}

// ---------- Flujo completo con el escrow real ----------

#[test]
fn tenant_funds_and_is_indexed() {
    let s = Setup::new();
    let created = s.factory.create_fianza(&s.landlord, &s.params(1));
    let escrow = escrow::Client::new(&s.env, &created.escrow);
    let terms = escrow.get_terms();

    escrow.fund_escrow(&s.tenant, &Some(s.code()), &terms);

    assert_eq!(s.token.balance(&created.escrow), AMOUNT);
    assert_eq!(escrow.get_escrow().status, Status::Active);
    assert_eq!(
        s.factory.list_by_tenant(&s.tenant, &0, &10),
        vec![&s.env, 1u64]
    );
    let summaries = s.factory.get_fianzas(&vec![&s.env, 1u64, 99u64]);
    assert_eq!(summaries.len(), 1);
    assert_eq!(summaries.get(0).unwrap().status, Status::Active);
}

// WEB-3: con la factory real, la passkey del inquilino solo firma fund_escrow y su
// token.transfer. register_tenant lo autoriza el escrow como invocador, no el inquilino.
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
fn fund_rejected_when_factory_paused() {
    let s = Setup::new();
    let created = s.factory.create_fianza(&s.landlord, &s.params(1));
    let escrow = escrow::Client::new(&s.env, &created.escrow);
    let terms = escrow.get_terms();
    s.factory.pause();

    let res = escrow.try_fund_escrow(&s.tenant, &Some(s.code()), &terms);
    assert_eq!(res, Err(Ok(escrow::EscrowError::Paused)));
}

// ---------- register_tenant ----------

#[test]
fn register_tenant_only_once() {
    let s = Setup::new();
    s.factory.create_fianza(&s.landlord, &s.params(1));

    s.factory.register_tenant(&1, &s.tenant);
    let res = s.factory.try_register_tenant(&1, &s.tenant);
    assert_eq!(res, Err(Ok(FactoryError::AlreadyRegistered)));
    assert_eq!(
        s.factory.try_register_tenant(&2, &s.tenant),
        Err(Ok(FactoryError::NotFound))
    );
}

#[test]
#[should_panic(expected = "Error(Auth, InvalidAction)")]
fn register_tenant_requires_the_escrow() {
    let s = Setup::new();
    s.factory.create_fianza(&s.landlord, &s.params(1));
    s.env.set_auths(&[]);

    s.factory.register_tenant(&1, &s.tenant);
}

// ---------- Registro de estrategias y admin ----------

#[test]
fn add_strategy_is_stored_disabled() {
    let s = Setup::new();
    let mut other = s.custody();
    other.id = symbol_short!("other");

    s.factory.add_strategy(&other);

    assert!(!s.factory.strategy(&symbol_short!("other")).enabled);
    assert!(!s.factory.funding_allowed(&symbol_short!("other")));
    assert_eq!(s.factory.strategies().len(), 2);
    assert_eq!(s.factory.admin(), s.admin);
}

#[test]
fn add_strategy_validates() {
    let s = Setup::new();
    assert_eq!(
        s.factory.try_add_strategy(&s.custody()),
        Err(Ok(FactoryError::StrategyExists))
    );

    let mut fake = s.custody();
    fake.id = symbol_short!("fake");
    fake.asset_name = soroban_sdk::String::from_str(&s.env, "USDC:GFAKE");
    assert_eq!(
        s.factory.try_add_strategy(&fake),
        Err(Ok(FactoryError::InvalidStrategy))
    );

    let mut vault = s.custody();
    vault.id = symbol_short!("vault");
    vault.kind = StrategyKind::DeFindexVault;
    vault.vault = Some(Address::generate(&s.env));
    vault.risk = RiskTier::Standard;
    assert_eq!(
        s.factory.try_add_strategy(&vault),
        Err(Ok(FactoryError::InvalidStrategy))
    );
}

#[test]
fn default_strategy_cannot_be_disabled() {
    let s = Setup::new();
    let res = s
        .factory
        .try_set_strategy_enabled(&symbol_short!("custody"), &false);
    assert_eq!(res, Err(Ok(FactoryError::InvalidStrategy)));
}

#[test]
#[should_panic(expected = "Error(Auth, InvalidAction)")]
fn admin_functions_require_admin() {
    let s = Setup::new();
    s.env.set_auths(&[]);
    s.factory.pause();
}

#[test]
fn set_config_keeps_token_immutable() {
    let s = Setup::new();
    let mut config = s.factory.config();
    config.tenant_yield_bps = 5_000;
    s.factory.set_config(&config);
    assert_eq!(s.factory.config().tenant_yield_bps, 5_000);

    config.token = Address::generate(&s.env);
    assert_eq!(
        s.factory.try_set_config(&config),
        Err(Ok(FactoryError::InvalidConfig))
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #3)")]
fn constructor_rejects_invalid_config() {
    let env = Env::default();
    let staff = Address::generate(&env);
    let config = GlobalConfig {
        token: Address::generate(&env),
        treasury: staff.clone(), // la tesorería no puede ser staff
        staff: vec![&env, staff],
        platform_fee_bps: 2_000,
        tw_fee_bps: 0,
        tw_fee_receiver: None,
        timeout_secs: 120,
        review_timeout_secs: 300,
        stop_bond_min: 0,
        stop_bond_bps: 500,
        tenant_yield_bps: 0,
        vault_manager: None,
    };
    let wasm_hash = env.deployer().upload_contract_wasm(escrow::WASM);
    env.register(FianzaFactory, (Address::generate(&env), wasm_hash, config));
}

#[test]
fn list_by_landlord_paginates() {
    let s = Setup::new();
    for n in 1..=3u8 {
        s.factory.create_fianza(&s.landlord, &s.params(n));
    }
    assert_eq!(s.factory.count_by_landlord(&s.landlord), 3);
    assert_eq!(
        s.factory.list_by_landlord(&s.landlord, &1, &10),
        vec![&s.env, 2u64, 3u64]
    );
    let res = s.factory.try_list_by_landlord(&s.landlord, &0, &51);
    assert_eq!(res, Err(Ok(FactoryError::TooMany)));
}
