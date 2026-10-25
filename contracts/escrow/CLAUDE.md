# contracts/escrow · P1

Escrow de **una fianza**. Es un **fork del Single-Release de Trustless Work** con depósito en DeFindex. Lo despliega `contracts/factory/`. Firmas: `docs/INTERFACES.md`. Diseño y cambios por archivo: `.kiro/pipeline/architecture.md`.

## Origen del código
- Base: `Trustless-Work/trustlesswork-smart-contract-stellar` (la rama y el SHA se deciden en G2 y se anotan en `NOTICE.md`), con permiso de Trustless Work.
- Conserva la estructura original (`core/`, `modules/fee`, `modules/math`, `storage/`, `events/`). Nuestro código nuevo va en módulos propios, por ejemplo `modules/vault/`, `modules/split/`, `core/stop_bond.rs` y `core/timeout.rs`.
- Marca **cada** cambio sobre un archivo original con `// FIANZAS: <motivo>`.

## Comandos
- Tests: `cargo test -p escrow`
- Build: `stellar contract build --package escrow`
- Formato: `cargo fmt -p escrow` · Lint: `cargo clippy -p escrow -- -D warnings`

## Reglas
- En los tests usa `contracts/mock-vault`, nunca el vault real. Al menos un test de integración **sin `mock_all_auths`** para la auth del vault.
- Cada función pública lleva al menos un test del camino bueno, uno de permisos (otra dirección intenta llamarla) y uno de estado incorrecto.
- Tests de reparto obligatorios: política 0 / 5000 / 10000 bps, con y sin deducción, vault que devuelve menos que el principal, y fee de Trustless Work a 0.
- Los tests de seguridad nombrados en `.kiro/pipeline/security.md` (§ 5 y § 12.9) se implementan con esos mismos nombres.
- No cambies una firma, un evento ni un error sin un issue "Cambio de interfaz" aprobado. Si cambia, avisa a P2 para regenerar los bindings.

## Checklist de seguridad (revisar en H22)
- [ ] `require_auth` en todo lo que mueve fondos o cambia estado. El init no se puede repetir.
- [ ] Fondear → `deposit` en el vault con `authorize_as_current_contract`. Liberar o resolver → `withdraw` del vault **antes** de cualquier pago.
- [ ] Importes y shares medidos por diferencia de balance.
- [ ] La fianza vuelve entera al inquilino (menos la deducción). Solo se reparte el rendimiento, y la pérdida va primero contra el rendimiento.
- [ ] Stop bond: solo lo deposita el casero, se guarda **fuera** del vault y su contabilidad va aparte.
- [ ] `!stop_justified ⇒ deduction == 0`. Sin hash de informe no se puede resolver.
- [ ] `stop` falla con `DeadlinePassed` una vez vencido el plazo, y `claim_after_timeout` funciona.
- [ ] Timeout de revisión: si el staff no resuelve, se paga al inquilino y el bond vuelve al casero.
- [ ] Storage `persistent` + `extend_ttl` en cada interacción. `checked_*` en toda la aritmética.
- [ ] Casero e inquilino pueden ser C-addresses (smart accounts con passkey): hay un test con una cuenta contrato.
