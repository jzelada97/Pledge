extern crate std;

use soroban_sdk::testutils::{Address as _, Ledger, MockAuth, MockAuthInvoke};
use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, token, vec, Address, Bytes, BytesN, Env,
    IntoVal, Symbol, Val, Vec,
};

use crate::contract::{FianzaFactory, FianzaFactoryClient};
use crate::escrow::{self, RiskTier, Strategy, StrategyKind};
use crate::types::{FianzaParams, GlobalConfig};

pub const AMOUNT: i128 = 5_000_000_000; // 500 USDC
pub const NOW: u64 = 1_000_000;
pub const END_TS: u64 = NOW + 30 * 86_400;

// ---------- Vault de DeFindex simulado (solo lo que lee la factory) ----------

#[contracttype]
enum VaultKey {
    Fees,
    Manager,
    Broken,
}

#[contract]
pub struct MockVault;

#[contractimpl]
impl MockVault {
    pub fn __constructor(e: Env, manager: Address, vault_fee: u32, protocol_fee: u32) {
        e.storage().instance().set(&VaultKey::Manager, &manager);
        e.storage()
            .instance()
            .set(&VaultKey::Fees, &(vault_fee, protocol_fee));
    }

    pub fn set_fees(e: Env, vault_fee: u32, protocol_fee: u32) {
        e.storage()
            .instance()
            .set(&VaultKey::Fees, &(vault_fee, protocol_fee));
    }

    pub fn set_manager(e: Env, manager: Address) {
        e.storage().instance().set(&VaultKey::Manager, &manager);
    }

    pub fn set_broken(e: Env, broken: bool) {
        e.storage().instance().set(&VaultKey::Broken, &broken);
    }

    pub fn get_fees(e: Env) -> (u32, u32) {
        if e.storage()
            .instance()
            .get(&VaultKey::Broken)
            .unwrap_or(false)
        {
            panic!("vault roto");
        }
        e.storage().instance().get(&VaultKey::Fees).unwrap()
    }

    pub fn get_manager(e: Env) -> Address {
        if e.storage()
            .instance()
            .get(&VaultKey::Broken)
            .unwrap_or(false)
        {
            panic!("vault roto");
        }
        e.storage().instance().get(&VaultKey::Manager).unwrap()
    }
}

// ---------- Contrato que se hace pasar por un escrow (FAC-5) ----------

#[contract]
pub struct Impostor;

#[contractimpl]
impl Impostor {
    pub fn attack(e: Env, factory: Address, id: u64, tenant: Address) {
        FianzaFactoryClient::new(&e, &factory).register_tenant(&id, &tenant);
    }
}

// ---------- Entorno ----------

pub struct Setup<'a> {
    pub env: Env,
    pub factory: FianzaFactoryClient<'a>,
    pub token: token::Client<'a>,
    pub admin: Address,
    pub treasury: Address,
    pub staff: Address,
    pub landlord: Address,
    pub tenant: Address,
}

impl<'a> Setup<'a> {
    /// Factory con la estrategia `custody` (NoYield) habilitada y por defecto.
    pub fn new() -> Self {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_timestamp(NOW);
        let sac = env.register_stellar_asset_contract_v2(Address::generate(&env));
        let token = token::Client::new(&env, &sac.address());
        let tenant = Address::generate(&env);
        token::StellarAssetClient::new(&env, &sac.address()).mint(&tenant, &(AMOUNT * 10));
        let admin = Address::generate(&env);
        let treasury = Address::generate(&env);
        let staff = Address::generate(&env);
        let config = base_config(&env, &token.address, &treasury, &staff);
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

    pub fn custody(&self) -> Strategy {
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

    /// Vault simulado gestionado por el admin.
    pub fn mock_vault(&self, vault_fee: u32, protocol_fee: u32) -> MockVaultClient<'a> {
        let addr = self
            .env
            .register(MockVault, (self.admin.clone(), vault_fee, protocol_fee));
        MockVaultClient::new(&self.env, &addr)
    }

    pub fn vault_strategy(&self, id: Symbol, vault: &Address, max_vault_fee_bps: u32) -> Strategy {
        Strategy {
            id,
            kind: StrategyKind::DeFindexVault,
            vault: Some(vault.clone()),
            risk: RiskTier::Standard,
            simulated: true,
            max_vault_fee_bps,
            ..self.custody()
        }
    }

    /// Registra y habilita una estrategia con vault.
    pub fn enable_vault_strategy(&self, id: Symbol, vault: &Address, max: u32) {
        self.factory
            .add_strategy(&self.vault_strategy(id.clone(), vault, max));
        self.factory.set_strategy_enabled(&id, &true);
    }

    pub fn code(&self) -> BytesN<32> {
        BytesN::from_array(&self.env, &[7u8; 32])
    }

    /// Parámetros con invitación y la versión de config actual.
    pub fn params(&self, nonce: u8) -> FianzaParams {
        let code = Bytes::from_array(&self.env, &self.code().to_array());
        FianzaParams {
            tenant: None,
            invite_hash: Some(self.env.crypto().sha256(&code).to_bytes()),
            amount: AMOUNT,
            end_ts: END_TS,
            strategy_id: None,
            nonce: BytesN::from_array(&self.env, &[nonce; 32]),
            expected_config_version: self.factory.config_version(),
        }
    }

    /// La siguiente llamada solo lleva la firma de `who` (no la del admin ni la del casero).
    pub fn sign_as(&self, who: &Address, fn_name: &str, args: Vec<Val>) {
        self.env.mock_auths(&[MockAuth {
            address: who,
            invoke: &MockAuthInvoke {
                contract: &self.factory.address,
                fn_name,
                args,
                sub_invokes: &[],
            },
        }]);
    }
}

pub fn base_config(
    env: &Env,
    token: &Address,
    treasury: &Address,
    staff: &Address,
) -> GlobalConfig {
    GlobalConfig {
        token: token.clone(),
        treasury: treasury.clone(),
        staff: vec![env, staff.clone()],
        platform_fee_bps: 2_000,
        tw_fee_bps: 0,
        tw_fee_receiver: None,
        timeout_secs: 120,
        review_timeout_secs: 300,
        stop_bond_min: 100_000_000,
        stop_bond_bps: 500,
        tenant_yield_bps: 0,
        vault_manager: None,
    }
}

pub fn no_args(env: &Env) -> Vec<Val> {
    ().into_val(env)
}
