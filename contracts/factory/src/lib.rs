#![no_std]

mod bond;
mod contract;
mod error;
mod events;
mod storage;
mod types;

pub mod escrow {
    soroban_sdk::contractimport!(file = "../escrow/target/wasm32v1-none/release/escrow.wasm");
}

#[cfg(test)]
mod test;

pub use crate::contract::FianzaFactory;
