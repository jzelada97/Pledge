// Derived from Trustless-Work/trustlesswork-smart-contract-stellar@1d22d0c (contracts/escrow/src/lib.rs), modified. See contracts/escrow/NOTICE.md
#![no_std]
// FIANZAS: temporal. Lints de estilo que el upstream no pasa con `clippy -D warnings`.
// Se quita en el recorte del fork, que reescribe estos módulos (architecture.md § 5).
#![allow(
    dead_code,
    clippy::collapsible_if,
    clippy::needless_borrow,
    clippy::needless_borrows_for_generic_args,
    clippy::needless_question_mark,
    clippy::redundant_field_names,
    clippy::too_many_arguments,
    clippy::type_complexity,
    clippy::unnecessary_cast
)]

mod contract;
mod core {
    pub mod dispute;
    pub mod escrow;
    pub mod milestone;
    pub use dispute::*;
    pub use escrow::*;
    pub use milestone::*;
    pub mod validators {
        pub mod dispute;
        pub mod escrow;
        pub mod milestone;
    }
}
mod error;
mod events {
    pub mod handler;
}
mod modules {
    pub mod math {
        pub mod basic;
        pub mod safe;

        pub use basic::*;
        pub use safe::*;
    }

    pub mod fee {
        pub mod calculator;
        pub mod distribution;

        pub use calculator::*;
    }
}

/// This module is currently Work In Progress.
mod storage {
    pub mod types;
}

#[cfg(test)]
mod tests;

pub use crate::contract::EscrowContract;
