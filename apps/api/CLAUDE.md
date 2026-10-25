# apps/api · P2

API compatible con la **Core API v2 de Trustless Work** más los endpoints propios en `/fianzas/v1`. Contrato HTTP: `docs/INTERFACES.md` § 8. Diseño: `.kiro/pipeline/architecture.md` § 6.8.

## Cómo está montada
- Hono con `basePath("/api")`. En producción la sirve `apps/web/app/api/[[...path]]/route.ts` (`nextHandlers()`); en local, `pnpm --filter @fianzas/api dev` → `http://localhost:8787/api/health`.
- Configuración: `deployments/testnet.json` (anclas de confianza) + variables de entorno del servidor (`RELAYER_URL`, `RELAYER_API_KEY`, `RAMP_FAUCET_SECRET`, `RAMP_ENABLED`, `API_KEYS_JSON`, `API_ALLOWED_ORIGINS`, `READ_SOURCE`). **Ninguna con `NEXT_PUBLIC_`.**
- Lecturas: simulación contra la RPC con `readSource` como origen, caché en memoria (5 s estado, 60 s estrategias). La cadena manda.
- `POST /stellar/send-transaction` envía XDR **ya firmados** y nunca patrocina. El patrocinio solo existe en `POST /fianzas/v1/relay` (`createRelayHandler` de `@fianzas/wallet/server`, dueño P3). El ramp simulado va en `/fianzas/v1/ramp` (`createSimRampHandler` de `@fianzas/anchor/server`, dueño P3).
- Errores: RFC 9457 Problem Details (`src/problem.ts`). Las rutas de TW que no encajan responden `501 FZ_ENDPOINT_NOT_SUPPORTED` con `extensions.replacement`.

## Comandos
- `pnpm --filter @fianzas/api typecheck` · `pnpm --filter @fianzas/api test`

## Reglas
- La API **nunca firma**: devuelve XDR sin firmar y recibe XDR firmados.
- No se extiende el cuerpo de una ruta de TW con campos que cambien el efecto económico; si cambia la semántica, ruta nueva en `/fianzas/v1` y `501` en la de TW.
- Importes: strings decimales en lecturas; bps como bps en `/fianzas/v1`.
- Los tests no tocan la RPC: se inyecta `Chain` falso en `createApp(cfg, { chain })`.
- `@stellar/stellar-sdk` fijado a la misma versión que `packages/wallet` (16.4.1) para no tener dos copias del XDR.
