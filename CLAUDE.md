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

## Antes de tocar nada
1. Mira tu rol: `harness/.role`. Si no existe, para y pide al humano que ejecute `node scripts/harness/setup.mjs P<n>`.
2. Lee `docs/DECISIONS.md`, el `CLAUDE.md` de la carpeta en la que vas a trabajar y, si tocas la API, `docs/INTERFACES.md` § 8.
3. Trabaja **solo en las carpetas de tu rol** (`harness/team.json`). Un hook bloquea las ediciones fuera de tu área. No intentes saltártelo con Bash, `sed` ni scripts.

## Roles y carpetas
| Rol | Persona | Responsable de | Carpetas |
|---|---|---|---|
| P1 | Carlos · @CarlosJX7 | Cliente de la API de Trustless Work y reglas de la fianza (roles, estados, repartos) | `packages/trustless/` (`contracts/escrow/` y `contracts/factory/` son del plan B: histórico) |
| P2 | Jose · @jzelada97 | DeFi + infra + **API compatible con Trustless Work**, **integrador** | `apps/api/` (y su montaje en `apps/web/app/api/`), `contracts/mock-vault/`, `contracts/yield-adapter/`, `packages/bindings/` (generado), `scripts/deploy|e2e|fund/`, `deployments/` |
| P3 | Ricardo · @RicardoMatosR | Onboarding sin cripto | `packages/wallet/` (passkeys + Relayer), `packages/anchor/` (SEP-24/SEP-45) |
| P4 | Diego · @Diego-Matoss | Pitch | `pitch/` |
| Libre | Todos (sin lock ni `cross-area`) | Front del producto desde el 26-oct (#105): casero e inquilino, y backoffice del staff. Repartidlo con issues asignados para no pisaros | `apps/web/` (salvo `apps/web/app/api/`, que es de P2), `apps/backoffice/` |
| Compartido | Todos | Requiere **lock** | `docs/INTERFACES.md`, `.kiro/` (specs), `CLAUDE.md`, `NOTICE.md`, `harness/`, `.claude/`, `.github/`, archivos de configuración y dependencias en la raíz |

`docs/` (salvo INTERFACES) y `README.md` son libres.

## Si necesitas algo de otra área
- **No lo edites.** Abre un issue con `/bloqueo` (si te frena) o con la plantilla "Cambio de interfaz" (si cambia una firma, evento o tipo).
- Mientras esperas, usa un **mock** en tu carpeta que cumpla `docs/INTERFACES.md`. Nadie espera más de 15 minutos sin mock.
- Para editar un archivo compartido: `/lock <área>` → cambio → PR → `/unlock <área>`. Un lock dura como mucho 30 minutos.

## Ramas, commits y PR
- Rama: `p<n>/<tarea-corta>` (ej. `p1/approve-release`). Nunca trabajes en `main`.
- Commits en formato **Conventional Commits con scope de área** (lo valida `.githooks/commit-msg`):
  `tipo(scope): descripción en imperativo, en español, ≤72 caracteres`
  - Tipos: `feat`, `fix`, `test`, `docs`, `refactor`, `chore`, `ci`, `perf`.
  - Scopes: `escrow`, `factory`, `trustless`, `api`, `vault`, `adapter`, `bindings`, `scripts`, `wallet`, `anchor`, `web`, `backoffice`, `pitch`, `interfaces`, `harness`, `ci`, `deps`, `docs`.
  - Cambio que rompe la interfaz: `feat(escrow)!: …` y una línea `BREAKING: …` en el cuerpo.
  - Enlaza el issue en el cuerpo: `Refs: #12`.
  - Ejemplo: `feat(escrow): añadir approve_release con doble aprobación`.
- PR pequeños (objetivo < 300 líneas), un tema por PR. El título del PR sigue el mismo formato, porque se fusiona con **squash**.
- Antes de abrir el PR: tests y typecheck de tu área en verde (`/pr` lo hace).
- `main` está protegida: requiere CI en verde y **1 aprobación de cualquiera de los otros tres**. El primero que esté libre revisa, en menos de 15 minutos. **Nunca** `git push --force` ni push directo a `main`.
- Sincroniza con `main` al menos cada 2 horas (`/sync`).

## Reglas de código
- **Trustless Work:** solo a través de `@fianzas/trustless`, que tiene el cliente y las reglas de la fianza. No reimplementes roles, estados ni repartos en otra parte. La `TW_API_KEY` solo vive en el servidor.
- **Importes:** en unidad mínima (`bigint`, 7 decimales). Para pasarlos a o desde la API de TW, usa `units.ts` (`floorToUnits` para los saldos). Nunca hagas cuentas con `number`.
- **Rendimiento:** en código, UI y pitch, el APY es siempre "variable" y nunca "garantizado", "0 riesgo" ni "sin riesgo".
- **Front:** el usuario final no ve "wallet", "seed", "XLM" ni "gas". Usa el glosario.
- No inventes direcciones de contratos ni claves. Lee las direcciones de `deployments/testnet.json` (lo escribe P2).
- Sin secretos en el repo. Variables en `.env.local` (ignorado), con ejemplo en `.env.example`.

## Glosario
fianza (deposit), casero (landlord), inquilino (tenant), staff, escrow (uno por fianza, de Trustless Work), aprobar devolución (el casero, `approve-milestone`), liberar (el inquilino, `release-funds`), parar (el casero, `dispute-escrow`), resolver (el staff, `resolve-dispute`), repartir el rendimiento sobrante (el staff, `withdraw-remaining-funds`), reparto por jurisdicción (`tenantYieldBps`, de 0 a 10000; Portugal = 0), comisión de plataforma (`platformFeeBps`, sobre el rendimiento sobrante), vault (DeFindex sobre Blend USDC), comisión de Trustless Work (0,3 %).

## Comandos de Claude Code del equipo
`/tarea <issue>` empezar una tarea · `/pr` checks, commit, push y PR · `/bloqueo <qué>` reportar un bloqueo · `/sync` ponerse al día con main · `/estado` panel del equipo · `/lock <área>` / `/unlock <área>`.
