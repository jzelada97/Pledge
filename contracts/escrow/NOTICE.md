# Aviso de origen · contracts/escrow

## Origen
Este contrato es un **fork** del contrato Single-Release de **Trustless Work**:
- Repositorio: https://github.com/Trustless-Work/trustlesswork-smart-contract-stellar
- Rama: `single-release-develop-v2`
- Commit: `1d22d0c1b9c5788f4fd7184e42024bbe10303756` (2026-09-29, PR #122, `soroban-sdk 28.0.0`)
- Ruta de origen: `contracts/escrow/`
- Copiado el 2026-10-25.

© Trustless Work. Usado y modificado con permiso. Las modificaciones son del equipo de Fianzas.

## Permiso
El repositorio original no declara licencia, así que el único título para copiar, modificar y publicar este código es el permiso de Trustless Work.
- Concedido por: _(rellenar: nombre y cargo en Trustless Work)_
- Fecha: _(rellenar)_
- Alcance: _(rellenar: copiar, modificar y publicar en un repositorio público; solo la hackatón o también el desarrollo posterior)_
- Constancia: _(rellenar: enlace al mensaje o issue, o ruta del email archivado en `docs/`)_

Ninguna licencia abierta del resto de este repositorio se aplica al código de Trustless Work, salvo que Trustless Work lo autorice.

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
| `src/lib.rs` | Copiado |
| `src/contract.rs` | Copiado |
| `src/error.rs` | Copiado |
| `src/core/dispute.rs`, `src/core/escrow.rs`, `src/core/milestone.rs` | Copiados |
| `src/core/validators/dispute.rs`, `src/core/validators/escrow.rs`, `src/core/validators/milestone.rs` | Copiados |
| `src/events/handler.rs` | Copiado |
| `src/modules/fee/calculator.rs`, `src/modules/fee/distribution.rs` | Copiados |
| `src/modules/math/basic.rs`, `src/modules/math/safe.rs` | Copiados |
| `src/storage/types.rs` | Copiado |
| `src/tests/*.rs` (8 archivos) | Copiados. Se sustituyen en el recorte del fork |
