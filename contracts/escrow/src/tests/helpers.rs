// Derived from Trustless-Work/trustlesswork-smart-contract-stellar@1d22d0c (contracts/escrow/src/tests/helpers.rs), modified. See contracts/escrow/NOTICE.md
// FIANZAS: el escrow se registra con `EscrowInit` y una factory falsa en lugar de
// `(admin, wasm_hash)`. Se conserva `create_usdc_token`.
extern crate std;

use crate::contract::{EscrowContract, EscrowContractClient};
use crate::storage::types::{EscrowInit, RiskTier, Strategy, StrategyKind, Terms};
use crate::tests::fake_factory::{FakeFactory, FakeFactoryClient};
use crate::tests::mock_vault::{MockVault, MockVaultClient};
use soroban_sdk::testutils::{Address as _, Ledger};
use soroban_sdk::{symbol_short, token, vec, Address, Bytes, BytesN, Env};
use token::Client as TokenClient;
use token::StellarAssetClient as TokenAdminClient;

pub const AMOUNT: i128 = 5_000_000_000; // 500 USDC
pub const NOW: u64 = 1_000_000;
pub const END_TS: u64 = NOW + 30 * 86_400;

pub fn create_usdc_token<'a>(e: &Env, admin: &Address) -> (TokenClient<'a>, TokenAdminClient<'a>) {
    let sac = e.register_stellar_asset_contract_v2(admin.clone());
    (
        TokenClient::new(e, &sac.address()),
        TokenAdminClient::new(e, &sac.address()),
    )
}

pub struct Setup<'a> {
    pub env: Env,
    pub token: TokenClient<'a>,
    pub token_sac: TokenAdminClient<'a>,
    pub factory: FakeFactoryClient<'a>,
    pub landlord: Address,
    pub tenant: Address,
    pub treasury: Address,
    pub staff: Address,
}

impl<'a> Setup<'a> {
    pub fn new() -> Self {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_timestamp(NOW);
        let token_admin = Address::generate(&env);
        let (token, token_sac) = create_usdc_token(&env, &token_admin);
        let tenant = Address::generate(&env);
        token_sac.mint(&tenant, &(AMOUNT * 2));
        let factory = FakeFactoryClient::new(&env, &env.register(FakeFactory, ()));
        Setup {
            landlord: Address::generate(&env),
            treasury: Address::generate(&env),
            staff: Address::generate(&env),
            tenant,
            token,
            token_sac,
            factory,
            env,
        }
    }

    /// Vault simulado sobre el token de la fianza, con comisiones (100, 2000).
    pub fn mock_vault(&self) -> MockVaultClient<'a> {
        let admin = Address::generate(&self.env);
        let addr = self
            .env
            .register(MockVault, (admin, self.token.address.clone()));
        MockVaultClient::new(&self.env, &addr)
    }

    /// Terms con estrategia DeFindexVault sobre `vault` y el snapshot de comisiones (100, 2000).
    pub fn vault_terms(&self, vault: &Address) -> Terms {
        let mut t = self.terms();
        t.strategy.id = symbol_short!("usdc_fx");
        t.strategy.kind = StrategyKind::DeFindexVault;
        t.strategy.vault = Some(vault.clone());
        t.strategy.risk = RiskTier::Standard;
        t.strategy.max_vault_fee_bps = 1_000;
        t.defindex_vault_fee_bps = 100;
        t.defindex_protocol_fee_bps = 2_000;
        t
    }

    /// Escrow con vault, con invitación y ya fondeado por el inquilino.
    pub fn funded_vault_escrow(&self, vault: &Address) -> EscrowContractClient<'a> {
        let terms = self.vault_terms(vault);
        let escrow = self.register(EscrowInit {
            terms: terms.clone(),
            tenant: None,
            invite_hash: Some(self.invite_hash()),
        });
        escrow.fund_escrow(&self.tenant, &Some(self.invite_code()), &terms);
        escrow
    }

    /// Escrow NoYield con invitación y ya fondeado.
    pub fn funded_escrow(&self) -> EscrowContractClient<'a> {
        let escrow = self.escrow_with_invite();
        escrow.fund_escrow(&self.tenant, &Some(self.invite_code()), &self.terms());
        escrow
    }

    pub fn terms(&self) -> Terms {
        let e = &self.env;
        Terms {
            factory: self.factory.address.clone(),
            id: 1,
            landlord: self.landlord.clone(),
            amount: AMOUNT,
            end_ts: END_TS,
            tenant_yield_bps: 0,
            strategy: Strategy {
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
            },
            platform_fee_bps: 2_000,
            tw_fee_bps: 0,
            tw_fee_receiver: None,
            defindex_vault_fee_bps: 0,
            defindex_protocol_fee_bps: 0,
            treasury: self.treasury.clone(),
            dispute_resolvers: vec![e, self.staff.clone()],
            timeout_secs: 120,
            review_timeout_secs: 300,
            stop_bond: 100_000_000,
        }
    }

    pub fn invite_code(&self) -> BytesN<32> {
        BytesN::from_array(&self.env, &[7u8; 32])
    }

    pub fn invite_hash(&self) -> BytesN<32> {
        let code = Bytes::from_array(&self.env, &self.invite_code().to_array());
        self.env.crypto().sha256(&code).to_bytes()
    }

    /// Escrow con invitación (el flujo de la UI).
    pub fn escrow_with_invite(&self) -> EscrowContractClient<'a> {
        self.register(EscrowInit {
            terms: self.terms(),
            tenant: None,
            invite_hash: Some(self.invite_hash()),
        })
    }

    /// Escrow con el inquilino fijado por el casero.
    pub fn escrow_with_tenant(&self) -> EscrowContractClient<'a> {
        self.register(EscrowInit {
            terms: self.terms(),
            tenant: Some(self.tenant.clone()),
            invite_hash: None,
        })
    }

    pub fn register(&self, init: EscrowInit) -> EscrowContractClient<'a> {
        EscrowContractClient::new(&self.env, &self.env.register(EscrowContract, (init,)))
    }
}
