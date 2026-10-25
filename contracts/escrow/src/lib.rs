// Derived from Trustless-Work/trustlesswork-smart-contract-stellar@1d22d0c (contracts/escrow/src/lib.rs), modified. See contracts/escrow/NOTICE.md
#![no_std]

mod contract;
// FIANZAS: árbol de módulos del fork. Archivos del upstream pendientes de portar, fuera del
// árbol hasta entonces: core/dispute.rs y core/validators/{dispute,milestone}.rs (parada),
// modules/fee/* y modules/math/* (sustituidos por modules/split y la aritmética checked_*).
mod core {
    pub mod escrow;
    pub mod milestone;
    pub mod settle;
    pub mod timeout;
    pub use escrow::*;
    pub use milestone::*;
    pub mod validators {
        pub mod escrow;
    }
}
mod error;
mod events {
    pub mod handler;
}
mod modules {
    pub mod split;
    pub mod vault;
}

mod storage {
    pub mod types;
}

#[cfg(test)]
mod tests;

pub use crate::contract::EscrowContract;
