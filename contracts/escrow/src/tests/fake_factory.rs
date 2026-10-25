// Factory falsa para probar el escrow aislado (security § 16: fake_factory.rs obligatorio).
// Expone las dos funciones que llama el escrow y permite forzar la pausa o un fallo.
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, Symbol};

#[contracttype]
enum Key {
    Allowed,
    Fail,
    Tenant(u64),
}

#[contract]
pub struct FakeFactory;

#[contractimpl]
impl FakeFactory {
    pub fn set_allowed(e: Env, allowed: bool) {
        e.storage().instance().set(&Key::Allowed, &allowed);
    }

    pub fn set_fail(e: Env, fail: bool) {
        e.storage().instance().set(&Key::Fail, &fail);
    }

    pub fn funding_allowed(e: Env, _strategy_id: Symbol) -> bool {
        e.storage().instance().get(&Key::Allowed).unwrap_or(true)
    }

    pub fn register_tenant(e: Env, id: u64, tenant: Address) {
        if e.storage().instance().get(&Key::Fail).unwrap_or(false) {
            panic!("register_tenant falla a propósito");
        }
        e.storage().instance().set(&Key::Tenant(id), &tenant);
    }

    pub fn tenant_of(e: Env, id: u64) -> Option<Address> {
        e.storage().instance().get(&Key::Tenant(id))
    }
}
