# packages/trustless · P1

**Plan A:** las fianzas son escrows Single-Release **v2 de Trustless Work**, creados y operados con su API REST. Este paquete es el cliente tipado de esa API y el mapeo de nuestro dominio (fianza, casero, inquilino, staff) a su escrow. El plan B (escrow y factory propios) sigue en `contracts/`.

## API de Trustless Work
- Base: `https://beta.api.trustlesswork.com` (v2). Cabecera `x-api-key: <id.secret>`. La key va en `.env.local` (`TW_API_KEY`), nunca en el repo ni en el navegador: el cliente se usa desde el servidor (`apps/api`).
- Cada operación devuelve `{ unsignedXdr, txHash }`. Se firma en el cliente **tal cual** (la passkey, `packages/wallet`) y se envía con `POST /stellar/send-transaction`.
- Errores: Problem Details (`code`, `detail`, `traceId`) → `TrustlessApiError`.
- Importes en **decimales** (`100.5`): convierte siempre con `units.ts` desde la unidad mínima (7 decimales). Nunca hagas cuentas con `number`.

## Mapeo (src/fianza.ts)
- Un hito "Devolución de la fianza" con `approvalsTarget = 2`: `approvers = [casero, inquilino]`, `releaseSigners = [casero, inquilino]`. La segunda aprobación usa `approve-and-release-milestones`.
- `receiver = inquilino`, `serviceProviders = [casero]`, `platform = tesorería`, `disputeResolvers = staff`, `admin` = cuenta de la plataforma, distinta de todos los demás roles.
- Parar = `dispute` (lo abre el casero). Resolver = `resolve-dispute` con `distributions` que suman el saldo: deducción al casero, el resto al inquilino.
- `platformFee = 0` mientras TW cobre sobre el total: nuestra comisión es solo sobre el rendimiento.

## DeFindex (src/defindex.ts)
TW va a añadir el depósito en DeFindex **sobre esta misma API**. Todo lo que suponemos de esa ampliación vive **solo** en `src/defindex.ts`, detrás de la opción `defindex` del cliente. Cuando TW lo publique, se cambia ese archivo y sus tests; el resto no se toca. Marca cada supuesto con `// SUPUESTO:`.

## Huecos frente al plan B (no los tapes aquí)
- Sin stop bond ni perito pagado por el bond.
- Sin timeout del casero ni de revisión: el inquilino no puede reclamar solo.
- Roles fijados al desplegar: el escrow se despliega cuando el inquilino acepta la invitación (hace falta su dirección).

## Comandos
- `pnpm --filter @fianzas/trustless typecheck test`
