# Enriched Prompt · Fianzas de habitación en Soroban (v2)

> Generado por el agente prompt-enricher el 2026-10-25. El usuario delegó las decisiones ("decide tú"). Cada decisión provisional está marcada como **[DP-n]** y se recoge en las preguntas abiertas del final.
> Fuentes leídas: `CLAUDE.md`, `docs/INTERFACES.md`, `docs/PIPELINE.md`, `docs/DECISIONS.md`, `harness/team.json`, los `CLAUDE.md` de `contracts/escrow`, `contracts/mock-vault`, `packages/wallet`, `packages/anchor`, `apps/web` y `apps/backoffice`, `.env.example` y `README.md`. También la documentación de Trustless Work V2 (roles, despliegue, liberación, disputas, trustlines y wallets), consultada el 2026-10-25.
> Esta etapa solo produce especificación. No se escribe código del producto antes de la hackatón.

## Summary

Plataforma web para caseros y grandes caseros de España (gestoras y coliving) que custodia la fianza de alquiler de **habitaciones** en un escrow de Soroban (testnet, USDC). En vivienda completa la fianza se deposita en el organismo autonómico (LAU art. 36), pero en habitaciones la custodia el casero, y ese es el hueco del producto. El casero propone la fianza. El inquilino la acepta y la deposita desde su banco (anchor SEP-24) con una cuenta de passkey, sin fees ni lenguaje cripto. Mientras está bloqueada, la fianza genera rendimiento en DeFindex o Blend. El rendimiento se reparte según un preset de política (`tenant_yield_bps`) y la plataforma cobra un % del rendimiento (`platform_fee_bps`), nunca del principal. La fianza se libera cuando **casero e inquilino aprueban la devolución**. Si el casero pulsa **"parar"**, el caso pasa al **staff**, que encarga un informe a un **perito** (lo paga la plataforma con su fee) y resuelve la deducción. Si el casero no aprueba ni para en N días tras el fin del contrato, el inquilino recupera el 100 %. Lo que se vende es la **UX/UI del casero** que gestiona muchos inquilinos. Se construye en una hackatón de 28 h con 4 personas y demo en vivo, usando herramientas del ecosistema Stellar donde ahorren tiempo sin romper requisitos.

---

## 1. Decisión de escrow

### 1.1 Lo que se verificó de Trustless Work (docs V2, 2026-10-25)

| Hecho | Fuente | Impacto |
|---|---|---|
| Roles: approvers, service providers, release signers y dispute resolvers (hasta 5 cada uno), más observers, admin, platform y receiver. Quórum por milestone (`approvalsTarget`). | Roles V2, Deploy V2 | La doble aprobación (casero + inquilino, quórum 2) **encaja**. |
| Single-Release: el importe liberado va a **un solo receiver**, descontando un fee de Trustless Work del **0,30 %** y el `platformFee`, que también se aplica al **importe bruto**. | Release phase V2 | **No encaja.** El fee caería sobre el principal del inquilino, no sobre el rendimiento, y no se puede repartir el rendimiento entre inquilino, casero y plataforma en el camino feliz. |
| Disputa: la abren approvers, service providers, release signers, platform o receiver. El dispute resolver reparte **todo** el saldo entre direcciones e importes libres, después de los dos fees. | Dispute resolution V2 | "Parar → staff resuelve" encaja, pero el resolver puede enviar fondos a **cualquier dirección**, algo más peligroso que nuestro `resolve(deduction)` acotado. |
| **No hay timeout on-chain.** Los plazos son "responsabilidad de la capa de aplicación". | Dispute resolution V2 | **No encaja.** El timeout que protege al inquilino tendría que ejecutarlo nuestro staff o un backend, sin garantía en el contrato. |
| Trustline: se acepta `contractId` (C…) o el par `symbol` + emisor. Las docs hablan de "any Stellar-issued asset" y no confirman tokens SEP-41 arbitrarios como las shares de un vault. | Deploy V2, Trustlines V2 | La opción B (bloquear shares de DeFindex) **no está confirmada**. Hay que probarla. |
| Las docs no mencionan smart wallets, passkeys ni C-addresses. El flujo devuelve un `unsignedXdr` que firma `signer` y se envía con `/stellar/send-transaction`. Las wallets documentadas son Freighter, Albedo, xBull, Rabet, Lobstr y Hana. | Deploy V2, Stellar Wallets V2 | **Riesgo alto con passkeys.** Una C-address no puede ser la cuenta origen de una transacción, así que habría que reconstruir y volver a simular el XDR con el Relayer como origen y entradas de auth firmadas por el smart account. No está documentado. |
| V2 (quórum, multi-dirección, observers) está en **beta en testnet** desde el 22-sep-2026. La auditoría de Runtime Verification (sep-2025) es anterior a V2 y a cambios posteriores del código. | Contexto dado | Usar la auditoría como argumento de seguridad sería inexacto. |
| No hay evidencia de que Trustless Work invierta los fondos bloqueados. | Contexto dado | El rendimiento, requisito central, queda fuera de Trustless Work. |

### 1.2 Comparativa

| Criterio | **A) Escrow propio con yield** (INTERFACES actual + modelo de roles de TW) | **B) TW con shares de vault como activo** | **C1) Híbrido: TW para aprobar y disputar + contrato propio de yield** | **C2) TW sin rendimiento** |
|---|---|---|---|---|
| Doble aprobación | Sí (`approve_release`) | Sí (quórum 2) | Sí | Sí |
| Parar → staff → perito | Sí, con `deduction` acotada y siempre a favor del casero | Sí, pero el resolver reparte libremente | Sí | Sí |
| Timeout on-chain para el inquilino | Sí (`claim_after_timeout`) | **No** (off-chain) | **No** | **No** |
| Reparto del yield por política | Sí, exacto | **No** en el camino feliz (un solo receiver). Solo con disputa forzada en cada fianza. | Parcial: los fondos están en TW **o** en el vault, no en los dos. El yield solo existe si el contrato propio custodia, y entonces TW no custodia nada. | **No hay yield** |
| Fee de la plataforma solo sobre el yield | Sí | **No** (bruto + 0,30 % de TW) | No | No (0,30 % sobre la fianza) |
| Encaje con passkeys (C-address) | Controlado por nosotros: test obligatorio con cuenta contrato | **No verificado**. Re-simulación del XDR. | Igual que B | Igual que B |
| Riesgo en 28 h | Medio: ~400–600 líneas de Rust y la máquina de estados ya especificada | Alto: dos dependencias externas (API de TW y vault) y flujo XDR + passkey sin documentar | **El más alto**: dos sistemas de custodia que no se componen | Bajo técnicamente, pero **elimina un requisito central** y el pitch |
| Herramientas de TW aprovechables | Modelo de roles, semántica de disputa y UX del backoffice como referencia | SDK, Escrow Blocks, indexer y backoffice clonable | Parte del SDK | Todo |
| Quién hace qué | P1: contrato. P2: adaptador. P3: wallet. P4: UI. | P1: integra la API de TW. P2: shares y redención. P3: firma XDR. P4: Blocks. | Reparto confuso | P1 casi sin trabajo |

### 1.3 Recomendación: **Opción A**, con Trustless Work como referencia de diseño y plan de migración

**Decisión [DP-1]:** escrow propio en Soroban (`contracts/escrow`) con el adaptador de yield de P2, siguiendo `docs/INTERFACES.md` con los ajustes de la sección 1.4. Se adopta **explícitamente el modelo de roles de Trustless Work** (tabla de correspondencias abajo), de forma que el pitch pueda decir "compatible con el modelo de Trustless Work; migraremos a TW cuando admita activos con rendimiento y timeouts". Trustless Work no custodia fondos en la demo.

**Motivo:** tres requisitos no negociables (timeout on-chain, reparto del yield por política y fee solo sobre el rendimiento) **no se pueden cumplir** con Trustless Work en su estado documentado, y su encaje con passkeys no está verificado. A es la única opción que cumple todo y deja el riesgo en código que controla el equipo. Además, nuestro `resolve(deduction)` es más seguro que el reparto libre de TW: el staff no puede desviar fondos a terceros.

| Rol de Trustless Work | Equivalente en nuestro escrow |
|---|---|
| approvers (quórum 2) | `landlord` + `tenant` → `approve_release` |
| release signer | Implícito: la segunda aprobación liquida automáticamente (`settle`) |
| service provider | No aplica (no hay milestones). El casero "entrega" la habitación. |
| dispute (abrir) | `stop(id, who, reason_hash)` |
| dispute resolver | `staff` → `assign_expert`, `record_report`, `resolve(deduction)` |
| receiver | `tenant` (principal − deducción + su parte del yield) y `landlord` (deducción + su parte) |
| platform / platformFee | `treasury` / `platform_fee_bps` (**sobre el yield**) |
| admin | `admin` (solo pausa, ver FR-12). No puede mover fondos. |
| observers | Lecturas públicas (`get`, `list_by_*`) y eventos |

### 1.4 Spike de validación (H0:30–H1:45, P1, timebox de 75 min) que confirma la decisión antes de G1

P1 no necesita más en G0 que el setup, así que hace este spike y anota el resultado en `docs/DECISIONS.md` antes de que se congele INTERFACES en H2.

1. **TW + shares (15 min):** con la API de testnet de TW (`POST /escrow/single-release/v2/deploy`), intentar desplegar con `trustline.contractId` = dirección del token de shares de un vault DeFindex de testnet (o, si no hay vault a mano, cualquier token SEP-41 no SAC). Resultado: ¿error de validación o XDR?
2. **TW + C-address (15 min):** el mismo deploy con una C-address cualquiera de testnet en `approvers` y `receiver`. ¿La API la acepta? ¿El `unsignedXdr` tiene como origen al `signer` (lo que obliga a re-simular para un smart account)?
3. **Reparto en el camino feliz (10 min):** confirmar en las docs o en Escrow Lab que Single-Release no permite varios receivers sin disputa y que el 0,30 % se cobra sobre el bruto.
4. **Prueba de A (35 min):** esqueleto `propose` → `accept_and_fund` → `approve_release` ×2 contra un stub de vault en `cargo test`, con `Address::generate` y una cuenta contrato de prueba, para medir el ritmo real de P1.

**Regla de decisión:** se cambia a B **solo si** 1 y 2 pasan **y** el equipo acepta por escrito timeout off-chain y fee sobre el bruto (es decir, cambia el producto). En cualquier otro caso se confirma A. Como 3 es casi seguro negativo, la expectativa es confirmar A en H1:45. **Si el spike se alarga, se corta en 75 min y se confirma A.**

---

## Functional Requirements

Prioridad MoSCoW entre corchetes. "Must" = imprescindible para G3/G4.

### Contrato `escrow` (P1)
- **[FR-1] [Must]** `propose`: el casero crea una fianza con importe, `end_ts`, `tenant_yield_bps` (0–10000) y una **invitación** (ver FR-2). Estado `Proposed`, sin fondos.
- **[FR-2] [Must] [DP-2]** Invitación sin conocer de antemano la dirección del inquilino: `propose` recibe `tenant: Option<Address>` e `invite_hash: Option<BytesN<32>>` (SHA-256 de un código aleatorio de 128 bits con sal, que viaja en el enlace de invitación off-chain). `accept_and_fund(id, tenant, invite_code)` exige `tenant.require_auth()`, comprueba el hash y fija `tenant`. **Cambio de INTERFACES antes de G1.**
- **[FR-3] [Must]** `accept_and_fund`: el inquilino transfiere el importe, el escrow deposita en el adaptador (`authorize_as_current_contract`) y registra las shares **por diferencia de balance**. `Proposed` → `Active`.
- **[FR-4] [Should]** `cancel(id)` del casero solo en `Proposed`. **Cambio de INTERFACES.**
- **[FR-5] [Must]** `approve_release(id, who)`: cuando aprueban los dos, se ejecuta `settle` (withdraw total del vault → reparto según la fórmula de INTERFACES § 1) y el estado pasa a `Settled`. Se permite antes de `end_ts` si ambos están de acuerdo.
- **[FR-6] [Must]** `stop(id, who, reason_hash)`: lo puede pulsar el casero (y también el inquilino, como en INTERFACES; ver [DP-6]) en `Active`/`Ending`. Congela la liberación. `Stopped`.
- **[FR-7] [Must]** `assign_expert` (`Stopped` → `UnderReview`), `record_report(report_hash)` y `resolve(deduction)` (`UnderReview` → `Settled`). Solo `staff`. `deduction ≤ min(total, amount)` y siempre va al casero.
- **[FR-8] [Must]** `claim_after_timeout`: si `now > end_ts + timeout_secs` y el estado es `Active`/`Ending` (sin `stop`), el inquilino cobra principal + su parte del yield (con política 10000 se queda todo el yield neto). `timeout_secs` es un parámetro del constructor: **120 s en la demo y 30 días en producción [DP-7]**.
- **[FR-9] [Must]** Reparto: `fee = yield × platform_fee_bps / 10000` a `treasury`, y el neto se reparte con `tenant_yield_bps`. Redondeo hacia abajo en las partes del casero y de la tesorería, y **el resto al inquilino**. Si hay pérdida (`total < amount`), yield = 0 y la pérdida la absorbe primero la deducción y luego el inquilino (como en INTERFACES). Invariante: `to_tenant + to_landlord + to_treasury == total`.
- **[FR-10] [Must]** Lecturas: `get`, `accrued_yield` (vía `preview_redeem`), `list_by_landlord` y `list_by_tenant`.
- **[FR-11] [Must]** Eventos de INTERFACES § 1, más `("cancelled", id)` si entra FR-4.
- **[FR-12] [Could] [DP-8]** Pausa de emergencia con OpenZeppelin `pausable`: `admin` puede bloquear `propose` y `accept_and_fund`. **Nunca** bloquea `approve_release`, `resolve` ni `claim_after_timeout` (los fondos siempre pueden salir).

### Yield y despliegue (P2)
- **[FR-13] [Must]** `yield_adapter` con la interfaz de INTERFACES § 2 sobre **DeFindex** (por defecto, [DP-3]) o Blend `submit`, según el spike de G2. `contracts/mock-vault` tiene la misma interfaz y `set_rate_bps`.
- **[FR-14] [Must]** `scripts/deploy`, `scripts/fund` y `scripts/bindings.sh` escriben `deployments/testnet.json` y `packages/bindings`. `scripts/e2e` cubre el camino feliz, el de parada y el de timeout.
- **[FR-15] [Must]** Un escrow "largo" creado en G3 que acumula yield real hasta la demo, y su lectura en el panel.

### Onboarding sin cripto (P3)
- **[FR-16] [Must]** `Wallet.createAccount`/`connect` con passkey (Face ID o huella) → C-address, y `signAndSend` con fees patrocinados por OpenZeppelin Channels, sin XLM en la cuenta del usuario.
- **[FR-17] [Must] [DP-4]** La API key del Relayer **no llega al navegador**: `packages/wallet` exporta un handler de servidor (`createRelayHandler`) que `apps/web` monta en una ruta propia, con una lista blanca de contratos (escrow, token, vault, factory del smart account).
- **[FR-18] [Should]** `Anchor.startDeposit`/`startWithdraw`/`status` contra `testanchor.stellar.org` (SEP-24 con SEP-45 para C-addresses). **Plan B:** ramp simulado con `isSimulated = true`, visible en la UI.
- **[FR-19] [Must]** `FakeWallet` y `FakeAnchor` con la misma interfaz para tests y para el front hasta la integración.

### UX/UI (P4)
- **[FR-20] [Must]** Panel del casero (desktop): lista de fianzas por estado (propuesta, activa, en fin de contrato, parada, en revisión y liquidada), importe, rendimiento acumulado en vivo, días hasta el fin y hasta el timeout. Acciones: crear fianza con preset de política, copiar enlace de invitación, aprobar devolución y parar devolución (con motivo).
- **[FR-21] [Must]** Flujo del inquilino (móvil): abrir la invitación → crear cuenta con passkey → depositar desde el banco (o ramp simulado) → aceptar → ver fianza y rendimiento → aprobar devolución o reclamar tras el timeout → retirar al banco.
- **[FR-22] [Should]** Backoffice del staff: cola de paradas → asignar perito → subir el informe (hash SHA-256 calculado en el navegador; el archivo no sale del equipo del staff) → resolver la deducción con una vista previa del `Settlement`. Firma con Freighter vía Stellar Wallets Kit. Si se recorta, se opera con `scripts/e2e`.
- **[FR-23] [Must]** Presets de política (INTERFACES § 6) con el aviso de que no afirman qué dice la ley de cada país.
- **[FR-24] [Must]** Pitch y guion de la demo con vídeo de respaldo.

## Non-Functional Requirements
- **[NFR-1] Lenguaje:** el usuario final nunca ve "wallet", "seed", "XLM", "gas" ni "transacción". Se usa el glosario de `CLAUDE.md`. Los errores llegan como `WalletError.code` y P4 los traduce.
- **[NFR-2] Feedback de firma:** cada acción que firma muestra 3 estados: firmando (Face ID), enviando, y hecho o error con instrucción.
- **[NFR-3] Latencia:** confirmación de una acción en testnet ≤ 15 s en el p95 de la demo. El panel refleja el cambio en ≤ 10 s (polling o `getEvents`).
- **[NFR-4] Coste para el usuario:** 0 XLM en las cuentas de casero e inquilino. Todas las fees van por el Relayer.
- **[NFR-5] Mobile-first** en el flujo del inquilino (375 px) y desktop ≥ 1280 px en el panel del casero. Accesibilidad básica: contraste AA, foco visible y etiquetas.
- **[NFR-6] Idioma:** es-ES, importes en formato `1.234,56` con "USDC (≈ €)". Sin conversión real a EUR en la demo, o con una tasa fija etiquetada.
- **[NFR-7] Calidad del contrato:** cada función pública con test de camino bueno, de permisos y de estado incorrecto. Tests de reparto con 0, 5000 y 10000 bps, con y sin deducción, y con pérdida. `clippy -D warnings`.
- **[NFR-8] Reproducibilidad:** `scripts/deploy` + `scripts/fund` reconstruyen el entorno de demo desde cero en ≤ 10 min. Direcciones solo en `deployments/testnet.json`.
- **[NFR-9] Observabilidad mínima:** todos los cambios de estado emiten eventos. El front muestra el hash con enlace a un explorador solo en el backoffice, nunca al inquilino.
- **[NFR-10] Privacidad (RGPD):** ningún dato personal on-chain. Solo hashes con sal (`reason_hash`, `report_hash`, `expert_ref`, `invite_hash`).
- **[NFR-11] Honestidad de la demo:** todo lo simulado (ramp, mock-vault, tasa EUR) lleva una etiqueta visible y se dice en el pitch.

## Technical Context
- **Language/Framework:**
  - Contratos: Rust + `soroban-sdk` (última estable compatible con el protocolo de testnet en la fecha), workspace Cargo (`contracts/escrow`, `contracts/mock-vault`, `contracts/yield-adapter`). Stellar CLI para build, deploy y bindings.
  - Front: **[DP-5] Next.js (App Router) + TypeScript + Tailwind + shadcn/ui** en `apps/web` y `apps/backoffice`, con pnpm workspaces. Next.js se elige para tener rutas de servidor que protejan la API key del Relayer (FR-17) sin montar un backend aparte.
  - Paquetes TS: `packages/wallet`, `packages/anchor` y `packages/bindings` (generado).
- **Existing patterns to follow:** harness de áreas (`harness/team.json`, guard de ownership, CODEOWNERS), Conventional Commits con scope, PR < 300 líneas, mocks por cada flecha de dependencia desde H2, puertas G0–G5 de `docs/PIPELINE.md`, plantilla de `docs/DECISIONS.md` y reglas de contratos de `CLAUDE.md` (`require_auth`, diferencia de balances, `persistent` + `extend_ttl`, `checked_*`).
- **Dependencies (ecosistema Stellar):** ver la tabla de la sección "Herramientas por rol".
- **Target environment:** Stellar **testnet** (`https://soroban-testnet.stellar.org`, passphrase `Test SDF Network ; September 2015`), OpenZeppelin Channels testnet, testanchor.stellar.org, y el front desplegado (Vercel o similar) más un navegador local. Demo en dos móviles reales con passkey.
- **Token [DP-9]:** el token del escrow es **el subyacente del vault elegido** (BlendUSDC si el vault es DeFindex o Blend sobre los pools de testnet de Blend). Si el anchor entrega otro activo, ver Q-5.

## Herramientas del ecosistema por rol

| Rol | Herramientas del ecosistema | Para qué | Qué se construye a mano | Riesgo |
|---|---|---|---|---|
| **P1 · Carlos · escrow** | `soroban-sdk` + testutils; **OpenZeppelin stellar-contracts** (`pausable`; opcionalmente `access_control` para `admin`/`staff`); **Stellar CLI** (build y deploy local); **Trustless Work** como referencia de diseño (modelo de roles, semántica de disputa) y en el **spike H0:30–H1:45** | Tests con cuentas contrato, pausa auditada en vez de una casera, el modelo de roles de TW para el pitch y una posible migración | Máquina de estados, invitación con hash, `settle` con fee y política, timeout, eventos y errores | **Medio.** Integración con el vault (`authorize_as_current_contract`) y tests con C-address. Mitigación: mock-vault desde H2. |
| **P2 · Jose · DeFi + infra (integrador)** | **DeFindex** (vault en testnet sobre Blend, shares como token) o **Blend** (`submit` con SupplyCollateral/WithdrawCollateral); **Stellar CLI** (`contract deploy`, `contract bindings typescript`); **Friendbot**; **Stellar RPC `getEvents`**; **Stellar Lab** para depurar; **Scaffold Stellar** solo como referencia de scripts (no se adopta como base, porque el monorepo y el harness ya existen) | Yield real, bindings TS tipados, cuentas de demo, feed de actividad del panel | `yield_adapter`, `mock-vault`, `scripts/deploy|fund|e2e|bindings.sh`, `deployments/testnet.json` y un lector de eventos mínimo (en `packages/bindings` o en el front de P4, ver Q-8) | **Alto.** Yield casi nulo en testnet, liquidez de los pools de testnet, gotcha `withdraw` antes de pagar. Mitigación: mock-vault con `set_rate_bps` (recorte 4). |
| **P3 · Ricardo · onboarding** | **`smart-account-kit`** ([DP-10], sobre OZ stellar-contracts con passkeys y políticas; no se mezcla con `passkey-kit`); **OpenZeppelin Relayer / Channels** hosted (`channels.openzeppelin.com/testnet`); **`@stellar/typescript-wallet-sdk`** (cliente SEP-10/24, y SEP-45 si lo trae); **testanchor.stellar.org** + Anchor Platform (SEP-45); **Stellar Wallets Kit** (Freighter para el staff y como fallback) | Cuenta con Face ID sin XLM, fees patrocinados, depósito y retiro bancario | Fachada `Wallet` y `Anchor`, `WalletError` con códigos estables, `createRelayHandler` con lista blanca, `FakeWallet`/`FakeAnchor`, ramp simulado de plan B | **Alto.** SEP-45 sigue en Draft. Compatibilidad del kit con bindings (`AssembledTransaction`). Passkeys en dos móviles reales. Mitigación: plan B del anchor (recorte 1). |
| **P4 · Diego · UX/UI + pitch** | **Next.js + shadcn/ui**; **Stellar Wallets Kit** en el backoffice; `packages/bindings` generados; **backoffice clonable de Trustless Work** y **Escrow Blocks** **solo como referencia visual** (no son compatibles con nuestro contrato) | Panel del casero, flujo del inquilino, backoffice del staff | Todas las pantallas, presets de política, estados de firma, cálculo del hash del informe en el navegador, pitch y vídeo | **Medio.** Integración tardía con wallet y bindings. Mitigación: mocks desde H2 y backoffice sustituible por script (recorte 3). |

## Constraints
- 28 h, 4 personas, roles y carpetas fijos (`harness/team.json`). Nadie edita fuera de su área.
- Solo testnet. Sin mainnet, sin EUR real y sin KYC.
- `docs/INTERFACES.md` se congela en G1 (H2). Los cambios propuestos aquí (FR-2, FR-4, FR-12) deben entrar **antes** de G1.
- Orden de recorte de `docs/PIPELINE.md`: anchor real → timeout en la UI → backoffice → yield real. **Nunca** se recortan los tests del contrato, el flujo con passkey ni el camino feliz en testnet.
- Sin IA en el producto.
- Sin secretos en el repo. `RELAYER_API_KEY` y las claves de staff, tesorería y admin solo en `.env.local`.
- No escribir código del producto antes de la hackatón. Esta especificación sí.

## Acceptance Criteria
Todas se comprueban en **testnet** con las direcciones de `deployments/testnet.json`, salvo que se indique "cargo test".

- **[AC-1]** (cargo test) Hay tests de reparto para 0, 5000 y 10000 bps × {sin deducción, con deducción} × {vault con ganancia, vault con pérdida} que cumplen `to_tenant + to_landlord + to_treasury == total` y `to_treasury == floor(yield × fee_bps / 10000)`.
- **[AC-2]** (cargo test) Cada función pública tiene un test de permisos: otra dirección recibe `NotParty`/error de auth, y un test de estado incorrecto (`BadStatus`). Hay un test con casero e inquilino como **cuentas contrato**.
- **[AC-3]** Camino feliz (G3): un casero con passkey propone, un inquilino con passkey abre el enlace, crea la cuenta, acepta y deposita, ambos aprueban, y los saldos de inquilino, casero y tesorería coinciden con `Settlement` del evento `settled`. Las dos cuentas tienen 0 XLM durante todo el flujo.
- **[AC-4]** Camino de parada: el casero para con motivo, el staff asigna perito, registra `report_hash` y resuelve con `deduction = X`. El casero recibe `X + su parte del yield` y el inquilino `principal − X + su parte`. Un `resolve` con `X > principal` falla con `DeductionTooHigh`.
- **[AC-5]** Timeout: con `timeout_secs = 120`, tras `end_ts + 120 s` sin aprobación del casero ni parada, el inquilino ejecuta `claim_after_timeout` y recibe el principal + su parte. Antes de ese momento, la llamada falla con `TimeoutNotReached`.
- **[AC-6]** Invitación: `accept_and_fund` con un `invite_code` incorrecto falla. Con el correcto, fija `tenant`.
- **[AC-7]** Fee solo sobre el yield: con yield = 0, `to_treasury == 0` y el inquilino recibe el 100 % del principal.
- **[AC-8]** El escrow "largo" creado en G3 muestra en el panel un `accrued_yield > 0` en H24 (vault real), o la demo declara el mock-vault.
- **[AC-9]** Anchor: el inquilino inicia un depósito SEP-24 en testanchor y el `status` llega a `completed`, o la UI muestra la etiqueta "simulado" con `isSimulated = true`.
- **[AC-10]** Ninguna cadena visible para el usuario en `apps/web` contiene "wallet", "seed", "XLM", "gas" ni "transacción" (comprobación por grep en CI o en QA).
- **[AC-11]** La API key del Relayer no aparece en el bundle del cliente (grep del build) y el handler rechaza llamadas a contratos fuera de la lista blanca.
- **[AC-12]** El backoffice solo muestra acciones si la cuenta conectada es la de `staff`. Con otra cuenta, la llamada on-chain falla igualmente.
- **[AC-13]** `scripts/deploy` + `scripts/fund` reconstruyen el entorno en ≤ 10 min y `scripts/e2e` pasa los 3 caminos.
- **[AC-14]** La decisión de escrow (spike de la sección 1.4) y las de G2 (vault, kit de passkeys, anchor) están anotadas en `docs/DECISIONS.md`.

## Security Considerations
- **Sensitivity level: high.** Custodia de fondos de terceros, cuentas con passkey y datos personales de inquilinos y caseros (off-chain).
- **Data types involved:** importes y direcciones (públicos on-chain); nombres, emails, dirección de la habitación, contratos de alquiler e informes periciales (off-chain, RGPD); hashes on-chain.
- **Auth requirements:** `require_auth` del casero en `propose`/`cancel`, del inquilino en `accept_and_fund`/`claim_after_timeout`, de la parte (`who`) en `approve_release`/`stop`, de `staff` en `assign_expert`/`record_report`/`resolve`, y de `admin` solo para la pausa. Constructor de un solo uso.
- **Amenazas principales a evaluar:**
  1. **Staff comprometido:** puede fijar una deducción hasta el principal a favor del casero. Está acotado por diseño (no puede enviar fondos a terceros). Producción: staff como multisig o smart account con política.
  2. **Riesgo del vault:** incidentes de Blend (YieldBlox, 22-feb-2026, ~10,2 M$, oráculo mal configurado; backstop de Comet, 25-ago-2026, 717.518 USDC). Mitigaciones: medir por diferencia de balance, cubrir la pérdida en el reparto (FR-9), la pausa (FR-12) y, en producción, una lista blanca de vaults, un límite por vault y una divulgación del riesgo al inquilino. En el pitch, el rendimiento **no** se presenta como garantizado.
  3. **Reentrada y orden de llamadas:** el estado pasa a `Settled` antes de las transferencias de salida, y siempre se hace `withdraw` antes de pagar.
  4. **Front-running de la invitación:** el código se ve al enviarse. El riesgo es bajo (el atacante bloquearía su propio dinero) y el casero puede detectarlo y cancelar en `Proposed`. Código de 128 bits con sal.
  5. **TTL del storage:** las fianzas de 12 meses pueden superar el TTL máximo de una entrada persistente. Hay que hacer `extend_ttl` en cada interacción y, en producción, un keeper que extienda o restaure. Documentarlo.
  6. **Relayer:** abuso de la API key. Va solo en el servidor, con lista blanca de contratos y límite por IP en la ruta.
  7. **Redondeo y aritmética:** `checked_*` y el resto al inquilino.
  8. **Tiempo:** se usa `env.ledger().timestamp()`. Se evalúa la tolerancia de unos segundos.
  9. **Privacidad:** hashes con sal y el informe pericial nunca on-chain.
  10. **Lenguaje engañoso:** los presets no afirman la ley. Lo simulado va etiquetado.

## Out of Scope
- Mainnet, EUR real, MYKOBO o cualquier anchor de producción, KYC/AML y la ley aplicable por comunidad autónoma.
- Custodia en Trustless Work (solo spike y referencia) y Multi-Release o milestones.
- Marketplace o directorio de peritos, y su pago on-chain: el pago al perito es una transferencia operativa desde la tesorería y queda fuera del contrato.
- Backend propio con base de datos. Los metadatos de demo (nombre del inquilino, habitación) van en el front (JSON de demo o `localStorage`), salvo lo indicado en FR-17.
- Notificaciones por email o push, firma del contrato de alquiler, multi-idioma y upgrade del contrato.
- IA de cualquier tipo.
- Indexer propio. El de Trustless Work no aplica a nuestro contrato.

## Notes for Downstream Agents
- **Architecture Agent:** parte de la **opción A**. Diseña la máquina de estados con `Ending` calculado, la invitación (FR-2), `cancel` y la pausa, y propón el diff exacto de `docs/INTERFACES.md` para G1. Define dónde vive la ruta del Relayer (`apps/web` monta el handler de `packages/wallet`) y cómo el panel obtiene datos (`list_by_landlord` + `get` en lote vía simulación, `getEvents` para la actividad). Mantén la interfaz del adaptador idéntica para el mock y el real. Incluye la tabla de correspondencias con Trustless Work para una futura migración.
- **Security Agent:** evalúa las 10 amenazas de arriba, en especial los límites de poder del staff, la integración con el vault (`authorize_as_current_contract`, pérdidas y pausa que nunca bloquea salidas), el TTL, la exposición del Relayer y el flujo de auth con C-address. Revisa también que el "plan de migración a Trustless Work" no sugiera usar su auditoría como garantía de V2.
- **Development Agent:** respeta las áreas y no edites fuera de la tuya. Contratos: diferencia de balances, `persistent` + `extend_ttl`, `checked_*`, eventos exactos de INTERFACES, `settle` antes de transferir. TS: `WalletError.code` estable, `FakeWallet` y `FakeAnchor` desde H2, bindings solo generados. Front: glosario y 3 estados de firma.
- **Scoring Agent:** puntúa el cumplimiento de FR-1…FR-24 (prioridad Must), que el fee se aplique solo al yield, el timeout on-chain, los límites del staff, las pruebas con C-address, la ausencia de lenguaje cripto, la honestidad de lo simulado y que el pitch use bien las herramientas del ecosistema (qué es real y qué es referencia).
- **QA Agent:** matriz de reparto (AC-1), permisos y estados (AC-2), los 3 caminos e2e en testnet (AC-3…AC-5), la invitación (AC-6), el grep de lenguaje cripto y de la API key (AC-10, AC-11) y el ensayo de la demo en dos móviles. Mide la latencia (NFR-3).

---

## Preguntas abiertas para el equipo (con decisión provisional)

| # | Pregunta | Decisión provisional | Quién la confirma y cuándo |
|---|---|---|---|
| Q-1 [DP-1] | ¿Escrow propio (A) o Trustless Work (B/C)? | **A**, con TW como referencia de roles y plan de migración. Se confirma con el spike de la sección 1.4. | P1 (revisa P2) · H1:45 |
| Q-2 [DP-2] | ¿Cómo se vincula al inquilino si no tiene cuenta cuando el casero propone? | `invite_hash` en `propose` y `invite_code` en `accept_and_fund` (cambio de INTERFACES). | P1 + P4 · antes de G1 |
| Q-3 [DP-3] | ¿DeFindex o Blend directo? | **DeFindex** (shares como token, interfaz más cercana a SEP-56). Blend `submit` si el vault de testnet no tiene liquidez. | P2 · G2 (H3) |
| Q-4 [DP-10] | ¿`smart-account-kit` o `passkey-kit`? | **smart-account-kit** (OZ stellar-contracts y políticas, mantenido por SDF). | P3 · G2 |
| Q-5 [DP-9] | El anchor de prueba, el vault y Circle usan "USDC" de emisores distintos. ¿Qué token usa el escrow y cómo llega el depósito? | El token es el subyacente del vault. Si testanchor entrega otro activo, el depósito del anchor se muestra real y el abono al token del vault lo hace `scripts/fund`, **etiquetado como simulado**. | P2 + P3 · G2 |
| Q-6 [DP-6] | ¿Puede el inquilino pulsar "parar" o solo el casero? | Se mantiene INTERFACES: **los dos** pueden. En la UI, el inquilino ve "tengo un problema con la devolución" y el casero ve "parar devolución". | P1 + P4 · G1 |
| Q-7 [DP-7] | Valor de N (timeout) y de `platform_fee_bps` | Demo: `timeout_secs = 120` y fee del 20 % (2000 bps). Producción: 30 días. El fee real depende del coste del perito (pendiente de modelo de negocio). | P4 (pitch) + P1 |
| Q-8 | ¿Quién lee eventos para el feed del panel? | P4 en el front con `getEvents` sobre el escrow. P2 expone un helper en los bindings si hace falta. | P2 + P4 · H10 |
| Q-9 [DP-5] | ¿Framework del front? | Next.js + TS + Tailwind + shadcn/ui, por la ruta de servidor del Relayer. | P4 + P3 · G0 |
| Q-10 [DP-8] | ¿Se incluye la pausa de emergencia (OZ `pausable`)? | Sí, como **Could**, solo si P1 va en plazo en H10. Nunca bloquea salidas. | P1 · H10 |
| Q-11 | ¿Cómo se paga al perito si el fee de una sola fianza no lo cubre? | Off-chain, desde la tesorería agregada de todas las fianzas. En el pitch se explica como un fondo común. | P4 (pitch) |
| Q-12 | ¿Hay que mencionar Trustless Work en el pitch aunque no custodie? | Sí, como "modelo de roles compatible y migración prevista cuando admita activos con rendimiento y timeouts". No se cita su auditoría como garantía. | P4 |
