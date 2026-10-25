//! Vault de DeFindex (docs/INTERFACES.md § 5). Código nuevo del fork: el upstream de TW no
//! tiene rendimiento.
mod defindex;

pub use defindex::{current_fees, deposit_all, preview_value, withdraw_all};
