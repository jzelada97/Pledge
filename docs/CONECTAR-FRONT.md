# Checkpoint: conectar la web (apps/web) con la lógica, plan A

Rama: `p4/textos-plan-a` (PR #113), al día con `main`. Modo MVP (`docs/DECISIONS.md`): solo el camino feliz.

## Lo que ya existe en `main`
- **API plan A** (`apps/api`, montada en `apps/web/app/api/[[...path]]`, misma origin):
  - `POST /api/fianzas/v1/fianzas {landlord, tenant, amount}` → crea el escrow de TW (firma la tesorería si hay `TREASURY_SECRET`) → `{contractId}`.
  - `POST /api/escrow/single-release/v2/fund {contractId, signer, amount}` → `{soroban:{func,auth,validUntilLedger}}` para una passkey.
  - `POST /api/escrow/single-release/v2/approve-milestones {contractId, approver, milestoneIndexes:[0]}` (casero).
  - `POST /api/escrow/single-release/v2/approve-and-release-milestones {contractId, signer, milestoneIndexes:[0]}` (inquilino).
  - `POST /api/fianzas/v1/indexer {txHash}` tras cada envío por el Relayer.
  - `GET /api/fianzas/v1/{landlords|tenants}/:address/fianzas`, `GET /api/fianzas/v1/fianzas/:contractId/view`.
  - `/api/fianzas/v1/relay` (Relayer) y `/api/fianzas/v1/ramp` (ramp simulado).
- **Wallet** (`@fianzas/wallet`): `createWallet(cfg)` → `connect`, `createAccount`, `signAndSendBuilt(res, {expectedTransferAmount, expectedContract})`.
- **Anchor** (`@fianzas/anchor`): `createSimulatedAnchor({rampPath})` → `startDeposit(address, "USDC", amount)`.

## Plan (camino feliz)
1. [x] `apps/web/package.json`: añadir `@fianzas/wallet` y `@fianzas/anchor` (lock `deps`).
2. [x] `lib/wallet-client.ts`: `createWallet` con `deployments/testnet.json` (`rpId = location.hostname`, `relayPath = /api/fianzas/v1/relay`, `trustless.isEscrow` = wasm de TW).
3. [x] `lib/use-sign.ts`: aceptar `action: () => Promise<void>` real en vez de los tiempos falsos.
4. [x] Invitación (`components/invitation-flow.tsx`): paso 1 `connect()` o `createAccount()`; paso 2 ramp; paso 3 crear el escrow (POST fianzas) + `fund` + `signAndSendBuilt` + indexer.
5. [x] Casero: aprobar (`approve-milestones`). Inquilino: recuperar (`approve-and-release-milestones`).
6. [ ] Probar en local con `.env.local` en la raíz: `TW_API_KEY`, `TREASURY_SECRET`, `RELAYER_API_KEY`, `RAMP_ENABLED=1`, `RAMP_FAUCET_SECRET` (pedir a Jose).

## Estado
- Pasos 1–5 hechos en código (typecheck en verde): `lib/pledge.ts`, invitación conectada (`/i/1?l=<casero>&a=<importe>`) y página `/demo` (cuenta, link del casero, fianzas reales, aprobar y recuperar). Paso 6 en curso: `apps/web/.env.local` creado (no se sube) y la API responde con `backend: trustless`, `relayer: true` y `ramp: true`. Falta el recorrido en Chrome con dos cuentas (casero e inquilino, dos perfiles de Chrome): `/demo` → link → `/i/1?l=…&a=10` → `/demo` aprobar → `/demo` recuperar.
- **RAMP_DOWN = la cuenta del ramp (faucet `GDHIKULV…YDC3`) sin USDC.** Recargarla cambiando XLM por USDC en Soroswap (router `CCJUD55A…7BRD`, ruta XLM → USDC); el 26-oct se recargó con 1000 XLM → 155 USDC.

## Para Jose: dónde se quedó (26-oct, 11:50)
Probado en local con Chrome (casero en el perfil normal, inquilino en una ventana de invitado):
- ✔ Crear la cuenta con passkey (el Relayer la despliega), el ramp simulado, `POST /fianzas` (crea el escrow de TW) y `POST /fund` (construye el depósito).
- ✖ **El envío del depósito firmado por la passkey: `POST /api/fianzas/v1/relay` → 400 `SIMULATION_FAILED`.**
  - Sin firma, `fund_escrow` simula bien: escrow `CAXPC6UN…` (20 USDC), inquilino `CCONQX2H…` con 20 USDC y una sola regla en la cuenta.
  - Así que falla la verificación de la firma WebAuthn en modo *enforcing*. Sospecha: `contextRuleIds: [0]` o el formato de firma de `smart-account-kit` 0.8.0 frente al wasm de la cuenta (`1b5f4534…`).
  - Para ver el error: registrar `sim.error` en `packages/wallet/src/server/chain.ts` (simulate) o reproducir con el `{func, auth}` que envía la web.
- Las pantallas de casero e inquilino (`/landlord`, `/tenant`) siguen con `lib/fixtures`. La parte real está en la invitación `/i/1?l=<casero>&a=<importe>` y en `/demo`.
- `.env.local` va en `apps/web/` (Next solo lo lee ahí): `TW_API_KEY`, `TREASURY_SECRET`, `RELAYER_API_KEY`, `RAMP_FAUCET_SECRET`, `RAMP_ENABLED`, `API_ALLOWED_ORIGINS`.
- Lock `deps` (#114) tomado por Ricardo para `apps/web/package.json` y `pnpm-lock.yaml`: liberarlo al fusionar el #113.
