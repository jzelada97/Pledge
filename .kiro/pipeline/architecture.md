# Architecture Decision Record · Fianzas de habitación en Soroban (v2: fork de Trustless Work)

> Revisión del agente de arquitectura del 2026-10-25. Sustituye entera a la versión anterior (opción A, escrow propio singleton).
> Entradas: `.kiro/pipeline/enriched-prompt.md`, la versión anterior de este documento, `.kiro/pipeline/security.md` (incluida la sección 12, *stop bond*), `docs/INTERFACES.md`, `docs/PIPELINE.md`, `harness/team.json` y `CLAUDE.md`.
> Código leído de verdad: `Trustless-Work/trustlesswork-smart-contract-stellar`, ramas `single-release-develop` (commit `f0b706eaf6e98aa83bf4f95df42857b5d4c8e847`) y `single-release-develop-v2` (commit `1d22d0c1b9c5788f4fd7184e42024bbe10303756`, 2026-09-29, `soroban-sdk 28.0.0`). Se leyeron los `src/` completos de las dos ramas, salvo los tests. También `paltalabs/defindex`: `apps/contracts/vault/src/lib.rs` (firmas de `deposit`, `withdraw` y `get_asset_amounts_per_shares`) y `public/testnet.contracts.json`.
> Marcas: **[AD-n]** es una decisión de arquitectura. **[TW-v2]** indica código que se conserva del upstream y **[FORK]** código que se modifica o se añade. **[G1]** significa que entra en `docs/INTERFACES.md` antes de congelarlo. **[Q-n]** es una pregunta abierta.

---

## 0. Cambios respecto a la versión anterior

| # | Antes (v1 de este documento) | Ahora | Justificación |
|---|---|---|---|
| C-1 | **Opción A**: escrow propio singleton y Trustless Work solo como referencia de roles | **Fork del contrato Single-Release V2 de Trustless Work**, con su permiso explícito para copiar y modificar | El equipo tiene permiso de TW. Los motivos para rechazar TW (falta de timeout on-chain, fee sobre el bruto, un solo receptor, ausencia de rendimiento y flujo de XDR sin documentar para passkeys) se referían a **usar TW tal como está a través de su API**. Con un fork se añaden esas piezas en el código y se llama al contrato directamente con nuestros bindings, así que la API de TW y su XDR dejan de importar. Se gana la estructura probada de TW (roles, quórum, validadores, matemática segura, eventos), un pitch honesto ("construido sobre Trustless Work") y la alineación con su V2. |
| C-2 | Un contrato singleton con todas las fianzas | **Un contrato escrow por fianza**, desplegado por **`FianzaFactory`** | Es el modelo de TW (`tw_new_single_release_escrow`). Cada fianza queda aislada: un fallo o un bloqueo afecta a una sola, y desaparece el "honeypot" del singleton (security § 6.1 #12). Coste: aparecen direcciones dinámicas (lista blanca del Relayer, eventos y bindings), resueltas en § 6.4 y § 8. |
| C-3 | `yield-adapter` de P2 entre el escrow y DeFindex o Blend | **El escrow habla directamente con un vault de DeFindex** (`modules/vault/`) mediante un subconjunto de su interfaz. `mock-vault` implementa ese mismo subconjunto. `yield-adapter` queda solo como **plan C** | Hay un salto y un contrato menos, y desaparece el libro de shares intermedio y su ataque de inflación. Las shares del vault son un token SEP-41 que se mide por diferencia de balance. P2 libera unas 4 h, que dedica a scripts, e2e y el spike del vault. |
| C-4 | Fee de plataforma sobre el rendimiento; sin fee de TW | Fee de plataforma (`platform_fee_bps`) **y** parámetro de fee de TW (`tw_fee_bps`), **ambos solo sobre el rendimiento** y configurables. **En el MVP, `tw_fee_bps = 0`** (decisión del equipo): el código y los tests lo soportan, pero no se cobra. El destino del fee de TW se fija en la configuración, **nunca** por argumento | Cumple la decisión 3 del equipo. El upstream recibe `trustless_work_address` como **argumento del llamante** en `release_funds`, `resolve_dispute` y `withdraw_remaining_funds`, y el fork lo corrige. Activar el 0,3 % sobre el rendimiento queda **pendiente de acordar con TW** (Q-16) y se hace con `set_config`, sin redeploy, solo para fianzas nuevas. |
| C-5 | Pérdida del vault: la absorbe el inquilino (Q-13 abierta) | La pérdida se compensa **primero con el rendimiento** (`yield = max(total − amount, 0)`). Si queda un déficit de principal, la deducción se cobra entera mientras quepa y **el resto lo absorbe el inquilino** (Q-13 sigue abierta solo para ese tramo) | Cumple la decisión 3. Solo cambia `split()`. |
| C-6 | `stop(id, who, reason_hash)`: lo pueden hacer los dos | `stop(reason_hash)`: **solo el casero**, con **stop bond** `min(max(stop_bond_min, amount × stop_bond_bps / 10000), amount)` y `resolve(resolver, deduction, stop_justified)` | Decisión del equipo ya analizada en security § 12. Se aplican OC-1 a OC-4 y el tope en el principal (12.2). |
| C-7 | Staff ausente: riesgo aceptado (Q-14), solo `stopped_ts` | **`claim_after_review_timeout()` sin permisos**, con `review_timeout_secs`: el bond vuelve al casero, la deducción es 0 y el camino es `ReviewTimeout`. `resolve` y el *claim* son complementarios en el tiempo (`ReviewDeadlinePassed`) | La decisión 5 del equipo lo hace obligatorio. Cierra V2/V22 de security (OC-5) en la hackatón y no solo en mainnet. |
| C-8 | Configuración en el constructor del escrow, inmutable | Configuración **global en la factory** (admin, actualizable) y **copiada a cada fianza al crearla** (`Terms`, inmutable) | El casero y el inquilino firman unas condiciones que el admin ya no puede cambiar (AUTHZ-1). Los cambios del admin solo afectan a fianzas nuevas. |
| C-9 | Un solo vault | **Registro de estrategias** en la factory: lista blanca de vaults de DeFindex con `id`, `RiskTier`, activo con emisor fijado, pool de Blend para leer el APY en vivo, `enabled`, `simulated` y una estrategia por defecto (**Blend Fixed Pool USDC**). Incluye un modo **sin rendimiento** (`NoYield`, sin vault). Las estrategias nuevas (incluidas las RWA) se añaden **sin redeploy del escrow** (§ 7.1) | Decisiones 4 y 6, y la decisión final del equipo sobre rendimiento. El casero elige la estrategia al crear la fianza, el inquilino la ve y la acepta al fondear, y queda fijada en la fianza. |
| C-10 | Índices `Vec<u64>` por casero, reescritos en cada alta | Índices **paginados** `(casero, n) → id` y `(inquilino, n) → id` en la factory, O(1) por alta | Los grandes caseros y la creación en lote harían caro el `Vec`. Era una limitación anotada en la versión anterior. |
| C-11 | `propose` + `accept_and_fund(id, tenant, code)` | `factory.create_fianza(landlord, params)` + `escrow.fund_escrow(tenant, invite_code, expected_terms)` | Conserva el nombre de TW (`fund_escrow`) y su idea de `expected_escrow`: el inquilino firma **las condiciones exactas**, y si cambian, el contrato rechaza con `TermsMismatch`. Refuerza WEB-11 on-chain. |
| C-12 | Pausa en el escrow (`pause`/`unpause`) | **Pausa en la factory**. Bloquea `create_fianza` y, mediante `funding_allowed`, `fund_escrow`. **Nunca** bloquea salidas ni `stop`. Las salidas **no llaman a la factory** | La pausa sigue siendo manual ([AD-2]). Es una dependencia de solo entrada: si la factory falla, los fondos siguen pudiendo salir. |
| C-13 | Lista blanca del Relayer por dirección de contrato | Lista blanca por **dirección fija** (factory) **más** por **wasm hash y registro en la factory** (escrows dinámicos) | Cada fianza tiene una dirección nueva (§ 8.2). |
| C-14 | `harness/team.json` sin carpetas nuevas | **`contracts/factory/**` se añade al área de P1** (scope `factory`) | Decisión 4: la factory es de P1. |
| C-15 | Toolchain `soroban-sdk ≥ 23` | **`soroban-sdk = "28.0.0"`**, el mismo que el upstream | Evita portar el fork. El spike confirma que testnet soporta el protocolo correspondiente. |
| C-16 | Sin backend propio: el front construía las transacciones con bindings y enviaba por `/api/relay` | **API propia `apps/api` (P2), compatible con la Core API v2 de TW**: las mismas rutas y formas donde el fork se comporta igual, `501` con `replacement` donde cambia la semántica, y endpoints nuevos en `/fianzas/v1` (factory, estrategias con APY y riesgo en vivo, Terms con comisiones, previews, stop, resolve, claims, listas). Se monta dentro de `apps/web` (una origin). Relay y ramp pasan a la API (§ 6.8) | Decisión firme del equipo: la API de TW solo sirve su revisión del contrato, y la compatibilidad permite usar `escrow-js`, el React SDK y Blocks cambiando la `baseUrl`. Se lleva a P2, que es integrador y ha quedado libre de `yield-adapter` |
| C-17 | Comisiones de DeFindex no modeladas | `Terms` += `defindex_vault_fee_bps` y `defindex_protocol_fee_bps` (snapshot de `get_fees()` al crear); el registro tiene `max_vault_fee_bps`; `fund_escrow` rechaza si la comisión sube (`VaultFeeChanged`); en mainnet, solo vaults gestionados por la plataforma (§ 6.9) | Decisión firme del equipo: al activarse la fianza, todas las comisiones quedan fijadas y visibles |
| C-18 | `salt = id` (la dirección del escrow solo se conoce al ejecutarse) | `salt = sha256(landlord ‖ nonce)` y `predict_address` | La API devuelve `contractId` en el build, como el deploy de TW. Sin squatting: el deployer es la factory y la salt incluye al casero firmante |
| C-19 | Escrow en instance storage; NOTICE en `contracts/escrow/` | Escrow en **persistent** (`DataKey::Escrow`) + TTL de la instancia; **`NOTICE.md` en la raíz**; marcadores `// FIANZAS:` | Alineado con el `CLAUDE.md` actualizado por el equipo |

**Se mantiene sin cambios** (con referencia a la decisión original): invitación por `invite_hash = sha256(code)` de 256 bits en el fragmento `#c=` [AD-3]; `DeadlinePassed` para cerrar la carrera stop/timeout [AD-4]; "si el casero aprobó, no puede parar" [AD-5]; `claim_after_timeout` sin permisos [AD-6]; `resolve` exige informe [AD-7]; ramp simulado por defecto [AD-8] con `createSimRampHandler` [AD-9]; staff con Freighter y XLM propio, fuera del Relayer [AD-10]; scripts en Node `.mjs` con identidades del CLI [AD-11]; handler del Relayer en servidor (`createRelayHandler`); Next.js App Router en las dos apps; `FakeWallet` y `FakeAnchor`; recorte de la deducción tras el `withdraw` (CT-7); `InvalidParty`; reparto puro `split()` compartido con la vista previa; "settle es el único sitio que paga".

---

## 1. Base del fork: rama, licencia y aviso

### 1.1 Rama base [AD-12]: **`single-release-develop-v2` @ `1d22d0c`**

| Criterio | v1 `single-release-develop` @ `f0b706e` | **v2 `single-release-develop-v2` @ `1d22d0c`** |
|---|---|---|
| Doble aprobación casero + inquilino | Un solo `approver`. Solo se puede imitar con approver = casero y `release_signer` = inquilino, en un orden forzado | **Nativa**: `roles.approvers: Vec<Address>` y `MilestoneApprovals { target, approval_count, approved_by }`. Quórum 2 sin orden |
| Aprobar y liberar en un paso | No | `approve_and_release_milestones`: es nuestra semántica de "la 2.ª aprobación liquida" |
| Inicialización segura | `initialize_escrow` **sin auth**: cualquiera puede inicializar una instancia desplegada aparte | `__constructor(admin, approved_wasm_hash)`; `initialize_escrow` exige al admin y borra `Admin`/`ApprovedWasmHash`; `tw_new_single_release_escrow` comprueba el wasm hash |
| Validadores de roles | Mínimos | Duplicados, límites (≤ 5) y solapes (`dispute_resolver ∉ {approvers, receiver, platform}`, `admin ∉ roles`). Encajan con AUTHZ-4 |
| Matemática | `safe_mul_div` que puede desbordar | `safe_mul_div` por partes y `mul_div_wide` con U256 |
| Eventos | `data_format = "vec"`, con el `Escrow` entero | Con nombres de campo y datos acotados (hashes de cadenas) |
| Estado de publicación | Es la rama por defecto | Beta en testnet; **V2 todavía no está publicada** por TW |
| Tests upstream | ~85 KB | ~175 KB (más cobertura de quórum y fondeo) |

**Decisión: v2.** Trae de serie lo que más nos cuesta (quórum multi-dirección, validadores de roles y el patrón de despliegue con wasm hash aprobado), y nuestro diff queda alineado con la versión que TW va a publicar. Ni la auditoría de Runtime Verification (sep-2025, anterior a V2) ni ninguna otra cubre **nuestro** fork. El pitch no la cita.

**Plan B (decisión en H1:30, ver § 10):** si el fork v2 no compila o sus tests no pasan con nuestro toolchain en 60 minutos, se toma v1 @ `f0b706e` y se mapea approver = casero y `release_signer` = inquilino. Las interfaces públicas del fork **no cambian** (están definidas en § 6), solo la implementación interna de la aprobación.

### 1.2 Qué se copia, dónde y con qué aviso [AD-13]

- **Origen:** `contracts/escrow/src/**` de v2 @ `1d22d0c` (sin `tests/`, salvo `tests/helpers.rs` como plantilla) se copia a **`contracts/escrow/src/**`** del monorepo (área de P1). `Cargo.toml` del crate se adapta a nuestro workspace.
- **Factory:** `contracts/factory/` es código nuevo de P1, **derivado** del patrón de `tw_new_single_release_escrow` (despliegue con `env.deployer()` y wasm hash aprobado).
- **Licencia:** el repositorio de TW **no declara licencia** (la API de GitHub devuelve `license: null` y no hay `LICENSE`). Sin licencia rigen todos los derechos reservados, así que **el único título para copiar es el permiso escrito de TW**. Como la entrega exige un repositorio **público** (G5), el permiso tiene que cubrir de forma explícita la publicación del código modificado (Q-17).
- **`NOTICE.md` en la raíz** (como fija ya `CLAUDE.md`; área compartida con `/lock harness`; lo redacta P1 en G0), con:
  1. Origen: repositorio, rama, commit `1d22d0c1b9c5788f4fd7184e42024bbe10303756` y fecha.
  2. Permiso: quién lo concede en TW, la fecha, el alcance (copiar, modificar, publicar y, si lo cubre, el uso comercial) y un enlace o cita del permiso (issue, email archivado en `docs/`).
  3. "© Trustless Work. Usado y modificado con permiso". Las modificaciones son del equipo.
  4. Lista de archivos copiados, modificados, eliminados y nuevos (la tabla de § 5).
  5. Que **no** se aplica al código de TW ninguna licencia abierta del resto del repositorio salvo que TW la autorice.
  6. Que el fork **no está auditado** y difiere del upstream.
- `contracts/escrow/` y `contracts/factory/` no llevan NOTICE propio: su `Cargo.toml` (campo `description`) y un `README.md` de carpeta remiten al `NOTICE.md` de la raíz.
- **Cabecera en cada archivo copiado:** `// Derived from Trustless-Work/trustlesswork-smart-contract-stellar@1d22d0c (<ruta>), modified. See /NOTICE.md`. **Cada cambio nuestro se marca con `// FIANZAS:`** (regla de `CLAUDE.md`), para poder revisar el diff contra el original.
- `README.md` (área libre) enlaza el `NOTICE.md`.
- **Comunicación a TW** (responsable: P1; no se menciona en el pitch): avisar en privado de que `trustless_work_address` llega como argumento del llamante en `release_funds`, `resolve_dispute` y `withdraw_remaining_funds` (v1 y v2).

---

## 2. Overview

```
 casero (passkey) ──create_fianza──▶ FianzaFactory ──deploy(wasm_hash, salt=id, EscrowInit)──▶ Escrow #id (1 contrato por fianza)
 inquilino (passkey) ──fund_escrow──▶ Escrow #id ──deposit (authorize_as_current_contract)──▶ Vault DeFindex (o ninguno: NoYield)
                                         │◀── withdraw (al liquidar), medido por diferencia ──┘
                                         └── register_tenant ──▶ FianzaFactory (índice del panel; solo en la entrada)
 staff (Freighter) ── assign_expert / record_report / resolve ──▶ Escrow #id
```

1. **`FianzaFactory`** (P1, nuevo): despliega un escrow por fianza; guarda el wasm hash, la configuración global, el registro de estrategias, los índices por casero e inquilino y la pausa, y emite eventos.
2. **`escrow`** (P1, fork de TW v2): máquina de estados de **una** fianza con quórum 2, vault de DeFindex, `split()` sobre el rendimiento, stop bond, timeout del inquilino y timeout de revisión.
3. **`mock-vault`** (P2): implementa el subconjunto de la interfaz del vault de DeFindex que usa el escrow, con `set_rate_bps`.
4. **Paquetes TS** sin cambios de rol: `packages/wallet` (passkey y Relayer, con una política nueva para direcciones dinámicas) y `packages/anchor` (ramp simulado o SEP-24).
5. **Apps Next.js**: `apps/web` (casero e inquilino) y `apps/backoffice` (staff).

No hay backend con estado ni base de datos. La fuente de verdad es on-chain: la factory (registro e índices) y cada escrow (estado y dinero).

## 3. Architectural Style

**Factory + instancia por agregado (un contrato por fianza) on-chain; monolito modular en el cliente; BFF mínimo sin estado en Next.js.**

- **Justificación**
  - Una fianza es un agregado independiente: no comparte dinero ni estado con otras. Un contrato por fianza aísla el riesgo y es el modelo de TW. La factory da descubribilidad (índices) sin indexer.
  - **La configuración se copia al crear la fianza** (snapshot), de modo que la instancia no depende de la factory para salir. Solo la entrada (`fund_escrow`) consulta a la factory (pausa, estrategia habilitada y registro del inquilino).
  - **Dentro del escrow, núcleo puro + cáscara con efectos**: `split()`, `effective_status()` y los cálculos de plazos son puros y se prueban sin `Env`. Los entrypoints comprueban auth y estado, hacen I/O (token, vault) y emiten eventos.
  - **Monolito modular TS con puertos y adaptadores**: igual que en la versión anterior.

---

## 4. Project Structure

Entre paréntesis, el dueño según `harness/team.json` (con el cambio de § 4.1).

```
stellar-fianzas/
├── Cargo.toml                         (deps) workspace: members = ["contracts/*"]; soroban-sdk = "28.0.0"; perfil release copiado de TW
├── rust-toolchain.toml                (deps) target wasm32v1-none
├── package.json, pnpm-workspace.yaml  (deps)
├── contracts/
│   ├── escrow/                        (P1) FORK de TW single-release-develop-v2 @ 1d22d0c
│   │   ├── Cargo.toml                 crate-type ["cdylib"]; dev-deps: soroban-sdk testutils, mock-vault (rlib)
│   │   ├── README.md                  remite a /NOTICE.md (permiso de TW, origen, lista de cambios)
│   │   └── src/
│   │       ├── lib.rs                 [FORK] árbol de módulos
│   │       ├── contract.rs            [FORK] entrypoints de la fianza (§ 6.2)
│   │       ├── error.rs               [FORK] un único EscrowError con códigos únicos
│   │       ├── events/handler.rs      [FORK] eventos fz_*
│   │       ├── storage/types.rs       [FORK] Terms, Escrow, Strategy, Settlement…
│   │       ├── core/
│   │       │   ├── escrow.rs          [FORK] constructor, fund_escrow, cancel, lecturas
│   │       │   ├── milestone.rs       [FORK] aprobaciones con quórum (de approve_milestones_inner)
│   │       │   ├── dispute.rs         [FORK] stop, assign_expert, record_report, resolve
│   │       │   ├── stop_bond.rs       [NUEVO] cobro y pago del bond
│   │       │   ├── timeout.rs         [NUEVO] effective_status, plazos, claim_after_timeout, claim_after_review_timeout
│   │       │   ├── settle.rs          [NUEVO] único sitio que paga
│   │       │   └── validators/{escrow,milestone,dispute}.rs   [FORK]
│   │       ├── modules/
│   │       │   ├── vault/{mod.rs, defindex.rs}  [NUEVO] subconjunto de DeFindex + deposit/withdraw/preview
│   │       │   ├── split/mod.rs       [NUEVO] reparto puro sobre el rendimiento
│   │       │   ├── fee/calculator.rs  [FORK] fees sobre el rendimiento (tw_fee_bps parametrizado)
│   │       │   ├── fee/distribution.rs [FORK] pay_settlement con destinos fijos (sin Map)
│   │       │   └── math/{basic,safe}.rs [TW-v2] sin cambios, salvo el tipo de error
│   │       └── tests/                 [NUEVO] matriz de split, auth, estados, bond, timeouts, vault, C-address
│   ├── factory/                       (P1) [NUEVO] FianzaFactory · AÑADIR AL ÁREA DE P1 (§ 4.1)
│   │   ├── Cargo.toml                 crate-type ["cdylib"]; importa el escrow con contractimport!
│   │   ├── README.md                  remite a /NOTICE.md (patrón derivado de tw_new_single_release_escrow)
│   │   └── src/
│   │       ├── lib.rs, contract.rs    entrypoints (§ 6.3)
│   │       ├── config.rs              GlobalConfig + validación
│   │       ├── strategies.rs          registro y estrategia por defecto
│   │       ├── deploy.rs              salt(id) y despliegue con EscrowInit
│   │       ├── bond.rs                compute_stop_bond (fórmula única)
│   │       ├── index.rs               índices paginados por casero e inquilino
│   │       ├── events.rs, error.rs, storage.rs
│   │       └── tests/                 create, batch, registro, pausa, register_tenant, config
│   ├── mock-vault/                    (P2) subconjunto DeFindex + __constructor(admin, asset) + set_rate_bps(i32)
│   └── yield-adapter/                 (P2) PLAN C: solo si DeFindex en testnet no sirve (Blend directo con la MISMA interfaz)
├── packages/
│   ├── bindings/                      (P2, generado y commiteado) factory/, escrow/, token/
│   ├── wallet/                        (P3) igual que antes + política de direcciones dinámicas (§ 8.2)
│   └── anchor/                        (P3) igual que antes
├── apps/
│   ├── web/                           (P4) panel del casero, creación con estrategia, flujo del inquilino, monta apps/api en app/api/[[...path]]/route.ts (un único archivo)
│   ├── api/                           (P2) [NUEVO] @fianzas/api: Hono, compatible con la Core API v2 de TW + /fianzas/v1 (§ 6.8); cliente @fianzas/api/client
│   └── backoffice/                    (P4) cola de paradas, perito, informe, resolve con stop_justified
├── deployments/                       (P2) testnet.json (§ 6.6), @fianzas/deployments
├── scripts/                           (P2) deploy/, fund/, e2e/, bindings.sh
└── pitch/                             (P4)
```

**Rutas que cambian respecto a la versión anterior:** `contracts/escrow/src/{lib,types,errors,events,storage,split,rules,vault}.rs` se sustituyen por la estructura del fork de TW, y aparece `contracts/factory/`. `contracts/yield-adapter/` pasa a ser solo plan C.

### 4.1 Cambios en `harness/team.json` y `CLAUDE.md` (PR de P2 en G0 con `/lock harness`; no los hace este agente)

- **Área nueva `api`** (§ 6.8.8): `{ "id": "api", "owner": "P2", "paths": ["apps/api/**"], "scopes": ["api"] }`, antes de `"web"`. En `CLAUDE.md`: fila de P2 += `apps/api/` y scopes += `api`. (`CLAUDE.md` ya refleja `contracts/factory/`, el scope `factory` y `NOTICE.md` en la raíz, compartido.)
- Área `escrow`: `"paths": ["contracts/escrow/**", "contracts/factory/**"]` y `"scopes": ["escrow", "factory"]`. **La factory es de P1.** Se usa la misma área y no una nueva, para que el guard, CODEOWNERS y la CI la traten igual sin más reglas.
- `CLAUDE.md`, tabla de roles: P1 → `contracts/escrow/` (fork de TW) y `contracts/factory/`. Lista de scopes += `factory`.
- Lo que ya proponían la versión anterior y security (HAR-11): `deps` += `tsconfig.base.json`, `.npmrc`, `.nvmrc`, `.cargo/**`, `vercel.json`; `harness` += `.env.example`, `.gitignore`, `.gitattributes`, `.vscode/**`; `docs` += `.kiro/**`.
- `node scripts/harness/sync-codeowners.mjs`.
- **CI (`.github/`, área `ci`, con lock):** el job de tests debe compilar el wasm del escrow **antes** de `cargo test -p factory` (§ 9, `contractimport!`).

---

## 5. Cambios concretos por archivo del fork

Referencia: rutas de TW v2 bajo `contracts/escrow/src/`.

| Archivo (TW v2) | Acción | Qué cambia exactamente |
|---|---|---|
| `contract.rs` | **Modificar** | `__constructor(admin, approved_wasm_hash)` → `__constructor(init: EscrowInit)`, que inicializa de forma atómica en el despliegue y elimina la ventana sin inicializar y la clave de admin. **Se eliminan:** `tw_new_single_release_escrow` (pasa a la factory), `initialize_escrow` (lo sustituye el constructor), `update_escrow` y `manage_milestones` (el admin no cambia condiciones), `change_milestone_status` (no hay entregables), `approve_milestones` y `approve_and_release_milestones` (se fusionan en `approve_release`), `release_funds` (pasa a `settle` interno), `withdraw_remaining_funds` (reparto libre del resolver, no permitido), `get_escrow_by_contract_id` y `get_multiple_escrow_balances` (pasan a la factory). **Se modifican:** `fund_escrow(signer, expected_escrow, amount)` → `fund_escrow(tenant, invite_code, expected_terms)`; `dispute_escrow(signer, reason)` → `stop(reason_hash)`; `resolve_dispute(dispute_resolver, trustless_work_address, distributions)` → `resolve(resolver, deduction, stop_justified)`; `extend_contract_ttl(admin, ledgers)` → `extend_contract_ttl()` sin permisos. **Se añaden:** `cancel`, `assign_expert`, `record_report`, `claim_after_timeout`, `claim_after_review_timeout`, `get_terms`, `get_roles`, `get_view`, `accrued_yield` y `preview_settlement`. |
| `core/escrow.rs` | **Modificar** | `initialize_escrow` → `init_from_constructor(e, init)`: valida (defensa en profundidad, con `panic_with_error!`) y guarda en **instance storage**. `fund_escrow`: (1) `tenant.require_auth()`; (2) `status == Proposed`; (3) `expected_terms == stored.terms` (`TermsMismatch`; es el `expected_escrow` de TW); (4) invitación o inquilino fijado; (5) `factory.funding_allowed(strategy_id)` (`Paused`); (6) `token.transfer(tenant → escrow, amount)` medido por diferencia (**cambio**: en TW cualquier `signer` fondea cualquier importe, varias veces, con `FundedAmount`; aquí hay un único fondeo, del inquilino, por el importe exacto); (7) si la estrategia es `DeFindexVault`, `vault::deposit_all(...)` con `authorize_as_current_contract` y las shares medidas por diferencia; (8) se fija `tenant`, `approvers += tenant` y `Active`; (9) `factory.register_tenant(id, tenant)`; (10) evento `fz_fund`. `release_funds_execute` → se mueve a `core/settle.rs` y deja de pagar `escrow.amount` con fee sobre el bruto. Se eliminan `change_escrow_properties`, `manage_milestones`, `get_multiple_escrow_balances` y `get_escrow_by_contract_id`. |
| `core/milestone.rs` | **Modificar** | Se conserva la lógica de `approve_milestones_inner` (`approved_by.push_back`, `approval_count = len`, rechazo de duplicados) sobre **una sola** aprobación (`Escrow.approvals`), sin `Vec<Milestone>`. `approve_release(approver)`: `require_auth`, valida y, si `approval_count >= target (2)`, llama a `settle(Approved)`. Se elimina `change_milestone_status`. |
| `core/dispute.rs` | **Modificar** | `dispute_escrow` → `stop(reason_hash)`: solo `terms.landlord`; `Active`; el casero no aprobó; `now ≤ end_ts + timeout_secs`; cobra el bond (`stop_bond.rs`); `Stopped`; `stopped_ts`. `resolve_dispute(..., distributions: Map)` → `resolve(resolver, deduction, stop_justified)`: `resolver ∈ terms.dispute_resolvers`; `UnderReview`; `now ≤ stopped_ts + review_timeout_secs`; informe; `0 ≤ deduction ≤ amount`; `!stop_justified ⇒ deduction == 0`; `settle(Resolved)` y después el bond al casero o a la tesorería. **Se elimina el reparto libre por `Map<Address, i128>`**: el resolver ya no puede enviar fondos a terceros. **Se elimina** `withdraw_remaining_funds`. **Se añaden** `assign_expert` (borra `report_hash` al reasignar, AUTHZ-5) y `record_report`. Se elimina el guard `DataKey::Reentrancy` en persistent: Soroban impide la reentrada de forma nativa y el guard costaba una escritura persistente (Security debe confirmarlo, § 12 R-10). |
| `core/validators/escrow.rs` | **Modificar** | Se conservan `has_duplicate_addresses` y la idea de `validate_dispute_resolver_role_overlap`/`validate_admin_role_overlap`, convertidas en `validate_parties(terms, tenant)` → `InvalidParty` (AUTHZ-4: partes ∉ {staff, treasury, factory, escrow, vault, token, tw_fee_receiver}, y `tenant ≠ landlord` → `SameParty`). Se eliminan la validación de cadenas, los milestones y los cambios de propiedades. `validate_fund_escrow_conditions` se reescribe con las comprobaciones de `fund_escrow`. `validate_release_conditions` pasa a "estado `Active` y quórum alcanzado". |
| `core/validators/milestone.rs` | **Modificar** | `validate_batch_milestone_approve` → `validate_approve(escrow, approver)`: `approver ∈ {landlord, tenant}` (`NotParty`), `Active` (`BadStatus`) y no aprobado ya (`AlreadyApproved`). El `target` (2) se fija en el constructor. La regla upstream `target ≤ approvers.len()` se valida en `fund_escrow`, porque al crear la fianza solo hay un approver (el inquilino todavía no existe). |
| `core/validators/dispute.rs` | **Modificar** | `validate_dispute_flag_change_conditions` → `validate_stop` (solo el casero, ya no "cualquier rol"). `validate_dispute_resolution_conditions` → `validate_resolve` (sin `distributions`, `total == balance` ni `MAX_DISTRIBUTIONS`). Se elimina `validate_withdraw_remaining_funds_conditions`. |
| `core/stop_bond.rs` | **Nuevo** | `collect_bond(e, esc)`: comprueba el saldo (`InsufficientBond`), hace `transfer(landlord → escrow, stop_bond)` medido por diferencia y fija `bond_held`. `pay_bond(e, esc, justified)`: destino `landlord` si está justificada y `treasury` si no; `bond_held = 0`; evento `fz_bond`. El bond **nunca** entra en el vault ni en `Settlement`. |
| `core/timeout.rs` | **Nuevo** | `effective_status(esc, now)` (`Ending` derivado). `timeout_at = end_ts + timeout_secs` y `review_deadline = stopped_ts + review_timeout_secs`, con `checked_add`. `claim_after_timeout()`: `Active` y `now > timeout_at` → `settle(0, Timeout)`. `claim_after_review_timeout()`: `Stopped|UnderReview` y `now > review_deadline` → `settle(0, ReviewTimeout)` + `pay_bond(justified = true)` (el bond vuelve al casero, OC-5) y `stop_justified = None`. |
| `core/settle.rs` | **Nuevo** | `settle(e, esc, deduction, path) -> Settlement`, el **único** sitio que paga principal y rendimiento: `withdraw` de todas las shares (o principal líquido si es `NoYield`) → `total` por diferencia → `deduction = min(deduction, principal_back)` (CT-7) → `split()` → escribe `Settled`, `settlement` y `path` → `pay_settlement` → evento `fz_settle`. |
| `modules/vault/mod.rs` + `defindex.rs` | **Nuevo** | Subconjunto de la interfaz del vault de DeFindex (§ 6.5): `deposit_all`, `withdraw_all` y `preview_value`. `deposit` se invoca con `try_invoke_contract::<Val, _>` y **se ignora su retorno** (sus tipos `AssetInvestmentAllocation` no se replican): las shares se miden con `balance(escrow)` antes y después, y deben ser `> 0`. `authorize_as_current_contract` autoriza **exactamente** `token.transfer(escrow, vault, amount)` (security § 4.1 fragmento 1, con `vault.balance` en lugar de `shares_of`). |
| `modules/split/mod.rs` | **Nuevo** | `split(total, amount, deduction, platform_fee_bps, tw_fee_bps, tenant_yield_bps) -> Result<Settlement, EscrowError>` (§ 6.4), puro, con matriz de tests. Lo usan `settle` y `preview_settlement`. |
| `modules/fee/calculator.rs` | **Modificar** | Se elimina la constante `TRUSTLESS_WORK_FEE_BPS = 30` y pasa a ser **parámetro** (`terms.tw_fee_bps`). `calculate_standard_fees(total_amount, platform_fee_bps)` → `calculate_yield_fees(yield_amount, platform_fee_bps, tw_fee_bps) -> YieldFeeResult { trustless_work_fee, platform_fee, net_yield }`. **La base es el rendimiento, no el bruto.** Se mantiene `safe_mul_div` de v2. |
| `modules/fee/distribution.rs` | **Reescribir** | `calculate_and_distribute_fees(..., distributions: Map<Address, i128>, total)` (reparto libre pro rata) → `pay_settlement(token, me, s: &Settlement, tenant, landlord, treasury, tw_receiver: Option<Address>)`: destinos fijos, sin transferencias de 0, y el fee de TW solo si `to_tw > 0` y `tw_receiver` es `Some`. |
| `modules/math/{basic,safe}.rs` | **Conservar** | Sin cambios de lógica. `Overflow/Underflow/DivisionError` → `EscrowError::Arithmetic`. |
| `storage/types.rs` | **Modificar** | `Escrow { engagement_id, title, description, roles, amount, platform_fee, milestones, dispute, released, trustline, receiver_memo }` → nuestro `Escrow` (§ 6.2): sin cadenas (sin datos personales on-chain, DAT-1), con `status: Status` en lugar de `released`/`dispute.is_disputed`/`dispute.resolved`, `approvals: Approvals` (el `MilestoneApprovals` de v2) en lugar de `milestones`, y nuevos `Terms`, `Strategy`, `Dispute` (con bond), `Settlement` y `SettlePath`. `Roles` se conserva **con la forma de v2** como tipo de lectura (`get_roles()`). `DataKey { Escrow, Admin, FundedAmount, Reentrancy, ApprovedWasmHash }` → `DataKey { Escrow }` en **persistent** (como el upstream y como exige `CLAUDE.md`), con `extend_ttl(17280, max_ttl)` en cada escritura **y** `instance().extend_ttl` en la misma llamada. Una sola entrada de datos: nada se archiva por separado (el upstream ya tuvo que extender `FundedAmount` a mano). `extend_contract_ttl()` extiende las dos. |
| `events/handler.rs` | **Modificar** | Topics `tw_*` → **`fz_*`** (§ 6.2), para que un indexer de TW no interprete eventos con otra semántica. Se mantiene el estilo `#[contractevent]` con campos con nombre. Se elimina `hash_string` porque ya no hay cadenas. |
| `error.rs` | **Reescribir** | `EscrowError` (48 códigos) + `MilestoneError` (17 códigos), que **se solapan** (el código 2 significa cosas distintas según el enum, lo que hace ambiguo el mapeo en el cliente), → **un único `EscrowError`** con códigos únicos (§ 6.2). |
| `lib.rs` | **Modificar** | Árbol de módulos nuevo y `#![no_std]`. |
| `tests/*` | **Sustituir** | Los tests de TW sobre milestones, `update_escrow` y reparto libre ya no aplican. Se conserva el estilo de `helpers.rs`. Tests nuevos: los de security § 5 y § 12.9, la matriz de `split` con fee de TW, el quórum con cuentas contrato y el vault con `mock-vault` y `evil_vault`. |

**Resultado esperado:** del upstream se reutilizan sobre todo `math/`, la lógica de quórum, los validadores de roles y el patrón de eventos y errores. Lo nuevo o reescrito, unas 700–900 líneas de Rust con los tests, es `settle`, `split`, `vault`, `stop_bond`, `timeout` y la factory.

---

## 6. Interfaces para G1 (`docs/INTERFACES.md`)

Convenciones: importes `i128` en la unidad mínima del token (7 decimales) y porcentajes en bps (10000 = 100 %). Constantes: `MAX_AMOUNT = 10^15`, `MAX_TERM_SECS = 3 × 365 × 86400`, `MAX_BATCH = 10`, `MAX_PAGE = 50`, `MAX_VIEWS = 25`.

### 6.1 Correspondencia de roles de Trustless Work [AD-14]

| Rol TW v2 | Valor en cada fianza | Cómo se fija | Nota |
|---|---|---|---|
| `approvers` (quórum `target = 2`) | `[landlord, tenant]` | `landlord` al crear; `tenant` se añade en `fund_escrow` | Liberación con las dos firmas, sin orden. **Alternativa con v1:** approver = casero (`approve`) y `release_signer` = inquilino (la 2.ª firma libera). |
| `release_signers` | `= approvers` | — | La liberación se ejecuta dentro de la aprobación que alcanza el quórum (semántica de `approve_and_release_milestones`). |
| `service_providers` | `[landlord]` | al crear | Obligatorio no vacío en v2. Sin milestones, no tiene funciones. |
| `dispute_resolvers` | `config.staff` (1–3 direcciones) | copia en `Terms` al crear | Cualquiera de ellos puede resolver. Varias direcciones mitigan el staff ausente. Inmutable por fianza. |
| `platform` | `config.treasury` | copia en `Terms` | Recibe `platform_fee` (del rendimiento) y el bond perdido. |
| `receiver` | `tenant` | en `fund_escrow` | Principal − deducción + su parte del rendimiento. **Receptores adicionales del fork:** `landlord` (deducción + su parte + bond devuelto) y `tw_fee_receiver`. |
| `admin` | dirección de la factory | constructor | **Sin poderes** en el escrow (no hay `update_escrow`). Solo identifica el origen. |
| `observers` | `[]` | — | Las lecturas son públicas. |
| (no existe en TW) | `claim_after_timeout`, `claim_after_review_timeout`, stop bond y vault | — | Extensiones del fork. |

**Vinculación del inquilino invitado** (se mantiene [AD-3] y FR-2):
1. El navegador del casero genera `code = getRandomValues(32 B)` e `invite_hash = sha256(code)`, y llama a `create_fianza(landlord, { tenant: None, invite_hash: Some(h), … })`.
2. Enlace: `https://<dominio>/i/<id>#c=<base64url(code)>`. El **`id`** se resuelve a la dirección del escrow con `factory.escrow_of(id)`, nunca desde la URL (WEB-2 y WEB-11).
3. El inquilino crea su passkey, lee `get_terms()`, ve las condiciones y la estrategia con su aviso de riesgo, y firma `fund_escrow(tenant, Some(code), expected_terms)`.
4. El escrow comprueba `sha256(code) == invite_hash`, fija `tenant`, `approvers += tenant` y llama a `factory.register_tenant(id, tenant)`, que comprueba que el llamante es `escrow_of(id)` y añade el id al índice del inquilino.
5. Si el casero conoce la dirección (`tenant: Some(t)`, `invite_hash: None`), `fund_escrow` exige `tenant == t`. Exactamente uno de los dos debe estar presente.

### 6.2 Contrato `escrow` (fork, P1)

#### Tipos (`storage/types.rs`)
```rust
#[contracttype] #[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Status { Proposed, Active, Ending /* DERIVADO, nunca se almacena */, Stopped, UnderReview, Settled, Cancelled }

#[contracttype] #[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SettlePath { Approved, Resolved, Timeout, ReviewTimeout }

#[contracttype] #[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum StrategyKind { NoYield, DeFindexVault }

#[contracttype] #[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RiskTier { NoYield, Standard, High }   // NINGUNO significa "sin riesgo" (ver § 7)

#[contracttype] #[derive(Clone, Debug, Eq, PartialEq)]
pub struct Strategy {
    pub id: Symbol,               // "usdc_fixed", "usdc_mock", "custody", …
    pub kind: StrategyKind,
    pub vault: Option<Address>,   // Some ⇔ DeFindexVault (el vault al que deposita el escrow)
    pub asset: Address,           // token de la fianza; == config.token (USDC)
    pub asset_name: String,       // "USDC:G…" = name() del SAC ⇒ fija CÓDIGO + EMISOR exactos (anti-falsificación)
    pub defindex_strategy: Option<Address>, // estrategia subyacente del vault (informativo, para el front)
    pub apy_pool: Option<Address>,          // pool de Blend del que el front lee el supply APY en vivo
    pub risk: RiskTier,
    pub simulated: bool,          // true ⇔ mock-vault (NFR-11: la UI lo etiqueta)
    pub enabled: bool,            // false ⇒ no se usa en fianzas NUEVAS; las existentes no se tocan
    pub max_vault_fee_bps: u32,   // tope de la comisión del vault DeFindex (sobre ganancias) que se admite; 0 si NoYield
}

#[contracttype] #[derive(Clone, Debug, Eq, PartialEq)]
pub struct Terms {                // inmutable desde el constructor; el inquilino lo firma en fund_escrow
    pub factory: Address,
    pub id: u64,
    pub landlord: Address,
    pub amount: i128,
    pub end_ts: u64,
    pub tenant_yield_bps: u32,    // copia de GlobalConfig.tenant_yield_bps al crear (#16); el casero no lo elige
    pub strategy: Strategy,       // snapshot
    pub platform_fee_bps: u32,    // sobre el rendimiento
    pub tw_fee_bps: u32,          // sobre el rendimiento (Q-16)
    pub tw_fee_receiver: Option<Address>,
    pub defindex_vault_fee_bps: u32,    // SNAPSHOT de vault.get_fees().0 al crear (0 si NoYield). Lo cobra el vault, no split()
    pub defindex_protocol_fee_bps: u32, // SNAPSHOT de vault.get_fees().1 al crear (0 si NoYield). Ídem
    pub treasury: Address,
    pub dispute_resolvers: Vec<Address>,
    pub timeout_secs: u64,
    pub review_timeout_secs: u64,
    pub stop_bond: i128,          // min(max(min, amount·bps/10000), amount), calculado por la factory
}

#[contracttype] #[derive(Clone, Debug, Eq, PartialEq)]
pub struct EscrowInit { pub terms: Terms, pub tenant: Option<Address>, pub invite_hash: Option<BytesN<32>> }

#[contracttype] #[derive(Clone, Debug, Eq, PartialEq)]
pub struct Approvals { pub target: u32, pub approval_count: u32, pub approved_by: Vec<Address> } // = MilestoneApprovals (TW v2)

#[contracttype] #[derive(Clone, Debug, Eq, PartialEq)]
pub struct Dispute {
    pub reason_hash: Option<BytesN<32>>,   // sha256(sal ‖ motivo), DAT-2
    pub stopped_ts: u64,                   // 0 si no hubo parada
    pub expert_ref: Option<BytesN<32>>,
    pub report_hash: Option<BytesN<32>>,
    pub bond_held: i128,
    pub stop_justified: Option<bool>,      // Some al resolver; None en ReviewTimeout
}

#[contracttype] #[derive(Clone, Debug, Eq, PartialEq)]
pub struct Settlement {
    pub total: i128,          // retirado del vault (o principal líquido si NoYield)
    pub yield_total: i128,    // max(total − amount, 0)
    pub deduction: i128,      // efectiva, tras el recorte de CT-7
    pub to_tenant: i128,
    pub to_landlord: i128,
    pub to_treasury: i128,    // platform fee (NO incluye el bond)
    pub to_tw: i128,          // fee de TW sobre el rendimiento
}

#[contracttype] #[derive(Clone, Debug, Eq, PartialEq)]
pub struct Escrow {
    pub terms: Terms,
    pub tenant: Option<Address>,
    pub invite_hash: Option<BytesN<32>>,
    pub status: Status,                    // almacenado (nunca Ending)
    pub approvals: Approvals,              // target = 2
    pub shares: i128,                      // shares del vault (0 si NoYield)
    pub created_ts: u64,
    pub funded_ts: u64,
    pub dispute: Dispute,
    pub settlement: Option<Settlement>,
    pub path: Option<SettlePath>,
}

#[contracttype] #[derive(Clone, Debug, Eq, PartialEq)]
pub struct Roles {                         // forma TW v2, calculada (no se almacena)
    pub approvers: Vec<Address>, pub service_providers: Vec<Address>, pub platform: Address,
    pub release_signers: Vec<Address>, pub dispute_resolvers: Vec<Address>,
    pub receiver: Option<Address>, pub admin: Address, pub observers: Vec<Address>,
}

#[contracttype] #[derive(Clone, Debug, Eq, PartialEq)]
pub struct EscrowView {
    pub data: Escrow,
    pub status: Status,         // EFECTIVO (Ending incluido)
    pub accrued_yield: i128,    // estimación bruta; 0 si el vault falla (CT-10)
    pub timeout_at: u64,        // end_ts + timeout_secs
    pub review_deadline: u64,   // stopped_ts + review_timeout_secs, o 0
}
```

#### Funciones

| Función | `require_auth` | Precondiciones (error) | Estado |
|---|---|---|---|
| `__constructor(init: EscrowInit)` | — (solo la despliega la factory; ver R-3) | `amount ∈ (0, MAX_AMOUNT]`; `end_ts > now`; bps válidos; `platform_fee_bps + tw_fee_bps ≤ 10000`; exactamente uno de `tenant`/`invite_hash`; `dispute_resolvers` 1–3 sin duplicados; si `tw_fee_bps > 0`, hay `tw_fee_receiver`. Si falla: `panic_with_error!` | — → `Proposed`. `approvals = {target: 2, count: 0, by: []}` |
| `cancel()` | `terms.landlord` | `Proposed` (BadStatus) | → `Cancelled` |
| `fund_escrow(tenant: Address, invite_code: Option<BytesN<32>>, expected_terms: Terms) -> i128` (shares) | `tenant` (+ `token.transfer(tenant, escrow, amount)` anidado) | `Proposed`; `now < end_ts` (InvalidEndTs); `expected_terms == terms` (TermsMismatch); invitación (InvalidInvite) o `tenant == fijado` (NotParty); `tenant ≠ landlord` (SameParty); partes (InvalidParty); `factory.funding_allowed(strategy.id)` (Paused); si hay vault: `vault.get_fees()` **≤ snapshot** en las dos componentes (VaultFeeChanged, § 6.9); transferencia medida `== amount` (InvalidAmount); shares > 0 (VaultError) | `Proposed` → `Active` |
| `approve_release(approver: Address) -> Option<Settlement>` | `approver` | `approver ∈ {landlord, tenant}` (NotParty); almacenado `Active` (BadStatus); no aprobado ya (AlreadyApproved). Vale antes y después de `end_ts`, y también tras el plazo | `Active` → (al llegar a 2) `Settled`, `Approved` |
| `stop(reason_hash: BytesN<32>)` | `terms.landlord` (+ `token.transfer(landlord, escrow, stop_bond)` anidado) | `Active` (BadStatus); el casero no aprobó (AlreadyApproved); `now ≤ timeout_at` (DeadlinePassed); `balance(landlord) ≥ stop_bond` (InsufficientBond). **La pausa no lo bloquea** | `Active` → `Stopped` |
| `assign_expert(resolver: Address, expert_ref: BytesN<32>)` | `resolver` | `resolver ∈ dispute_resolvers` (NotResolver); `Stopped` o `UnderReview` (BadStatus). Al reasignar borra `report_hash` | → `UnderReview` |
| `record_report(resolver: Address, report_hash: BytesN<32>)` | `resolver` | NotResolver; `UnderReview` | `UnderReview` |
| `resolve(resolver: Address, deduction: i128, stop_justified: bool) -> Settlement` | `resolver` | NotResolver; `UnderReview`; `now ≤ review_deadline` (ReviewDeadlinePassed); `report_hash` (ReportMissing); `0 ≤ deduction ≤ amount` (InvalidAmount/DeductionTooHigh); `!stop_justified ⇒ deduction == 0` (IncoherentResolution) | → `Settled`, `Resolved` (+ bond) |
| `claim_after_timeout() -> Settlement` | **ninguna** | `Active` (BadStatus); `now > timeout_at` (TimeoutNotReached) | → `Settled`, `Timeout` |
| `claim_after_review_timeout() -> Settlement` | **ninguna** | `Stopped` o `UnderReview` (BadStatus); `now > review_deadline` (ReviewTimeoutNotReached) | → `Settled`, `ReviewTimeout`; bond → casero |
| `extend_contract_ttl()` | ninguna | — | instancia y código a `max_ttl` |
| `get_escrow() -> Escrow` | — | — (sin llamadas externas) | lectura |
| `get_terms() -> Terms` | — | — | lectura |
| `get_roles() -> Roles` | — | forma TW v2 | lectura |
| `get_view() -> EscrowView` | — | llama al vault con `try_` | lectura |
| `accrued_yield() -> i128` | — | `max(preview − amount, 0)`; 0 si `NoYield`, sin fondos o con fallo | lectura |
| `preview_settlement(deduction: i128) -> Settlement` | — | estado con fondos; mismo `split()` | lectura |

**Bordes temporales complementarios** (CT-4 ampliado): `Ending ⇔ Active ∧ now ≥ end_ts`; `stop ⇔ now ≤ timeout_at`; `claim_after_timeout ⇔ now > timeout_at`; `resolve ⇔ now ≤ review_deadline`; `claim_after_review_timeout ⇔ now > review_deadline`. Para un mismo `now`, nunca pueden ejecutarse a la vez dos caminos que compitan.

#### Eventos (`#[contractevent]`, data con nombres; topic 0 = nombre y topic 1 = `id`)
| Topic 0 | Data |
|---|---|
| `fz_init` | `factory, landlord, amount, end_ts, tenant_yield_bps, strategy_id, stop_bond, has_invite: bool, platform_fee_bps, tw_fee_bps, defindex_vault_fee_bps, defindex_protocol_fee_bps` |
| `fz_cancel` | `landlord` |
| `fz_fund` | `tenant, amount, shares` |
| `fz_approve` | `approver, approval_count` |
| `fz_stop` | `landlord, reason_hash, bond` |
| `fz_expert` | `resolver, expert_ref` |
| `fz_report` | `resolver, report_hash` |
| `fz_settle` | `settlement: Settlement, path: SettlePath, vault_fees_at_settle: Option<(u32, u32)>` (lectura con `try_` de `get_fees()` para reporting; **nunca** bloquea la salida) |
| `fz_bond` | `to, amount, justified: Option<bool>` (`None` en ReviewTimeout) |

#### Errores (`error.rs`, único enum)
```rust
#[contracterror] #[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)] #[repr(u32)]
pub enum EscrowError {
    BadStatus = 1, NotParty = 2, AlreadyApproved = 3, TimeoutNotReached = 4,
    InvalidBps = 5, InvalidAmount = 6, DeductionTooHigh = 7, VaultError = 8,
    InvalidInvite = 9, DeadlinePassed = 10, SameParty = 11, InvalidEndTs = 12,
    ReportMissing = 13, InvalidParty = 14, IncoherentResolution = 15, InsufficientBond = 16,
    TermsMismatch = 17, NotResolver = 18, ReviewTimeoutNotReached = 19, ReviewDeadlinePassed = 20,
    Paused = 21, Arithmetic = 22, InvalidConfig = 23, FactoryCall = 24, VaultFeeChanged = 25,
}
```

### 6.3 Contrato `FianzaFactory` (nuevo, P1)

#### Tipos (importa `Strategy`, `StrategyKind`, `RiskTier`, `Terms`, `EscrowInit`, `Escrow` y `Status` del escrow con `contractimport!`)
```rust
#[contracttype] #[derive(Clone, Debug, Eq, PartialEq)]
pub struct GlobalConfig {
    pub token: Address,                 // USDC del vault por defecto
    pub treasury: Address,              // platform de TW
    pub staff: Vec<Address>,            // 1..=3 → dispute_resolvers de las fianzas NUEVAS
    pub platform_fee_bps: u32,          // demo 2000; ≤ 5000
    pub tw_fee_bps: u32,                // MVP: 0 (no se cobra). Si TW lo acuerda: 30, solo sobre el rendimiento (Q-16)
    pub tw_fee_receiver: Option<Address>,
    pub timeout_secs: u64,              // demo 120; prod 30 días; ≥ 60
    pub review_timeout_secs: u64,       // demo 300; prod 30 días; ≥ 60
    pub stop_bond_min: i128,            // demo 100_000_000 (10 USDC); 0..=MAX_AMOUNT
    pub stop_bond_bps: u32,             // demo 500; ≤ 2000
    pub tenant_yield_bps: u32,          // parte del rendimiento neto para el inquilino, según la jurisdicción (#16). MVP (Portugal): 0 → todo al casero; ≤ 10000
    pub vault_manager: Option<Address>, // Some ⇒ add_strategy exige vault.get_manager() == esto (vaults propios; mainnet). Testnet: None
}

#[contracttype] #[derive(Clone, Debug, Eq, PartialEq)]
pub struct FianzaParams {
    pub tenant: Option<Address>,
    pub invite_hash: Option<BytesN<32>>,
    pub amount: i128,
    pub end_ts: u64,
    pub strategy_id: Option<Symbol>,    // None → estrategia por defecto
    pub nonce: BytesN<32>,              // salt = sha256(landlord ‖ nonce): dirección del escrow conocida ANTES de firmar (compatibilidad con el `contractId` del deploy de TW)
}

#[contracttype] #[derive(Clone, Debug, Eq, PartialEq)]
pub struct Created { pub id: u64, pub escrow: Address }

#[contracttype] #[derive(Clone, Debug, Eq, PartialEq)]
pub struct FianzaSummary { pub id: u64, pub escrow: Address, pub data: Escrow, pub status: Status /* efectivo */ }
```

#### Funciones
| Función | Auth | Precondiciones (error) | Efecto |
|---|---|---|---|
| `__constructor(admin, escrow_wasm_hash: BytesN<32>, config: GlobalConfig)` | — | config válida (InvalidConfig) | — |
| `create_fianza(landlord: Address, p: FianzaParams) -> Created` | `landlord` | no pausada (Paused); estrategia existe (StrategyNotFound) y `enabled` (StrategyDisabled); `amount ∈ (0, MAX_AMOUNT]` (InvalidAmount); `now < end_ts ≤ now + MAX_TERM_SECS` (InvalidEndTs); exactamente uno de `tenant`/`invite_hash` (InvalidInvite); `landlord`/`tenant` ∉ {staff, treasury, factory, token, vault, tw_fee_receiver} (InvalidParty); `tenant ≠ landlord` (SameParty); si hay vault: `(vf, pf) = vault.get_fees()` con `vf ≤ strategy.max_vault_fee_bps` y `pf ≤ 10000` (VaultFeeTooHigh) | `id = next_id`; `salt = sha256(landlord ‖ nonce)` (dirección ya ocupada → `NonceUsed`); `deployer().with_current_contract(salt).deploy_v2(wasm_hash, (EscrowInit,))` con `Terms.defindex_vault_fee_bps = vf`, `defindex_protocol_fee_bps = pf` y `tenant_yield_bps = config.tenant_yield_bps`; registra `Escrow(id)`, `IdOf(addr)` e índice del casero; evento `f_created` |
| `predict_address(landlord, nonce) -> Address` | — | — | dirección que tendrá el escrow (`deployer().with_current_contract(salt).deployed_address()`); la usa la API para devolver `contractId` en el build |
| `create_fianzas_batch(landlord, items: Vec<FianzaParams>) -> Vec<Created>` **[Could]** | `landlord` (una sola firma) | `1 ≤ len ≤ MAX_BATCH` (TooMany); cada item como arriba; atómica | N despliegues. El límite real lo mide el spike (§ 10) |
| `register_tenant(id: u64, tenant: Address)` | **el escrow** (`escrow_of(id).require_auth()`, implícita al ser invocador directo) | `escrow_of(id)` existe (NotFound); el llamante es ese escrow (NotEscrow); no registrado (AlreadyRegistered) | índice del inquilino; evento `f_tenant` |
| `funding_allowed(strategy_id: Symbol) -> bool` | — | — | `!paused ∧ strategy.enabled` |
| `set_escrow_wasm_hash(hash: BytesN<32>)` | admin | — | solo afecta a fianzas **nuevas**; evento `f_wasm {old, new}` |
| `set_config(config: GlobalConfig)` | admin | válida (InvalidConfig) | solo fianzas nuevas; evento `f_config` |
| `add_strategy(s: Strategy)` | admin | `id` nuevo (StrategyExists); `≤ 10` estrategias (TooMany); `kind == DeFindexVault ⇔ vault.is_some()`; `kind == NoYield ⇒ risk == NoYield`; `vault ∉ {token, factory, treasury, staff}`; `asset == config.token` **y** `token::Client(asset).name() == s.asset_name` (fija el emisor exacto; InvalidStrategy); `max_vault_fee_bps ≤ 2000` y `vault.get_fees().0 ≤ max_vault_fee_bps` (VaultFeeTooHigh); si `config.vault_manager = Some(m)`: `vault.get_manager() == m` (VaultNotPlatformManaged); se guarda con `enabled = false` hasta que el admin lo habilite (dos pasos, para revisar el evento antes) | evento `f_strategy` |
| `set_strategy_enabled(id: Symbol, enabled: bool)` | admin | existe; no se puede deshabilitar la estrategia por defecto sin cambiarla antes | deshabilitar bloquea **altas y fondeos nuevos**; las fianzas ya creadas conservan su snapshot y sus salidas; evento |
| `set_default_strategy(id: Symbol)` | admin | existe y `enabled` | exactamente una por defecto; evento |
| `pause()` / `unpause()` | admin | — | bloquea `create_*` y `fund_escrow` (vía `funding_allowed`); eventos `f_paused`/`f_unpaused` |
| `config() -> GlobalConfig`, `escrow_wasm_hash() -> BytesN<32>`, `paused() -> bool`, `admin() -> Address` | — | — | lectura |
| `strategies() -> Vec<Strategy>`, `strategy(id) -> Strategy`, `default_strategy() -> Strategy` | — | NotFound | lectura |
| `count() -> u64` | — | último id (ids `1..=count`) | lectura |
| `escrow_of(id) -> Address`, `id_of(escrow: Address) -> u64` | — | NotFound | lectura (fuente de verdad para el front y el Relayer) |
| `list_by_landlord(landlord, start: u32, limit: u32) -> Vec<u64>` | — | `limit ≤ MAX_PAGE` | lectura paginada |
| `list_by_tenant(tenant, start: u32, limit: u32) -> Vec<u64>` | — | igual | lectura paginada |
| `count_by_landlord(landlord) -> u32`, `count_by_tenant(tenant) -> u32` | — | — | lectura |
| `get_fianzas(ids: Vec<u64>) -> Vec<FianzaSummary>` | — | `len ≤ MAX_VIEWS` (TooMany); omite ids inexistentes | `escrow.get_escrow()` por id, **sin llamar al vault** (presupuesto, § 8.3) |

`compute_stop_bond(amount, min, bps) = min(max(min, floor(amount × bps / 10000)), amount)` vive **solo** en `factory/src/bond.rs`. La factory lo calcula y lo copia en `Terms.stop_bond`.

**Storage de la factory:** instance: `Admin`, `WasmHash`, `Config`, `Paused`, `NextId`, `DefaultStrategy`, `StrategyIds: Vec<Symbol>` (≤ 10). persistent (con `extend_ttl` en cada escritura): `Strategy(Symbol)`, `Escrow(u64) → Address`, `IdOf(Address) → u64`, `LandlordCount(Address) → u32`, `LandlordAt(Address, u32) → u64`, `TenantCount(Address) → u32`, `TenantAt(Address, u32) → u64`.

**Eventos** (topic 0 = nombre, topic 1 = `id` cuando aplica): `f_created {escrow, landlord, amount, strategy_id, defindex_vault_fee_bps, defindex_protocol_fee_bps}`, `f_tenant {tenant}`, `f_wasm {old, new}`, `f_config {config}`, `f_strategy {id, enabled, is_default, risk, max_vault_fee_bps}`, `f_paused {admin}`, `f_unpaused {admin}`.

**Errores**
```rust
#[contracterror] #[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)] #[repr(u32)]
pub enum FactoryError {
    NotFound = 1, Paused = 2, InvalidConfig = 3, StrategyNotFound = 4, StrategyDisabled = 5,
    StrategyExists = 6, InvalidStrategy = 7, NotEscrow = 8, TooMany = 9, InvalidAmount = 10,
    InvalidEndTs = 11, InvalidInvite = 12, InvalidParty = 13, InvalidBps = 14,
    AlreadyRegistered = 15, SameParty = 16, Arithmetic = 17,
    VaultFeeTooHigh = 18, VaultNotPlatformManaged = 19, NonceUsed = 20,
}
```
Validación de `GlobalConfig`: `platform_fee_bps + tw_fee_bps ≤ 10000`, `platform_fee_bps ≤ 5000`, `stop_bond_bps ≤ 2000`, `tenant_yield_bps ≤ 10000`, `timeout_secs ≥ 60`, `review_timeout_secs ≥ 60`, `staff` de 1 a 3 sin duplicados, `treasury ∉ staff`, `tw_fee_bps > 0 ⇒ tw_fee_receiver.is_some()` y `staff`, `treasury` ≠ factory.

### 6.4 Reparto (`modules/split`, puro) [AD-15]

```
pre: amount > 0, total ≥ 0, 0 ≤ deduction, platform_bps + tw_bps ≤ 10000, tenant_bps ≤ 10000
principal_back = min(total, amount)
deduction      = min(deduction, principal_back)          // el recorte lo hace settle (CT-7); split lo exige
yield          = max(total − amount, 0)                  // la pérdida se compensa PRIMERO con el rendimiento
tw             = floor(yield × tw_bps / 10000)           // fee de TW: solo sobre el rendimiento; MVP tw_bps = 0 (Q-16)
fee            = floor(yield × platform_bps / 10000)     // fee de plataforma: solo sobre el rendimiento
net            = yield − tw − fee
landlord_yield = floor(net × (10000 − tenant_bps) / 10000)
tenant_yield   = net − landlord_yield                    // el resto del redondeo, al inquilino
to_landlord    = deduction + landlord_yield
to_tenant      = principal_back − deduction + tenant_yield   // un déficit de principal recae aquí (Q-13)
to_treasury    = fee
to_tw          = tw
post: to_tenant + to_landlord + to_treasury + to_tw == total   (si no, panic: es un bug)
```
- Los dos fees se calculan **sobre el rendimiento bruto**, igual que TW los calcula sobre el bruto del escrow. Así el reparto conserva la forma "bruto − fee TW − fee plataforma = neto", pero aplicada solo al rendimiento.
- **El principal nunca paga fees.** Con `yield = 0`: `to_treasury = to_tw = 0` y el inquilino recibe `amount − deduction` (AC-7).
- El **bond** queda fuera de `Settlement` y se paga después (security 12.7).
- `NoYield`: `total = amount` (principal líquido en el escrow) → `yield = 0`.
- Matriz obligatoria (AC-1 ampliado): `tenant_bps ∈ {0, 5000, 10000}` × `deduction ∈ {0, parcial, amount}` × `vault ∈ {ganancia, pérdida < rendimiento, pérdida > rendimiento, pérdida total}` × `tw_bps ∈ {0 (MVP), 30}`.

### 6.5 Subconjunto del vault de DeFindex (lo usa el escrow; lo implementa `mock-vault`)

Firmas verificadas en `paltalabs/defindex/apps/contracts/vault/src/lib.rs`:
```rust
// El vault es además el token SEP-41 de sus shares (dfTokens).
fn deposit(e: Env, amounts_desired: Vec<i128>, amounts_min: Vec<i128>, from: Address, invest: bool)
    -> Result<(Vec<i128>, i128, Option<Vec<Option<AssetInvestmentAllocation>>>), ContractError>;
fn withdraw(e: Env, withdraw_shares: i128, min_amounts_out: Vec<i128>, from: Address) -> Result<Vec<i128>, ContractError>;
fn get_asset_amounts_per_shares(e: Env, vault_shares: i128) -> Result<Vec<i128>, ContractError>;
fn balance(e: Env, id: Address) -> i128;
fn get_fees(e: Env) -> (u32, u32);                          // (vault_fee_bps, defindex_protocol_fee_bps)
fn get_manager(e: Env) -> Result<Address, ContractError>;   // solo lo usa la factory en add_strategy
```
**Cómo lo usa el escrow (`modules/vault/defindex.rs`):**
- **deposit_all:** `authorize_as_current_contract([token.transfer(escrow, vault, amount)])`, después `try_invoke_contract::<Val, Error>(vault, "deposit", ([amount], [amount], escrow, true))`. **Se ignora el retorno** y se miden las shares con `balance(escrow)` antes y después (`> 0`, o `VaultError`). Con `invest = true` el vault invierte en sus estrategias en la misma transacción; las transferencias vault → estrategia no necesitan la auth del escrow.
- **withdraw_all:** `withdraw(shares, [0], escrow)` con `min_amounts_out = 0` **a propósito**: una pérdida no debe bloquear la salida. Se mide por diferencia de balance del token y lo absorbe `split()`. Antes de pagar siempre se retira.
- **preview_value:** `try_get_asset_amounts_per_shares(shares)[0]`; si falla, 0 (CT-10).
- **Contrato del mock (P2):** `__constructor(admin, asset)`; las mismas 6 firmas (`get_fees` configurable con `set_fees(vf, pf)` para probar `VaultFeeChanged`; `get_manager` devuelve `admin`) (`deposit` puede devolver `(Vec<i128>, i128)`, porque el escrow ignora el retorno); token de shares SEP-41 mínimo (`balance`, `total_supply`); `set_rate_bps(i32)` anualizado, lineal y con negativos posibles, solo admin; `InsufficientReserve` si no puede pagar. Debe **tirar con `transfer_from`-equivalente exactamente `token.transfer(from, mock, amount)`**, como DeFindex, para que el árbol de auth sea idéntico.
- **`evil_vault` en tests (P1):** tira de más, mintea shares falsas o paga menos, para probar CT-8.

### 6.6 `deployments/testnet.json` (P2)
```json
{
  "network": "testnet",
  "rpcUrl": "https://soroban-testnet.stellar.org",
  "networkPassphrase": "Test SDF Network ; September 2015",
  "startLedger": 0,
  "factory": "C…",
  "escrowWasmHash": "…",
  "escrowWasmHashesAllowed": ["…"],
  "token": "C…", "tokenCode": "USDC", "tokenIssuer": "G…",
  "strategies": [
    { "id": "usdc_fixed", "kind": "defindex", "vault": "C… (usdc_paltalabs_vault u otro tras el spike)", "defindexStrategy": "CALLOM5I7XLQPPOPQMYAHUWW4N7O3JKT42KQ4ASEEVBXDJQNJOALFSUY (USDC_blend_strategy, a confirmar)", "apyPool": "C… (pool Blend testnet)", "assetName": "USDC:G…", "risk": "standard", "simulated": false, "default": true, "maxVaultFeeBps": 1000 },
    { "id": "usdc_mock", "kind": "defindex", "vault": "C… (mock-vault)", "risk": "standard", "simulated": true,  "default": false },
    { "id": "custody",   "kind": "noyield",  "vault": null, "risk": "noyield", "simulated": false, "default": false }
  ],
  "defindex": { "factory": "CDSCWE4GLNBYYTES2OCYDFQA2LLY4RBIAX6ZI32VSUXD7GO6HRPO4A32", "vaultWasmHash": "f345228d…" },
  "admin": "G…", "staff": ["G…"], "treasury": "G…", "twFeeBps": 0, "twFeeReceiver": null,
  "faucet": "G…", "readSource": "G…",
  "relayer": "https://channels.openzeppelin.com/testnet",
  "smartAccount": { "accountWasmHash": "…", "webauthnVerifier": "C… | null" },
  "anchor": { "mode": "simulated | sep24", "homeDomain": "testanchor.stellar.org" },
  "demo": { "longFianzaId": 0 },
  "updatedAt": "2026-…"
}
```
`strategies` es un **espejo** de `factory.strategies()` para el front y el Relayer. Si no coinciden, manda la cadena. `escrowWasmHashesAllowed` alimenta la política del Relayer y WEB-3.

### 6.7 Paquetes TS: cambios respecto a la versión anterior

- **§ 4 `packages/wallet`:** la interfaz `Wallet`, `WalletError`, `SignPhase`, `createWallet` y `FakeWallet` no cambian. Se mantienen los añadidos de security: `AUTH_MISMATCH`, `signatureExpirationLedger ≤ latest + 60` y `location.hostname === rpId`. **WEB-3** espera estas subinvocaciones:
  - `factory.create_fianza`: ninguna.
  - `escrow.fund_escrow`: solo `token.transfer(tenant, escrow, terms.amount)`.
  - `escrow.stop`: solo `token.transfer(landlord, escrow, terms.stop_bond)`.
  - El resto: ninguna.
  - La raíz debe ser `deployments.factory`, o un escrow con `factory.id_of(addr)` válido.
- **§ 4 `Wallet`** += `signAndSendBuilt(res: UnsignedTransactionResponse, opts?: { onPhase }) => Promise<{ hash }>`: con `res.soroban` firma las auth entries con la passkey y envía a `/api/fianzas/v1/relay`; sin él (cuenta G) firma el XDR y llama a `/api/stellar/send-transaction` (§ 6.8.4). `WalletConfig.relayPath = "/api/fianzas/v1/relay"`.
- **§ 4b `@fianzas/wallet/server`:** nueva `RelayPolicy` (§ 8.2). La monta `apps/api` (P2) en `/fianzas/v1/relay`, no `apps/web`.
- **§ 5 y § 5b (anchor y ramp simulado):** sin cambios.
- **§ 6 Rendimiento por jurisdicción (#16):** sin presets. `tenant_yield_bps` lo fija `GlobalConfig` (MVP Portugal: 0, todo al casero); el front solo lo lee de `Terms` y no afirma la ley.

### 6.8 API propia compatible con la Core API v2 de Trustless Work (P2) [AD-19]

**Objetivo.** Ofrecer la API de TW v2 para nuestro fork, de modo que `@trustless-work/escrow-js`, el React SDK y Blocks funcionen **cambiando solo la `baseUrl`** en todo lo que nuestro contrato hace igual que el de TW, y añadir endpoints propios para la factory, DeFindex y las reglas de la fianza. La API de TW no sirve, porque solo construye transacciones para su propia revisión del contrato. Rutas y payloads verificados el 25-oct-2026 en `docs.trustlesswork.com/trustless-work/v2-en/api-rest/*` (base de testnet de TW: `https://beta.api.trustlesswork.com`).

**Base URL:** `https://<dominio>/api` (la misma origin que `apps/web`, § 6.8.6). En el SDK: `baseURL = "https://<dominio>/api"`.

**Convenciones copiadas de TW** (no se negocian):
1. **La API nunca firma.** `BUILD POST /escrow/<family>/<version>/<action>` → `{ unsignedXdr, txHash, contractId? }`; el cliente firma; `SUBMIT POST /stellar/send-transaction { signedXdr }`.
2. El escrow se identifica por su `contractId` (`C…`); el id numérico de la fianza solo aparece en `/fianzas/v1`.
3. Todo en camelCase.
4. Paginación keyset `{ data, hasMore, nextCursor }`, nunca un array suelto. `nextCursor` es opaco (base64url de `{start}` sobre los índices de la factory).
5. Errores RFC 9457 Problem Details `{ type, title, status, code, detail, instance, traceId, extensions }`. Se reutilizan los códigos de TW cuando el concepto coincide (`ESCROW_NOT_FOUND`, `ESCROW_ALREADY_RESOLVED`, `ESCROW_APPROVER_ALREADY_APPROVED_MILESTONE`, `ESCROW_UNAUTHORIZED_APPROVER`, `ESCROW_ONLY_DISPUTE_RESOLVER_CAN_EXECUTE`, `ESCROW_PROPERTIES_MISMATCH` para `TermsMismatch`, `ESCROW_NOT_COMPLETED`, `STELLAR_SIMULATION_FAILED`, `STELLAR_STATE_ARCHIVED` con `extensions.restoreXdr`, `AMOUNT_PRECISION_UNSUPPORTED`, `TOO_MANY_REQUESTS`). Los conceptos propios usan `FZ_<NOMBRE>` (`FZ_DEADLINE_PASSED`, `FZ_INSUFFICIENT_BOND`, `FZ_VAULT_FEE_CHANGED`, `FZ_INVALID_INVITE`, `FZ_ENDPOINT_NOT_SUPPORTED`…). Siempre va `extensions.contractError: number` si el error viene del contrato.
6. Importes: en las **lecturas**, strings decimales (`"150.0000000"`). En las **escrituras** se acepta `number` (como TW: "10 = 10 USDC") o string decimal; más de 7 decimales → `AMOUNT_PRECISION_UNSUPPORTED`. Los bps se exponen como bps (`platformFeeBps`) en `/fianzas/v1`; en la forma TW, `platformFee` es un porcentaje (ver 6.8.2).
7. El read-model es eventualmente consistente; **la cadena manda**.

**Respuesta de build** (`UnsignedTransactionResponse` de TW + una extensión):
```ts
interface UnsignedTransactionResponse {
  unsignedXdr: string;        // tx preparada (simulada). Firmable tal cual si signer es una cuenta G
  txHash: string;             // hash de la tx preparada (solo coincide si se firma tal cual)
  contractId?: string | null; // en creaciones: dirección que TENDRÁ el escrow (predict_address)
  soroban?: {                 // [EXT] solo si signer es una C-address (passkey)
    func: string;             // base64 XDR HostFunction
    auth: string[];           // base64 SorobanAuthorizationEntry SIN firmar, para el smart account
    validUntilLedger: number; // = latestLedger + 60 (AUTH-5)
  };
}
```

#### 6.8.1 Endpoints de TW Single-Release v2: qué se implementa

Regla de decisión para los que cambian de semántica: **se conserva la ruta de TW solo si su cuerpo basta para construir nuestra llamada sin adivinar nada, y si el efecto es igual o más restrictivo que lo que espera un usuario del SDK de TW.** Si no, la operación va a una **ruta nueva** en `/fianzas/v1` y la ruta de TW responde `501 FZ_ENDPOINT_NOT_SUPPORTED` con `extensions.replacement` (la ruta nueva). Motivo: un hook del SDK (por ejemplo, el de resolver una disputa con `distributions`) que se reinterpretara en silencio movería el dinero de otra forma de la que el integrador cree. Es mejor fallar de forma explícita que acertar a medias. Por la misma razón, **no** se extiende el cuerpo de una ruta de TW con campos que cambian el efecto económico.

| TW v2 (método y ruta) | Cuerpo TW | Nuestro comportamiento | Categoría | Función del contrato |
|---|---|---|---|---|
| `POST /escrow/single-release/v2/deploy` | `signer, engagementId, title, description, roles, amount, platformFee, milestones?, trustline` | Roles, fees y token no los elige el llamante: salen de la configuración de la factory → **501**, reemplazo `POST /fianzas/v1/fianzas` | No implementado (ruta nueva) | — |
| `POST /escrow/single-release/v2/fund` | `contractId, signer, amount` | **Misma ruta y forma.** `signer` = inquilino; `amount` debe ser igual a `terms.amount` (si no, 422 `ESCROW_PROPERTIES_MISMATCH`); el servidor lee `get_terms()` y lo pasa como `expected_terms`. **[EXT] opcional** `inviteCode` (base64url de 32 B) para fianzas con invitación. Sin `inviteCode` solo vale si la fianza tiene el inquilino fijado | Igual + campo opcional | `fund_escrow` |
| `POST /escrow/single-release/v2/approve-milestones` | `contractId, approver, milestoneIndexes` | **Misma ruta y forma.** `milestoneIndexes` debe ser `[0]` (si no, 422 `ESCROW_INVALID_MILESTONE_INDEX`). **Diferencia:** la aprobación que completa el quórum **liquida** en la misma transacción, porque los dos approvers son también release signers. El SDK no tiene que hacer nada más | Igual, con efecto adicional documentado | `approve_release` |
| `POST /escrow/single-release/v2/approve-and-release-milestones` | `contractId, signer, milestoneIndexes` | **Misma ruta y forma.** Se simula antes: si tras esta aprobación no se alcanza el quórum, 422 `ESCROW_NOT_COMPLETED`, como en TW | Igual | `approve_release` |
| `POST /escrow/single-release/v2/release-funds` | `contractId, releaseSigner` | No hay liberación separada (la hace la 2.ª aprobación) → **501**, reemplazo `approve-and-release-milestones` | No implementado | — |
| `POST /escrow/single-release/v2/change-milestone-status` | `contractId, serviceProvider, updates` | No hay estados de milestone → **501** | No implementado | — |
| `POST /escrow/single-release/v2/dispute` | `contractId, signer, reason` | Solo el casero puede parar, mueve un **bond** y el motivo va como **hash con sal** (no texto on-chain) → **501**, reemplazo `POST /fianzas/v1/fianzas/{contractId}/stop` | Cambia de semántica → ruta nueva | `stop` |
| `POST /escrow/single-release/v2/resolve-dispute` | `contractId, disputeResolver, distributions[]` | El reparto libre no existe; se resuelve con `deduction` + `stopJustified` → **501**, reemplazo `POST /fianzas/v1/fianzas/{contractId}/resolve` | Cambia de semántica → ruta nueva | `resolve` |
| `POST /escrow/single-release/v2/withdraw-remaining-funds` | `contractId, disputeResolver, distributions[]` | Eliminado en el fork → **501** | No implementado | — |
| `PUT /escrow/single-release/v2/update` | `contractId, admin, escrow` | `Terms` inmutables → **501** | No implementado | — |
| `POST /escrow/single-release/v2/manage-milestones` | `contractId, admin, newMilestones, milestoneUpdates` | Sin milestones editables → **501** | No implementado | — |
| `POST /escrow/single-release/v2/extend-ttl` | `contractId, admin, ledgersToExtend` | **Misma ruta y forma.** En el fork es sin permisos: `admin` se usa solo como cuenta que firma y paga; `ledgersToExtend` se ignora (se extiende al máximo). Si está archivado: 409 `STELLAR_STATE_ARCHIVED` con `restoreXdr`, como en TW | Igual (más permisivo) | `extend_contract_ttl` |
| `POST /stellar/send-transaction` | `signedXdr` | **Misma ruta y forma.** Envío normal a la RPC de Soroban (la cuenta origen paga). Respuesta `{ txHash, ledger, contractId?, code: "STELLAR_TX_SUBMITTED" }`. **No patrocina** (6.8.4) | Igual | — |
| `GET /escrow/single-release/v2/{contractId}` | — | **Misma ruta.** Lectura directa (`get_escrow`) devuelta **en la forma TW v2** (tabla 6.8.2) + `fianza` [EXT] con `Terms`, estado efectivo, bond, liquidación y comisiones | Igual + extensión | `get_escrow`, `get_roles` |
| `GET /escrow/single-release/v2/escrow-balances?addresses=` (≤ 20) | — | **Misma ruta.** `balance` = valor estimado del principal en el vault (`preview_value`) + saldo líquido (bond o principal `NoYield`); `trustlineDecimals = 7` | Igual (valor, no saldo bruto, documentado) | `get_view` |
| `GET /escrows` | `scope, limit, cursor, includeSnapshot, sort, order, createdAfter, createdBefore, status, type, contractVersion, engagementId, contractIds, participant, role, platformId, subjectId` | **Misma ruta.** Se soportan `limit` (1–200), `cursor`, `includeSnapshot`, `order`, `status`, `contractIds` (1–50), `participant` + `role` (`approver`/`serviceProvider` = casero o inquilino; `receiver` = inquilino; `platform` = tesorería) y `engagementId` (`fianza-<id>`). `sort` solo `createdAt` (= orden de id). `platformId`, `subjectId`, `createdAfter/Before` → 400 `VALIDATION_ERROR` (no se ignoran en silencio). `scope=mine` exige API key; sin auth vale `scope=all` (datos públicos on-chain). `contractVersion` = `"v2-fianzas"` | Igual (subconjunto) | `factory.list_by_*`, `get_fianzas` |
| `GET /escrows/{contractId}` | — | **Misma ruta.** Fila del read-model + `snapshot` (forma TW) | Igual | `get_escrow` |
| `GET /escrows/details?contractIds=` (≤ 50) | — | **Misma ruta.** En lotes de 25 sobre `get_fianzas` | Igual | `get_fianzas` |
| `GET /escrows/{contractId}/events` | `limit, cursor, order` | **Misma ruta.** Eventos `fz_*` de ese contrato (RPC `getEvents`, límite de retención de la RPC: ver 6.8.5) | Igual | — |
| `GET /escrows/{contractId}/milestones`, `GET /escrows/milestones` | — | Un único milestone sintético "Devolución de la fianza" | Igual | `get_escrow` |
| `GET /escrows/financial?contractIds=` (≤ 50) | — | **Misma ruta.** Principal, rendimiento acumulado estimado, comisiones (todas, § 6.9) y, si está liquidada, el `Settlement` | Igual + campos | `get_view` |
| `POST /graphql` | — | **501** en el MVP | No implementado | — |
| Auth de TW (API keys, sesiones de wallet, Subjects, Platforms) | — | Solo `x-api-key` (6.8.7). El resto → 501 | Parcial | — |

**Resumen:** 13 rutas de TW se sirven igual o con extensiones (`fund`, `approve-milestones`, `approve-and-release-milestones`, `extend-ttl`, `send-transaction` y 8 lecturas). Dos cambian de semántica y van a ruta nueva (`dispute` → `stop`, `resolve-dispute` → `resolve`). Siete no se implementan (`deploy` → ruta nueva de la factory, `release-funds`, `change-milestone-status`, `withdraw-remaining-funds`, `update`, `manage-milestones`, `graphql`).

#### 6.8.2 Forma TW v2 del escrow (`snapshot`)
| Campo TW | Valor en el fork | Nota |
|---|---|---|
| `engagementId` | `"fianza-<id>"` | |
| `title` / `description` | `"Fianza #<id>"` / `""` | Sin datos personales on-chain (DAT-1) |
| `roles` | `get_roles()` en camelCase; `receiver` = `null` hasta el fondeo | 6.1 |
| `amount` | principal (string decimal) | |
| `platformFee` | **`0`** | En TW es un % del **bruto**; el nuestro es del **rendimiento**. Exponer el 20 % en este campo haría que un componente de Blocks mostrara "20 % de la fianza", así que el valor real va en `fianza.fees` (Q-26) |
| `milestones` | `[{ description: "Devolución de la fianza", status: <estado efectivo en snake_case>, evidence: "", approvals: { target: 2, approvalCount, approvedBy } }]` | |
| `dispute` | `{ isDisputed: status ∈ {Stopped, UnderReview}, reason: "", resolved: path ∈ {Resolved, ReviewTimeout} }` | El motivo solo existe como hash: `fianza.reasonHash` |
| `released` | `path ∈ {Approved, Timeout}` | |
| `trustline` | `{ address: token }` | |
| **`fianza`** [EXT] | `{ id, status, terms, fees, stopBond, bondHeld, stopJustified, tenantYieldBps, timeoutAt, reviewDeadline, accruedYield, settlement, path, strategy }` | La fuente completa |

#### 6.8.3 Endpoints nuevos (`/fianzas/v1`)
Mismo bucle build → sign → submit, la misma `UnsignedTransactionResponse` y los mismos errores.

| Método | Ruta | Qué hace |
|---|---|---|
| POST | `/fianzas/v1/fianzas` | Build de `factory.create_fianza`. Devuelve `contractId` (predicho con `predict_address(landlord, nonce)`, estable) y `id: null` (se conoce al ejecutarse, en `send-transaction` y en el evento) |
| POST | `/fianzas/v1/fianzas/batch` **[Could]** | Build de `create_fianzas_batch` (≤ `MAX_BATCH`) |
| GET | `/fianzas/v1/config` | `GlobalConfig` de la factory, `paused`, `escrowWasmHash` y `MAX_*` |
| GET | `/fianzas/v1/strategies` | Registro de la factory **+ datos en vivo**: `supplyApy` del pool de Blend (`apy_pool`, SDK de Blend), `vaultFeeBps`/`protocolFeeBps` actuales (`get_fees()`), `maxVaultFeeBps`, `risk`, `simulated`, `enabled`, `isDefault`, `apyLabel: "~6-7 %, variable"` (o "variable" si no hay dato) y `updatedAt`. Caché de 60 s |
| GET | `/fianzas/v1/fianzas/by-id/{id}` | `{ id, contractId }` (`escrow_of`); lo usa la página de invitación |
| GET | `/fianzas/v1/fianzas/{contractId}/terms` | `Terms` completos con **todas las comisiones fijadas**: `platformFeeBps`, `twFeeBps`, `defindexVaultFeeBps`, `defindexProtocolFeeBps` (base de cada una), `stopBond`, plazos y estrategia |
| GET | `/fianzas/v1/fianzas/{contractId}/view` | `EscrowView`: estado efectivo, `timeoutAt`, `reviewDeadline` y `accruedYield` |
| GET | `/fianzas/v1/fianzas/{contractId}/yield` | `{ accruedYield, estimatedToTenant, estimatedToLandlord, estimatedToTreasury, estimatedToTw, asOf }` (`preview_settlement(0)`; estimación, no garantizada) |
| GET | `/fianzas/v1/fianzas/{contractId}/preview-settlement?deduction=` | `Settlement` de `preview_settlement(deduction)` (backoffice) |
| POST | `/fianzas/v1/fianzas/{contractId}/cancel` | Build de `cancel` |
| POST | `/fianzas/v1/fianzas/{contractId}/stop` | Build de `stop(reasonHash)`, con el bond anidado en el árbol de auth. La respuesta añade `stopBond` para que la UI lo muestre antes de firmar |
| POST | `/fianzas/v1/fianzas/{contractId}/assign-expert` | Build de `assign_expert` |
| POST | `/fianzas/v1/fianzas/{contractId}/record-report` | Build de `record_report` |
| POST | `/fianzas/v1/fianzas/{contractId}/resolve` | Build de `resolve(deduction, stopJustified)`. Rechaza `stopJustified = false` con `deduction > 0` antes de simular (`FZ_INCOHERENT_RESOLUTION`) |
| POST | `/fianzas/v1/fianzas/{contractId}/claim-timeout` | Build de `claim_after_timeout` (sin permisos; `signer` solo paga o patrocina) |
| POST | `/fianzas/v1/fianzas/{contractId}/claim-review-timeout` | Build de `claim_after_review_timeout` |
| GET | `/fianzas/v1/landlords/{address}/fianzas?cursor&limit&status` | `factory.list_by_landlord` + `get_fianzas` → `{ data: FianzaSummary[], hasMore, nextCursor }` |
| GET | `/fianzas/v1/tenants/{address}/fianzas?cursor&limit&status` | Igual con `list_by_tenant` |
| GET | `/fianzas/v1/strategies/{id}/price` | Precio por share del vault (`get_asset_amounts_per_shares(10^7)`) para estimar el rendimiento de una lista sin N simulaciones (§ 8.3) |
| POST | `/fianzas/v1/relay` | Envío **patrocinado** para C-addresses: `createRelayHandler(RelayPolicy)` de `@fianzas/wallet/server` (6.8.4) |
| POST / GET | `/fianzas/v1/ramp` | Ramp simulado: `createSimRampHandler` de `@fianzas/anchor/server` (sin cambios de comportamiento) |
| GET | `/openapi.json` **[Could]** | Spec OpenAPI generada |

Los endpoints de admin de la factory (`set_config`, `add_strategy`, `set_escrow_wasm_hash`, `pause`…) **no** se exponen en la API: se operan con `scripts/` e identidades del CLI.

#### 6.8.4 Envío y Relayer: **endpoint aparte** [AD-20]
- **`POST /stellar/send-transaction`** se mantiene con la semántica de TW: la cuenta origen (G) firma la transacción y **paga su fee** (staff con Freighter, caseros con wallet clásica, integradores con API key). El servidor solo valida que sea un XDR firmado y lo envía a la RPC.
- **`POST /fianzas/v1/relay { func, auth }`** es el **único** camino patrocinado, para las C-address con passkey: es `createRelayHandler` con la `RelayPolicy` de § 8.2 (contratos y funciones permitidos, wasm hash y registro en la factory, sin `SOURCE_ACCOUNT`, raíz idéntica a `func`, límites de tamaño y ritmo y `Origin` propio).
- **Por qué no decide `send-transaction`:** si inspeccionara el XDR para "decidir" si patrocina, cualquier transacción de una cuenta G que tocara un contrato permitido podría conseguir el patrocinio. Además, la decisión quedaría implícita y repartida entre dos rutas, y el contrato de TW de esa ruta ("pagas tú") se rompería. Con un endpoint aparte, la superficie de la política es una sola, y el test de AC-11 y SRV-* se queda igual.
- **Flujo con passkey:** build (`signer` = C…) → respuesta con `soroban.func` + `soroban.auth` → `packages/wallet` firma las auth entries con la passkey (verificando WEB-3) → `POST /fianzas/v1/relay`. El `unsignedXdr` en ese caso se construye con `readSource` como origen, es solo informativo y no se puede enviar.
- **`packages/wallet`** añade `signAndSendBuilt(res: UnsignedTransactionResponse, opts?)` junto a `signAndSend(tx: AssembledTransaction)` (§ 6.7). Si recibe `soroban`, va por el Relayer; si no, firma el XDR (solo cuentas G y Freighter) y llama a `send-transaction`.
- La API key de Channels (`RELAYER_API_KEY`) vive **solo** en el servidor de la API (SRV-1).

#### 6.8.5 Read-model: **lectura directa de la cadena + caché en memoria** (sin indexer propio en el MVP) [AD-21]
- **Listas:** índices on-chain de la factory (`list_by_landlord`/`list_by_tenant` y `count`), así que no hace falta indexer para listar.
- **Detalle y lotes:** simulación de `get_escrow`/`get_fianzas` (≤ 25 por simulación).
- **Rendimiento:** precio por share por vault, una vez por petición.
- **Eventos:** `getEvents` de la RPC bajo demanda, filtrando por `contractId` y desde `deployments.startLedger`. **Límite:** la RPC pública solo guarda eventos durante una ventana limitada (del orden de días); en la demo basta. Fuera de la ventana, `GET /escrows/{contractId}/events` devuelve los que haya y `extensions.truncated = true`.
- **Caché** en memoria por instancia (TTL de 5 s en lecturas de estado, 60 s en estrategias y APY) y deduplicación de peticiones simultáneas.
- **Por qué no un indexer en 28 h:** un proceso que consuma `getEvents` y escriba en una base de datos exige persistencia, despliegue aparte y reconciliación. La cadena ya ofrece índices por casero e inquilino porque la factory los guarda. **Mainnet [M]:** indexer de eventos `fz_*`/`f_*` → Postgres, con `getEvents` en continuo y reconciliación con `get_escrow`, sin cambiar el contrato HTTP.

#### 6.8.6 Stack y despliegue
- **Hono 4** (Request/Response estándar) + `zod` (`@hono/zod-validator`) + `@stellar/stellar-sdk` (RPC y XDR) + `packages/bindings` + `@blend-capital/blend-sdk` (APY) + una librería decimal (`decimal.js`).
- Paquete `apps/api` → `@fianzas/api`, que exporta `createApp(cfg)` y el cliente tipado `@fianzas/api/client` (fetch fino + tipos) para `apps/web` y `apps/backoffice`.
- **Despliegue: dentro de `apps/web`** con una única ruta catch-all, `apps/web/app/api/[[...path]]/route.ts`, que exporta `GET`/`POST`/`PUT` = `handle(createApp(cfg))` de `hono/vercel`. Así hay **una origin** (sin CORS para nuestro front, y CS-3 sigue valiendo), un solo despliegue en Vercel y los secretos solo en el entorno Production (SEC-4).
- Las rutas antiguas `apps/web/app/api/relay` y `/api/ramp` **se eliminan**: `WalletConfig.relayPath = "/api/fianzas/v1/relay"` y `rampPath = "/api/fianzas/v1/ramp"`.
- Desarrollo local: `pnpm --filter @fianzas/api dev` con `@hono/node-server` (puerto 8787).
- CORS solo para orígenes registrados por API key.
- **Configuración:** `@fianzas/deployments` (direcciones) más `RELAYER_URL`, `RELAYER_API_KEY`, `RAMP_FAUCET_SECRET`, `RAMP_ENABLED`, `SOROBAN_RPC_URL`, `NETWORK_PASSPHRASE`, `API_KEYS_JSON` y `BLEND_POOL_RPC` (opcional). Ninguna lleva el prefijo `NEXT_PUBLIC_`.

#### 6.8.7 Autenticación y límites
| Credencial | Para quién | Qué permite | Límite |
|---|---|---|---|
| **Ninguna** (misma origin) | Nuestro front | Lecturas, builds, `/fianzas/v1/relay` y `/fianzas/v1/ramp` (con comprobación de `Origin`) | Lecturas: 120/min por IP. Builds: 30/min por IP. Relay: SRV-6. Ramp: SRV-12 |
| **`x-api-key: <id>.<secret>`** (formato de TW) | Grandes caseros e integradores (SDK de TW) | Lecturas (`scope=mine` = las direcciones de casero registradas en la key), builds y `send-transaction` | 300/min por key. **Nunca** el Relayer: los integradores pagan su fee |
| `Authorization: Bearer <jwt>` (sesión de wallet de TW) | — | **No en el MVP** → 401 `AUTH_SESSION_NOT_CONFIGURED` (código de TW). [M]: SEP-10 (G) / SEP-45 (C) | — |

- Las keys viven en `API_KEYS_JSON` (sin base de datos): `[{ id, secretSha256, label, landlords: ["G…|C…"], scopes: ["read","build","submit"], rpm, origins? }]`. El secreto se compara en tiempo constante sobre `sha256(secret)`. Las keys las da P2 a mano.
- **Los builds no requieren auth**, porque solo producen datos sin firmar: la cadena aplica `require_auth`. Lo que se protege es el coste (simulaciones de la RPC y Channels).
- **`inviteCode` en `fund`:** viaja por HTTPS a nuestra misma origin; el servidor **no** lo registra ni lo cachea (DAT-6) y lo descarta tras simular. Riesgo residual: el operador de la API lo ve antes del envío (R-18).
- Límites en memoria por instancia (limitación aceptada; [M] KV compartido).

#### 6.8.8 Dueño y carpeta: **`apps/api/` → P2** [AD-22]
- **Por qué P2:** es el integrador y ya es dueño de los bindings, `deployments` y scripts, que son la base de la API. Al quedar fuera `yield-adapter` tiene unas 4 h libres. P1 es el rol más cargado y P3 y P4 tienen la ruta crítica de passkeys y UI.
- **P3** sigue siendo dueño de `createRelayHandler` y `createSimRampHandler` (en sus paquetes); la API solo los monta.
- **P4** solo añade el archivo catch-all de `apps/web` y consume `@fianzas/api/client`.
- **`harness/team.json`** (PR de P2 con `/lock harness`, junto al de § 4.1): `{ "id": "api", "owner": "P2", "paths": ["apps/api/**"], "scopes": ["api"] }`, añadido antes de `"web"`. En `CLAUDE.md`: fila de P2 += `apps/api/` y lista de scopes += `api`. Ejemplo de commit: `feat(api): añadir build de fund compatible con TW v2`.

#### 6.8.9 Tabla para `docs/INTERFACES.md` (§ 7 nuevo: API)
Auth: **A** = anónima de la misma origin; **K** = `x-api-key`; **A/K** = cualquiera de las dos. Las respuestas de build son `UnsignedTransactionResponse` (UTR).

| Método | Ruta | Auth | Body / query | Respuesta | Firma el XDR | Función |
|---|---|---|---|---|---|---|
| POST | `/escrow/single-release/v2/fund` | A/K | `{ contractId, signer, amount, inviteCode? }` | UTR | inquilino | `escrow.fund_escrow` |
| POST | `/escrow/single-release/v2/approve-milestones` | A/K | `{ contractId, approver, milestoneIndexes: [0] }` | UTR | casero o inquilino | `escrow.approve_release` |
| POST | `/escrow/single-release/v2/approve-and-release-milestones` | A/K | `{ contractId, signer, milestoneIndexes: [0] }` | UTR | casero o inquilino (la 2.ª firma) | `escrow.approve_release` |
| POST | `/escrow/single-release/v2/extend-ttl` | A/K | `{ contractId, admin, ledgersToExtend }` | UTR | cualquiera (paga) | `escrow.extend_contract_ttl` |
| POST | `/stellar/send-transaction` | A/K | `{ signedXdr }` | `{ txHash, ledger, contractId?, code }` | ya firmado (G) | — |
| GET | `/escrow/single-release/v2/{contractId}` | A/K | — | snapshot TW + `fianza` | — | `escrow.get_escrow` |
| GET | `/escrow/single-release/v2/escrow-balances` | A/K | `addresses` (≤ 20) | `[{ address, balance, trustlineDecimals }]` | — | `escrow.get_view` |
| GET | `/escrows` | A/K | `limit, cursor, includeSnapshot, order, status, contractIds, participant, role, engagementId, scope` | `{ data, hasMore, nextCursor }` | — | `factory.list_by_*` + `get_fianzas` |
| GET | `/escrows/{contractId}` · `/escrows/details` · `/escrows/{contractId}/events` · `/escrows/{contractId}/milestones` · `/escrows/milestones` · `/escrows/financial` | A/K | según TW | según TW (+ campos) | — | lecturas |
| POST | `/fianzas/v1/fianzas` | A/K | `{ signer, tenant?, inviteHash?, amount, endTs, strategyId?, nonce }` | UTR (`contractId` predicho) | casero | `factory.create_fianza` |
| POST | `/fianzas/v1/fianzas/batch` [Could] | K | `{ signer, items: [...] }` | UTR | casero | `factory.create_fianzas_batch` |
| GET | `/fianzas/v1/config` | A/K | — | `GlobalConfig` + `paused` | — | `factory.config` |
| GET | `/fianzas/v1/strategies` | A/K | — | `[{ id, kind, vault, assetName, risk, simulated, enabled, isDefault, maxVaultFeeBps, vaultFeeBps, protocolFeeBps, supplyApy, apyLabel, updatedAt }]` | — | `factory.strategies` + `vault.get_fees` + Blend |
| GET | `/fianzas/v1/strategies/{id}/price` | A/K | — | `{ pricePerShare, asOf }` | — | `vault.get_asset_amounts_per_shares` |
| GET | `/fianzas/v1/fianzas/by-id/{id}` | A/K | — | `{ id, contractId }` | — | `factory.escrow_of` |
| GET | `/fianzas/v1/fianzas/{contractId}/terms` | A/K | — | `Terms` (con las 4 comisiones) | — | `escrow.get_terms` |
| GET | `/fianzas/v1/fianzas/{contractId}/view` | A/K | — | `EscrowView` | — | `escrow.get_view` |
| GET | `/fianzas/v1/fianzas/{contractId}/yield` | A/K | — | `{ accruedYield, estimatedTo*, asOf }` | — | `escrow.preview_settlement(0)` |
| GET | `/fianzas/v1/fianzas/{contractId}/preview-settlement` | A/K | `deduction` | `Settlement` | — | `escrow.preview_settlement` |
| POST | `/fianzas/v1/fianzas/{contractId}/cancel` | A/K | `{ signer }` | UTR | casero | `escrow.cancel` |
| POST | `/fianzas/v1/fianzas/{contractId}/stop` | A/K | `{ signer, reasonHash }` | UTR + `stopBond` | casero | `escrow.stop` |
| POST | `/fianzas/v1/fianzas/{contractId}/assign-expert` | A/K | `{ resolver, expertRef }` | UTR | staff (Freighter) | `escrow.assign_expert` |
| POST | `/fianzas/v1/fianzas/{contractId}/record-report` | A/K | `{ resolver, reportHash }` | UTR | staff | `escrow.record_report` |
| POST | `/fianzas/v1/fianzas/{contractId}/resolve` | A/K | `{ resolver, deduction, stopJustified }` | UTR | staff | `escrow.resolve` |
| POST | `/fianzas/v1/fianzas/{contractId}/claim-timeout` | A/K | `{ signer }` | UTR | cualquiera | `escrow.claim_after_timeout` |
| POST | `/fianzas/v1/fianzas/{contractId}/claim-review-timeout` | A/K | `{ signer }` | UTR | cualquiera | `escrow.claim_after_review_timeout` |
| GET | `/fianzas/v1/landlords/{address}/fianzas` | A/K | `cursor, limit, status` | `{ data: FianzaSummary[], hasMore, nextCursor }` | — | `factory.list_by_landlord` + `get_fianzas` |
| GET | `/fianzas/v1/tenants/{address}/fianzas` | A/K | `cursor, limit, status` | igual | — | `factory.list_by_tenant` + `get_fianzas` |
| POST | `/fianzas/v1/relay` | A (misma origin) | `{ func, auth[] }` | `{ hash, status }` / `{ code }` | auth entries con passkey; origen y fee: Relayer | la de `func` (lista blanca) |
| POST · GET | `/fianzas/v1/ramp` | A (misma origin) | `{ to, amount }` · `?id=` | `{ id, hash }` · `{ status }` | faucet (servidor) | `token.transfer` |
| POST/PUT | `deploy`, `release-funds`, `change-milestone-status`, `dispute`, `resolve-dispute`, `withdraw-remaining-funds`, `update`, `manage-milestones`, `/graphql` | — | — | `501 FZ_ENDPOINT_NOT_SUPPORTED` + `extensions.replacement` | — | — |

En el MVP, `/stop`, `/resolve`, `/assign-expert` y `/record-report` con `signer`/`resolver` G devuelven un XDR que el staff firma con Freighter y envía con `send-transaction`. Las funciones de staff **nunca** pasan por el Relayer.

### 6.9 Comisiones de DeFindex fijadas en los `Terms` [AD-23]

Verificado en `paltalabs/defindex/apps/contracts/vault/src/lib.rs`: el vault expone `get_fees(e) -> (u32, u32)` = `(vault_fee, defindex_protocol_fee)` en bps, cobradas **sobre las ganancias** mediante `report`/`lock_fees`. El manager del vault puede cambiar la comisión (`lock_fees(new_fee_bps)`) y su receptor (`set_fee_receiver`), y hay `get_manager()`.

**Qué se fija al activarse la fianza.** Cuando el inquilino fondea, las cuatro comisiones ya están en `Terms`, que él firma en `expected_terms`:

| Comisión | Campo | Base | Quién la cobra | Cuándo se fija |
|---|---|---|---|---|
| Plataforma | `platform_fee_bps` | rendimiento neto del vault | `split()` → tesorería | al crear (config) |
| Trustless Work | `tw_fee_bps` (**0 en el MVP**) | rendimiento neto del vault | `split()` → `tw_fee_receiver` | al crear (config) |
| DeFindex vault | `defindex_vault_fee_bps` | ganancias dentro del vault | **el vault** (reduce el valor de la share) | al crear (`get_fees()` desde la factory) y **comprobada al fondear** |
| DeFindex protocolo | `defindex_protocol_fee_bps` | según la semántica de DeFindex (a confirmar en el spike si se calcula sobre la comisión del vault o sobre las ganancias) | **el vault** | igual |

- **No hay doble descuento.** Las comisiones de DeFindex las cobra el vault dentro del rendimiento: `split()` recibe un `total` que ya es neto de ellas (medido por diferencia de balance al retirar). Por eso `split()` **no** las vuelve a restar. Se guardan en `Terms` para **mostrarlas** (pantalla de aceptación, `/terms`, `/escrows/financial`) y para el **reporting** (`fz_init`, `f_created` y `fz_settle.vault_fees_at_settle`).
- **Validación:**
  - Factory, `add_strategy`: `max_vault_fee_bps ≤ 2000`; `get_fees().0 ≤ max_vault_fee_bps`; si `config.vault_manager` está fijado, `get_manager() == vault_manager`.
  - Factory, `create_fianza`: `vf ≤ max_vault_fee_bps` y `pf ≤ 10000`, y copia de las dos en `Terms`.
  - Escrow, constructor: `platform_fee_bps + tw_fee_bps ≤ 10000` (son las únicas que resta `split()`). Además, `defindex_vault_fee_bps ≤ 10000`, `defindex_protocol_fee_bps ≤ 10000` y las dos a 0 si es `NoYield` (InvalidConfig).
  - No se exige que la suma de las cuatro sea ≤ 10000: se aplican en cascada (el vault sobre las ganancias brutas y las nuestras sobre lo que queda), así que la comisión efectiva total es `v + (1 − v)·(p + t) ≤ 100 %` siempre que cada parte lo sea.

**Riesgo: que el manager del vault suba la comisión después de crear la fianza.** Las tres opciones analizadas:

| Opción | Protege | No protege | Coste |
|---|---|---|---|
| (a) Solo vaults cuyo manager es la plataforma (vault propio creado con la factory de DeFindex) | Que un tercero suba la comisión en cualquier momento | Que la plataforma misma la suba (es un compromiso de gobernanza) | No disponible en testnet si se usa `usdc_paltalabs_vault` |
| (b) Tope `max_vault_fee_bps` en el registro, comprobado al crear | Que se den de alta fianzas con comisiones abusivas | Subidas posteriores | Una lectura |
| (c) `get_fees()` en `fund_escrow` y rechazo si supera el snapshot | Subidas entre crear y fondear: el inquilino nunca mete dinero con condiciones peores de las que firmó | Subidas **después** del fondeo | Una llamada cruzada más, **solo en la entrada** |

**Decisión: (b) + (c) siempre, y (a) obligatoria en mainnet.**
- (b) y (c) son baratas, se comprueban on-chain y cubren todo el tramo antes de que entre el dinero. Si falla (c), el error es `VaultFeeChanged`, el casero ve el aviso y puede cancelar y crear otra fianza.
- (a) es la única que limita el riesgo **después** del fondeo, y se puede exigir on-chain: con `config.vault_manager = Some(multisig)`, `add_strategy` rechaza vaults cuyo `get_manager()` sea otro (VaultNotPlatformManaged). En testnet `vault_manager = None` para poder usar `usdc_paltalabs_vault`, y la UI lo indica ("vault de terceros").
- **No se bloquea nunca una salida por comisiones:** `settle` no compara comisiones, solo las registra (`vault_fees_at_settle`). Tras el fondeo, una subida reduce el rendimiento, pero nunca el principal (la comisión de DeFindex solo se aplica a ganancias) ni la capacidad de liquidar.
- [M] Política de gobernanza del multisig: no subir `vault_fee` de un vault con fianzas activas, o hacerlo con un preaviso y un timelock publicados. Monitor de `get_fees()` que avise si cambia.

---

## 7. Estrategias de rendimiento [AD-16]

**Regla de producto (decisión final del equipo):** la estrategia por defecto del MVP es un **vault de DeFindex sobre el Blend Fixed Pool USDC**. El rendimiento se comunica **siempre** como "~6-7 %, variable", nunca como prometido. Ninguna opción se presenta como "sin riesgo": la custodia sin rendimiento conserva el riesgo de contrato, de emisor del USDC y operativo. El APY que ve el usuario **se lee en vivo** (off-chain, SDK de Blend sobre `Strategy.apy_pool`) y nunca se guarda on-chain.

**Datos verificados on-chain en mainnet el 25-oct-2026** (SDK de Blend sobre los pools de las estrategias de DeFindex):

| Pool | Activo | Supply APY | Uso | Suministrado |
|---|---|---|---|---|
| Fixed Pool `CAJJZSGMMM3PD7N33TAPHGBUGTB43OC73HVIK2L2G6BNGGGYOSSYBXBD` | USDC | **5,88 %** (media de 30 días 6,76 % según DefiLlama) | 73,8 % | ~53 M USDC |
| | EURC | 0,16 % | — | — |
| | XLM | 0,00 % | — | — |
| Etherfuse (RWA) `CDMAVJPFXPADND3YRL4BSM3AKZWCTFMX27GLLXCML3PD62HEQS5FPVAI` | USDC | **0,05 %** | 15 % | ~5.476 USDC |
| | USTRY `CBLV4ATSIWU67CFSQU2NVRKINQIKUZ2ODSZBUJTJ43VJVRSBTZYOPNUR` | 0,00 % | — | — |
| | CETES `CAL6ER2TI6CTRAY6BFXWNWA7WTYXUXTQCHUBCIBU5O6KM3HJFG6Z6VXV` | 0,00 % | — | — |

**Conclusión:** las estrategias "RWA" de DeFindex casi no dan rendimiento por préstamo. Con USTRY o CETES, el rendimiento sería la revalorización del propio bono, lo que obliga a cambiar USDC por un activo poco líquido y añade riesgo de precio. Con USDC en Etherfuse se gana un 0,05 %. El Fixed Pool USDC es la opción con rendimiento y el menor riesgo relativo del catálogo, pero **no es libre de riesgo**: tiene riesgo de oráculo, de mala deuda, de liquidez (73,8 % de uso) y de contrato.

| Id (registro) | Red | Vault / estrategia DeFindex | `RiskTier` | Texto en la UI (P4) | MVP |
|---|---|---|---|---|---|
| `usdc_fixed` **(por defecto)** | testnet | `usdc_paltalabs_vault` `CBMVK2JK6NTOT2O4HNQAIQFJY232BHKGLIMXDVQVHIIZKDACXDFZDWHN` sobre `USDC_blend_strategy` `CALLOM5I7XLQPPOPQMYAHUWW4N7O3JKT42KQ4ASEEVBXDJQNJOALFSUY` (**a confirmar en el spike**; alternativa: vault propio con `defindex_factory` sobre esa estrategia) | Standard | "~6-7 %, variable, no garantizado (dato de mainnet). Riesgos: protocolo, oráculo, liquidez y contrato". En testnet: "rendimiento de prueba" | **Sí** |
| `usdc_fixed` **(por defecto)** | mainnet | Vault propio de DeFindex con una sola estrategia `usdc_blend_autocompound_fixed_strategy` `CDB2WMKQQNVZMEBY7Q7GZ5C7E7IAFSNMZ7GGVD6WKTCEWK7XOIAVZSAP` sobre el Fixed Pool `CAJJZSGM…BXBD` | Standard | Igual, con el APY en vivo | Producción |
| `usdc_mock` | testnet | `mock-vault` | Standard (`simulated = true`) | "Rendimiento simulado" (NFR-11) | Sí (respaldo de la demo) |
| `custody` | ambas | **Sin vault** (`NoYield`) | NoYield | "Sin rendimiento. Riesgos: contrato, emisor del USDC y operativo" | Sí |
| `usdc_etherfuse` ("RWA") | mainnet | Vault propio sobre `usdc_blend_autocompound_etherfuse_strategy` (pool Etherfuse `CDMAVJPF…FPVAI`) | **High** | **"Más riesgo, rendimiento casi nulo hoy (APY en vivo)"**. Aviso obligatorio con casilla: colateral RWA de poca liquidez, precedente YieldBlox (manipulación de USTRY), APY leído hoy de 0,05 % y pool pequeño (~5.476 USDC) | Roadmap. Registro preparado para la narrativa del pitch; **no** es la recomendada |
| (excluidas) `eurc_fixed`, `xlm_*`, `cetes_*`, `ustry_*`, `tesouro_*` | mainnet | — | — | No se ofrecen: EURC 0,16 %; XLM 0,00 % y riesgo de precio; CETES, USTRY y TESOURO con 0,00 % por préstamo y riesgo de cambio o precio frente a una fianza en euros. Además su activo ≠ USDC (el registro lo rechaza) | No |

- **Modo "sin rendimiento": escrow sin vault, no estrategia `hodl`.** La estrategia `hodl` de DeFindex mete el dinero en un vault (con sus managers, `upgrade` y `rescue`) a cambio de nada. Sin vault hay menos contratos de terceros y el mismo código (`kind == NoYield` omite el depósito y el retiro).
- **Mainnet: vaults propios de DeFindex** (creados con su factory) con los roles `manager`/`emergency_manager`/`rebalance_manager`/`fee_receiver` en un multisig de la plataforma y la fee del vault declarada. Así no dependemos de los managers de un vault de terceros (R-5).
- **En testnet no se registra ninguna estrategia `High`**: no hay un vault USDC sobre Etherfuse (los de testnet son de CETES y XLM, con activo ≠ USDC). La UI muestra la tarjeta "RWA" deshabilitada con el aviso y el APY de mainnet leído en vivo, para enseñar el flujo sin simular nada.
- El rendimiento del panel es una **estimación** (`accrued_yield`), siempre con "variable, no garantizado". Las comisiones propias del vault de DeFindex (`get_fees`) ya están descontadas del valor de la share.

### 7.1 Rutas de escalabilidad [AD-18]

**Principio:** una fianza **fija su estrategia al crearla** (snapshot `Terms.strategy`, que incluye vault, activo con emisor y nivel de riesgo, y que el inquilino firma en `expected_terms`). Cambiar el registro solo afecta a fianzas **nuevas**. Una fianza ya creada nunca cambia de vault, ni siquiera si el admin desactiva su estrategia: sigue pudiendo liquidarse, porque las salidas no consultan la factory.

**Añadir una estrategia sin redeploy del escrow.** El escrow habla con cualquier vault de DeFindex a través del mismo subconjunto de interfaz (§ 6.5). Por tanto:
1. DeFindex publica una estrategia (por ejemplo, una nueva de Etherfuse) → creamos un vault de DeFindex sobre ella con activo USDC, o usamos uno existente auditado.
2. `scripts/` verifica off-chain: `get_assets()` = [USDC con el emisor exacto], una sola estrategia, la estrategia esperada, `get_fees()`, los managers y que el vault es del wasm oficial de DeFindex.
3. Admin: `add_strategy(s)`. Queda **deshabilitada**; se revisa el evento `f_strategy`.
4. Admin: `set_strategy_enabled(id, true)` → disponible en `create_fianza`.
5. El front la muestra con su `RiskTier`, su aviso y su APY en vivo (`apy_pool`).
Solo si una estrategia futura **no** encaja en la interfaz de vault de DeFindex (otro `StrategyKind`) hace falta un wasm de escrow nuevo (`set_escrow_wasm_hash`), y solo afecta a fianzas nuevas.

**Validaciones del registro** (on-chain en `add_strategy`/`set_strategy_enabled`, más las off-chain del script):

| Validación | Dónde | Motivo |
|---|---|---|
| Solo el admin añade, habilita, deshabilita o cambia la estrategia por defecto | `admin.require_auth()` | Lista blanca |
| Alta en dos pasos (`enabled = false` al añadir) | factory | Revisar el evento antes de exponerla |
| `RiskTier` obligatorio; `NoYield ⇔ kind NoYield`; `High` exige aviso con casilla en la UI | factory + front | Comunicación del riesgo |
| `asset == config.token` | factory | La fianza siempre se denomina en el token del escrow (USDC). Un vault de otro activo (CETES, USTRY, USDY) **se rechaza**. Para usarlo, la estrategia del vault tendría que tener USDC como activo y hacer el cambio dentro |
| **Emisor exacto fijado**: `token::Client(asset).name() == asset_name` (`"USDC:G…"`). Además, el script compara la dirección del SAC con la lista oficial | factory + script | Evita tokens falsos con el mismo código (hay al menos 10 USDY falsos en Stellar) |
| `vault ∉ {token, factory, treasury, staff}` | factory | Configuración absurda o maliciosa |
| El vault es una instancia del wasm oficial de DeFindex, tiene una sola estrategia y los managers esperados | script (off-chain) | La factory no puede leer el wasm de otro contrato on-chain sin coste. La auth exacta del depósito (R-11) se comprueba en cada fondeo |
| Desactivar = bloquear **nuevas** altas y fondeos; nunca salidas | factory + escrow | Respuesta a incidentes sin atrapar fondos |
| No se puede desactivar la estrategia por defecto sin cambiarla antes | factory | Siempre hay una por defecto válida |
| Máximo 10 estrategias | factory | Presupuesto de `strategies()` |
| [M] Tope de TVL por estrategia (`max_tvl`) y timelock del admin | futuro | Concentración de riesgo |

**Roadmap de "RWA de verdad" (no se implementa en el MVP):** una estrategia DeFindex **propia** (con la skill de estrategias de DeFindex) que, con USDC como activo del vault, compre y mantenga un token de letras del Tesoro que se revalorice, y venda al retirar.

| Candidato | Hechos verificados | Pendiente / riesgos |
|---|---|---|
| **Ondo USDY** | En Stellar. 3,73 % de APY y 538 M$ de TVL (DefiLlama, producto total). Emisor `GAJMPX5NBOG6TQFPQGRABJEEB2YE7RFRLUKJDZAZGAD5GFX4J7TADAZ6`, SAC `CB3YA656OYIHU57657I5KGSBRHE5I3OZU4VFC22PYAOANFZHEWNYGAGP`. `auth_required = false` (un contrato puede tenerlo sin autorización previa), **clawback y revocable activados**. Al menos 10 USDY falsos en Stellar. El mint directo exige KYC, no ser de EE. UU. y 40–50 días de espera | El emisor puede **congelar o recuperar** saldos de nuestra estrategia (riesgo de emisor). La entrada y salida serían por mercado secundario (liquidez y deslizamiento en Stellar a verificar). Denominado en USD (riesgo de cambio frente a una fianza en euros). Verificar las condiciones de uso para contratos y residentes en la UE |
| **Spiko EUTBL** | En Stellar; letras del Tesoro en euros | Verificar si exige lista blanca o KYC del titular (un contrato puede no ser elegible), la liquidez y el emisor exacto. Exigiría un token de fianza en EUR (`config.token` multi-activo → cambio de factory) |

Cualquiera de las dos rutas solo se registra tras verificar el emisor exacto, la elegibilidad de un contrato como titular, la liquidez de salida y el tratamiento regulatorio (MiCA y PRIIPs). Se describe siempre como "más rendimiento potencial y otros riesgos", nunca como libre de riesgo.

---

## 8. Data Flow

### 8.1 Quién firma y quién paga

| Paso | Firma (auth) | Fee de red | Canal (build en la API § 6.8 y después envío) | Fees económicos |
|---|---|---|---|---|
| Crear la cuenta (casero o inquilino) | passkey | Relayer | `/api/fianzas/v1/relay` | — |
| `factory.create_fianza` (y `_batch`) | passkey del casero | Relayer | `/api/fianzas/v1/relay` | — |
| `escrow.cancel` | passkey del casero | Relayer | `/api/fianzas/v1/relay` | — |
| Ramp simulado → C-address | faucet (servidor) | faucet (XLM) | `/api/fianzas/v1/ramp` | — |
| `escrow.fund_escrow` (+ `token.transfer` anidado; el escrow autoriza el depósito en el vault y llama a `register_tenant`) | passkey del inquilino | Relayer | `/api/fianzas/v1/relay` | — |
| `escrow.approve_release` (×2; la 2.ª liquida) | passkey de la parte | Relayer | `/api/fianzas/v1/relay` | del **rendimiento**: fee de TW + fee de plataforma |
| `escrow.stop` (+ bond anidado) | passkey del casero | Relayer | `/api/fianzas/v1/relay` | bond (depósito) |
| `assign_expert`, `record_report`, `resolve` | staff (Freighter) | staff (XLM) | build en `/api/fianzas/v1/fianzas/{contractId}/…` + `/api/stellar/send-transaction` | rendimiento: fees; bond → casero o tesorería |
| `claim_after_timeout`, `claim_after_review_timeout` | nadie | Relayer (si lo pulsa el inquilino) o XLM de quien lo lance | `/api/fianzas/v1/relay` o CLI | rendimiento: fees |
| Factory: config, estrategias, wasm, pausa | admin (identidad del CLI) | admin (XLM) | `scripts/` | — |
| Pago al perito | tesorería (off-chain, transferencia operativa) | tesorería | fuera del contrato | — |

### 8.2 Relayer con direcciones dinámicas (P3) [AD-17]
```ts
export interface RelayPolicy {
  fixedContracts: Record<string, string[]>;   // { [factory]: ["create_fianza", "create_fianzas_batch"] }
  escrow: {
    wasmHashes: string[];                     // deployments.escrowWasmHashesAllowed
    factory: string;                          // la instancia debe estar registrada aquí
    functions: string[];                      // ["cancel","fund_escrow","approve_release","stop","claim_after_timeout","claim_after_review_timeout"]
  };
  createContractWasmHashes: string[];         // solo smart accounts
  maxRequestsPerMinutePerIp: number;
}
```
- Si el contrato raíz no está en `fixedContracts`: (1) `getLedgerEntries` de su instancia, cuyo ejecutable debe ser un wasm de `escrow.wasmHashes`; (2) simulación de `factory.id_of(addr)` que devuelve un id y no `NotFound`. **Las dos cosas**, porque el wasm es público y cualquiera puede desplegar una instancia propia con otras condiciones. El resultado se cachea por dirección: es inmutable.
- `assign_expert`, `record_report`, `resolve` y las funciones de admin de la factory **nunca** pasan por el Relayer.
- Siguen vigentes SRV-3 (sin `SOURCE_ACCOUNT`), SRV-4 (raíz idéntica a `func`), los límites de tamaño y ritmo y `server-only`. Con el ramp simulado, `token.transfer` queda fuera de la lista (SRV-5).

### 8.3 Lectura del panel
`factory.count_by_landlord(L)` → `factory.list_by_landlord(L, start, 50)` → `factory.get_fianzas(ids[0..25])`, una simulación por página **sin llamadas al vault** (en DeFindex, `get_asset_amounts_per_shares` actualiza informes de estrategias y es caro; 25 de esas llamadas podrían superar el presupuesto de simulación). El rendimiento en vivo de la lista: **una** simulación por vault de `get_asset_amounts_per_shares(10^7)` (precio por share) y `shares × precio` en el cliente, etiquetado como "estimado". En el detalle, `escrow.get_view()`. Polling cada 5 s.
**Feed de actividad:** `getEvents` con filtros por topic (`fz_*`, `f_*`) desde `deployments.startLedger`, **descartando cualquier evento cuyo `contractId` no sea la factory o un escrow de `escrow_of(id)`**. Otros contratos pueden emitir los mismos topics (R-7).

### 8.4 Camino feliz
```mermaid
sequenceDiagram
  autonumber
  participant L as Casero (passkey)
  participant T as Inquilino (passkey)
  participant API as apps/api (montada en apps/web /api): /fianzas/v1/relay, /fianzas/v1/ramp y builds
  participant F as FianzaFactory
  participant E as Escrow #id
  participant V as Vault DeFindex (o mock)
  participant K as USDC (SAC)
  L->>L: code (32 B), invite_hash = sha256(code)
  L->>API: create_fianza(L, {invite_hash, amount, end_ts, bps, strategy: None→default}) [auth L]
  API->>F: (política OK)
  F->>E: deploy(wasm_hash, salt=id, EscrowInit{Terms snapshot}) → Proposed, fz_init
  F-->>L: Created{id, escrow}, f_created
  L-->>T: enlace /i/{id}#c=code (off-chain)
  T->>API: createAccount; /api/fianzas/v1/ramp (simulado)
  T->>F: escrow_of(id), get_terms() (lectura)
  T->>API: fund_escrow(T, code, expected_terms) [auth T: raíz + transfer(T→E, amount)]
  E->>F: funding_allowed(strategy) = true
  E->>K: transfer(T → E, amount) (medido)
  E->>V: deposit([amount],[amount],E,true) [authorize_as_current_contract: transfer(E→V, amount)]
  E-->>E: shares = Δ V.balance(E) → Active, fz_fund
  E->>F: register_tenant(id, T) → f_tenant
  T->>API: approve_release(T) → fz_approve(1)
  L->>API: approve_release(L) → quórum 2
  E->>V: withdraw(shares, [0], E) → total = Δ balance
  E-->>E: split() → Settled, fz_settle{Approved}
  E->>K: transfer → T, L, treasury, tw_fee_receiver
```

### 8.5 Parada → staff → perito
```mermaid
sequenceDiagram
  autonumber
  participant L as Casero (passkey)
  participant S as Staff (Freighter)
  participant E as Escrow #id
  participant V as Vault
  L->>E: stop(reason_hash) [auth L + transfer(L→E, stop_bond)]; now ≤ timeout_at
  E-->>E: bond_held = stop_bond (fuera del vault), stopped_ts, Stopped, fz_stop
  S->>E: assign_expert(S, expert_ref) → UnderReview
  Note over S: perito off-chain (lo paga la tesorería)
  S->>E: record_report(S, sha256(sal‖informe))
  S->>E: preview_settlement(X) (simulación)
  S->>E: resolve(S, X, stop_justified) ; now ≤ review_deadline ; !justified ⇒ X == 0
  E->>V: withdraw → total
  E-->>E: split(total, amount, X) → Settled{Resolved}
  E->>E: pagos de Settlement; después el bond: justified → L, si no → treasury (fz_bond)
```

### 8.6 Timeout del inquilino
`Active` y `end_ts` pasado → `Ending`. Hasta `timeout_at` el casero puede aprobar o parar (con bond). Si `now > timeout_at`, `stop` falla con `DeadlinePassed` y cualquiera puede ejecutar `claim_after_timeout()` → `split(total, amount, 0)` → `Settled{Timeout}`. El inquilino recibe principal + su parte. Demo: fianza creada antes del pitch con `end_ts = now + 60 s` y `timeout_secs = 120`.

### 8.7 Revisión vencida
`Stopped`/`UnderReview` y `now > stopped_ts + review_timeout_secs` → `resolve` falla con `ReviewDeadlinePassed` y cualquiera ejecuta `claim_after_review_timeout()` → `split(total, amount, 0)` → `Settled{ReviewTimeout}`, el bond vuelve al casero (`fz_bond {justified: None}`). Ni la plataforma ni el staff ganan nada con su inacción (OC-5). Demo: `review_timeout_secs = 300`.

---

## 9. Technology Decisions

| Decisión | Elección | Alternativas | Justificación |
|---|---|---|---|
| Base del escrow | Fork de TW `single-release-develop-v2` @ `1d22d0c` [AD-12] | v1, escrow propio (versión anterior) | § 0 C-1 y § 1.1 |
| Topología | Factory + un contrato por fianza | Singleton | Aislamiento y modelo de TW (C-2) |
| Despliegue | `deployer().with_current_contract(salt=id)` + `__constructor(EscrowInit)` | `tw_new` + `initialize_escrow` | Inicialización atómica, sin ventana ni clave de admin. La salt derivada del id evita colisiones y squatting (TW la recibía del llamante) |
| Tipos compartidos | `contractimport!` del wasm del escrow en la factory | Crate común de tipos | Sin carpeta nueva sin dueño. Exige compilar el escrow antes (CI y scripts) |
| Vault | Llamada directa a DeFindex (subconjunto), retorno ignorado y medición por balance | `yield-adapter` | C-3. Sin replicar sus tipos complejos |
| Sin rendimiento | `NoYield` sin vault | Estrategia `hodl` de DeFindex | § 7 |
| Storage del escrow | persistent `DataKey::Escrow` (una entrada) + TTL de la instancia en cada escritura | instance | Regla de `CLAUDE.md` y menor diff con el upstream. Una sola entrada de datos evita archivados parciales |
| Storage de la factory | instance (config) + persistent (registro e índices paginados) | `Vec` por casero | C-10 |
| Pausa | Manual en la factory, solo de entrada [AD-2] | OZ `pausable` | Sin acoplar versiones y sin bloquear salidas |
| Fee de TW | `tw_fee_bps` configurable sobre el rendimiento, destino en config; **0 en el MVP** | Constante del 0,3 % sobre el bruto | C-4, Q-16 |
| Eventos | `#[contractevent]` con `fz_*`/`f_*` | Topics `tw_*` | No confundir a los indexers de TW |
| SDK | `soroban-sdk 28.0.0` | ≥ 23 | Igual que el upstream (C-15) |
| API | Hono 4 en `apps/api`, montada en `apps/web` (`hono/vercel`), compatible con TW Core API v2 [AD-19] | Fastify aparte; rutas sueltas de Next; sin API | Request/Response estándar (corre en Vercel y en Node), una sola origin, sin servidor aparte que desplegar; compatibilidad con el SDK de TW cambiando la `baseUrl` |
| Envío patrocinado | Endpoint aparte `/fianzas/v1/relay` [AD-20] | Que `send-transaction` decida | Superficie de política única y explícita (§ 6.8.4) |
| Read-model | Cadena directa + caché en memoria [AD-21] | Indexer propio con BD | 28 h; la factory ya guarda los índices on-chain |
| Comisiones de DeFindex | Snapshot en `Terms` + tope en el registro + comprobación al fondear + vault propio en mainnet [AD-23] | Ignorarlas; solo tope | § 6.9 |
| Front, wallet, anchor, staff, scripts | Sin cambios (Next.js ×2, smart-account-kit, OZ Channels con proxy, ramp simulado, Freighter, Node `.mjs`) | — | Versión anterior, [AD-8…AD-11] |

## 10. Spike H0–H3 (actualizado)

| Hora | Quién | Prueba | Criterio de éxito | Si falla |
|---|---|---|---|---|
| H0:30–H1:30 | P1 | Copiar v2 @ `1d22d0c` a `contracts/escrow`, `NOTICE.md`, `cargo build --target wasm32v1-none --release` y **los tests upstream en verde** con nuestro toolchain. Medir el tamaño del wasm | Compila y los tests pasan | **H1:30: se pasa a v1 @ `f0b706e`** con el mapeo approver/release_signer (§ 1.1). Las interfaces de § 6 no cambian |
| H1:00–H2:00 | P1 | **Quórum de 2**: con el fork recortado, `approvers = [L]` y `target = 2`; `fund_escrow` añade T; `approve_release(L)`, `approve_release(T)` → liquida. Con `Address::generate` **y** con una cuenta contrato (`__check_auth` real), sin `mock_all_auths` | Liquida solo en la 2.ª aprobación; la misma parte dos veces → `AlreadyApproved` | Lógica de quórum propia (≈30 líneas) dentro de `milestone.rs` |
| H1:00–H3:00 | P2 | **Depósito desde un contrato en el vault de testnet**: (1) `get_assets()` de `usdc_paltalabs_vault` → token subyacente y estrategia; `get_fees()` (y si `defindex_protocol_fee` se aplica sobre la comisión del vault o sobre las ganancias); `get_manager()`; ¿alguna estrategia pausada? (2) contrato mínimo de prueba (o el esqueleto del escrow) que hace `deposit([10 USDC],[10 USDC],self,true)` con `authorize_as_current_contract` exacto, mide `balance(self)` y hace `withdraw(shares,[0],self)` midiendo el token; (3) `get_asset_amounts_per_shares`; (4) coste en CPU y tamaño del footprint | Shares > 0, retiro ≥ depositado − redondeo, sin auth extra | (a) vault propio con `defindex_factory` sobre `USDC_blend_strategy` + depósito semilla (CT-9); (b) si DeFindex no sirve en H3: **demo con `usdc_mock`** (recorte 4) y `yield-adapter` sobre Blend como plan C, con la misma interfaz |
| H2:00–H3:00 | P1 | **Factory mínima**: `create_fianza` despliega el wasm del escrow (`upload_contract_wasm` en tests) con `EscrowInit` y comprueba `escrow_of(id)`. Medir cuántos despliegues caben en una transacción en testnet (límites de escritura y CPU) | Despliega e inicializa en una llamada | `MAX_BATCH` según la medida, o el lote se recorta (Could) |
| H1–H3 | P3 | Spike de la versión anterior (passkey → C-address → `{func, auth}` → Channels) **contra una instancia creada por factory**, más la comprobación de wasm hash por `getLedgerEntries` | La C-address firma `fund_escrow` con su `token.transfer` anidado | Sin cambios respecto a la versión anterior |

**G2 (H3):** `docs/DECISIONS.md` con: base del fork (v2 o v1), vault de testnet (`usdc_paltalabs_vault`, propio o mock), `MAX_BATCH` medido y kit de passkeys.

## 11. Orden de implementación por rol (alineado con `docs/PIPELINE.md`)

| Fase | P1 · escrow + factory | P2 · DeFi + infra | P3 · onboarding | P4 · UX/UI |
|---|---|---|---|---|
| **G0 (H0–H1)** | Setup. H0:30: copia del fork, `NOTICE.md`, build + tests upstream | Monorepo (`soroban-sdk 28.0.0`), PR de `team.json`/`CLAUDE.md` (§ 4.1) y CI con build del escrow antes de la factory. Identidades del CLI. PR de `team.json` con el área `api` | Setup y docs | Esqueleto Next ×2 |
| **G1 (H1–H2)** | `/lock interfaces` con § 6 de este documento. Recorte del fork (elimina funciones de § 5), `types.rs`, `error.rs`, `split` + matriz | Revisa § 6.5 y § 6.6. Empieza `mock-vault` con la interfaz de DeFindex (incluidos `get_fees`/`get_manager`). Lleva § 6.8.9 (API) al `/lock interfaces` | Revisa § 6.7 y § 8.2 | Baja fidelidad: creación con selector de estrategia, aviso de riesgo, parada con bond |
| **G2 (H1–H3)** | Spike del quórum y de la factory mínima (§ 10) | Spike del vault (§ 10). `mock-vault` entregado (H3). Esqueleto de `apps/api` (Hono, Problem Details, `/fianzas/v1/config`, `/stellar/send-transaction`) y montaje de relay y ramp | Spike de passkeys contra una instancia de la factory | Pantallas contra `FakeWallet` y fixtures `FianzaSummary` |
| **H3–H5** | **Todas las firmas públicas** de escrow y factory compiladas (las de la fase 5 con cuerpo provisional `BadStatus`). Factory: config, registro, índices y `register_tenant` | `deploy.mjs`: sube el wasm del escrow → despliega la factory → `add_strategy` ×3 → `set_default_strategy`. `bindings.sh` (factory, escrow, token). **Primer despliegue en H5**. API: lecturas (`GET /escrow/single-release/v2/{contractId}`, `/fianzas/v1/.../terms`, `/view`, `/strategies`, listas) con cliente `@fianzas/api/client` | `FakeWallet`/`FakeAnchor`; `createRelayHandler` con `RelayPolicy` nueva y tests | Bindings reales (H5), `SignButton` |
| **Fase 3 (H5–H10)** | `fund_escrow` (invitación, `expected_terms`, vault, `register_tenant`), `approve_release` + `settle` + `split`, `cancel`, lecturas, `funding_allowed`, tests de auth y estado, test con cuenta contrato | `fund.mjs` (trustlines de tesorería y del receptor del fee de TW, faucet, reserva del mock, bond de los caseros demo); `e2e/happy.mjs` **a través de la API** (build → firma → envío). API: builds de `fianzas`, `fund`, `approve-milestones`, `approve-and-release-milestones`, `cancel` y la extensión `soroban` para C-address | `createWallet` real | Panel (lista paginada + precio por share), creación con estrategia y enlace de invitación, flujo del inquilino |
| **G3 (H10–H12)** | Fusiona; avisa a P2 | Integración: redeploy, bindings y `deployments.json`. **Fianza larga** con `usdc_fixed` (o `usdc_mock`) y `/api` en el dominio definitivo | Cambio a real (`signAndSendBuilt`); cuentas demo en el dominio definitivo | `NEXT_PUBLIC_USE_FAKES=0`; camino feliz |
| **Fase 5 (H12–H16)** | (H14–H16) `stop` + bond, `assign_expert`, `record_report`, `resolve` con `stop_justified`, `claim_after_timeout`, `claim_after_review_timeout` y tests de security § 12.9 | (H12–H14) `e2e/stop.mjs` (los dos valores de `stop_justified`), `e2e/timeout.mjs`, `e2e/review-timeout.mjs` y cuenta de staff. API: `stop`, `assign-expert`, `record-report`, `resolve`, `claim-*`, `preview-settlement` y los `501` con `replacement` | (H14–H16) Ramp simulado | (H12–H14) Backoffice con `stop_justified` explícito |
| **G4 (H16–H22)** | `create_fianzas_batch` **(Could)**, bordes temporales y `evil_vault` | Redeploy final, AC-13 (≤ 10 min). API: `/escrows*`, `/financial`, `/events`, API keys y prueba con `@trustless-work/escrow-js` cambiando la `baseUrl` | Robustez | Timeout y revisión vencida en la UI, feed de eventos, `check-copy.mjs` |
| **G5 (H22–H28)** | Checklist de seguridad (contrato y factory) + `NOTICE.md` final | README con diagrama y NOTICE | Móviles listos | Pitch ("construido sobre Trustless Work, con permiso"), vídeo |

**Carga:** P1 es el rol más cargado y no toca la API. P2 absorbe la API (unas 6–8 h repartidas entre H2 y H22) gracias a las 4 h que libera `yield-adapter`; asume además todos los e2e y puede proponer tests de la factory con la etiqueta `cross-area` y la aprobación de P1. P4 añade un solo archivo (`apps/web/app/api/[[...path]]/route.ts`) y consume `@fianzas/api/client`; hasta H5 usa `FakeWallet` y fixtures. **Plan de degradación de la API:** si en H10 los builds no están listos, el front sigue con bindings + `signAndSend` (diseño anterior) y la API queda con relay, ramp y lecturas; las rutas TW de solo lectura y `/escrows*` son lo último que se recorta de la API. **Recortes, en orden:** (0) `create_fianzas_batch`; (0b) `/escrows/financial`, `/events`, API keys y `/graphql` de la API; (1) anchor real; (2) UI de los timeouts (se quedan en el contrato y los tests); (3) backoffice → script; (4) vault real → `usdc_mock`. **Nunca se recortan:** los tests del contrato y de la factory, la factory misma, el relay de la API (es el único camino patrocinado), el flujo con passkey ni el camino feliz en testnet.

## 12. Riesgos para Security

1. **R-1 Fork sin auditar.** v2 es beta, y el fork cambia fondeo, liberación y disputa. Ninguna auditoría (tampoco la de Runtime Verification, anterior a V2) cubre el código. El pitch no la cita.
2. **R-2 Poder del admin de la factory.** `set_escrow_wasm_hash` puede apuntar las fianzas **nuevas** a un wasm malicioso; `add_strategy` puede añadir un vault malicioso; `set_config` cambia fees, staff y plazos de las nuevas. No afecta a las existentes. Mitigaciones [H]: eventos `f_wasm`/`f_strategy`/`f_config`; el front y el Relayer solo aceptan wasm de `escrowWasmHashesAllowed` y vaults de `deployments.strategies`; el inquilino firma `expected_terms`. [M]: timelock y multisig del admin.
3. **R-3 Instancias falsas del escrow.** El wasm es público: cualquiera puede desplegar una instancia con otras condiciones (por ejemplo, otra tesorería). Solo valen las de `factory.escrow_of(id)`. El enlace lleva el **id**, nunca la dirección. El Relayer comprueba wasm y registro (§ 8.2). `register_tenant` desde una instancia no registrada falla (`NotEscrow`).
4. **R-4 Callback `register_tenant`.** Debe aceptar solo al escrow registrado para ese id (contaminación del índice o phishing en el panel). Necesita un test con un contrato impostor.
5. **R-5 Confianza en el vault de DeFindex.** Sus managers pueden hacer `rescue`, `pause_strategy`, `rebalance` y **`upgrade`** del wasm del vault. En testnet, `usdc_paltalabs_vault` está gestionado por PaltaLabs. En mainnet, vault propio con managers en multisig (§ 7). Hay que revisar si `upgrade` permite desviar fondos.
6. **R-6 Riesgo de Blend.** Oráculo y mala deuda en el Fixed Pool (uso del 73,8 % el 25-oct-2026: una subida de la utilización puede impedir retiros); colateral RWA ilíquido en Etherfuse (precedente YieldBlox/USTRY). Iliquidez: si `withdraw` revierte por alta utilización, **todas las salidas de esa fianza quedan bloqueadas**, también el timeout del inquilino. [H]: mensaje claro y reintento. [M]: retiro parcial o pago *pull* (`Owed`) y topes por vault.
7. **R-7 Suplantación de eventos.** Cualquier contrato puede emitir `fz_*`. El feed filtra por `contractId` registrado.
8. **R-8 Destino del fee de TW.** El upstream lo acepta como argumento del llamante. En el fork sale de `Terms`; si `tw_fee_bps > 0` sin receptor, el constructor falla. El receptor (G) necesita trustline y `fund.mjs` lo verifica, porque si no, revierte el `settle` (pagos *push*, CT-11).
9. **R-9 Snapshot del staff.** Rotar el staff no afecta a fianzas existentes: una clave comprometida sigue valiendo en ellas. Mitigaciones: 1–3 resolvers, `review_timeout` y, en mainnet, staff como smart account o multisig.
10. **R-10 Guard de reentrada eliminado.** Se confía en la prohibición nativa de reentrada de Soroban. Verificar que ninguna llamada externa (vault, token, factory) puede volver a entrar al escrow, y que el estado `Settled` se escribe antes de pagar.
11. **R-11 Auth del vault.** `authorize_as_current_contract` debe autorizar exactamente `token.transfer(escrow, vault, amount)`, y `deposit` con `amounts_min = [amount]`. Test sin `mock_all_auths` y con `evil_vault`.
12. **R-12 Presupuesto.** `get_fianzas` no llama al vault. `create_fianzas_batch` limitado por la medida del spike. Las transacciones son atómicas.
13. **R-13 Bond.** Se aplican OC-1 a OC-4. OC-5 pasa a [H] gracias a `claim_after_review_timeout`. El bond queda líquido fuera del vault. Invariante por instancia: `balance(escrow) == bond_held + (principal líquido si NoYield)`.
14. **R-14 Licencia y permiso.** Repositorio público con código de TW sin licencia: el permiso escrito tiene que cubrirlo (Q-17).
15. **R-15 Regulación.** MiCA art. 50 (rendimiento sobre un EMT como el USDC) y custodia. Además, el aviso de riesgo de `usdc_etherfuse` no puede sonar a recomendación de inversión. Un token RWA (USDY o EUTBL) puede ser un instrumento financiero (MiCA o PRIIPs). Nunca se usa "0 riesgo" ni "sin riesgo" en ningún texto.
16. **R-16 Registro de estrategias y tokens RWA.** Tokens falsos con el mismo código (al menos 10 USDY falsos): se fija `asset_name` (CÓDIGO:EMISOR) y la dirección del SAC. Los emisores con clawback o revocable (USDY) pueden congelar o recuperar saldos de una estrategia: es un riesgo de emisor que hay que divulgar y que, por ahora, excluye estas estrategias del MVP. Una estrategia desactivada no debe bloquear salidas (test). El admin que añade un vault malicioso solo afecta a fianzas nuevas, y el script de verificación off-chain y el alta en dos pasos son el control (R-2).
17. **R-17 API y builds sin auth.** Coste de simulaciones (DoS de la RPC o de Channels): límites por IP y por key, caché y `Origin` propio en relay y ramp. Un build manipulado (API comprometida) que devuelva otro árbol de auth: **WEB-3 sigue siendo obligatorio en el cliente**, que verifica raíz, función, argumentos y subinvocaciones antes de pedir la passkey. La API no es de confianza para el contenido de lo que se firma.
18. **R-18 `inviteCode` en `POST /escrow/single-release/v2/fund`.** El operador de la API lo ve antes del envío. Impacto bajo (quien se adelante bloquea su propio dinero, CT-13). Mitigaciones: no se registra ni se cachea, HTTPS y misma origin. [M] invitación ed25519 (CT-13), que elimina el secreto reutilizable.
19. **R-19 Compatibilidad engañosa con el SDK de TW.** Un componente de Blocks puede mostrar `platformFee` o `release` con la semántica de TW. Por eso `platformFee = 0` en la forma TW, las comisiones reales van en `fianza.fees`, y las rutas con otra semántica devuelven `501` en lugar de reinterpretar el cuerpo. Revisar que ninguna ruta TW "igual" mueva dinero a destinos que el llamante no espera (`approve-milestones` liquida en la 2.ª aprobación: documentado).
20. **R-20 Comisión del vault de DeFindex.** Subida entre crear y fondear: bloqueada (`VaultFeeChanged`). Subida después del fondeo: posible si el manager no es la plataforma (testnet: `usdc_paltalabs_vault`). Mainnet: `config.vault_manager` obligatorio, multisig y monitor de `get_fees()`. La comisión solo afecta a ganancias, nunca al principal; `settle` no se bloquea por comisiones.
21. **R-21 API keys en `API_KEYS_JSON`.** Sin rotación automática ni revocación inmediata (exige redeploy). Secretos con hash, comparación en tiempo constante y keys sin acceso al Relayer.

## 13. Trade-offs and Known Limitations

- Más contratos y direcciones dinámicas: bindings por dirección, Relayer y feed más complejos (resuelto en § 8).
- Una vez creada, una fianza no se puede migrar a un wasm corregido: no hay upgrade del escrow. Las correcciones solo llegan a fianzas nuevas.
- Pagos *push*: un receptor que no puede cobrar bloquea su `settle` (CT-11). En la hackatón, solo C-address y trustlines verificadas.
- `withdraw` sin pago parcial: con un pool ilíquido no hay liquidación hasta que vuelva la liquidez.
- Un déficit de principal (pérdida mayor que el rendimiento) recae en el inquilino tras la deducción (Q-13).
- Rendimiento casi nulo en testnet: la demo de "yield en vivo" puede requerir `usdc_mock`, etiquetado.
- Índice de inquilinos solo al fondear; las invitaciones pendientes no aparecen en el panel del inquilino.

## 14. Dependencies (External Libraries)

| Librería o contrato | Propósito | Versión |
|---|---|---|
| `soroban-sdk` (+ `testutils`) | Escrow, factory y mock | **28.0.0** (igual que el upstream) |
| Código de TW | Base del escrow | `single-release-develop-v2` @ `1d22d0c` (o v1 @ `f0b706e`) |
| Vault de DeFindex (on-chain, sin crate) | Rendimiento | testnet: hash del vault `f345228d…`, factory `CDSCWE4G…4A32`, `usdc_paltalabs_vault` `CBMVK2JK…ZDWHN`, `USDC_blend_strategy` `CALLOM5I…ALFSUY`. Mainnet: `usdc_blend_autocompound_fixed_strategy` `CDB2WMKQ…AVZSAP` sobre el Fixed Pool `CAJJZSGM…BXBD` |
| SDK de Blend (TS, solo front) | Supply APY en vivo de `Strategy.apy_pool` | última; P4 |
| Stellar CLI | Build, deploy, bindings e identidades | el correspondiente al SDK 28 |
| TS (`@stellar/stellar-sdk`, smart-account-kit, OZ Channels, typescript-wallet-sdk, stellar-wallets-kit, Next ≥ 15 parcheado, React 19, Tailwind 4, `server-only`, Vitest) | Sin cambios | ver la versión anterior y security WEB-8 |

## 15. Preguntas abiertas

| # | Pregunta | Decisión provisional | Quién y cuándo |
|---|---|---|---|
| Q-13 | Déficit de principal tras compensar con el rendimiento: ¿lo absorbe el inquilino, el casero o se reparte a prorrata? | El inquilino, después de la deducción | Equipo, antes de G1 |
| **Q-16** | ¿Se activa el 0,3 % de TW **solo sobre el rendimiento**? ¿A qué dirección? | **Fuera del MVP: `tw_fee_bps = 0`** y `tw_fee_receiver = None`. El parámetro existe, los tests cubren 0 y 30, y se activa con `set_config` (solo para fianzas nuevas) cuando TW lo acuerde | P1 con TW, después de la hackatón |
| **Q-17** | ¿El permiso de TW cubre el repositorio **público**, la licencia de nuestras modificaciones y un uso comercial futuro? | Solo hackatón y repositorio público, documentado en `NOTICE.md` | P1, G0 |
| **Q-18** | ¿Vault de testnet: `usdc_paltalabs_vault` o uno propio? | El que pase el spike; si ninguno, `usdc_mock` | P2, G2 |
| **Q-19** | ¿Mainnet: vault propio de DeFindex o de terceros? ¿Quién lleva los roles del vault? | Propio, con managers en multisig | Producto, después de la hackatón |
| **Q-20** | RWA de verdad (§ 7.1): ¿puede un contrato tener USDY o EUTBL? ¿Qué liquidez de salida hay en Stellar? ¿Cómo se trata el clawback del emisor de USDY? | Roadmap, sin implementar. USDY: `auth_required = false`, pero con clawback y revocable; el mint exige KYC. EUTBL: sin verificar | Producto |
| **Q-23** | ¿Se usa `usdc_etherfuse` como opción "RWA" en el pitch pese a su 0,05 % de APY? | Registrada en mainnet como `High`, no recomendada. En la demo, tarjeta deshabilitada con el APY en vivo | P4 (pitch) |
| Q-21 | Destino del bond perdido (OC-8: ¿inquilino, `expert_fund`?) | Tesorería (decisión del equipo) | Producto, antes de mainnet |
| Q-22 | `MAX_BATCH` real | 10, a medir en el spike | P1, H3 |
| Q-15 | Dominio fijo para el `rpId` | Sin cambios | P3 + P4, G2 |
| **Q-24** | ¿`defindex_protocol_fee` se cobra sobre la comisión del vault o sobre las ganancias? | A confirmar leyendo `report`/`lock_fees` en el spike; solo cambia cómo se **muestra** (el `split` no depende de ello) | P2, G2 |
| **Q-25** | ¿Exigimos vault gestionado por la plataforma ya en testnet (vault propio con `defindex_factory`) en vez de `usdc_paltalabs_vault`? | No en testnet (`vault_manager = None`, aviso "vault de terceros"); sí en mainnet | P2, G2 |
| **Q-26** | Campo `platformFee` en la forma TW: `0` (para no mostrarlo como % de la fianza) o el % real con otra base | `0` + `fianza.fees` | P4 + P2, G1 |
| **Q-27** | ¿Acepta `@trustless-work/escrow-js` una `baseUrl` con path (`/api`) y las extensiones (`soroban`, `fianza`) sin romper sus tipos? | Probarlo en G4; si no, subdominio `api.<dominio>` con la API en la raíz | P2, G4 |
| **Q-28** | ¿Sesión de wallet (Bearer JWT) para los caseros del front? | No en el MVP; [M] SEP-10/SEP-45 | Producto |

## 16. Notes for Development Agent

1. **Primero NOTICE y spike.** No se fusiona código copiado de TW sin `NOTICE.md` en la raíz, sin la cabecera en cada archivo y sin los marcadores `// FIANZAS:`.
2. **Interfaces:** § 6 es el borrador de `docs/INTERFACES.md` (escrow § 1, factory § 1b nuevo, vault § 2, deployments § 3, wallet y Relayer § 4/4b). P1 lo lleva con `/lock interfaces` en H1.
3. **Escrow, en este orden:** recorte del fork → `types`/`error` → `split` + matriz → constructor → `fund_escrow` (con `mock-vault`) → `approve_release` + `settle` → lecturas → `cancel` → firmas completas (H5) → parada, bond y resolve → timeouts.
4. **`settle` es el único sitio que paga principal y rendimiento.** `pay_bond` solo se llama desde `resolve` y `claim_after_review_timeout`, después de `settle`. Se escribe `Settled` antes de transferir y nunca se transfiere 0.
5. **Las salidas no llaman a la factory.** Solo `fund_escrow` lo hace (`funding_allowed`, `register_tenant`).
6. **Tests:** nunca `mock_all_auths` en auth ni vault. Cuenta contrato real para el quórum. `evil_vault`. Impostor de `register_tenant`. Bordes temporales complementarios. Invariante de balance con bond.
7. **Build:** el wasm del escrow se compila antes de la factory (`contractimport!`). El job de CI y `deploy.mjs` respetan ese orden.
8. **Front:** la estrategia, sus avisos y los textos de riesgo salen de `factory.strategies()`. Nunca "sin riesgo". `usdc_etherfuse` lleva aviso con casilla. `simulated` muestra la etiqueta.
9. **API (P2):** convenciones de TW sin excepciones (camelCase, `{ data, hasMore, nextCursor }`, Problem Details con `code` estable, importes string en lecturas, nunca firma). Rutas TW con otra semántica → `501` con `replacement`, nunca reinterpretar. El relay solo en `/fianzas/v1/relay`. Nada del body de `fund` en logs.
10. **Fuera de tu área no se edita.** `harness/team.json`, `CLAUDE.md` y la CI cambian por PR con lock (§ 4.1).
