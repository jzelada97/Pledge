# contracts/mock-vault · P2

Vault de pruebas con la misma interfaz que el vault de DeFindex que usa el escrow (`docs/INTERFACES.md`), con rendimiento simulado (`set_rate_bps`) y modos de fallo: devuelve menos que el principal, sin liquidez y error. Lo usan los tests del escrow y del factory, y la demo si hay que recortar.

El adaptador al vault real vive en `contracts/yield-adapter/` (de P2), si al final hace falta. Si el escrow llama al vault de DeFindex directamente, este directorio solo contiene el mock.

## Estrategia por defecto
- Vault de DeFindex sobre el **Blend Fixed Pool USDC**. En mainnet: `usdc_blend_autocompound_fixed_strategy` `CDB2WMKQQNVZMEBY7Q7GZ5C7E7IAFSNMZ7GGVD6WKTCEWK7XOIAVZSAP` y el pool `CAJJZSGMMM3PD7N33TAPHGBUGTB43OC73HVIK2L2G6BNGGGYOSSYBXBD`. En testnet hay que confirmarlo en el spike (`usdc_paltalabs_vault` / `USDC_blend_strategy` de `defindex-io/stellar-contracts/public/testnet.contracts.json`).
- El APY se lee en vivo y se muestra como "~6-7 %, variable". Nunca se escribe a mano.

## Comandos
- Tests: `cargo test -p mock-vault`
- Bindings para el front: `scripts/bindings.sh`, que escribe en `packages/bindings/` (no se edita a mano).
- Deploy y fondeo: `scripts/deploy/` y `scripts/fund/`, que actualizan `deployments/testnet.json`. Este archivo incluye el factory, el `wasm_hash` del escrow y el registro de estrategias.

## Reglas
- La interfaz del mock y la del vault real tienen que ser idénticas: el escrow no debe notar la diferencia.
- Como integrador, P2 regenera los bindings y despliega cada vez que se fusiona un cambio en `contracts/escrow` o `contracts/factory`.
