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
1. [ ] `apps/web/package.json`: añadir `@fianzas/wallet` y `@fianzas/anchor` (lock `deps`).
2. [ ] `lib/wallet-client.ts`: `createWallet` con `deployments/testnet.json` (`rpId = location.hostname`, `relayPath = /api/fianzas/v1/relay`, `trustless.isEscrow` = wasm de TW).
3. [ ] `lib/use-sign.ts`: aceptar `action: () => Promise<void>` real en vez de los tiempos falsos.
4. [ ] Invitación (`components/invitation-flow.tsx`): paso 1 `connect()` o `createAccount()`; paso 2 ramp; paso 3 crear el escrow (POST fianzas) + `fund` + `signAndSendBuilt` + indexer.
5. [ ] Casero: aprobar (`approve-milestones`). Inquilino: recuperar (`approve-and-release-milestones`).
6. [ ] Probar en local con `.env.local` en la raíz: `TW_API_KEY`, `TREASURY_SECRET`, `RELAYER_API_KEY`, `RAMP_ENABLED=1`, `RAMP_FAUCET_SECRET` (pedir a Jose).

## Estado
- (se actualiza en cada paso)
