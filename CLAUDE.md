# Fianzas de habitación en Soroban

Plataforma para caseros y grandes caseros. Cada fianza de habitación es un **escrow propio** creado por un **factory** (`FianzaFactory`).

- **El escrow es un fork del contrato de Trustless Work**, hecho con su permiso (ver `NOTICE.md`), al que añadimos el depósito en **DeFindex**. Por defecto usa el vault sobre el **Blend Fixed Pool USDC**, que rinde ~6-7 % variable y **nunca es "sin riesgo"**.
- **La fianza vuelve entera al inquilino** cuando **casero e inquilino aprueban**. Solo se reparte el **rendimiento**: un % para la plataforma y el resto según el preset del país.
- **Solo el casero puede parar**, depositando un **stop bond**. El staff asigna un **perito** y resuelve:
  - si la parada estaba justificada, el bond vuelve al casero;
  - si no, va a la tesorería, que paga al perito.
- **Timeout:** si el casero no responde, el inquilino recupera el 100 %.
- **El inquilino no ve nada de cripto:** usa una cuenta con **passkey**, sin fees, y deposita desde el banco vía **anchor (SEP-24)**.

Hackatón de 28 horas, 4 personas, testnet.
- Plan y fases: `docs/PIPELINE.md`.
- Contrato entre piezas: `docs/INTERFACES.md`.
- Specs del pipeline (enriched prompt, arquitectura, seguridad): `.kiro/pipeline/`.
- Decisiones tomadas: `docs/DECISIONS.md`.

## Antes de tocar nada
1. Mira tu rol: `harness/.role`. Si no existe, para y pide al humano que ejecute `node scripts/harness/setup.mjs P<n>`.
2. Lee `docs/INTERFACES.md` y el `CLAUDE.md` de la carpeta en la que vas a trabajar.
3. Trabaja **solo en las carpetas de tu rol** (`harness/team.json`). Un hook bloquea las ediciones fuera de tu área. No intentes saltártelo con Bash, `sed` ni scripts.

## Roles y carpetas
| Rol | Persona | Responsable de | Carpetas |
|---|---|---|---|
| P1 | Carlos · @CarlosJX7 | Escrow (fork de Trustless Work + DeFindex) y factory | `contracts/escrow/`, `contracts/factory/` |
| P2 | Jose · @jzelada97 | DeFi + infra, **integrador** | `contracts/mock-vault/`, `contracts/yield-adapter/`, `packages/bindings/` (generado), `scripts/deploy|e2e|fund/`, `deployments/` |
| P3 | Ricardo · @RicardoMatosR | Onboarding sin cripto | `packages/wallet/` (passkeys + Relayer), `packages/anchor/` (SEP-24/SEP-45) |
| P4 | Diego · @Diego-Matoss | UX/UI + pitch | `apps/web/` (casero e inquilino), `apps/backoffice/` (staff), `pitch/` |
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
  - Scopes: `escrow`, `factory`, `vault`, `adapter`, `bindings`, `scripts`, `wallet`, `anchor`, `web`, `backoffice`, `pitch`, `interfaces`, `harness`, `ci`, `deps`, `docs`.
  - Cambio que rompe la interfaz: `feat(escrow)!: …` y una línea `BREAKING: …` en el cuerpo.
  - Enlaza el issue en el cuerpo: `Refs: #12`.
  - Ejemplo: `feat(escrow): añadir approve_release con doble aprobación`.
- PR pequeños (objetivo < 300 líneas), un tema por PR. El título del PR sigue el mismo formato, porque se fusiona con **squash**.
- Antes de abrir el PR: tests y typecheck de tu área en verde (`/pr` lo hace).
- `main` está protegida: requiere CI en verde y **1 aprobación de cualquiera de los otros tres**. El primero que esté libre revisa, en menos de 15 minutos. **Nunca** `git push --force` ni push directo a `main`.
- Sincroniza con `main` al menos cada 2 horas (`/sync`).

## Reglas de código
- **Contratos (Rust/Soroban):** `require_auth` en todo lo que mueva fondos o cambie estado. Shares e importes por diferencia de balances. Storage `persistent` con `extend_ttl`. `checked_*` en la aritmética. Cada función pública lleva test.
- **Código de Trustless Work:** mantén la atribución y la cabecera de origen en los archivos copiados. Marca cada cambio nuestro con `// FIANZAS:` para que el diff con el original se pueda revisar.
- **Estrategias de rendimiento:** solo las del registro del factory. En código, UI y pitch, el APY es siempre "variable" y nunca "garantizado", "0 riesgo" ni "sin riesgo".
- **Bindings TS** (`packages/bindings/`): se generan con `scripts/bindings.sh`. **No se editan a mano.**
- **Front:** el usuario final no ve "wallet", "seed", "XLM" ni "gas". Usa el glosario.
- No inventes direcciones de contratos ni claves. Lee las direcciones de `deployments/testnet.json` (lo escribe P2).
- Sin secretos en el repo. Variables en `.env.local` (ignorado), con ejemplo en `.env.example`.

## Glosario
fianza (deposit), casero (landlord), inquilino (tenant), staff, perito (expert), política de yield (`tenant_yield_bps`, de 0 a 10000), fee de plataforma (`platform_fee_bps`, sobre el rendimiento), aprobar devolución (`approve_release`), parar (`stop`), depósito por parar (`stop_bond`), parada justificada (`stop_justified`), resolver (`resolve`), estrategia (vault de DeFindex del registro del factory), factory (`FianzaFactory`).

## Comandos de Claude Code del equipo
`/tarea <issue>` empezar una tarea · `/pr` checks, commit, push y PR · `/bloqueo <qué>` reportar un bloqueo · `/sync` ponerse al día con main · `/estado` panel del equipo · `/lock <área>` / `/unlock <área>`.
