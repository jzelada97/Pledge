# contracts/factory · P1

> **Plan B, descartado (docs/DECISIONS.md, 26-oct).** Esta factory es histórica: no se desarrolla, no se despliega y no se toma como referencia. En el plan A no hay factory: los escrows los despliega Trustless Work (`TW_DEPLOYER_TESTNET`).

`FianzaFactory`: crea **un escrow por fianza** y es el punto de entrada del front. Firmas: `docs/INTERFACES.md`. Diseño: `.kiro/pipeline/architecture.md`.

## Qué hace
- Despliega el escrow con el patrón `tw_new_single_release_escrow` de Trustless Work (`deployer().with_address(...).deploy_contract(wasm_hash, …)`) y lo inicializa en la misma transacción.
- Guarda el `wasm_hash` del escrow. Solo el admin lo actualiza, y las fianzas ya creadas no cambian.
- **Registro de estrategias:** lista blanca de vaults de DeFindex con un id, un nivel de riesgo, el token subyacente (con el emisor exacto), una marca de "por defecto" y otra de "activa". Una estrategia desactivada no se puede usar en fianzas nuevas, pero las existentes siguen igual. Es la **ruta de escalabilidad a RWA**: se añaden estrategias nuevas sin redeploy.
- Guarda la configuración global: `platform_fee_bps`, `stop_bond_min`, `stop_bond_bps`, `timeout_secs`, el timeout de revisión, `staff`, la tesorería y el fee de Trustless Work (0 en el MVP).
- Mantiene índices por casero y por inquilino para el panel.
- Emite eventos y tiene pausa, que afecta a la creación de fianzas nuevas.
- Creación en lote para grandes caseros, si da tiempo.

## Comandos
- Tests: `cargo test -p factory` · Build: `stellar contract build --package factory`

## Reglas
- La estrategia de cada fianza se fija al crearla y se copia en el escrow. El factory nunca la cambia después.
- Se valida que el token del vault coincide con el del escrow, con el emisor exacto: en Stellar hay tokens falsos con el mismo código.
- Solo el admin modifica el registro y la configuración. Cada cambio emite un evento.
