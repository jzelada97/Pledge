// Matriz de reparto de docs/INTERFACES.md § 4 y security § 9.1 (split_*).
use crate::error::EscrowError;
use crate::modules::split::split;
use crate::storage::types::Settlement;

const AMOUNT: i128 = 5_000_000_000;
const MAX_AMOUNT: i128 = 1_000_000_000_000_000;

/// Lo que hace `settle` antes de llamar a `split`: recortar la deducción a lo que vuelve.
fn settle_like(total: i128, deduction: i128, platform: u32, tw: u32, tenant: u32) -> Settlement {
    let deduction = deduction.min(total.min(AMOUNT));
    split(total, AMOUNT, deduction, platform, tw, tenant).unwrap()
}

fn assert_invariants(s: &Settlement, total: i128, platform: u32, tw: u32) {
    // Se reparte exactamente lo retirado.
    assert_eq!(s.to_tenant + s.to_landlord + s.to_treasury + s.to_tw, total);
    // Las comisiones salen solo del rendimiento.
    let yield_total = (total - AMOUNT).max(0);
    assert_eq!(s.yield_total, yield_total);
    assert_eq!(s.to_treasury, yield_total * platform as i128 / 10_000);
    assert_eq!(s.to_tw, yield_total * tw as i128 / 10_000);
    // El inquilino recupera el principal que vuelve menos la deducción, como mínimo.
    let principal_back = total.min(AMOUNT);
    assert!(s.to_tenant >= principal_back - s.deduction);
    assert!(s.to_landlord >= s.deduction);
    assert!(s.to_tenant >= 0 && s.to_landlord >= 0);
}

#[test]
fn split_invariant_matrix() {
    let gain = AMOUNT + 500_000_000;
    let totals = [
        gain,
        AMOUNT,      // sin rendimiento
        AMOUNT - 10, // pérdida menor que el rendimiento esperado
        AMOUNT / 2,  // pérdida mayor
        0,           // pérdida total
    ];
    for total in totals {
        for tenant_bps in [0u32, 5_000, 10_000] {
            for deduction in [0, AMOUNT / 3, AMOUNT] {
                for tw in [0u32, 30] {
                    let s = settle_like(total, deduction, 2_000, tw, tenant_bps);
                    assert_invariants(&s, total, 2_000, tw);
                    let net = s.yield_total - s.to_treasury - s.to_tw;
                    let tenant_yield = s.to_tenant - (total.min(AMOUNT) - s.deduction);
                    match tenant_bps {
                        0 => assert_eq!(tenant_yield, 0),
                        10_000 => assert_eq!(tenant_yield, net),
                        _ => assert_eq!(tenant_yield, net - net / 2),
                    }
                }
            }
        }
    }
}

// MVP Portugal: todo el rendimiento neto al casero, la fianza entera al inquilino.
#[test]
fn split_portugal_yield_to_landlord() {
    let s = settle_like(AMOUNT + 500_000_000, 0, 2_000, 0, 0);
    assert_eq!(s.to_tenant, AMOUNT);
    assert_eq!(s.to_treasury, 100_000_000); // 20 % del rendimiento
    assert_eq!(s.to_landlord, 400_000_000);
    assert_eq!(s.to_tw, 0);
}

#[test]
fn split_fees_never_touch_principal() {
    for total in [0, AMOUNT / 2, AMOUNT - 1, AMOUNT] {
        let s = settle_like(total, 0, 5_000, 30, 0);
        assert_eq!((s.to_treasury, s.to_tw, s.yield_total), (0, 0, 0));
        assert_eq!(s.to_tenant, total);
    }
}

#[test]
fn split_rounding_remainder_to_tenant() {
    // Rendimiento impar con reparto 50/50: el resto del redondeo va al inquilino.
    let s = settle_like(AMOUNT + 7, 0, 0, 0, 5_000);
    assert_eq!(s.to_landlord, 3);
    assert_eq!(s.to_tenant, AMOUNT + 4);
}

#[test]
fn split_rejects_invalid_inputs() {
    assert_eq!(
        split(AMOUNT, 0, 0, 0, 0, 0),
        Err(EscrowError::InvalidAmount)
    );
    assert_eq!(
        split(-1, AMOUNT, 0, 0, 0, 0),
        Err(EscrowError::InvalidAmount)
    );
    assert_eq!(
        split(AMOUNT, AMOUNT, -1, 0, 0, 0),
        Err(EscrowError::InvalidAmount)
    );
    assert_eq!(
        split(AMOUNT, AMOUNT, 0, 9_000, 1_001, 0),
        Err(EscrowError::InvalidBps)
    );
    assert_eq!(
        split(AMOUNT, AMOUNT, 0, 0, 0, 10_001),
        Err(EscrowError::InvalidBps)
    );
    assert_eq!(
        split(AMOUNT / 2, AMOUNT, AMOUNT / 2 + 1, 0, 0, 0),
        Err(EscrowError::DeductionTooHigh)
    );
}

#[test]
fn split_extreme_values_no_overflow() {
    let s = split(MAX_AMOUNT * 2, MAX_AMOUNT, MAX_AMOUNT, 5_000, 5_000, 10_000).unwrap();
    assert_eq!(
        s.to_tenant + s.to_landlord + s.to_treasury + s.to_tw,
        MAX_AMOUNT * 2
    );
    let s = split(i128::MAX / 20_000, 1, 0, 2_000, 30, 0).unwrap();
    assert_eq!(
        s.to_tenant + s.to_landlord + s.to_treasury + s.to_tw,
        i128::MAX / 20_000
    );
}

#[test]
fn split_pseudorandom_10k() {
    // Generador lineal congruencial: determinista y sin dependencias.
    let mut seed: u64 = 0x5eed_f1a2;
    let mut next = |max: u64| {
        seed = seed.wrapping_mul(6_364_136_223_846_793_005).wrapping_add(1);
        (seed >> 33) % max
    };
    for _ in 0..10_000 {
        let amount = 1 + next(MAX_AMOUNT as u64) as i128;
        let total = next(2 * MAX_AMOUNT as u64) as i128;
        let platform = next(5_001) as u32;
        let tw = next(10_001 - platform as u64) as u32;
        let tenant = next(10_001) as u32;
        let deduction = (next(MAX_AMOUNT as u64) as i128).min(total.min(amount));
        let s = split(total, amount, deduction, platform, tw, tenant).unwrap();
        assert_eq!(s.to_tenant + s.to_landlord + s.to_treasury + s.to_tw, total);
        assert!(s.to_tenant >= total.min(amount) - deduction);
    }
}
