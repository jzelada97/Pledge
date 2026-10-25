# packages/trustless · P1

**Plan A:** las fianzas son escrows single-release **con rendimiento** de Trustless Work: la API v1 de single-release más un vault de DeFindex ("Guía de migración a TrustYield", 25-oct-2026). Este paquete es el cliente tipado de esa API y el mapeo de nuestro dominio (fianza, casero, inquilino, staff) a su escrow.

## API de Trustless Work
- Base: `https://trustless-backend-production.up.railway.app` (Swagger en `/docs`). Cabecera `x-api-key`. Es una key **propia de esta API** (la de v1/v2 da 401). Va en `.env.local` (`TW_API_KEY`), nunca en el repo ni en el navegador: el cliente se usa desde el servidor (`apps/api`).
- Cada escritura devuelve `{ unsignedTransaction }`. Lo firma la cuenta del rol y se envía con `POST /helper/send-transaction { signedXdr }`.
- **Una passkey (C-address) no puede ser firmante en la API** (400 `invalid version byte`, issue #61), aunque sí puede tener roles. Las acciones que firma una passkey (`fund_escrow`, `approve_milestone`, `release_funds`, `dispute_escrow`) se construyen contra el contrato y van por el Relayer de `packages/wallet` (plan A, `externalEscrows` y `trustless.feeAddress`).
- Lecturas con arrays: `?contractIds[]=C…` / `?addresses[]=C…`, también con un solo valor.
- Errores (NestJS `{ statusCode, message }`) → `TrustlessApiError`.
- Importes en **decimales** (`100.5`): convierte siempre con `units.ts` desde la unidad mínima (7 decimales). Nunca hagas cuentas con `number`.
- Activo: USDC de **Blend** en testnet (emisor `GATALTGT…5V56`). Necesitan trustline quien fondea, el receptor y `platformAddress` (**aunque `platformFee = 0`**: comprobado).

## Mapeo (src/fianza.ts)
- Roles v1, uno por rol: `approver` = `serviceProvider` = casero; `releaseSigner` = `receiver` = inquilino; `platformAddress` = tesorería (cobra `platformFee` **y puede actualizar el escrow**: es una cuenta de la plataforma); `disputeResolver` = staff.
- "Aprobar devolución" = dos pasos: el casero aprueba el hito (`approve-milestone`, índice `"0"`) y el inquilino libera (`release-funds`). Al liberar se paga capital + rendimiento menos comisiones.
- Parar = `dispute-escrow` del casero. Resolver = `resolve-dispute` repartiendo el **importe fondeado** (deducción al casero, resto al inquilino); el rendimiento que sobra se reparte con `withdraw-remaining-funds` según la jurisdicción.
- `signer` del deploy: por defecto la tesorería (cuenta G de la plataforma), porque las partes pueden ser passkeys.

## Rendimiento y comisiones (src/defindex.ts)
- Vault por defecto de TW (testnet) `CCG3G4YU…S7ZJ`; wasm del escrow `828ae584…4b95`; comisión de TW a `GBPUACN7…AMUB`.
- La comisión de TW (0,3 %) y `platformFee` se cobran sobre **todo lo retirado**, capital incluido: el inquilino solo recupera el 100 % si el rendimiento supera ese 0,3 %. `platformFee = 0` de momento.
- El saldo crece en cada ledger; justo después de fondear puede quedar 1 stroop por debajo del importe. No compares `balance == amount`.

## Huecos frente al plan B (no los tapes aquí)
- Sin stop bond ni perito pagado por el bond.
- Sin timeout del casero ni de revisión: el inquilino no puede reclamar solo.
- Roles fijados al desplegar: el escrow se despliega cuando el inquilino acepta la invitación (hace falta su dirección).

## Comandos
- `pnpm --filter @fianzas/trustless typecheck test`
