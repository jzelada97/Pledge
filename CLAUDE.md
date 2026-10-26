# Fianzas de habitación en Soroban

Plataforma para caseros y grandes caseros (marca: **Pledge**). **Solo existe el plan A** (`docs/DECISIONS.md`, 26-oct). Cada fianza de habitación es un **escrow single-release con rendimiento de Trustless Work** (TrustYield). `apps/api` lo crea y lo gestiona con su API, a través de `@fianzas/trustless` (mapeo en `packages/trustless/CLAUDE.md`).

- **Rendimiento:** el escrow deposita la fianza en un **vault de DeFindex** sobre Blend USDC. Es **variable** y **nunca "sin riesgo"**.
- **Devolución:** el casero aprueba y el inquilino libera. Recibe fianza + rendimiento − comisiones (Trustless Work cobra un 0,3 % de todo lo retirado).
- **Parar:** solo el casero, antes de aprobar y sin coste. **El staff resuelve**: la deducción va al casero y el resto al inquilino. El rendimiento que sobra se reparte después (`distribute-yield`): primero la comisión opcional de plataforma y luego según la **jurisdicción** (`tenantYieldBps`; ni casero ni inquilino lo eligen). MVP en **Portugal: al casero**.
- **No existen** el perito, el depósito por parar (*stop bond*) ni los plazos on-chain (*timeouts* del contrato). No los uses en código, UI, docs ni pitch. El plazo de 30 días para que el inquilino reclame sí existe, pero lo aplica la plataforma (`claim-timeout` en `apps/api`, #115).
- **El inquilino no ve nada de cripto:** usa una cuenta con **passkey**, sin comisiones (las paga nuestro Relayer), y deposita desde el banco vía **anchor (SEP-24**, simulado en testnet).
- **El plan B está descartado:** el escrow y la factory propios (`contracts/`), `packages/bindings` y el backend `factory` de `apps/api`. Son histórico: no se desarrollan ni se toman como referencia.

Hackatón de 28 horas, 4 personas, testnet.
- Decisiones tomadas (**léelas primero**): `docs/DECISIONS.md`.
- API entre front y servidor: `docs/INTERFACES.md` § 8. Las secciones de contratos y factory son del plan B: histórico.
- Plan y fases: `docs/PIPELINE.md`. Las specs de `.kiro/pipeline/` describen el plan B: histórico.

## Cómo se trabaja (tras la entrega)
La hackatón terminó el 26-oct y el harness de equipo (roles por carpeta, locks, CODEOWNERS, hooks) se retiró. Ya no hay áreas ni locks: cualquiera edita cualquier carpeta y abre un PR contra `main`.

- Lee primero `docs/DECISIONS.md` y el `CLAUDE.md` de la carpeta en la que trabajes; si tocas la API, `docs/INTERFACES.md` § 8.
- Rama por tarea, PR pequeño con tests y typecheck en verde (`pnpm --filter <paquete> typecheck|test`). Commits en español, en imperativo, con el formato `tipo(scope): descripción` como hasta ahora.
- Nunca `git push --force` ni push directo a `main`.
- Despliegue: `docs/DEPLOY.md`.

## Reglas de código
- **Trustless Work:** solo a través de `@fianzas/trustless`, que tiene el cliente y las reglas de la fianza. No reimplementes roles, estados ni repartos en otra parte. La `TW_API_KEY` solo vive en el servidor.
- **Importes:** en unidad mínima (`bigint`, 7 decimales). Para pasarlos a o desde la API de TW, usa `units.ts` (`floorToUnits` para los saldos). Nunca hagas cuentas con `number`.
- **Rendimiento:** en código, UI y pitch, el APY es siempre "variable" y nunca "garantizado", "0 riesgo" ni "sin riesgo".
- **Front:** el usuario final no ve "wallet", "seed", "XLM" ni "gas". Usa el glosario.
- No inventes direcciones de contratos ni claves. Lee las direcciones de `deployments/testnet.json` (lo escribe P2).
- Sin secretos en el repo. Variables en `.env.local` (ignorado), con ejemplo en `.env.example`.

## Glosario
fianza (deposit), casero (landlord), inquilino (tenant), staff, escrow (uno por fianza, de Trustless Work), aprobar devolución (el casero, `approve-milestone`), liberar (el inquilino, `release-funds`), parar (el casero, `dispute-escrow`), resolver (el staff, `resolve-dispute`), repartir el rendimiento sobrante (el staff, `withdraw-remaining-funds`), reparto por jurisdicción (`tenantYieldBps`, de 0 a 10000; Portugal = 0), comisión de plataforma (`platformFeeBps`, sobre el rendimiento sobrante), vault (DeFindex sobre Blend USDC), comisión de Trustless Work (0,3 %).
