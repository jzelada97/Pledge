# Architecture Decision Record · Fianzas de habitación en Soroban (v2: escrow propio por fianza + factory)

> Revisión del agente de arquitectura del 2026-10-25. Sustituye entera a la versión anterior (opción A, escrow propio singleton).
> Entradas: `.kiro/pipeline/enriched-prompt.md`, la versión anterior de este documento, `.kiro/pipeline/security.md` (incluida la sección 12, *stop bond*), `docs/INTERFACES.md`, `docs/PIPELINE.md`, `harness/team.json` y `CLAUDE.md`.
> Código leído de verdad: `Trustless-Work/trustlesswork-smart-contract-stellar`, ramas `single-release-develop` (commit `f0b706eaf6e98aa83bf4f95df42857b5d4c8e847`) y `single-release-develop-v2` (commit `1d22d0c1b9c5788f4fd7184e42024bbe10303756`, 2026-09-29, `soroban-sdk 28.0.0`). Se leyeron los `src/` completos de las dos ramas, salvo los tests. También `paltalabs/defindex`: `apps/contracts/vault/src/lib.rs` (firmas de `deposit`, `withdraw` y `get_asset_amounts_per_shares`) y `public/testnet.contracts.json`.
> Marcas: **[AD-n]** es una decisión de arquitectura. **[TW-v2]** indica código que se conserva del upstream y **[FORK]** código que se modifica o se añade. **[G1]** significa que entra en `docs/INTERFACES.md` antes de congelarlo. **[Q-n]** es una pregunta abierta.

---

## 00. Decisión posterior: escrow propio, sin fork de Trustless Work (prevalece)

**Decisión del equipo (2026-10-25):** el escrow se escribe **desde cero**. No se copia ni se modifica código de Trustless Work. Este apartado prevalece sobre el resto del documento donde choquen:

| Dónde | Qué cambia |
|---|---|
| § 0 C-1, § 1, [AD-12], [AD-13] | **No aplican.** No hay rama base, ni plan B a v1, ni `NOTICE.md` de TW, ni cabeceras de origen, ni marcas `// FIANZAS:`. |
| § 0 C-2, C-3, C-5…C-15 | Se mantienen: un contrato escrow por fianza desplegado por `FianzaFactory`, vault de DeFindex directo, configuración copiada a `Terms`, registro de estrategias, índices paginados, pausa en la factory, `soroban-sdk = "28.0.0"`. |
| § 0 C-4, Q-16, R-8 | **Sin fee de TW.** Fuera `tw_fee_bps`, `tw_fee_receiver`, `Settlement.to_tw` y el término `tw` de `split()`. El único fee es `platform_fee_bps`, sobre el rendimiento. |
| § 4 y § 5 | La estructura de módulos de § 4 se mantiene, pero **todo es código nuevo**: las marcas [TW-v2] y [FORK] no aplican. La tabla de § 5 se lee como la lista de piezas a escribir (`contract.rs`, `core/{escrow, approvals, dispute, stop_bond, timeout, settle}`, `validators`, `modules/{vault, split, fee}`, aritmética con `checked_*`, `storage/types.rs`, eventos `fz_*`, un único `EscrowError`), no como un diff. |
| § 6.1 [AD-14] | Sustituido por "Roles de una fianza" en INTERFACES § 1. `Roles` y `get_roles()` se eliminan. El quórum de 2 (`Approvals { target: 2 }`) es lógica propia. |
| § 10 (spike) | La fila "compilar el fork" se sustituye por: **esqueleto del escrow propio** (tipos, errores, constructor) compilado a `wasm32v1-none` con un test del constructor. El spike del quórum de 2 con cuentas contrato se mantiene sobre nuestra lógica. |
| § 11, § 16 | Sin "copia del fork" ni "primero NOTICE". El pitch no dice "construido sobre Trustless Work". |
| § 12 R-1, R-14; § 15 Q-17 | R-1 pasa a "código propio sin auditar". R-14 y Q-17 quedan **cerrados**. |

Seguridad de esta versión: `.kiro/pipeline/security.md` § 13. Interfaces vigentes: `docs/INTERFACES.md`.

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
- **`contracts/escrow/NOTICE.md`** (obligatorio, P1, en G0), con:
  1. Origen: repositorio, rama, commit `1d22d0c1b9c5788f4fd7184e42024bbe10303756` y fecha.
  2. Permiso: quién lo concede en TW, la fecha, el alcance (copiar, modificar, publicar y, si lo cubre, el uso comercial) y un enlace o cita del permiso (issue, email archivado en `docs/`).
  3. "© Trustless Work. Usado y modificado con permiso". Las modificaciones son del equipo.
  4. Lista de archivos copiados, modificados, eliminados y nuevos (la tabla de § 5).
  5. Que **no** se aplica al código de TW ninguna licencia abierta del resto del repositorio salvo que TW la autorice.
  6. Que el fork **no está auditado** y difiere del upstream.
- **`contracts/factory/NOTICE.md`**: una línea que remite al NOTICE del escrow para el patrón derivado.
- **Cabecera en cada archivo copiado:** `// Derived from Trustless-Work/trustlesswork-smart-contract-stellar@1d22d0c (<ruta>), modified. See contracts/escrow/NOTICE.md`.
- `README.md` (área libre) enlaza los dos NOTICE.
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
│   │   ├── NOTICE.md                  [NUEVO] permiso de TW, origen, lista de cambios
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
│   │   ├── NOTICE.md                  remite al del escrow (patrón derivado de tw_new_single_release_escrow)
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
│   ├── web/                           (P4) panel del casero, creación con estrategia, flujo del inquilino, /api/relay, /api/ramp
│   └── backoffice/                    (P4) cola de paradas, perito, informe, resolve con stop_justified
├── deployments/                       (P2) testnet.json (§ 6.6), @fianzas/deployments
├── scripts/                           (P2) deploy/, fund/, e2e/, bindings.sh
└── pitch/                             (P4)
```

**Rutas que cambian respecto a la versión anterior:** `contracts/escrow/src/{lib,types,errors,events,storage,split,rules,vault}.rs` se sustituyen por la estructura del fork de TW, y aparece `contracts/factory/`. `contracts/yield-adapter/` pasa a ser solo plan C.

### 4.1 Cambios en `harness/team.json` y `CLAUDE.md` (PR de P2 en G0 con `/lock harness`; no los hace este agente)

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
| `storage/types.rs` | **Modificar** | `Escrow { engagement_id, title, description, roles, amount, platform_fee, milestones, dispute, released, trustline, receiver_memo }` → nuestro `Escrow` (§ 6.2): sin cadenas (sin datos personales on-chain, DAT-1), con `status: Status` en lugar de `released`/`dispute.is_disputed`/`dispute.resolved`, `approvals: Approvals` (el `MilestoneApprovals` de v2) en lugar de `milestones`, y nuevos `Terms`, `Strategy`, `Dispute` (con bond), `Settlement` y `SettlePath`. `Roles` se conserva **con la forma de v2** como tipo de lectura (`get_roles()`). `DataKey { Escrow, Admin, FundedAmount, Reentrancy, ApprovedWasmHash }` → `DataKey { Escrow }` en **instance storage**: un solo TTL junto con la instancia y nada que se archive por separado (el upstream ya tuvo que extender `FundedAmount` a mano). |
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
}

#[contracttype] #[derive(Clone, Debug, Eq, PartialEq)]
pub struct Terms {                // inmutable desde el constructor; el inquilino lo firma en fund_escrow
    pub factory: Address,
    pub id: u64,
    pub landlord: Address,
    pub amount: i128,
    pub end_ts: u64,
    pub tenant_yield_bps: u32,
    pub strategy: Strategy,       // snapshot
    pub platform_fee_bps: u32,    // sobre el rendimiento
    pub tw_fee_bps: u32,          // sobre el rendimiento (Q-16)
    pub tw_fee_receiver: Option<Address>,
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
| `fund_escrow(tenant: Address, invite_code: Option<BytesN<32>>, expected_terms: Terms) -> i128` (shares) | `tenant` (+ `token.transfer(tenant, escrow, amount)` anidado) | `Proposed`; `now < end_ts` (InvalidEndTs); `expected_terms == terms` (TermsMismatch); invitación (InvalidInvite) o `tenant == fijado` (NotParty); `tenant ≠ landlord` (SameParty); partes (InvalidParty); `factory.funding_allowed(strategy.id)` (Paused); transferencia medida `== amount` (InvalidAmount); shares > 0 (VaultError) | `Proposed` → `Active` |
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
| `fz_init` | `factory, landlord, amount, end_ts, tenant_yield_bps, strategy_id, stop_bond, has_invite: bool` |
| `fz_cancel` | `landlord` |
| `fz_fund` | `tenant, amount, shares` |
| `fz_approve` | `approver, approval_count` |
| `fz_stop` | `landlord, reason_hash, bond` |
| `fz_expert` | `resolver, expert_ref` |
| `fz_report` | `resolver, report_hash` |
| `fz_settle` | `settlement: Settlement, path: SettlePath` |
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
    Paused = 21, Arithmetic = 22, InvalidConfig = 23,
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
}

#[contracttype] #[derive(Clone, Debug, Eq, PartialEq)]
pub struct FianzaParams {
    pub tenant: Option<Address>,
    pub invite_hash: Option<BytesN<32>>,
    pub amount: i128,
    pub end_ts: u64,
    pub tenant_yield_bps: u32,          // preset de país (INTERFACES § 6)
    pub strategy_id: Option<Symbol>,    // None → estrategia por defecto
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
| `create_fianza(landlord: Address, p: FianzaParams) -> Created` | `landlord` | no pausada (Paused); estrategia existe (StrategyNotFound) y `enabled` (StrategyDisabled); `amount ∈ (0, MAX_AMOUNT]` (InvalidAmount); `now < end_ts ≤ now + MAX_TERM_SECS` (InvalidEndTs); `tenant_yield_bps ≤ 10000` (InvalidBps); exactamente uno de `tenant`/`invite_hash` (InvalidInvite); `landlord`/`tenant` ∉ {staff, treasury, factory, token, vault, tw_fee_receiver} (InvalidParty); `tenant ≠ landlord` (SameParty) | `id = next_id`; `salt = id` en 32 bytes big-endian; `deployer().with_current_contract(salt).deploy_v2(wasm_hash, (EscrowInit,))`; registra `Escrow(id)`, `IdOf(addr)` e índice del casero; evento `f_created` |
| `create_fianzas_batch(landlord, items: Vec<FianzaParams>) -> Vec<Created>` **[Could]** | `landlord` (una sola firma) | `1 ≤ len ≤ MAX_BATCH` (TooMany); cada item como arriba; atómica | N despliegues. El límite real lo mide el spike (§ 10) |
| `register_tenant(id: u64, tenant: Address)` | **el escrow** (`escrow_of(id).require_auth()`, implícita al ser invocador directo) | `escrow_of(id)` existe (NotFound); el llamante es ese escrow (NotEscrow); no registrado (AlreadyRegistered) | índice del inquilino; evento `f_tenant` |
| `funding_allowed(strategy_id: Symbol) -> bool` | — | — | `!paused ∧ strategy.enabled` |
| `set_escrow_wasm_hash(hash: BytesN<32>)` | admin | — | solo afecta a fianzas **nuevas**; evento `f_wasm {old, new}` |
| `set_config(config: GlobalConfig)` | admin | válida (InvalidConfig) | solo fianzas nuevas; evento `f_config` |
| `add_strategy(s: Strategy)` | admin | `id` nuevo (StrategyExists); `≤ 10` estrategias (TooMany); `kind == DeFindexVault ⇔ vault.is_some()`; `kind == NoYield ⇒ risk == NoYield`; `vault ∉ {token, factory, treasury, staff}`; `asset == config.token` **y** `token::Client(asset).name() == s.asset_name` (fija el emisor exacto; InvalidStrategy); se guarda con `enabled = false` hasta que el admin lo habilite (dos pasos, para revisar el evento antes) | evento `f_strategy` |
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

**Eventos** (topic 0 = nombre, topic 1 = `id` cuando aplica): `f_created {escrow, landlord, amount, strategy_id}`, `f_tenant {tenant}`, `f_wasm {old, new}`, `f_config {config}`, `f_strategy {id, enabled, is_default}`, `f_paused {admin}`, `f_unpaused {admin}`.

**Errores**
```rust
#[contracterror] #[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)] #[repr(u32)]
pub enum FactoryError {
    NotFound = 1, Paused = 2, InvalidConfig = 3, StrategyNotFound = 4, StrategyDisabled = 5,
    StrategyExists = 6, InvalidStrategy = 7, NotEscrow = 8, TooMany = 9, InvalidAmount = 10,
    InvalidEndTs = 11, InvalidInvite = 12, InvalidParty = 13, InvalidBps = 14,
    AlreadyRegistered = 15, SameParty = 16, Arithmetic = 17,
}
```
Validación de `GlobalConfig`: `platform_fee_bps + tw_fee_bps ≤ 10000`, `platform_fee_bps ≤ 5000`, `stop_bond_bps ≤ 2000`, `timeout_secs ≥ 60`, `review_timeout_secs ≥ 60`, `staff` de 1 a 3 sin duplicados, `treasury ∉ staff`, `tw_fee_bps > 0 ⇒ tw_fee_receiver.is_some()` y `staff`, `treasury` ≠ factory.

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
```
**Cómo lo usa el escrow (`modules/vault/defindex.rs`):**
- **deposit_all:** `authorize_as_current_contract([token.transfer(escrow, vault, amount)])`, después `try_invoke_contract::<Val, Error>(vault, "deposit", ([amount], [amount], escrow, true))`. **Se ignora el retorno** y se miden las shares con `balance(escrow)` antes y después (`> 0`, o `VaultError`). Con `invest = true` el vault invierte en sus estrategias en la misma transacción; las transferencias vault → estrategia no necesitan la auth del escrow.
- **withdraw_all:** `withdraw(shares, [0], escrow)` con `min_amounts_out = 0` **a propósito**: una pérdida no debe bloquear la salida. Se mide por diferencia de balance del token y lo absorbe `split()`. Antes de pagar siempre se retira.
- **preview_value:** `try_get_asset_amounts_per_shares(shares)[0]`; si falla, 0 (CT-10).
- **Contrato del mock (P2):** `__constructor(admin, asset)`; las mismas 4 firmas (`deposit` puede devolver `(Vec<i128>, i128)`, porque el escrow ignora el retorno); token de shares SEP-41 mínimo (`balance`, `total_supply`); `set_rate_bps(i32)` anualizado, lineal y con negativos posibles, solo admin; `InsufficientReserve` si no puede pagar. Debe **tirar con `transfer_from`-equivalente exactamente `token.transfer(from, mock, amount)`**, como DeFindex, para que el árbol de auth sea idéntico.
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
    { "id": "usdc_fixed", "kind": "defindex", "vault": "C… (usdc_paltalabs_vault u otro tras el spike)", "defindexStrategy": "CALLOM5I7XLQPPOPQMYAHUWW4N7O3JKT42KQ4ASEEVBXDJQNJOALFSUY (USDC_blend_strategy, a confirmar)", "apyPool": "C… (pool Blend testnet)", "assetName": "USDC:G…", "risk": "standard", "simulated": false, "default": true },
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
- **§ 4b `@fianzas/wallet/server`:** nueva `RelayPolicy` (§ 8.2).
- **§ 5 y § 5b (anchor y ramp simulado):** sin cambios.
- **§ 6 Presets:** `tenant_yield_bps` por **preset de país**. Los presets se quedan en el front y no afirman la ley.

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

| Paso | Firma (auth) | Fee de red | Canal | Fees económicos |
|---|---|---|---|---|
| Crear la cuenta (casero o inquilino) | passkey | Relayer | `/api/relay` | — |
| `factory.create_fianza` (y `_batch`) | passkey del casero | Relayer | `/api/relay` | — |
| `escrow.cancel` | passkey del casero | Relayer | `/api/relay` | — |
| Ramp simulado → C-address | faucet (servidor) | faucet (XLM) | `/api/ramp` | — |
| `escrow.fund_escrow` (+ `token.transfer` anidado; el escrow autoriza el depósito en el vault y llama a `register_tenant`) | passkey del inquilino | Relayer | `/api/relay` | — |
| `escrow.approve_release` (×2; la 2.ª liquida) | passkey de la parte | Relayer | `/api/relay` | del **rendimiento**: fee de TW + fee de plataforma |
| `escrow.stop` (+ bond anidado) | passkey del casero | Relayer | `/api/relay` | bond (depósito) |
| `assign_expert`, `record_report`, `resolve` | staff (Freighter) | staff (XLM) | RPC directa | rendimiento: fees; bond → casero o tesorería |
| `claim_after_timeout`, `claim_after_review_timeout` | nadie | Relayer (si lo pulsa el inquilino) o XLM de quien lo lance | `/api/relay` o CLI | rendimiento: fees |
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
  participant API as apps/web /api/relay + /api/ramp
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
  T->>API: createAccount; /api/ramp (simulado)
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
| Storage del escrow | instance | persistent (TW) | Un TTL y sin entradas archivadas por separado |
| Storage de la factory | instance (config) + persistent (registro e índices paginados) | `Vec` por casero | C-10 |
| Pausa | Manual en la factory, solo de entrada [AD-2] | OZ `pausable` | Sin acoplar versiones y sin bloquear salidas |
| Fee de TW | `tw_fee_bps` configurable sobre el rendimiento, destino en config; **0 en el MVP** | Constante del 0,3 % sobre el bruto | C-4, Q-16 |
| Eventos | `#[contractevent]` con `fz_*`/`f_*` | Topics `tw_*` | No confundir a los indexers de TW |
| SDK | `soroban-sdk 28.0.0` | ≥ 23 | Igual que el upstream (C-15) |
| Front, wallet, anchor, staff, scripts | Sin cambios (Next.js ×2, smart-account-kit, OZ Channels con proxy, ramp simulado, Freighter, Node `.mjs`) | — | Versión anterior, [AD-8…AD-11] |

## 10. Spike H0–H3 (actualizado)

| Hora | Quién | Prueba | Criterio de éxito | Si falla |
|---|---|---|---|---|
| H0:30–H1:30 | P1 | Copiar v2 @ `1d22d0c` a `contracts/escrow`, `NOTICE.md`, `cargo build --target wasm32v1-none --release` y **los tests upstream en verde** con nuestro toolchain. Medir el tamaño del wasm | Compila y los tests pasan | **H1:30: se pasa a v1 @ `f0b706e`** con el mapeo approver/release_signer (§ 1.1). Las interfaces de § 6 no cambian |
| H1:00–H2:00 | P1 | **Quórum de 2**: con el fork recortado, `approvers = [L]` y `target = 2`; `fund_escrow` añade T; `approve_release(L)`, `approve_release(T)` → liquida. Con `Address::generate` **y** con una cuenta contrato (`__check_auth` real), sin `mock_all_auths` | Liquida solo en la 2.ª aprobación; la misma parte dos veces → `AlreadyApproved` | Lógica de quórum propia (≈30 líneas) dentro de `milestone.rs` |
| H1:00–H3:00 | P2 | **Depósito desde un contrato en el vault de testnet**: (1) `get_assets()` de `usdc_paltalabs_vault` → token subyacente y estrategia; `get_fees()`; ¿alguna estrategia pausada? (2) contrato mínimo de prueba (o el esqueleto del escrow) que hace `deposit([10 USDC],[10 USDC],self,true)` con `authorize_as_current_contract` exacto, mide `balance(self)` y hace `withdraw(shares,[0],self)` midiendo el token; (3) `get_asset_amounts_per_shares`; (4) coste en CPU y tamaño del footprint | Shares > 0, retiro ≥ depositado − redondeo, sin auth extra | (a) vault propio con `defindex_factory` sobre `USDC_blend_strategy` + depósito semilla (CT-9); (b) si DeFindex no sirve en H3: **demo con `usdc_mock`** (recorte 4) y `yield-adapter` sobre Blend como plan C, con la misma interfaz |
| H2:00–H3:00 | P1 | **Factory mínima**: `create_fianza` despliega el wasm del escrow (`upload_contract_wasm` en tests) con `EscrowInit` y comprueba `escrow_of(id)`. Medir cuántos despliegues caben en una transacción en testnet (límites de escritura y CPU) | Despliega e inicializa en una llamada | `MAX_BATCH` según la medida, o el lote se recorta (Could) |
| H1–H3 | P3 | Spike de la versión anterior (passkey → C-address → `{func, auth}` → Channels) **contra una instancia creada por factory**, más la comprobación de wasm hash por `getLedgerEntries` | La C-address firma `fund_escrow` con su `token.transfer` anidado | Sin cambios respecto a la versión anterior |

**G2 (H3):** `docs/DECISIONS.md` con: base del fork (v2 o v1), vault de testnet (`usdc_paltalabs_vault`, propio o mock), `MAX_BATCH` medido y kit de passkeys.

## 11. Orden de implementación por rol (alineado con `docs/PIPELINE.md`)

| Fase | P1 · escrow + factory | P2 · DeFi + infra | P3 · onboarding | P4 · UX/UI |
|---|---|---|---|---|
| **G0 (H0–H1)** | Setup. H0:30: copia del fork, `NOTICE.md`, build + tests upstream | Monorepo (`soroban-sdk 28.0.0`), PR de `team.json`/`CLAUDE.md` (§ 4.1) y CI con build del escrow antes de la factory. Identidades del CLI | Setup y docs | Esqueleto Next ×2 |
| **G1 (H1–H2)** | `/lock interfaces` con § 6 de este documento. Recorte del fork (elimina funciones de § 5), `types.rs`, `error.rs`, `split` + matriz | Revisa § 6.5 y § 6.6. Empieza `mock-vault` con la interfaz de DeFindex | Revisa § 6.7 y § 8.2 | Baja fidelidad: creación con selector de estrategia, aviso de riesgo, parada con bond |
| **G2 (H1–H3)** | Spike del quórum y de la factory mínima (§ 10) | Spike del vault (§ 10). `mock-vault` entregado (H3) | Spike de passkeys contra una instancia de la factory | Pantallas contra `FakeWallet` y fixtures `FianzaSummary` |
| **H3–H5** | **Todas las firmas públicas** de escrow y factory compiladas (las de la fase 5 con cuerpo provisional `BadStatus`). Factory: config, registro, índices y `register_tenant` | `deploy.mjs`: sube el wasm del escrow → despliega la factory → `add_strategy` ×3 → `set_default_strategy`. `bindings.sh` (factory, escrow, token). **Primer despliegue en H5** | `FakeWallet`/`FakeAnchor`; `createRelayHandler` con `RelayPolicy` nueva y tests | Bindings reales (H5), `SignButton` |
| **Fase 3 (H5–H10)** | `fund_escrow` (invitación, `expected_terms`, vault, `register_tenant`), `approve_release` + `settle` + `split`, `cancel`, lecturas, `funding_allowed`, tests de auth y estado, test con cuenta contrato | `fund.mjs` (trustlines de tesorería y del receptor del fee de TW, faucet, reserva del mock, bond de los caseros demo); `e2e/happy.mjs` | `createWallet` real | Panel (lista paginada + precio por share), creación con estrategia y preset, flujo del inquilino |
| **G3 (H10–H12)** | Fusiona; avisa a P2 | Integración: redeploy, bindings y `deployments.json`. **Fianza larga** con `usdc_fixed` (o `usdc_mock`) | Cambio a real; cuentas demo en el dominio definitivo | `NEXT_PUBLIC_USE_FAKES=0`; camino feliz |
| **Fase 5 (H12–H16)** | (H14–H16) `stop` + bond, `assign_expert`, `record_report`, `resolve` con `stop_justified`, `claim_after_timeout`, `claim_after_review_timeout` y tests de security § 12.9 | (H12–H14) `e2e/stop.mjs` (los dos valores de `stop_justified`), `e2e/timeout.mjs`, `e2e/review-timeout.mjs` y cuenta de staff | (H14–H16) Ramp simulado | (H12–H14) Backoffice con `stop_justified` explícito |
| **G4 (H16–H22)** | `create_fianzas_batch` **(Could)**, bordes temporales y `evil_vault` | Redeploy final, AC-13 (≤ 10 min) | Robustez | Timeout y revisión vencida en la UI, feed de eventos, `check-copy.mjs` |
| **G5 (H22–H28)** | Checklist de seguridad (contrato y factory) + `NOTICE.md` final | README con diagrama y NOTICE | Móviles listos | Pitch ("construido sobre Trustless Work, con permiso"), vídeo |

**Carga de P1:** es el rol más cargado. Como P2 ya no construye `yield-adapter`, P2 asume todos los e2e y puede proponer tests de la factory con la etiqueta `cross-area` y la aprobación de P1 (el harness lo permite). **Recortes, en orden:** (0) `create_fianzas_batch`; (1) anchor real; (2) UI de los timeouts (se quedan en el contrato y los tests); (3) backoffice → script; (4) vault real → `usdc_mock`. **Nunca se recortan:** los tests del contrato y de la factory, la factory misma, el flujo con passkey ni el camino feliz en testnet.

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

## 16. Notes for Development Agent

1. **Primero NOTICE y spike.** No se fusiona código copiado de TW sin `contracts/escrow/NOTICE.md` y sin la cabecera en cada archivo.
2. **Interfaces:** § 6 es el borrador de `docs/INTERFACES.md` (escrow § 1, factory § 1b nuevo, vault § 2, deployments § 3, wallet y Relayer § 4/4b). P1 lo lleva con `/lock interfaces` en H1.
3. **Escrow, en este orden:** recorte del fork → `types`/`error` → `split` + matriz → constructor → `fund_escrow` (con `mock-vault`) → `approve_release` + `settle` → lecturas → `cancel` → firmas completas (H5) → parada, bond y resolve → timeouts.
4. **`settle` es el único sitio que paga principal y rendimiento.** `pay_bond` solo se llama desde `resolve` y `claim_after_review_timeout`, después de `settle`. Se escribe `Settled` antes de transferir y nunca se transfiere 0.
5. **Las salidas no llaman a la factory.** Solo `fund_escrow` lo hace (`funding_allowed`, `register_tenant`).
6. **Tests:** nunca `mock_all_auths` en auth ni vault. Cuenta contrato real para el quórum. `evil_vault`. Impostor de `register_tenant`. Bordes temporales complementarios. Invariante de balance con bond.
7. **Build:** el wasm del escrow se compila antes de la factory (`contractimport!`). El job de CI y `deploy.mjs` respetan ese orden.
8. **Front:** la estrategia, sus avisos y los textos de riesgo salen de `factory.strategies()`. Nunca "sin riesgo". `usdc_etherfuse` lleva aviso con casilla. `simulated` muestra la etiqueta.
9. **Fuera de tu área no se edita.** `harness/team.json`, `CLAUDE.md` y la CI cambian por PR con lock (§ 4.1).
