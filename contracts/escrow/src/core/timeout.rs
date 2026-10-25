//! Plazos y estado efectivo (código nuevo del fork; CT-4). `Ending` se deriva, nunca se guarda.
use soroban_sdk::Env;

use crate::error::EscrowError;
use crate::storage::types::{Escrow, Status};

/// Hasta aquí el casero puede parar; después el inquilino puede reclamar.
pub fn timeout_at(escrow: &Escrow) -> Result<u64, EscrowError> {
    escrow
        .terms
        .end_ts
        .checked_add(escrow.terms.timeout_secs)
        .ok_or(EscrowError::Arithmetic)
}

/// Fin del plazo del staff para resolver una parada; 0 si no hubo parada.
pub fn review_deadline(escrow: &Escrow) -> Result<u64, EscrowError> {
    if escrow.dispute.stopped_ts == 0 {
        return Ok(0);
    }
    escrow
        .dispute
        .stopped_ts
        .checked_add(escrow.terms.review_timeout_secs)
        .ok_or(EscrowError::Arithmetic)
}

pub fn effective_status(e: &Env, escrow: &Escrow) -> Status {
    if escrow.status == Status::Active && e.ledger().timestamp() >= escrow.terms.end_ts {
        Status::Ending
    } else {
        escrow.status
    }
}
