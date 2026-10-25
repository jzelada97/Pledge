// Derived from Trustless-Work/trustlesswork-smart-contract-stellar@1d22d0c (contracts/escrow/src/lib.rs), modified. See contracts/escrow/NOTICE.md
#![no_std]

mod contract;
// FIANZAS: árbol de módulos del fork. Archivos del upstream pendientes de portar, fuera del
// árbol hasta entonces: core/{dispute,milestone}.rs y core/validators/{dispute,milestone}.rs
// (aprobación y parada), modules/fee/* y modules/math/* (settle y split).
mod core {
    pub mod escrow;
    pub use escrow::*;
    pub mod validators {
        pub mod escrow;
    }
}
mod error;
mod events {
    pub mod handler;
}

mod storage {
    pub mod types;
}

#[cfg(test)]
mod tests;

pub use crate::contract::EscrowContract;
