use crate::error::FactoryError;

/// `min(max(min, floor(amount × bps / 10000)), amount)`. Único sitio donde se calcula el bond.
pub fn compute_stop_bond(amount: i128, min: i128, bps: u32) -> Result<i128, FactoryError> {
    let proportional = amount
        .checked_mul(bps as i128)
        .ok_or(FactoryError::Arithmetic)?
        / 10_000;
    Ok(proportional.max(min).min(amount))
}

#[cfg(test)]
mod tests {
    use super::compute_stop_bond;

    #[test]
    fn compute_stop_bond_formula() {
        // Fianza pequeña: se aplica el mínimo.
        assert_eq!(
            compute_stop_bond(1_000_000_000, 100_000_000, 500),
            Ok(100_000_000)
        );
        // Fianza grande: el porcentaje supera al mínimo.
        assert_eq!(
            compute_stop_bond(10_000_000_000, 100_000_000, 500),
            Ok(500_000_000)
        );
        // Nunca más que la propia fianza.
        assert_eq!(
            compute_stop_bond(50_000_000, 100_000_000, 500),
            Ok(50_000_000)
        );
    }
}
