# Aviso de origen · contracts/escrow

## Origen
Este contrato es un **fork** del contrato Single-Release de **Trustless Work**:
- Repositorio: https://github.com/Trustless-Work/trustlesswork-smart-contract-stellar
- Rama: `single-release-develop-v2`
- Commit: `1d22d0c1b9c5788f4fd7184e42024bbe10303756` (2026-09-29, PR #122, `soroban-sdk 28.0.0`)
- Ruta de origen: `contracts/escrow/`
- Copiado el 2026-10-25.

© Trustless Work. Las modificaciones son del equipo de Fianzas.

## Estado del fork
- **No está auditado.** Ninguna auditoría de Trustless Work cubre este fork, y su comportamiento difiere del upstream.
- Cada archivo copiado empieza con la cabecera `// Derived from Trustless-Work/trustlesswork-smart-contract-stellar@1d22d0c (<ruta>), modified. See contracts/escrow/NOTICE.md`.
- Cada cambio sobre un archivo original está marcado con `// FIANZAS: <motivo>` (`# FIANZAS:` en TOML).
- El plan de cambios por archivo está en `.kiro/pipeline/architecture.md` § 5.

## Archivos
Rutas relativas a `contracts/escrow/`. Esta tabla se actualiza con cada cambio del fork.

| Archivo | Estado |
|---|---|
| `Cargo.toml` | Modificado: versiones explícitas, workspace propio y perfiles de release del `Cargo.toml` raíz del upstream |
| `Cargo.lock` | Copiado del `Cargo.lock` raíz del upstream |
| `src/lib.rs` | Modificado: árbol de módulos del fork; los archivos pendientes de portar quedan fuera |
| `src/contract.rs` | Modificado: entrypoints de INTERFACES § 2 (constructor, `fund_escrow`, `cancel`, lecturas); eliminadas las funciones del upstream |
| `src/error.rs` | Reescrito: un único `EscrowError` con códigos únicos |
| `src/core/escrow.rs` | Modificado: `init_from_constructor`, `fund_escrow` con invitación y `expected_terms`, `cancel` |
| `src/core/validators/escrow.rs` | Modificado: `validate_init` y `validate_parties`; se conserva `has_duplicate_addresses` |
| `src/events/handler.rs` | Reescrito: eventos `fz_*` |
| `src/storage/types.rs` | Reescrito: tipos de INTERFACES § 2 |
| `src/core/dispute.rs`, `src/core/milestone.rs` | Copiados, pendientes de portar (aprobación y parada); fuera del árbol de módulos |
| `src/core/validators/dispute.rs`, `src/core/validators/milestone.rs` | Copiados, pendientes de portar; fuera del árbol de módulos |
| `src/modules/fee/calculator.rs`, `src/modules/fee/distribution.rs` | Copiados, pendientes de portar (`settle`); fuera del árbol de módulos |
| `src/modules/math/basic.rs`, `src/modules/math/safe.rs` | Copiados, pendientes de portar (`split`); fuera del árbol de módulos |
| `src/tests/helpers.rs`, `src/tests/mod.rs` | Modificados: escrow registrado con `EscrowInit` y factory falsa |
| `src/tests/{balance,dispute,escrow,events,fund,milestone}.rs` | Eliminados: probaban funciones del upstream que ya no existen |
| `src/tests/{fake_factory,constructor,fund,cancel}.rs` | Nuevos |
