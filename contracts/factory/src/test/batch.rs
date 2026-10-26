use soroban_sdk::{vec, Vec};

use crate::error::FactoryError;
use crate::test::setup::Setup;
use crate::types::FianzaParams;

#[test]
fn batch_creates_all_with_one_signature() {
    let s = Setup::new();
    let items = vec![&s.env, s.params(1), s.params(2), s.params(3)];

    let created = s.factory.create_fianzas_batch(&s.landlord, &items);

    // auths() refleja la última llamada: se comprueba antes de leer nada más.
    assert_eq!(s.env.auths().len(), 1); // una sola firma del casero
    assert_eq!(created.len(), 3);
    assert_eq!(s.factory.count(), 3);
    assert_eq!(
        s.factory.list_by_landlord(&s.landlord, &0, &10),
        vec![&s.env, 1u64, 2u64, 3u64]
    );
}

#[test]
fn batch_is_atomic() {
    let s = Setup::new();
    let mut bad = s.params(3);
    bad.amount = 0;
    let items = vec![&s.env, s.params(1), s.params(2), bad];

    let res = s.factory.try_create_fianzas_batch(&s.landlord, &items);

    assert_eq!(res, Err(Ok(FactoryError::InvalidAmount)));
    assert_eq!(s.factory.count(), 0);
    assert_eq!(s.factory.count_by_landlord(&s.landlord), 0);
}

#[test]
fn batch_rejects_duplicate_nonce() {
    let s = Setup::new();
    let items = vec![&s.env, s.params(1), s.params(1)];

    let res = s.factory.try_create_fianzas_batch(&s.landlord, &items);

    assert_eq!(res, Err(Ok(FactoryError::NonceUsed)));
    assert_eq!(s.factory.count(), 0);
}

#[test]
fn batch_max_size() {
    let s = Setup::new();
    let mut items: Vec<FianzaParams> = Vec::new(&s.env);
    assert_eq!(
        s.factory.try_create_fianzas_batch(&s.landlord, &items),
        Err(Ok(FactoryError::TooMany))
    );
    for n in 1..=11u8 {
        items.push_back(s.params(n));
    }
    assert_eq!(
        s.factory.try_create_fianzas_batch(&s.landlord, &items),
        Err(Ok(FactoryError::TooMany))
    );
}
