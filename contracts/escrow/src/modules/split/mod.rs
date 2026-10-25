//! Reparto de una fianza liquidada (docs/INTERFACES.md § 4). Función pura, sin storage.
//! El principal nunca paga comisiones: TW y plataforma cobran solo sobre el rendimiento, y una
//! pérdida del vault se compensa primero con el rendimiento.
use crate::error::EscrowError;
use crate::storage::types::Settlement;

const MAX_BPS: i128 = 10_000;

fn bps_of(value: i128, bps: u32) -> Result<i128, EscrowError> {
    value
        .checked_mul(bps as i128)
        .map(|v| v / MAX_BPS)
        .ok_or(EscrowError::Arithmetic)
}

/// `deduction` ya viene recortada a lo que vuelve del principal (CT-7, lo hace `settle`).
pub fn split(
    total: i128,
    amount: i128,
    deduction: i128,
    platform_fee_bps: u32,
    tw_fee_bps: u32,
    tenant_yield_bps: u32,
) -> Result<Settlement, EscrowError> {
    if amount <= 0 || total < 0 || deduction < 0 {
        return Err(EscrowError::InvalidAmount);
    }
    let fee_bps = (platform_fee_bps as i128)
        .checked_add(tw_fee_bps as i128)
        .ok_or(EscrowError::Arithmetic)?;
    if fee_bps > MAX_BPS || tenant_yield_bps as i128 > MAX_BPS {
        return Err(EscrowError::InvalidBps);
    }
    let principal_back = total.min(amount);
    if deduction > principal_back {
        return Err(EscrowError::DeductionTooHigh);
    }

    let yield_total = total
        .checked_sub(amount)
        .ok_or(EscrowError::Arithmetic)?
        .max(0);
    let to_tw = bps_of(yield_total, tw_fee_bps)?;
    let to_treasury = bps_of(yield_total, platform_fee_bps)?;
    let net = yield_total
        .checked_sub(to_tw)
        .and_then(|v| v.checked_sub(to_treasury))
        .ok_or(EscrowError::Arithmetic)?;
    let landlord_yield = bps_of(net, 10_000 - tenant_yield_bps)?;
    // El resto del redondeo va al inquilino.
    let tenant_yield = net
        .checked_sub(landlord_yield)
        .ok_or(EscrowError::Arithmetic)?;

    let to_landlord = deduction
        .checked_add(landlord_yield)
        .ok_or(EscrowError::Arithmetic)?;
    // Un déficit del principal recae aquí (Q-13).
    let to_tenant = principal_back
        .checked_sub(deduction)
        .and_then(|v| v.checked_add(tenant_yield))
        .ok_or(EscrowError::Arithmetic)?;

    let paid = to_tenant
        .checked_add(to_landlord)
        .and_then(|v| v.checked_add(to_treasury))
        .and_then(|v| v.checked_add(to_tw))
        .ok_or(EscrowError::Arithmetic)?;
    // Invariante: se reparte exactamente lo retirado. Si no, es un bug.
    assert!(paid == total, "split: el reparto no cuadra con el total");

    Ok(Settlement {
        total,
        yield_total,
        deduction,
        to_tenant,
        to_landlord,
        to_treasury,
        to_tw,
    })
}
