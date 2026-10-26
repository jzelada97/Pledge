# Informe de análisis de seguridad · Fianzas de habitación en Soroban (v3)

> Agente de seguridad, 2026-10-25. **Sustituye entera** a la versión anterior, que analizaba el escrow propio singleton. Esta parte de la arquitectura definitiva `.kiro/pipeline/architecture.md`: fork de Trustless Work + DeFindex + `FianzaFactory` + `apps/api`, con los cambios C-1…C-19, la § 6.8 (API) y la § 6.9 (comisiones de DeFindex).
> Contexto revisado:
> - Pipeline y documentación: `enriched-prompt.md`, `architecture.md` completo, `docs/INTERFACES.md` (borrador v2 generado desde la § 6), `docs/DECISIONS.md` y `CLAUDE.md`.
> - Harness: `harness/team.json` (actualizado), `.claude/settings.json`, `.claude/hooks/*`, `.githooks/*`, `scripts/harness/*`, `.github/workflows/ci.yml` y `.env.example`.
> - Fuentes externas: la documentación de roles de vault de DeFindex (`docs.defindex.io/integration-guide/vault-roles`, consultada hoy).
>
> El repositorio todavía no tiene código de producto. La búsqueda de secretos (`S[A-Z2-7]{55}`, claves PEM y API keys) no ha encontrado nada.

**Etiquetas**
- **[H]**: obligatorio en la hackatón (testnet).
- **[M]**: obligatorio antes de mainnet; en la hackatón solo se documenta.
- **[G1]**: cambia la interfaz y tiene que entrar en `docs/INTERFACES.md` antes de congelarlo.
- Los prefijos de requisito son AUTH, AUTHZ, DAT (datos), IV (validación de entradas), CS (comunicaciones), CT (escrow), FAC (factory), VLT (vault), API, SRV (Relayer y ramp), WEB (cliente), HAR (harness) y SEC (secretos).

---

## 0. Cambios por la nueva arquitectura

### 0.1 Qué cambia en el modelo de amenazas

| Cambio (architecture § 0) | Efecto de seguridad | Valoración |
|---|---|---|
| C-1 Fork de TW v2 (`1d22d0c`, beta y sin auditar en V2) | Heredamos código que nadie ha auditado en esta versión, y además lo recortamos y lo extendemos. La auditoría de Runtime Verification es de la v1 (sep-2025) y no cubre ni V2 ni nuestro diff. | **Riesgo nuevo** (§ 4) |
| C-2 Un escrow por fianza + factory | Se acaba el "honeypot" del singleton: un fallo afecta a una sola fianza. A cambio aparecen direcciones dinámicas, instancias falsas y un admin con poder sobre las fianzas **nuevas**. | **Mejora** el aislamiento; **riesgo nuevo** de gobernanza (§ 5) |
| C-3 Escrow → DeFindex directo | Hay un contrato menos (sin `yield-adapter` ni libro intermedio). A cambio dependemos directamente de los roles del vault (manager, upgrade, comisiones). | Neutro (§ 6) |
| C-4 y C-17 Comisiones fijadas en `Terms` | El inquilino firma las cuatro comisiones. El manager de un vault de terceros puede subir la suya **después** de fondear. | Mejora con riesgo residual (§ 6.2) |
| C-6 y C-7 Solo el casero para, con bond, y `claim_after_review_timeout` | Cierra el bloqueo por staff ausente (antes V2, Q-14) ya en la hackatón. | **Mejora** |
| C-8 Configuración en la factory, copiada a `Terms` | El inquilino queda protegido por `expected_terms`, pero **el casero no firma la configuración**: el admin puede cambiarla justo antes de su `create_fianza`. | **Hallazgo nuevo** (FAC-6) |
| C-11 `expected_terms` en `fund_escrow` | `TermsMismatch` impone on-chain lo que antes solo exigía la UI (WEB-11). | **Mejora** |
| C-12 Pausa en la factory, solo de entrada | Las salidas no llaman a la factory. | Mejora |
| C-16 `apps/api` compatible con TW | Superficie nueva: builds anónimos, `send-transaction`, API keys, caché, CORS y compatibilidad con el SDK de TW. **La API pasa a construir lo que firman los usuarios.** | **Riesgo nuevo principal** (§ 7) |
| C-18 `salt = sha256(landlord ‖ nonce)` + `predict_address` | No hay *squatting* (el deployer es la factory y la salt incluye al firmante). La dirección se conoce antes de crear la fianza, así que alguien puede enviarle tokens por adelantado. | Correcto, con dos requisitos (FAC-3, CT-16) |
| C-19 Escrow en persistent + TTL de la instancia | Hay dos entradas con TTL (instancia y `DataKey::Escrow`) que se extienden juntas. | Correcto (CT-12) |

### 0.2 Hallazgos nuevos por severidad

| # | Hallazgo | Sev. | Arreglo | Cuándo |
|---|---|---|---|---|
| N-10 | **El cliente verifica lo que firma contra datos de la propia API.** Si `signAndSendBuilt` comprueba el árbol de auth con `terms`, `escrow_of` o la lista de wasm que le da la API, una API comprometida (Vercel, dependencia, preview) puede apuntar `fund_escrow` a una instancia falsa con su propia tesorería y pasar la verificación. | **Alta** | WEB-3 contra **lecturas independientes**: RPC de Soroban directa con `readSource` y anclas de confianza **empaquetadas en el build** (`@fianzas/deployments`: factory, token, `escrowWasmHashesAllowed` y vaults de las estrategias). La API no es de confianza para el contenido de la firma. El cliente calcula él mismo el *payload* de firma. | H [G1] |
| N-11 | **El staff (Freighter) firma XDR que construye la API.** Una API comprometida puede añadir operaciones (`setOptions` que añade un firmante a la cuenta del staff, `payment`, `changeTrust`) a la transacción de `resolve`. Con eso se toma la clave del staff, y el staff tiene poderes sobre todas las fianzas paradas. | **Alta** | Antes de abrir Freighter, el backoffice decodifica el `unsignedXdr` y exige: exactamente 1 operación `InvokeHostFunction`, `source == staff`, el contrato, la función y los argumentos esperados, `fee ≤` un tope y `timeBounds` cortos. Si no, `AUTH_MISMATCH` (WEB-15). | H [G1] |
| N-12 | **Compromiso del admin de la factory → robo de las fianzas nuevas.** Con `set_escrow_wasm_hash` (wasm malicioso) o `add_strategy` + `set_default_strategy` (vault malicioso), los depósitos que entren después se pierden. El inquilino firma `expected_terms`, pero los `Terms` no dicen qué wasm ejecuta el escrow. | **Alta** | [H] El cliente y el Relayer verifican el wasm de la instancia y el vault de la estrategia contra las listas empaquetadas (N-10). `Created` y `f_created` llevan `wasm_hash`. [M] Admin multisig + *timelock* de 48 h en wasm, estrategias y config, y monitor de eventos `f_*`. | H [G1] / M |
| N-5 | **`NoYield`: si `settle` calcula `total` con `balance(escrow)`, se reparte el bond del casero** (y cualquier donación) como si fuera principal: el bond acabaría en el inquilino o en los fees. | **Alta** (fácil de introducir) | `total = terms.amount` en `NoYield`, **nunca** el saldo. Invariante `balance(escrow) ≥ bond_held + (NoYield ? amount : 0)`, con `≥` y no `==`, porque las donaciones son posibles (C-18). | H |
| N-13 | `POST /stellar/send-transaction` es un **proxy abierto** a la RPC: envía cualquier transacción firmada, a cualquier contrato y con cualquier operación, desde nuestra IP y con nuestro cupo. | Media | Solo transacciones con una única operación `InvokeHostFunction` cuya raíz sea la factory o un escrow registrado con wasm permitido. Es más restrictivo que TW, lo que la regla de la § 6.8.1 permite. | H [G1] |
| N-3 | El **Relayer patrocina despliegues de contratos** de forma anónima (`create_fianza` es un deploy completo y `create_fianzas_batch` son hasta 10). Cuesta drenar el cupo de Channels. | Media | Se quita `create_fianzas_batch` de `RelayPolicy`; el lote solo va con API key y fee propio. Límite por casero (10 creaciones/día) y tope global por hora. | H [G1] |
| N-14 | **El casero no firma la configuración.** El admin puede cambiar fees, bond, plazos, staff o tesorería entre que el casero ve la pantalla y se ejecuta su `create_fianza`. | Media | `FianzaParams.expected_config_version` y `FactoryError::ConfigChanged`; la versión sube con cada `set_*`. | H [G1] |
| N-15 | `vault_manager` se comprueba solo en `add_strategy`, pero el manager de DeFindex **puede cederse a sí mismo** a otra dirección. | Media | Volver a comprobar `get_manager()` en `create_fianza` y en `funding_allowed` (solo en la entrada) cuando `vault_manager` es `Some`. | H [G1] |
| N-16 | **Upgrade del vault de DeFindex:** el manager puede cambiar el código si el vault se desplegó como *upgradable*. Eso anula todas nuestras garantías sobre esa fianza. | Media (testnet) / **Alta** (mainnet) | Testnet: aceptado y etiquetado como "vault de terceros". Mainnet: vault propio **no** *upgradable*, o manager multisig con *timelock*, y el script de alta verifica el flag. | M |
| N-6 | `withdraw(shares, [0], escrow)` y `claim_*` sin permisos: **cualquiera elige el momento** de materializar una pérdida temporal del vault, y esa pérdida queda como definitiva. | Media (mainnet) | [M] Si `total < amount` en un `claim_*`, exigir `tenant.require_auth()` (el inquilino consiente su pérdida); `resolve` con `min_total` opcional. | M |
| N-17 | Caché en memoria de la API con claves controladas por el usuario (`contractId`, `addresses`, `cursor`), lo que permite crecer sin límite y tumbar la instancia (DoS). | Media | LRU acotada (≤ 1.000 entradas), solo para claves validadas (StrKey correcta y registrada), con semáforo de concurrencia hacia la RPC y *timeouts* de 5 s. | H |
| N-18 | `GlobalConfig.token` se puede cambiar con `set_config` → fianzas nuevas en otro token, con la UI mostrando "USDC". | Media | El `token` es inmutable desde el constructor de la factory (`InvalidConfig` si cambia). | H [G1] |
| N-19 | No hay área `api` en `harness/team.json`: `apps/api/**` queda **sin dueño**, y el montaje `apps/web/app/api/**` cae en el área de P4, aunque `CLAUDE.md` se lo da a P2. | Media | Área `api` = `["apps/api/**", "apps/web/app/api/**"]`, **antes** de `web`. | H (G0) |
| N-2 | Funciones del upstream que sobreviven al recorte (`update_escrow`, `withdraw_remaining_funds`, `change_milestone_status`, `tw_new_*`). Cualquiera de ellas es un camino de salida de fondos no previsto. | Media | Test de CI que compara la interfaz del wasm (`stellar contract info interface`) con una lista cerrada de funciones. | H |
| N-20 | La forma TW con `platformFee = 0` hace que un componente de Blocks de un integrador muestre "sin comisión" aunque haya un 20 % sobre el rendimiento (honestidad, NFR-11). | Baja | Nuestra UI nunca muestra comisiones desde la forma TW. Documentarlo en la API y en `/openapi.json`. | H |
| N-21 | Inconsistencias en `architecture.md`: la § 2, el diagrama de la § 8.4 y la § 9 dicen `salt = id` (C-18 dice `sha256(landlord ‖ nonce)`); la § 5 dice que `core/escrow.rs` guarda en **instance** (C-19 dice persistent); R-13 escribe el invariante con `==`. | Baja | Corregirlas antes de generar INTERFACES (§ 15). | G1 |

### 0.3 Bloqueantes antes de G1 (H2)

1. **N-10, N-11:** WEB-3 con lecturas independientes y comprobación del XDR de cuentas G. Se añade a INTERFACES § 7/§ 8 (wallet) y a la tabla de la API.
2. **N-12:** `Created { id, escrow, wasm_hash }` y `f_created.wasm_hash`.
3. **N-13:** restricción de `send-transaction` en la tabla de la API.
4. **N-3:** `create_fianzas_batch` fuera de `RelayPolicy.fixedContracts`.
5. **N-14:** `FianzaParams.expected_config_version`, `config_version()` y `ConfigChanged = 21`.
6. **N-15:** comprobación de `get_manager()` en `create_fianza` y en `funding_allowed`.
7. **N-18:** `token` inmutable.
8. **FAC-3:** codificación exacta de la salt (`sha256(landlord.to_xdr() ‖ nonce)`), compartida por `create_fianza` y `predict_address`.
9. **N-5:** `NoYield ⇒ total = terms.amount`, escrito en la § 6.4.
10. **N-21:** corregir `salt = id`, instance storage y el `==` de R-13.
11. **N-19:** área `api` en `team.json` (es G0, pero sin ella el guard deja pasar ediciones en `apps/api`).

---

## 1. Evaluación del nivel de riesgo

- **Nivel global: ALTO** para el diseño, que va a mainnet custodiando fianzas reales en DeFi, con código heredado sin auditar y una API que construye lo que se firma.
- **Hackatón: MEDIO.** Es testnet con equipo de confianza. El riesgo real es que la demo falle: Relayer o faucet drenados, liquidación bloqueada por iliquidez o por un pago que revierte, o un vault de terceros que cambia.
- **Sensibilidad de los datos**
  - Públicos on-chain: importes, C-address de las partes, fechas, política, comisiones y los hashes de motivo, perito, informe e invitación.
  - Personales off-chain (RGPD): nombre, email, dirección de la habitación, contrato e informe pericial. En la demo son ficticios y solo están en `localStorage`.
  - Secretos: `RELAYER_API_KEY`, `RAMP_FAUCET_SECRET`, `API_KEYS_JSON` y las identidades del CLI (deployer, admin, staff, treasury y faucet).
- **Cumplimiento normativo**
  - Hackatón: ninguno exigible. Lo simulado va etiquetado (NFR-11).
  - Antes de mainnet, con revisión legal:
    - RGPD + LOPDGDD: EIPD y supresión frente a datos inmutables (DAT-3).
    - LAU art. 36.
    - **MiCA art. 50**: prohíbe a emisores y CASP conceder intereses sobre tokens de dinero electrónico como el USDC, y la custodia de criptoactivos de terceros puede requerir licencia.
    - PRIIPs/MiCA si se ofrecen RWA.
    - PBC/FT con rampa fiat real.

---

## 2. Modelo de amenazas

### 2.1 Activos

| Activo | Sensibilidad | Impacto si se compromete |
|---|---|---|
| Principal de cada fianza (shares en el vault, o líquido si `NoYield`) | Crítica | Pérdida del dinero del inquilino, limitada a una fianza salvo que se comprometa el admin (todas las nuevas) |
| Vivacidad de las salidas (`approve_release`, `resolve`, `claim_after_timeout`, `claim_after_review_timeout`) | Crítica | Fondos bloqueados aunque no se roben |
| Stop bond (líquido en el escrow) | Alta | Bond perdido o mal pagado |
| Clave del **admin de la factory** | **Crítica** | wasm o vault malicioso para las fianzas nuevas, tesorería o staff falsos (N-12) |
| Claves de `staff` (1–3, snapshot por fianza) | Alta | Deducir hasta el 100 % a favor del casero; marcar injustificada (el bond va a la tesorería) |
| Claves de `treasury`, `faucet` y `deployer` | Media/Alta | Fees y bonds; demo rota; despliegues |
| Roles del vault de DeFindex (manager, emergency, rebalance, fee receiver) | Alta | Upgrade, comisiones y estrategias |
| `apps/api` (código y entorno de Vercel) | **Alta** | Construye lo que firman los usuarios (N-10, N-11) y tiene los secretos del Relayer y del faucet |
| Smart accounts con passkey | Crítica | XSS en el origen del `rpId` = firmar cualquier cosa |
| `RELAYER_API_KEY`, `RAMP_FAUCET_SECRET`, `API_KEYS_JSON` | Media | Abuso de costes y demo rota |
| `@fianzas/deployments` (anclas de confianza empaquetadas) | Alta | Si se altera, el cliente aceptaría wasm o vaults falsos |
| Datos personales off-chain | Alta (RGPD) | Brecha |
| Repo y CI | Media | Código malicioso en `main` y en Vercel |

### 2.2 Actores
1. **Casero malicioso**: para sin motivo, impide el pago o colude con el staff.
2. **Inquilino malicioso**: ya no puede parar. Le queda el *griefing* con el timeout, que no daña a nadie.
3. **Staff comprometido, negligente o ausente**: la ausencia ya tiene salida (C-7).
4. **Admin de la factory comprometido.**
5. **Operador o proveedor de la API comprometido** (Vercel, dependencia npm o preview).
6. **Manager del vault de DeFindex** (PaltaLabs en testnet; la plataforma en mainnet).
7. **Atacante externo**: abuso de endpoints anónimos, XSS o phishing, instancias falsas del escrow y eventos falsos.
8. **Integrador con API key**, que espera la semántica de TW.
9. **Colaborador o agente de IA** que se salta el harness.
10. **Contribuidor externo** con PR desde un fork.

### 2.3 Vectores

| # | Vector | Prob. | Impacto | Mitigación |
|---|---|---|---|---|
| V1 | Carrera `stop` vs `claim_after_timeout` | Alta | Alto | `DeadlinePassed` con bordes complementarios (CT-4) |
| V2 | Staff que no resuelve | Media | Alto | `claim_after_review_timeout` sin permisos (C-7) |
| V3 | Receptor que no puede cobrar (trustline, congelación, `tw_fee_receiver` o tesorería G) y bloquea `settle` | Baja [H] / Media [M] | Crítico | C-address y trustlines verificadas [H]; `Owed` [M] (CT-11) |
| V4 | Iliquidez de Blend (uso del 74 %): `withdraw` revierte | Media | Alto | Atomicidad y reintento [H]; retiro parcial, shares como pago o `Owed`, y topes por vault [M] (VLT-6) |
| V5 | Pérdida del vault (oráculo, mala deuda) | Baja | Alto | `split` con pérdida, divulgación y topes [M] |
| V6 | Vault malicioso o con fallos que tira de más o paga menos | Baja | Crítico | Auth exacta y medición por diferencia (CT-8), `evil_vault` |
| V7 | Manager del vault que sube la comisión tras fondear | Media (testnet) | Medio (solo rendimiento) | `VaultFeeChanged` antes de fondear; vault propio en mainnet (§ 6.2) |
| V8 | Upgrade del vault (N-16) | Baja | Crítico | No *upgradable* o multisig + *timelock* [M] |
| V9 | Admin: wasm, estrategia o config maliciosos (N-12, N-14, N-18) | Baja | Crítico (fianzas nuevas) | Anclas empaquetadas, `expected_config_version`, token inmutable; *timelock* [M] |
| V10 | Instancia falsa del escrow (wasm público) | Media | Alto | `escrow_of`/`id_of` + wasm permitido en el cliente y en el Relayer; el enlace lleva el id |
| V11 | Impostor en `register_tenant` | Media | Medio | `escrow_of(id).require_auth()` (FAC-5) |
| V12 | Eventos `fz_*` emitidos por otros contratos | Media | Medio | Filtrar por `contractId` registrado (API-14) |
| V13 | API que construye un árbol de auth o un XDR distinto del esperado (N-10, N-11) | Baja | Crítico | Verificación independiente en el cliente (WEB-3, WEB-15) |
| V14 | Abuso de builds y lecturas anónimos (coste de RPC, DoS de caché) | Alta | Medio | Límites, LRU acotada, semáforo (API-5…API-8) |
| V15 | `send-transaction` como proxy abierto (N-13) | Media | Bajo/Medio | Lista blanca de contratos (API-11) |
| V16 | Drenaje de Channels con despliegues patrocinados (N-3) | Alta | Medio | Política y límites (SRV-2, SRV-6) |
| V17 | Drenaje del faucet del ramp | Alta | Medio (demo) | SRV-10…SRV-15 |
| V18 | Integrador del SDK de TW que espera otra semántica | Media | Medio | `501` con `replacement`; nada de reinterpretar en silencio (API-16) |
| V19 | XSS en `apps/web`, que equivale a firmar con la passkey | Baja | Crítico | CSP con nonce, sin scripts de terceros (WEB-5…WEB-8) |
| V20 | Código de invitación visto por la API o filtrado en la URL | Baja | Bajo | No se registra; el fragmento se borra; ed25519 [M] |
| V21 | Conflicto de interés del bond (el staff decide y la tesorería cobra) | Media | Medio | OC-1…OC-7 (§ 12) |
| V22 | Fuga de PII en logs o en errores de la API | Media | Medio (RGPD) | DAT-6, API-12 |
| V23 | Harness o CI eludidos (lectura de identidades, push a `main`, `apps/api` sin dueño) | Media | Alto | § 14 |
| V24 | Paquete npm o crate comprometido (Shai-Hulud 2025, tj-actions 2025) | Media | Alto | Lockfiles, scripts de instalación bloqueados, SHA en las acciones (§ 8.3) |

---

## 3. Requisitos de seguridad

### 3.1 Autenticación (AUTH)
- **[AUTH-1] [H]** `require_auth` exacto, tabla de la § 6.2/6.3:
  - `create_fianza` y `create_fianzas_batch`: `landlord`.
  - `cancel` y `stop`: `terms.landlord` (almacenado).
  - `fund_escrow`: `tenant`.
  - `approve_release`: `approver ∈ {landlord, tenant}`.
  - `assign_expert`, `record_report` y `resolve`: `resolver ∈ terms.dispute_resolvers`.
  - `claim_after_timeout`, `claim_after_review_timeout` y `extend_contract_ttl`: **ninguno**.
  - Admin de la factory: `set_*`, `add_strategy`, `pause` y `unpause`.
  - `register_tenant`: la dirección del escrow registrado.
  Las direcciones de rol se leen **siempre** de storage (`Terms`, `Config`), nunca de un argumento sin comprobar que pertenece al rol.
- **[AUTH-2] [H]** `require_auth` va antes de cualquier escritura o llamada externa.
- **[AUTH-3] [H]** Los `claim_*` no dependen de quién llama: solo pagan a `tenant`, `landlord`, `treasury` y `tw_fee_receiver` de `Terms`.
- **[AUTH-4] [H]** El `__constructor` del escrow y el de la factory son de un solo uso (garantía del protocolo). Un test intenta invocarlos después del despliegue.
- **[AUTH-5] [H]** Las auth entries de la passkey llevan `signatureExpirationLedger ≤ latestLedger + 60`. **El cliente lee `latestLedger` de su propia RPC** y no acepta `validUntilLedger` de la API si es mayor.
- **[AUTH-6] [H]** `rpId` igual al hostname exacto del dominio definitivo, y `createWallet` falla si `location.hostname !== rpId`.
- **[AUTH-7] [M]** Recuperación de la smart account con un segundo firmante.
- **[AUTH-8] [M]** Admin de la factory, staff y manager de los vaults propios como multisig o smart account con política.
- **[AUTH-9] [H]** API keys: formato `<id>.<secret>`, con un secreto aleatorio de ≥ 256 bits en base64url. Se guarda `sha256(secret)` y se compara en **tiempo constante** sobre digests de longitud fija. La key solo va en la cabecera `x-api-key`; se rechaza en la query. Se registra solo el `id`. Tras 10 fallos por IP y minuto, `429`.

### 3.2 Autorización (AUTHZ)
- **[AUTHZ-1] [H]** Poderes del staff limitados por el contrato:
  - `assign_expert` y `record_report` solo escriben metadatos.
  - `resolve` solo envía la deducción al `landlord` de `Terms` (`0 ≤ deduction ≤ amount`, recortada a `principal_back`) y el bond al `landlord` o a la `treasury`.
  - **Se ha eliminado el reparto libre `distributions: Map` de TW** (§ 4.2).
  - No existe ninguna función que cambie `Terms` (sin `update_escrow`).
- **[AUTHZ-2] [H]** El escrow no tiene admin con poderes (`Roles.admin = factory`, solo informativo). La pausa de la factory solo bloquea `create_*` y `fund_escrow`. **Nunca** bloquea `cancel`, `stop`, `approve_release`, `assign_expert`, `record_report`, `resolve` ni los `claim_*`.
- **[AUTHZ-3] [H]** Cada entrypoint valida el estado **almacenado**. `Settled` y `Cancelled` son terminales.
- **[AUTHZ-4] [H]** Partes prohibidas (`InvalidParty`): `landlord` y `tenant` ∉ {staff, treasury, factory, escrow, vault, token, tw_fee_receiver}. Además `tenant ≠ landlord` (`SameParty`), y en la configuración `treasury ∉ staff`. Se conserva así la idea de los validadores de solape de TW (`dispute_resolver ∉ {approvers, receiver, platform}`).
- **[AUTHZ-5] [H]** Reasignar al perito borra `report_hash`. Cada `record_report` emite su evento.
- **[AUTHZ-6] [H]** Backoffice: el chequeo "cuenta == staff" es solo de UX. La seguridad real es `require_auth`.
- **[AUTHZ-7] [M]** Veredicto firmado por el perito y doble firma del staff (§ 12, OC-6 y OC-7).
- **[AUTHZ-8] [H]** Las API keys **no** dan acceso a `/fianzas/v1/relay`. `scope=mine` solo filtra lecturas por los `landlords` de la key. Ninguna key permite operaciones de admin (no hay endpoints de admin).

### 3.3 Protección de datos (DAT)
- **[DAT-1] [H]** On-chain no va ningún dato personal en claro. La forma TW usa `title: "Fianza #<id>"` y `description: ""`.
- **[DAT-2] [H]** `reason_hash`, `expert_ref` y `report_hash` son `sha256(sal_32B ‖ contenido)`, con la sal off-chain. `invite_hash = sha256(code_32B)` sin sal.
- **[DAT-3] [M]** Borrado criptográfico (borrar la sal y el contenido) y una EIPD que declare que direcciones, importes y fechas son seudónimos y permanentes.
- **[DAT-4] [H]** El informe se hashea en el navegador del staff y no se sube a ningún sitio, tampoco a la API.
- **[DAT-5] [H]** Los datos de demo son ficticios y viven solo en `localStorage`. **No se envían a la API.**
- **[DAT-6] [H]** La API y los handlers **no registran** cuerpos de petición (en especial el `inviteCode` de `fund`), la IP completa (como mucho truncada), pares dirección + IP ni ninguna key. En logs solo van `traceId`, ruta, `code`, contrato, función y duración. Los logs de Vercel tienen retención mínima y no se envían a terceros.
- **[DAT-7] [M]** Divulgación al inquilino antes de fondear: rendimiento variable y no garantizado, posible pérdida (Q-13), comisiones con su base, "vault de terceros" si aplica, y el plazo y el proceso del perito.
- **[DAT-8] [M]** `/fianzas/v1/landlords/{address}/fianzas` y `/escrows?scope=all` facilitan perfilar la cartera de un casero que sea persona física. Los datos ya son públicos on-chain, pero la EIPD lo debe valorar; en mainnet, `scope=all` con API key.

### 3.4 Validación de entradas (IV)
- **[IV-1] [H]** `create_fianza`:
  - `0 < amount ≤ MAX_AMOUNT`.
  - `now < end_ts ≤ now + MAX_TERM_SECS`.
  - `tenant_yield_bps` ya no es un parámetro: lo copia de `GlobalConfig` (IV-3, #16).
  - Exactamente uno de `tenant` o `invite_hash`.
  - La estrategia existe y está `enabled`.
  - `expected_config_version` coincide (N-14).
  - Comisiones del vault dentro de los topes.
- **[IV-2] [H]** `checked_add` en `end_ts + timeout_secs` y en `stopped_ts + review_timeout_secs`. Constructor del escrow como defensa en profundidad: lo mismo con `panic_with_error!`.
- **[IV-3] [H]** `GlobalConfig`:
  - `platform_fee_bps ≤ 5000` y `platform_fee_bps + tw_fee_bps ≤ 10000`.
  - `stop_bond_bps ≤ 2000` y `0 ≤ stop_bond_min ≤ MAX_AMOUNT`.
  - `tenant_yield_bps ≤ 10000` (reparto por jurisdicción, #16).
  - `timeout_secs ≥ 60` y `review_timeout_secs ≥ 60`.
  - `staff` de 1 a 3 sin duplicados; `treasury ∉ staff`; `staff`, `treasury` ≠ factory.
  - `tw_fee_bps > 0 ⇒ tw_fee_receiver`.
  - **`token` inmutable** (N-18).
  - [M] mínimos de mainnet como constantes del constructor: `timeout_secs ≥ 7 días` y `review_timeout_secs ≥ 14 días`.
- **[IV-4] [H]** Lecturas de la factory: `limit ≤ MAX_PAGE` y `ids ≤ MAX_VIEWS` (`TooMany`); los ids inexistentes se omiten.
- **[IV-5] [H]** API (`zod` estricto, `.strict()`, sin campos extra):
  - Direcciones con `StrKey.isValidContract`/`isValidEd25519PublicKey`, **antes** de cualquier llamada a la RPC.
  - Importes decimales con ≤ 7 decimales, convertidos con `BigInt` o `decimal.js` y nunca con `parseFloat` (si no, `AMOUNT_PRECISION_UNSUPPORTED`).
  - `nonce`, `inviteHash`, `reasonHash`, `reportHash` e `inviteCode`: base64url de exactamente 32 bytes.
  - `cursor`: opaco y validado (`start ≤ count`).
  - Cuerpo ≤ 64 KB.
  - `addresses ≤ 20` y `contractIds ≤ 50`.
- **[IV-6] [H]** `/fianzas/v1/ramp`: SRV-11…SRV-14.
- **[IV-7] [H]** Front: el código del fragmento es base64url de 43 caracteres; si no es válido, no se llama a nada.

### 3.5 Comunicaciones (CS)
- **[CS-1] [H]** Solo HTTPS. `RELAYER_URL`, `SOROBAN_RPC_URL` y `BLEND_POOL_RPC` salen del entorno del servidor. **Ningún parámetro de la petición se convierte en URL** (SSRF). Hay un `fetch` envuelto con lista blanca de hosts (RPC, Channels y la RPC de Blend).
- **[CS-2] [H]** Cabeceras en `apps/web` (que incluye la API) y en `apps/backoffice`:
  - CSP con nonce y `frame-ancestors 'none'`.
  - `Referrer-Policy: no-referrer`.
  - `X-Content-Type-Options: nosniff`.
  - `Permissions-Policy` con `publickey-credentials-*=(self)`.
- **[CS-3] [H]** `/fianzas/v1/relay` y `/fianzas/v1/ramp` exigen un `Origin` **presente** e igual al propio. Ni ahí ni en los builds anónimos se emite CORS.
- **[CS-4] [H]** CORS solo para los `origins` registrados en una API key y solo en lecturas, builds y `send-transaction`. Nunca `Access-Control-Allow-Credentials: true` ni `*`. Se documenta que las keys son de **servidor a servidor**: una key incrustada en el front de un integrador está expuesta.
- **[CS-5] [H]** IP para los límites: la que da la plataforma (`x-real-ip` o el primer valor de `x-forwarded-for` puesto por Vercel).
- **[CS-6] [H]** El cliente lee la RPC de Soroban **directamente** (`deployments.rpcUrl`) para la verificación de WEB-3, y no a través de la API.

### 3.6 Escrow (CT)
- **[CT-1] [H]** Orden: checks → interacciones medidas → escribir `Settled`, `settlement` y `path` → transferencias → eventos. `settle` es el **único** sitio que paga principal y rendimiento; `pay_bond` solo se llama después de `settle`, desde `resolve` y `claim_after_review_timeout`. No se transfieren importes 0.
- **[CT-2] [H]** `total` se mide como la diferencia de `token.balance(escrow)` **justo antes y justo después** de `withdraw`. Nunca se usa el retorno del vault.
- **[CT-3] [H]** `split()` es puro y usa la matemática segura de TW (`safe_mul_div`/`mul_div_wide`). Comprueba el invariante `to_tenant + to_landlord + to_treasury + to_tw == total` (si falla, `panic!`). Las comisiones de DeFindex **no** se restan en `split` (§ 6.9: ya vienen descontadas del valor de la share).
- **[CT-4] [H]** Bordes complementarios:
  - `stop ⇔ now ≤ timeout_at` y `claim_after_timeout ⇔ now > timeout_at`.
  - `resolve ⇔ now ≤ review_deadline` y `claim_after_review_timeout ⇔ now > review_deadline`.
  - `Ending ⇔ Active ∧ now ≥ end_ts`.
- **[CT-5] [H]** **Vivacidad**: todo estado con fondos tiene un camino a `Settled` que no depende de una sola parte.
  - `Active` → `claim_after_timeout`.
  - `Stopped`/`UnderReview` → `claim_after_review_timeout`.
  - `Proposed` no tiene fondos (→ `cancel`).
  - Ningún camino de salida llama a la factory.
- **[CT-6] [H]** `claim_after_review_timeout`: deducción 0, bond al casero, `stop_justified = None` y path `ReviewTimeout`.
- **[CT-7] [H]** `resolve`: `0 ≤ deduction ≤ amount` antes de retirar; después se recorta a `principal_back` y se guarda la deducción efectiva. `!stop_justified ⇒ deduction == 0` se valida sobre la deducción **recibida**.
- **[CT-8] [H]** Vault:
  - `authorize_as_current_contract` autoriza **exactamente** `token.transfer(escrow, vault, amount)`, sin subinvocaciones.
  - `deposit([amount], [amount], escrow, true)` con `try_invoke_contract`, ignorando el retorno.
  - Shares = Δ`vault.balance(escrow)` > 0.
  - **Además**, Δ`token.balance(escrow) == −amount` durante el depósito.
  - Cualquier error se convierte en `VaultError` y revierte.
- **[CT-9] [H]** `fund_escrow`:
  - Un único fondeo (sin el `FundedAmount` de TW).
  - `expected_terms == terms`.
  - `get_fees() ≤ snapshot` en las dos componentes (`VaultFeeChanged`).
  - `funding_allowed` de la factory.
  - Transferencia del inquilino medida `== amount`.
  - Se fija `tenant`, `approvers += tenant`, `Active`, `register_tenant`.
  - El quórum se valida: `target (2) ≤ approvers.len()`.
- **[CT-10] [H]** Las lecturas con vault (`get_view`, `accrued_yield`, `preview_settlement`) y el `get_fees()` de `fz_settle` van con `try_`. Si fallan, valen 0 o `None`: **una lectura o una comisión nunca bloquea una salida**.
- **[CT-11] [H → M]** Pagos *push*.
  - [H]: casero e inquilino son C-address; la trustline de `treasury` (y de `tw_fee_receiver` si existe) la crea `fund.mjs` y la verifica `deploy.mjs`.
  - [M]: si un `try_transfer` falla, el importe se acredita en `Owed(addr)` y se retira con `withdraw_owed(who)`. Aplica a principal, rendimiento, fees y bond.
- **[CT-12] [H → M]** TTL.
  - [H]: `DataKey::Escrow` (persistent) y la instancia se extienden **juntos** en cada escritura y en `extend_contract_ttl()` (sin permisos).
  - [M]: un *keeper* que llame a `extend_contract_ttl` en fianzas largas, extienda también las entradas de la factory (FAC-11) y gestione la restauración (`STELLAR_STATE_ARCHIVED` + `restoreXdr`).
- **[CT-13] [M]** Invitación ed25519 ligada a `(escrow, tenant)` en lugar del preimage de sha256.
- **[CT-14] [M]** Tope de TVL por estrategia, auditoría externa del fork y de la factory, y *fuzzing* de `split`.
- **[CT-15] [H]** Sin `unwrap()`/`expect()` en los entrypoints. El único `panic!` permitido es el invariante de `split`; en el constructor se usa `panic_with_error!`.
- **[CT-16] [H]** **`NoYield`: `total = terms.amount`** (N-5). Invariante en reposo: `balance(escrow) ≥ bond_held + (NoYield ∧ no liquidada ? amount : 0)`. Con `≥`, porque la dirección es predecible y se le pueden enviar tokens antes o después de crearla.
- **[CT-17] [H]** **Interfaz cerrada**: el wasm del escrow solo expone las funciones de la § 6.2 (N-2).
- **[CT-18] [H]** Reentrada: Soroban impide volver a entrar en un contrato que ya está en la pila de llamadas, así que es correcto eliminar `DataKey::Reentrancy` (R-10). Lo cubre un test con `evil_vault` que intenta llamar al escrow desde `deposit` y desde `withdraw`.
- **[CT-19] [M]** Pérdida materializada por terceros (N-6): si `total < amount` en un `claim_*`, se exige `tenant.require_auth()`.

### 3.7 Factory (FAC)
- **[FAC-1] [H]** La factory **no** tiene `upgrade`, ni ninguna función que edite una `Strategy` ya registrada (solo `enabled`), ni ninguna que cambie `Escrow(id)`/`IdOf(addr)`.
- **[FAC-2] [H]** Despliegue con `deployer().with_current_contract(salt).deploy_v2(wasm_hash, (EscrowInit,))`. Solo la factory puede desplegar en direcciones derivadas de su propia dirección, y como la salt incluye al `landlord` que firma, nadie puede ocupar la dirección de otro.
- **[FAC-3] [H] [G1]** `salt = sha256(landlord.to_xdr() ‖ nonce)`, en **una sola función** que usan `create_fianza` y `predict_address`. Un nonce repetido da `NonceUsed`, comprobado con `IdOf(predicted)` antes del deploy. El `nonce` lo genera el **cliente** (32 bytes de `getRandomValues`), no la API. El cliente no se fía del `contractId` que devuelve la API para nada relacionado con fondos: lo confirma con `escrow_of(id)` tras el evento.
- **[FAC-4] [H]** `set_escrow_wasm_hash` solo afecta a fianzas nuevas y emite `f_wasm`. `Created` y `f_created` llevan `wasm_hash` (N-12).
- **[FAC-5] [H]** `register_tenant(id, tenant)`: `let esc = escrow_of(id)?; esc.require_auth();`. Solo pasa si el escrow registrado es el invocador directo. Además `AlreadyRegistered`. Un contrato impostor falla.
- **[FAC-6] [H] [G1]** `ConfigVersion` (u32, instance) sube con cada `set_config`, `set_escrow_wasm_hash`, `add_strategy`, `set_strategy_enabled` y `set_default_strategy`. `create_fianza` exige `p.expected_config_version == config_version()` (`ConfigChanged`). Lectura: `config_version()`.
- **[FAC-7] [H]** Registro de estrategias:
  - Alta en dos pasos (`enabled = false`).
  - `asset == config.token` **y** `token::Client(asset).name() == asset_name`.
  - `vault ∉ {token, factory, treasury, staff}`.
  - `NoYield ⇔ vault None ⇔ risk NoYield`.
  - `max_vault_fee_bps ≤ 2000` y `get_fees().0 ≤ max`.
  - `get_manager() == vault_manager` si se ha configurado.
  - Como mucho 10 estrategias.
  - No se puede deshabilitar la estrategia por defecto.
- **[FAC-8] [H] [G1]** `create_fianza` y `funding_allowed` vuelven a comprobar `get_fees()` contra los topes y `get_manager()` si `vault_manager` es `Some` (N-15). Si `get_manager` falla con `vault_manager` configurado, se rechaza: es fail-closed y solo en la entrada.
- **[FAC-9] [H]** `create_fianzas_batch`: atómico, `≤ MAX_BATCH` y nonces distintos (`NonceUsed` en el segundo repetido). **No pasa por el Relayer** (N-3).
- **[FAC-10] [H]** Índices: solo el casero firmante se añade al suyo (`create_fianza`) y solo el escrow registrado añade al inquilino (`register_tenant`). Paginación `limit ≤ 50`.
- **[FAC-11] [M]** `extend_ttl(ids: Vec<u64>)` sin permisos para `Escrow(id)`, `IdOf`, `Strategy` e índices. Si se archivan, el Relayer y la API no reconocen la fianza: los fondos no se pierden, pero el inquilino necesita restaurar.
- **[FAC-12] [M]** *Timelock* (por ejemplo 48 h) en `set_escrow_wasm_hash`, `add_strategy`, `set_default_strategy` y en los cambios de `treasury`/`staff` de `set_config`. La pausa sigue siendo inmediata.

### 3.8 Vault de DeFindex (VLT)
- **[VLT-1] [H]** Solo vaults del registro. El script de alta verifica off-chain:
  - `get_assets()` = [USDC con el emisor exacto].
  - Una sola estrategia, que es la esperada.
  - `get_fees()`.
  - Los roles (`manager`, `emergency_manager`, `rebalance_manager`, `fee_receiver`).
  - Que la instancia es del wasm oficial de DeFindex.
  - **Si es *upgradable*.**
  El resultado se guarda en `docs/DECISIONS.md`.
- **[VLT-2] [H]** Testnet (`usdc_paltalabs_vault`, gestionado por PaltaLabs): se acepta, con `vault_manager = None` y la etiqueta "vault de terceros" en la UI (Q-25).
- **[VLT-3] [M]** Mainnet (Q-19, decisión de seguridad):
  - Vault **propio** creado con la factory de DeFindex, **no *upgradable***.
  - `Manager` en multisig 2 de 3 de la plataforma (el manager puede reasignar todos los roles y cambiar la comisión).
  - `EmergencyManager` como bot o multisig.
  - `RebalanceManager` = manager (vault de una estrategia).
  - `fee_receiver` con trustline.
  - `config.vault_manager = Some(multisig)`.
- **[VLT-4] [H]** Un cambio de comisión **nunca** bloquea el retiro: `settle` no llama a `get_fees` salvo con `try_` para el evento (CT-10). Subirla tras fondear solo reduce el rendimiento: la comisión de DeFindex es sobre ganancias y no toca el principal.
- **[VLT-5] [M]** Monitor de `get_fees()`, de los roles y de los eventos de upgrade del vault. Ante cualquier cambio no previsto, `set_strategy_enabled(false)` (bloquea las altas, nunca las salidas).
- **[VLT-6] [M]** Iliquidez: alerta por uso del pool > 90 %, divulgación al inquilino, y opción de liquidar **en shares** (transferir dfTokens, que son SEP-41, a las partes) cuando `withdraw` revierte.
- **[VLT-7] [H]** `rescue` del emergency manager mueve los fondos de la estrategia al saldo libre del vault y la pausa, así que el retiro sigue siendo posible. Lo comprueba un test de e2e de P2 si el vault de testnet lo permite.

### 3.9 API (`apps/api`)
- **[API-1] [H]** La API **nunca firma**. Cada build devuelve una transacción con **una sola** operación `InvokeHostFunction`, sin `setOptions`, `payment` ni ninguna otra operación, con `timeBounds ≤ 300 s` y fee del simulador con tope. Para C-address, `soroban.func`/`soroban.auth` sin firmar.
- **[API-2] [H]** **El árbol de auth de cada build es exactamente el esperado** (los de la § 6.7): raíz = factory o escrow registrado. Subinvocaciones: ninguna, salvo en `fund_escrow` (`token.transfer(tenant, escrow, terms.amount)`) y `stop` (`token.transfer(landlord, escrow, terms.stop_bond)`). La API lo comprueba antes de responder, y el cliente lo vuelve a comprobar de forma independiente (WEB-3).
- **[API-3] [H]** Los builds validan el contrato antes de simular: `contractId` registrado (`id_of`) y wasm permitido. Si no, `404 ESCROW_NOT_FOUND` sin llamar a la RPC.
- **[API-4] [H]** `fund`: `amount == terms.amount` (si no, `422 ESCROW_PROPERTIES_MISMATCH`). `expected_terms` sale de `get_terms()` leído en la cadena. El `inviteCode` nunca se registra, nunca se cachea y se descarta tras simular.
- **[API-5] [H]** Límites (en memoria por instancia, aceptado):
  - Lecturas: 120/min por IP.
  - Builds: 30/min por IP y 10/min por `signer`.
  - Keys: 300/min por key.
  - Fallos de auth: 10/min por IP.
  - Tope global de simulaciones por instancia: semáforo de 10 en vuelo y cola corta, y si se llena, `429`.
- **[API-6] [H]** Caché: LRU acotada (≤ 1.000 entradas), solo para claves validadas (StrKey y registro), con TTL de 5 s para estado y 60 s para estrategias y APY, y deduplicación de peticiones simultáneas. Los resultados negativos se cachean 5 s. No se cachea nada que dependa de `inviteCode` o de API keys.
- **[API-7] [H]** *Timeouts* de 5 s hacia la RPC y de 10 s hacia Channels. Sin reintentos automáticos de envíos (para no duplicar).
- **[API-8] [H]** `GET /escrows/{contractId}/events`: rango de ledgers acotado y página de ≤ 100 eventos. Se devuelven solo los eventos cuyo `contractId` es un escrow registrado o la factory.
- **[API-9] [H]** `/fianzas/v1/relay` monta `createRelayHandler(RelayPolicy)` y **es la única** ruta que llama a Channels. Ninguna otra ruta reenvía al Relayer (test).
- **[API-10] [H]** `RelayPolicy` (§ 8.2 de la arquitectura, con N-3):
  - `fixedContracts = { [factory]: ["create_fianza"] }`.
  - Escrows: wasm permitido **y** `id_of` válido.
  - Sin `SOURCE_ACCOUNT`; raíz idéntica a `func`.
  - ≤ 4 auth entries, cuerpo ≤ 64 KB.
  - `Origin` propio.
  - Límites por IP, por credencial y globales.
  - `token.transfer` fuera de la lista con el ramp simulado.
- **[API-11] [H] [G1]** `POST /stellar/send-transaction` (N-13):
  - XDR firmado, una sola operación `InvokeHostFunction` y raíz = factory o escrow registrado con wasm permitido. Si no, `403 FZ_TX_NOT_ALLOWED`.
  - Nunca hay *fee-bump* ni patrocinio.
  - No se aceptan transacciones de *restore* de terceros salvo de contratos nuestros.
- **[API-12] [H]** Errores (RFC 9457):
  - `detail` saneado: sin trazas, URLs internas, respuestas crudas de la RPC o de Channels, keys ni cuerpos.
  - `traceId` aleatorio.
  - `instance` = ruta sin query.
  - `extensions.contractError` solo con el número.
  - No se distingue "key inexistente" de "key inválida".
- **[API-13] [H]** Secretos de la API (`RELAYER_API_KEY`, `RAMP_FAUCET_SECRET`, `API_KEYS_JSON`) solo en el entorno *Production* de Vercel, sin `NEXT_PUBLIC_`. Los módulos que los leen importan `server-only`. AC-11 se amplía a `API_KEYS_JSON`.
- **[API-14] [H]** El *read-model* nunca acepta un evento ni un contrato que no salga de `escrow_of`/`id_of`.
- **[API-15] [H]** Paginación: `nextCursor` opaco, validado y sin datos sensibles. Los filtros no soportados devuelven `400 VALIDATION_ERROR`; nunca se ignoran.
- **[API-16] [H]** Compatibilidad con TW:
  - **Las rutas de TW cuya semántica económica cambia responden `501 FZ_ENDPOINT_NOT_SUPPORTED`** con `extensions.replacement`. Afecta a `deploy`, `release-funds`, `change-milestone-status`, `dispute`, `resolve-dispute`, `withdraw-remaining-funds`, `update`, `manage-milestones` y `graphql`.
  - **Nunca** se reinterpreta un cuerpo de TW ni se le añaden campos que cambien el efecto económico.
  - El efecto adicional de `approve-milestones` (la 2.ª aprobación liquida) se documenta en la respuesta (`extensions.settles: true` cuando completa el quórum) y en `/openapi.json`.
  - La forma TW lleva `platformFee: 0` y `fianza.fees` con las comisiones reales (N-20).
- **[API-17] [M]** Keys en un almacén (KV) con revocación inmediata y rotación sin redeploy, sesión SEP-10/45 para caseros, límites en un almacén compartido e indexer propio.

### 3.10 Servicios de servidor (SRV)
- **[SRV-1] [H]** `import "server-only"` en `@fianzas/wallet/server` y `@fianzas/anchor/server`. Grep del bundle del cliente (AC-11).
- **[SRV-2] [H]** Relay: `func` = `InvokeContract` permitido, o `CreateContract`/`V2` solo con el wasm del smart account (o la función de su *factory*, si smart-account-kit despliega así: se confirma en el spike de P3).
- **[SRV-3] [H]** Se rechazan las credenciales `SOURCE_ACCOUNT`.
- **[SRV-4] [H]** Cada `rootInvocation.contractFn` es idéntica byte a byte a `func`.
- **[SRV-5] [H]** Sin `token.transfer` con el ramp simulado. `create_fianzas_batch`, `assign_expert`, `record_report`, `resolve` y las funciones de admin, nunca.
- **[SRV-6] [H]** Límites: 30/min por IP, 10/min por dirección de credencial, `create_fianza` ≤ 10 al día por casero y un tope global por hora.
- **[SRV-7] [H]** No acepta `fee`, `source` ni URLs desde el cliente.
- **[SRV-8] [H]** Respuestas solo `{code}` (y `detail` saneado).
- **[SRV-9] [M]** Sesión de usuario y presupuesto diario por cuenta.
- **[SRV-10] [H]** `createSimRampHandler` lanza una excepción con la *passphrase* de mainnet.
- **[SRV-11] [H]** Destino: una C-address cuyo ejecutable sea `smartAccount.accountWasmHash`, comprobado con `getLedgerEntries`.
- **[SRV-12] [H]** Topes por petición, por dirección y por IP (5/h), un tope global por hora y el interruptor `RAMP_ENABLED`.
- **[SRV-13] [H]** Faucet exclusivo con saldo acotado.
- **[SRV-14] [H]** Transacción construida en el servidor, con las peticiones serializadas (para evitar `tx_bad_seq`).
- **[SRV-15] [H]** `GET ?id=` solo para ids emitidos por esa instancia.

### 3.11 Cliente (WEB)
- **[WEB-1] [H]** La simulación usa `readSource`, que nunca firma.
- **[WEB-2] [H]** Las anclas de confianza salen **solo** de `@fianzas/deployments` empaquetado en el build: factory, token, `escrowWasmHashesAllowed`, vaults de las estrategias y `smartAccount`. Nunca de la API, de la URL ni de `localStorage`.
- **[WEB-3] [H] [G1]** **Lo que ves es lo que firmas, con verificación independiente (N-10).** Antes de pedir la passkey, `signAndSend`/`signAndSendBuilt`:
  1. Decodifica `soroban.func` y cada auth entry.
  2. Comprueba la raíz:
     - si es la factory, que coincide con `deployments.factory`;
     - si es un escrow, que `factory.id_of(addr)` lo reconoce y que el ejecutable de la instancia está en `escrowWasmHashesAllowed` (con `getLedgerEntries`), ambas cosas consultadas a la RPC propia.
  3. Comprueba que la función es la que ha pedido el usuario.
  4. Comprueba los argumentos:
     - `tenant`/`landlord` = su propia dirección;
     - `invite_code` = el del fragmento;
     - `expected_terms` = `get_terms()` leído por el propio cliente;
     - en `create_fianza`, `nonce` = el que él generó y `expected_config_version` = el leído.
  5. Comprueba las subinvocaciones exactas: en `fund_escrow`, `token.transfer(tenant, escrow, terms.amount)` con `token == deployments.token`; en `stop`, `token.transfer(landlord, escrow, terms.stop_bond)`; en el resto, ninguna.
  6. Comprueba la estrategia de `terms`: `strategy.vault` está en `deployments.strategies` y `strategy.asset == deployments.token`.
  7. Calcula **él mismo** el *payload* de firma (`HashIdPreimage::SorobanAuthorization`, con su propio nonce y `signatureExpirationLedger`). No firma ningún hash que venga de la API.

  Si falla cualquier comprobación, lanza `WalletError("AUTH_MISMATCH")`.
- **[WEB-4] [H]** No se firman auth entries de otras direcciones.
- **[WEB-5] [H]** XSS: prohibidos `dangerouslySetInnerHTML`, `eval` y `href`/`src` con datos sin validar. Los datos de la cadena se renderizan como texto.
- **[WEB-6] [H]** CSP con nonce (fragmento 9 de la § 8.1). `connect-src` incluye solo `'self'` y la RPC de Soroban (la API está en la misma origin).
- **[WEB-7] [H]** Sin scripts de terceros ni analítica en `apps/web`.
- **[WEB-8] [H]** Next.js y React en el último parche disponible (como mínimo, con CVE-2025-29927 y CVE-2025-55182/55183/55184 corregidos). Hono y `@hono/*` también en el último parche, y `pnpm audit --prod` sin críticas.
- **[WEB-9] [H]** El código de invitación y el `nonce` salen de `crypto.getRandomValues(new Uint8Array(32))`.
- **[WEB-10] [H]** El fragmento `#c=` se lee y se borra con `history.replaceState`. Solo viaja en el cuerpo de `fund` (API-4), nunca en una URL ni en un log.
- **[WEB-11] [H]** La pantalla de aceptación muestra importe, plazos, política, **las cuatro comisiones con su base**, el bond (informativo), la estrategia con su `RiskTier`, "vault de terceros" si aplica y el APY "variable". Todo se lee de la cadena (`get_terms()`), y solo el APY del endpoint de estrategias, etiquetado como estimación.
- **[WEB-12] [H]** Backoffice: Freighter en un perfil dedicado, con `preview_settlement` antes de `resolve`.
- **[WEB-13] [H]** Hay textos para `VaultError`, `VaultFeeChanged`, `DeadlinePassed`, `ReviewDeadlinePassed`, `InsufficientBond`, `TermsMismatch`, `ConfigChanged` y `AUTH_MISMATCH`, sin trazas.
- **[WEB-15] [H] [G1]** **Guardia de XDR para cuentas G (N-11).** El backoffice, y cualquier cliente que firme `unsignedXdr`, exige:
  - `source == signer`;
  - una sola operación `InvokeHostFunction`;
  - raíz, función y argumentos esperados;
  - auth entries solo `SOURCE_ACCOUNT` del firmante y sin subinvocaciones en las funciones de staff;
  - `fee ≤ 10 XLM` en testnet;
  - `maxTime − now ≤ 300 s`.
  Si falla, `AUTH_MISMATCH` antes de abrir Freighter.

---

## 4. Riesgos del fork de Trustless Work

### 4.1 Estado de la base
- **v2 `1d22d0c` es beta y no está publicada por TW.** La auditoría de Runtime Verification (sep-2025) es de la v1 y no cubre V2 ni nuestro diff. **El pitch no la cita** y el `NOTICE.md` dice "no auditado" (se respeta lo que pide la § 1.2).
- **Plan B v1 `f0b706e`:** `initialize_escrow` **sin auth** en v1, pero el fork lo elimina por completo (constructor atómico), así que el problema desaparece también en el plan B. El mapeo approver = casero y `release_signer` = inquilino impone un orden. **Requisito:** el plan B pasa **la misma batería de tests**, incluida `approve_release_order_independent`. Si no la pasa, `approve_release` tiene que ocultar el orden por dentro.
- **Revisión del diff:** cada cambio va marcado con `// FIANZAS:`. El revisor de cada PR del escrow compara contra el upstream con `git diff --no-index`.

### 4.2 Qué se rompe al quitar `resolve_dispute(distributions)`, `withdraw_remaining_funds` y el pago directo

| Pieza eliminada | Qué hacía en TW | Qué se pierde | Qué lo sustituye y qué hay que vigilar |
|---|---|---|---|
| `resolve_dispute(..., distributions: Map)` | El resolver repartía **todo** el saldo a direcciones libres | La salida genérica de una disputa | `resolve(deduction, stop_justified)` con destinos fijos (es más seguro). Vigilar que la validación upstream `total == balance` **no** se conserve: con el bond en el saldo fallaría siempre. Se usa la medición por diferencia (CT-2). |
| `withdraw_remaining_funds` | Evacuaba saldo residual tras resolver | Polvo, donaciones a la dirección predicha (C-18) y tokens enviados por error se quedan atrapados para siempre | Riesgo aceptado: no se añade `sweep` en la hackatón, porque sería un camino de salida más. [M] Opcional: `sweep_residual()` sin permisos, solo en estado terminal, solo hacia `treasury` y solo por `balance − 0`. |
| `release_funds(release_signer, trustless_work_address)` | Pago de `amount` con fee sobre el bruto a un `receiver`, con el receptor del fee como **argumento del llamante** | — | `settle` interno. **El destino del fee de TW sale de `Terms`**, lo que corrige el bug upstream (R-8). |
| `update_escrow`, `manage_milestones` y `change_milestone_status` | El admin o el *service provider* cambiaban propiedades e hitos | — | Nada: `Terms` son inmutables. **N-2:** test de interfaz cerrada. |
| `tw_new_single_release_escrow` + `initialize_escrow` | Despliegue con salt del llamante e init en dos pasos | La ventana sin inicializar (bien) | Factory + `__constructor(EscrowInit)` atómico. |
| `DataKey::Reentrancy` | Guard en persistent | — | La prohibición nativa de reentrada de Soroban (CT-18). |
| `FundedAmount` y el fondeo múltiple | Cualquiera fondeaba cualquier importe varias veces | — | Un solo fondeo, del inquilino, exacto (CT-9). Test `fund_twice_fails`. |

### 4.3 Invariantes de TW que hay que conservar (con test)
1. **Quórum:**
   - `approved_by` sin duplicados;
   - `approval_count == approved_by.len()`;
   - `approved_by ⊆ {landlord, tenant}`;
   - `target == 2 ≤ approvers.len()` a partir del fondeo;
   - no se puede aprobar en `Proposed`.
2. **Solape de roles:** `dispute_resolvers ∩ {landlord, tenant, treasury} = ∅`, `admin (factory) ∉` partes y sin duplicados.
3. **Una disputa congela la liberación:** en `Stopped`/`UnderReview` no se puede aprobar.
4. **Terminalidad:** después de `Settled` no se mueve nada (el `released` de TW).
5. **`expected_escrow` → `expected_terms`:** fondear con condiciones distintas falla.
6. **Matemática segura** de v2 en `split` y en los fees (sin `checked_*` sueltos que puedan divergir).
7. **Solo se despliega el wasm aprobado:** la factory despliega `escrow_wasm_hash`, y el cliente y el Relayer verifican el wasm de cada instancia.
8. **Eventos en cada cambio de estado** (con topics `fz_*` para no confundir a los indexers de TW).
9. **Un único enum de errores con códigos únicos** (se resuelve el solape `EscrowError`/`MilestoneError` del upstream).

### 4.4 Persistent + instancia (C-19)
- `DataKey::Escrow` (persistent) y la instancia tienen TTL independientes: **se extienden juntos** en cada escritura y en `extend_contract_ttl()`. Si se archiva una de las dos, la llamada falla hasta restaurar. Desde el protocolo 23 la restauración puede ir en la propia transacción; la API devuelve `STELLAR_STATE_ARCHIVED` con `restoreXdr`. **Los fondos no se pierden.**
- Otras entradas con TTL propio: el saldo de shares del escrow dentro del vault (storage del vault), los saldos del SAC y las entradas de la factory. Un *keeper* [M] las cubre.
- El tamaño de `Escrow` (`Terms` con `String asset_name` y ≤ 3 resolvers) es de pocos KB, muy por debajo del límite de entrada.

---

## 5. Factory: análisis

### 5.1 Despliegue determinista y salt (C-18)
- **Sin *squatting* ni colisión:** la dirección se deriva de (factory, salt), y solo la factory puede usar su propia dirección como deployer. La salt incluye al `landlord` cuya auth exige `create_fianza`, así que un atacante no puede ocupar la dirección del casero ni colisionar con ella.
- **Adelantarse a la transacción no sirve:** reenviar la transacción firmada del casero produce lo mismo que el casero pidió, y el segundo envío falla por `NonceUsed`.
- **Dirección predecible:** cualquiera puede enviar tokens o shares a un escrow antes de que exista, o después. No le pasa nada al reparto siempre que se cumplan CT-2 y CT-16 (medición por diferencia, `NoYield` con `terms.amount` e invariantes con `≥`). Test `prefunded_predicted_address_does_not_change_split`.
- **Codificación:** `landlord.to_xdr(&env)` + los 32 bytes del nonce. `predict_address` y el deploy comparten la función, y lo cubre el test `predict_address_matches_deployed`.
- **Nonce:** lo genera el cliente. Si la API lo generara, podría reutilizar el de otra fianza del mismo casero y provocar `NonceUsed` (DoS) o hacer que el front se confunda de dirección.

### 5.2 Poderes del admin y peor caso

| Poder | Peor caso si el admin está comprometido | Mitigación [H] | [M] |
|---|---|---|---|
| `set_escrow_wasm_hash` | wasm que roba los depósitos de las fianzas **nuevas** | El cliente y el Relayer solo aceptan wasm de `escrowWasmHashesAllowed` **empaquetado**; `wasm_hash` en `Created` y `f_created` | *Timelock*, multisig, build reproducible publicado |
| `add_strategy` + `set_default_strategy` | Vault malicioso para las fianzas nuevas | Alta en dos pasos; el cliente acepta solo vaults de `deployments.strategies`; el inquilino ve la estrategia en `Terms` | *Timelock*, monitor de `f_strategy` |
| `set_config` (treasury, staff, fees, plazos, bond, `vault_manager`) | La tesorería se queda fees y bonds; un staff aliado con un casero; plazos de 60 s | `expected_config_version` (el casero) y `expected_terms` (el inquilino); `token` inmutable; topes de la configuración | Mínimos de mainnet como constantes; *timelock* para treasury y staff |
| `set_strategy_enabled(false)` / `pause` | DoS de altas y fondeos | Las salidas nunca se bloquean; `cancel` siempre funciona | — |
| (no existe) upgrade de la factory, editar estrategias o mapeos | — | FAC-1 | — |

**Separación de confianza:** la clave del admin (CLI de P2) y las anclas empaquetadas (`deployments/testnet.json`, que cambia por PR revisado) son **dos dominios distintos**. Un atacante necesita comprometer los dos para robar fianzas nuevas. Así hay que mantenerlo: `deployments` no se genera en el build a partir de la cadena ni se descarga en tiempo de ejecución.

### 5.3 Registro de estrategias
- La validación del emisor exacto (`asset == config.token` y `name() == "USDC:G…"`) es correcta. Como `token` es inmutable (N-18), la comprobación de `name()` es una segunda barrera.
- **Estrategia deshabilitada:** bloquea `create_fianza` y `fund_escrow` de las fianzas en `Proposed` con esa estrategia, que pueden cancelarse. **Nunca** afecta a las salidas (test `disabled_strategy_does_not_block_exits`).
- Las estrategias `High` (RWA) no se registran en testnet. En mainnet llevan aviso con casilla y no se presentan como recomendación (R-15).

### 5.4 Índices, lotes y pausa
- La paginación es O(1) por alta, y nadie puede escribir en el índice de otro (FAC-10).
- Lote: atómico, con nonces distintos, `≤ MAX_BATCH` medido en el spike y fuera del Relayer.
- La pausa solo afecta a la entrada. Las salidas no llaman a la factory, como cubre el test `exits_work_with_broken_factory`, que usa una factory falsa que hace panic en todo.

---

## 6. Integración con DeFindex

### 6.1 Auth del depósito y del retiro
- `deposit(..., from = escrow, invest = true)`:
  - El vault hace `from.require_auth()`, que se cumple porque el escrow es el invocador directo.
  - El vault ejecuta `token.transfer(escrow, vault, amount)`, que requiere la auth del escrow vía `authorize_as_current_contract` **exacta**.
  - Las transferencias vault → estrategia → Blend no requieren la auth del escrow.
  - Si DeFindex calculara un importe distinto de `amount` (no debería con un solo activo), la auth no coincidiría y la transacción revertiría. Es fail-closed y correcto.
- `withdraw(shares, [0], escrow)`: `from.require_auth()` se cumple como invocador directo; las shares se queman y el activo se transfiere al escrow.
- **Tests:** sin `mock_all_auths`, con `mock-vault`, que reproduce **exactamente** el patrón `token.transfer(from, mock, amount)`, y con `evil_vault`.

### 6.2 Comisiones (§ 6.9)
- **Antes de fondear:**
  - el tope del registro (`max_vault_fee_bps ≤ 2000`);
  - la comprobación en `create_fianza`;
  - el **snapshot** en `Terms`, que firma el inquilino;
  - la comprobación en `fund_escrow` (`VaultFeeChanged` si sube).
  El inquilino nunca fondea con comisiones peores de las que firmó. **Correcto.**
- **Después de fondear:** el manager puede subir la comisión con `lock_fees(new_fee_bps)`. Esto solo reduce el rendimiento, nunca el principal ni la capacidad de liquidar (VLT-4).
  - Testnet: riesgo aceptado, con la etiqueta "vault de terceros".
  - Mainnet: vault propio con manager multisig y política de no subir comisiones con fianzas activas, o subirlas con preaviso y *timelock* (VLT-3, VLT-5).
- **Matiz:** si DeFindex aplica la nueva comisión a ganancias acumuladas aún sin "bloquear" (`lock_fees` en cada depósito o retiro), una subida afectaría también a rendimiento ya generado. Hay que confirmarlo en el spike junto con Q-24.
- **`fz_settle.vault_fees_at_settle`** se lee con `try_` y nunca revierte. Lo cubre el test `settle_succeeds_when_get_fees_panics`.

### 6.3 Roles del vault (verificado en la documentación de DeFindex hoy)
- **Manager:**
  - cambia todos los roles, incluido el suyo;
  - cambia la comisión de rendimiento;
  - **actualiza el código si el vault se desplegó como *upgradable***;
  - puede hacer todo lo que hacen los demás roles.
- **Rebalance manager:** mueve fondos entre estrategias. En un vault con una sola estrategia, el efecto se limita a invertir o desinvertir.
- **Emergency manager:** `rescue` lleva los fondos al saldo libre del vault y pausa la estrategia. El retiro sigue siendo posible.
- **Fee receiver:** necesita trustline (si no, la distribución de fees falla, pero eso no afecta a nuestro retiro).
- La documentación afirma que "ningún rol puede retirar fondos de los usuarios". **Excepción:** el upgrade, si el vault es *upgradable*. Ahí está el riesgo real (N-16).
- **Q-19, decisión de seguridad:** vault propio, no *upgradable*, con manager multisig (VLT-3).

### 6.4 Iliquidez y pérdida
- Si el uso del pool es alto, `withdraw` revierte. La transacción es atómica, así que el estado se conserva y basta con reintentar. **Todas las salidas de esa fianza quedan bloqueadas** mientras dure, también el timeout del inquilino.
  - [H]: mensaje claro (`VaultError` → "el fondo no tiene liquidez ahora; inténtalo más tarde") y e2e con `mock-vault` sin reserva.
  - [M]: VLT-6.
- La pérdida se compensa primero con el rendimiento. El déficit de principal lo absorbe el inquilino (Q-13). Hay que divulgarlo (DAT-7) y evitar que un tercero elija el momento de materializarlo (N-6, CT-19).

---

## 7. API (`apps/api`): análisis

### 7.1 Construcción del XDR sin firmar y encaje con `AUTH_MISMATCH`
- **La API está fuera del perímetro de confianza de la firma.** Aunque es nuestra, está en Vercel con dependencias npm y previews, así que puede comprometerse. La API comprueba el árbol de auth antes de responder (API-2), pero eso es solo una ayuda. La barrera real es el cliente:
  - con passkey: `signAndSendBuilt` aplica WEB-3 con lecturas **propias** de la RPC y anclas **empaquetadas**;
  - con Freighter: el backoffice aplica WEB-15.
- **Lo que la API no puede colar:**
  - subinvocaciones extra, porque el cliente compara la lista exacta;
  - otra raíz u otro escrow, porque el cliente comprueba `id_of` y el wasm;
  - otros `expected_terms`, porque el cliente lee `get_terms()` por su cuenta;
  - operaciones extra en XDR de cuentas G (WEB-15);
  - una firma sobre un hash ajeno, porque el *payload* lo calcula el cliente;
  - una expiración larga, porque el cliente lee `latestLedger`.
- **Lo que sí ve la API:** el `inviteCode` del `fund` (R-18). Es un riesgo bajo y aceptado; ed25519 en mainnet.
- **`unsignedXdr` con `readSource` para las C-address:** es informativo y el cliente **no** lo envía nunca. Lo cubre un test.

### 7.2 Endpoints anónimos
- Son correctos funcionalmente: los builds no tienen secretos y la cadena aplica `require_auth`. El riesgo es el **coste**: simulaciones en la RPC pública (que nos limitará o bloqueará), memoria de la caché y despliegues patrocinados por el Relayer.
- Mitigación: API-5…API-8, N-3 y SRV-6. En Vercel cada instancia tiene sus propios límites, así que la protección es débil frente a un ataque distribuido. Para la demo se acepta; en mainnet, almacén compartido y WAF.

### 7.3 API keys
- **Emisión:** a mano por P2, con un secreto de ≥ 256 bits que se entrega por un canal cifrado. En `API_KEYS_JSON` solo va el `sha256` del secreto.
- **Rotación:** se añade la key nueva (pueden convivir dos por integrador), se redespliega y se quita la antigua. **La revocación exige redeploy** (R-21, aceptado). En mainnet, KV con revocación inmediata.
- **Alcance por casero:** `landlords` solo filtra `scope=mine`. **No** restringe los builds (no hace falta: la cadena exige la firma del casero) y **no** da acceso al Relayer.
- Las keys son de servidor a servidor (CS-4).

### 7.4 Rate limiting, CORS y origen
- API-5 y CS-3…CS-5. Todo va en una única origin: nuestro front no necesita CORS, y `/relay` y `/ramp` nunca lo emiten.

### 7.5 `/relay` y la `RelayPolicy`
- API-9 y API-10. La política vive en `@fianzas/wallet/server` (P3) y la API solo la monta (P2). La configuración de la política (la factory y los hashes) sale de `@fianzas/deployments`, nunca del cuerpo de la petición.

### 7.6 Errores, RGPD, SSRF
- Errores: API-12. RGPD: DAT-6 y DAT-8. SSRF: CS-1. No hay ningún parámetro que acabe en una URL: `apy_pool` es una dirección on-chain que el SDK de Blend consulta a través de la RPC configurada.

### 7.7 Compatibilidad con el SDK de TW y por qué los `501`
- La regla de la § 6.8.1 es **correcta desde el punto de vista de seguridad**: un hook del SDK de TW que llame a `resolve-dispute` con `distributions` y reciba un 200 con otra semántica movería el dinero de una forma que el integrador no espera. Un `501` explícito con `replacement` hace que el fallo sea seguro.
- **Riesgos residuales:**
  1. `approve-milestones` **liquida** en la 2.ª aprobación. Los destinos son fijos y las dos partes han aprobado, así que va dentro de su intención, pero un integrador que automatice aprobaciones puede no esperarlo. Se documenta y se marca (`extensions.settles`).
  2. `escrow-balances` devuelve un **valor estimado** y no el saldo bruto (documentado).
  3. `platformFee: 0` engaña a las UIs de terceros (N-20).
  4. `extend-ttl` es más permisivo, pero inocuo: solo paga renta.
  5. Hay que comprobar si `escrow-js` tolera las extensiones (Q-27). Si las descarta, pierde `soroban` y el integrador con passkey no puede firmar, lo que da un fallo seguro.

---

## 8. Guía de código seguro

### 8.1 OBLIGATORIO (con fragmentos)

1. **Depósito en DeFindex con auth exacta y doble medición** (CT-8). La firma exacta de `try_invoke_contract` se ajusta a `soroban-sdk 28`.
```rust
// FIANZAS: depósito en el vault de DeFindex
fn deposit_all(e: &Env, t: &Terms, amount: i128) -> Result<i128, EscrowError> {
    let me = e.current_contract_address();
    let vault = t.strategy.vault.clone().ok_or(EscrowError::InvalidConfig)?;
    let asset = token::Client::new(e, &t.strategy.asset);
    let shares = token::Client::new(e, &vault);                 // dfTokens (SEP-41)
    e.authorize_as_current_contract(vec![e, InvokerContractAuthEntry::Contract(SubContractInvocation {
        context: ContractContext {
            contract: t.strategy.asset.clone(),
            fn_name: Symbol::new(e, "transfer"),
            args: (me.clone(), vault.clone(), amount).into_val(e),
        },
        sub_invocations: vec![e],
    })]);
    let (a0, s0) = (asset.balance(&me), shares.balance(&me));
    let amounts: Vec<i128> = vec![e, amount];
    let args: Vec<Val> = vec![e, amounts.clone().into_val(e), amounts.into_val(e), me.clone().into_val(e), true.into_val(e)];
    match e.try_invoke_contract::<Val, soroban_sdk::Error>(&vault, &Symbol::new(e, "deposit"), args) {
        Ok(Ok(_)) => {}
        _ => return Err(EscrowError::VaultError),                // se ignora el retorno
    }
    let pulled = a0.checked_sub(asset.balance(&me)).ok_or(EscrowError::Arithmetic)?;
    let minted = shares.balance(&me).checked_sub(s0).ok_or(EscrowError::Arithmetic)?;
    if pulled != amount || minted <= 0 { return Err(EscrowError::VaultError); }
    Ok(minted)
}
```

2. **`settle` con `NoYield`, comisiones por `try_` y efectos antes de pagar** (CT-1, CT-2, CT-10, CT-16).
```rust
// FIANZAS: único sitio que paga principal y rendimiento
fn settle(e: &Env, esc: &mut Escrow, deduction: i128, path: SettlePath) -> Result<Settlement, EscrowError> {
    let t = &esc.terms;
    let total = match t.strategy.kind {
        StrategyKind::NoYield => t.amount,                       // NUNCA balance(escrow): incluye el bond y las donaciones
        StrategyKind::DeFindexVault => vault::withdraw_all(e, t, esc.shares)?, // Δ balance alrededor del withdraw
    };
    let principal_back = total.min(t.amount);
    let s = split::split(total, t.amount, deduction.min(principal_back),
                         t.platform_fee_bps, t.tw_fee_bps, t.tenant_yield_bps)?;
    esc.status = Status::Settled; esc.settlement = Some(s.clone()); esc.path = Some(path); esc.shares = 0;
    storage::put_escrow(e, esc);                                 // persistent + instance extend_ttl
    let fees = vault::try_get_fees(e, t);                        // Option<(u32,u32)>: nunca revierte
    distribution::pay_settlement(e, t, esc.tenant.as_ref().ok_or(EscrowError::BadStatus)?, &s)?; // sin 0
    events::settle(e, t.id, &s, path, fees);
    Ok(s)
}
```

3. **`stop` del casero, con plazo y bond** (sin cambios en lo esencial; ver § 12).
```rust
pub fn stop(e: Env, reason_hash: BytesN<32>) -> Result<(), EscrowError> {
    let mut esc = storage::get_escrow(&e)?;
    esc.terms.landlord.require_auth();
    if esc.status != Status::Active { return Err(EscrowError::BadStatus); }
    if esc.approvals.approved_by.contains(&esc.terms.landlord) { return Err(EscrowError::AlreadyApproved); }
    let timeout_at = esc.terms.end_ts.checked_add(esc.terms.timeout_secs).ok_or(EscrowError::Arithmetic)?;
    if e.ledger().timestamp() > timeout_at { return Err(EscrowError::DeadlinePassed); }
    stop_bond::collect_bond(&e, &mut esc)?;                     // saldo ≥ bond, transfer medido, bond_held
    esc.status = Status::Stopped;
    esc.dispute.reason_hash = Some(reason_hash.clone());
    esc.dispute.stopped_ts = e.ledger().timestamp();
    storage::put_escrow(&e, &esc);
    events::stop(&e, esc.terms.id, &esc.terms.landlord, &reason_hash, esc.dispute.bond_held);
    Ok(())
}
```

4. **Salt única y `register_tenant`** (FAC-3, FAC-5).
```rust
pub fn salt(e: &Env, landlord: &Address, nonce: &BytesN<32>) -> BytesN<32> {
    let mut b = landlord.clone().to_xdr(e);
    b.append(&Bytes::from(nonce.clone()));
    e.crypto().sha256(&b).into()
}
pub fn register_tenant(e: Env, id: u64, tenant: Address) -> Result<(), FactoryError> {
    let esc: Address = storage::escrow_of(&e, id).ok_or(FactoryError::NotFound)?;
    esc.require_auth();                      // solo pasa si el escrow registrado es el invocador directo
    if storage::tenant_registered(&e, id) { return Err(FactoryError::AlreadyRegistered); }
    index::push_tenant(&e, &tenant, id);
    events::tenant(&e, id, &tenant);
    Ok(())
}
```

5. **`split` con la matemática segura de TW y el invariante de 4 términos** (CT-3).
```rust
pub fn split(total: i128, amount: i128, deduction: i128, p_bps: u32, tw_bps: u32, t_bps: u32)
    -> Result<Settlement, EscrowError> {
    if amount <= 0 || total < 0 || deduction < 0 { return Err(EscrowError::InvalidAmount); }
    if p_bps.checked_add(tw_bps).map_or(true, |s| s > 10_000) || t_bps > 10_000 { return Err(EscrowError::InvalidBps); }
    let pb = total.min(amount);
    if deduction > pb { return Err(EscrowError::DeductionTooHigh); }
    let y  = (total - amount).max(0);
    let tw = safe_mul_div(y, tw_bps as i128, 10_000)?;
    let fee = safe_mul_div(y, p_bps as i128, 10_000)?;
    let net = y.checked_sub(tw).and_then(|x| x.checked_sub(fee)).ok_or(EscrowError::Arithmetic)?;
    let ly = safe_mul_div(net, (10_000 - t_bps) as i128, 10_000)?;
    let s = Settlement { total, yield_total: y, deduction,
        to_tenant: pb - deduction + (net - ly), to_landlord: deduction + ly, to_treasury: fee, to_tw: tw };
    assert!(s.to_tenant + s.to_landlord + s.to_treasury + s.to_tw == total, "split invariant");
    Ok(s)
}
```

6. **Cliente: verificación independiente antes de la passkey** (WEB-3, TS).
```ts
// packages/wallet: nunca usa datos de la API para decidir si firma
async function verifyBuilt(res: UnsignedTransactionResponse, intent: Intent, rpc: rpc.Server, dep: Deployments) {
  const func = xdr.HostFunction.fromXDR(res.soroban!.func, "base64");
  const ic = func.invokeContract();
  const root = Address.fromScAddress(ic.contractAddress()).toString();
  if (root !== dep.factory) {
    const wasm = await instanceWasmHash(rpc, root);                     // getLedgerEntries propio
    if (!dep.escrowWasmHashesAllowed.includes(wasm)) throw mismatch("wasm");
    if ((await simulateRead(rpc, dep.factory, "id_of", [root])) == null) throw mismatch("registry");
  }
  const expected = await buildExpectedInvocation(intent, rpc, dep);     // get_terms() leído por el cliente
  for (const a of res.soroban!.auth.map(b => xdr.SorobanAuthorizationEntry.fromXDR(b, "base64"))) {
    if (!sameInvocationTree(a.rootInvocation(), expected)) throw mismatch("auth-tree"); // raíz + args + subs exactos
  }
  const latest = (await rpc.getLatestLedger()).sequence;
  if (res.soroban!.validUntilLedger > latest + 60) throw mismatch("expiry");
}
```

7. **Guardia de XDR para cuentas G** (WEB-15, backoffice).
```ts
function guardClassicXdr(xdrB64: string, signer: string, exp: { contract: string; fn: string; args: xdr.ScVal[] }) {
  const tx = TransactionBuilder.fromXDR(xdrB64, Networks.TESTNET) as Transaction;
  if (tx.source !== signer || tx.operations.length !== 1) throw mismatch("ops");
  const op = tx.operations[0];
  if (op.type !== "invokeHostFunction") throw mismatch("op-type");
  const ic = op.func.invokeContract();
  if (Address.fromScAddress(ic.contractAddress()).toString() !== exp.contract
      || ic.functionName().toString() !== exp.fn
      || !sameArgs(ic.args(), exp.args)) throw mismatch("call");
  if (BigInt(tx.fee) > 100_000_000n) throw mismatch("fee");             // 10 XLM
  const max = Number(tx.timeBounds?.maxTime ?? 0);
  if (!max || max - Date.now() / 1000 > 300) throw mismatch("timebounds");
}
```

8. **API: `send-transaction` restringido y keys en tiempo constante** (API-11, AUTH-9).
```ts
app.post("/stellar/send-transaction", zValidator("json", z.object({ signedXdr: z.string().max(65536) }).strict()), async (c) => {
  const tx = TransactionBuilder.fromXDR(c.req.valid("json").signedXdr, cfg.networkPassphrase);
  if (tx instanceof FeeBumpTransaction || tx.operations.length !== 1 || tx.operations[0].type !== "invokeHostFunction")
    return problem(c, 403, "FZ_TX_NOT_ALLOWED");
  const root = rootContract(tx.operations[0]);
  if (root !== dep.factory && !(await registry.isRegisteredEscrowWithAllowedWasm(root)))
    return problem(c, 403, "FZ_TX_NOT_ALLOWED");
  return submitToRpc(c, tx);                                           // nunca Channels
});
function checkKey(header: string | undefined): ApiKey | null {
  const [id, secret] = (header ?? "").split(".");
  const k = keys.get(id ?? "");
  const got = createHash("sha256").update(secret ?? "").digest();
  const want = k ? Buffer.from(k.secretSha256, "hex") : Buffer.alloc(32);
  return timingSafeEqual(got, want) && k ? k : null;                   // mismo coste exista o no la key
}
```

9. **CSP con nonce** en el `middleware.ts` de cada app: `script-src 'self' 'nonce-…' 'strict-dynamic'`, `object-src 'none'`, `base-uri 'none'`, `frame-ancestors 'none'`, `connect-src 'self' <rpcUrl>` y además `Referrer-Policy: no-referrer` y `X-Content-Type-Options: nosniff`.

10. **Compromiso con sal** (DAT-2), en el navegador: `sha256(getRandomValues(32) ‖ contenido)`, con la sal guardada aparte y off-chain.

### 8.2 PROHIBIDO
1. `mock_all_auths()` en tests de auth, vault, quórum o factory.
2. Usar `balance(escrow)` como `total` (`NoYield`, o "saldo del escrow" de TW). Fiarse del retorno de `deposit` o `withdraw`.
3. Transferir antes de escribir `Settled`. Transferir 0. Pagar a destinos que no salgan de `Terms`. Pagar el bond dentro de `split`.
4. Conservar funciones del upstream fuera de la lista de la § 6.2. Añadir `sweep`, `rescue`, `upgrade` o `set_*` en el escrow. Añadir `upgrade` o edición de estrategias o mapeos en la factory.
5. Llamar a la factory desde un camino de salida. Que la pausa, una estrategia deshabilitada o `get_fees()` bloqueen una salida.
6. `unwrap()`/`expect()` en los entrypoints.
7. Firmar en el cliente lo que dice la API sin verificarlo contra la RPC propia y las anclas empaquetadas. Firmar un hash que da la API. Descargar `deployments` en tiempo de ejecución.
8. Que `send-transaction` patrocine, o que una ruta distinta de `/fianzas/v1/relay` llame a Channels.
9. Registrar cuerpos, `inviteCode`, keys o pares IP + dirección. Errores con trazas o respuestas crudas.
10. Reinterpretar en silencio un cuerpo de TW o añadirle campos con efecto económico. Mostrar en nuestra UI las comisiones desde la forma TW.
11. `NEXT_PUBLIC_` con secretos. Importar `@fianzas/*/server` o `@fianzas/api` (el servidor) desde un componente cliente.
12. `dangerouslySetInnerHTML`, scripts de terceros o analítica. `Math.random` para cualquier valor de seguridad.
13. Citar la auditoría de TW o insinuar que el fork está auditado. Presentar el APY como garantizado, o cualquier estrategia como "sin riesgo".
14. Reutilizar en mainnet claves de testnet o usar una misma identidad para dos roles.

### 8.3 Seguridad de dependencias
- **Rust:**
  - `soroban-sdk = "=28.0.0"` (el mismo que el upstream) y `Cargo.lock` commiteado.
  - Sin crates de OpenZeppelin en el escrow ni en la factory.
  - El wasm del escrow que incrusta la factory con `contractimport!` se **compila en la misma ejecución de CI**, nunca desde un artefacto ni desde la caché.
  - `cargo audit` (informativo en la hackatón, bloqueante en mainnet).
- **Build reproducible [H]:** `deploy.mjs` registra en `escrowWasmHashesAllowed` el hash del wasm compilado desde el commit revisado, y la CI comprueba que el hash del build de `main` coincide.
- **npm/pnpm:**
  - `--frozen-lockfile` y pnpm ≥ 10 (sin scripts de instalación salvo los de `onlyBuiltDependencies`).
  - `minimumReleaseAge: 1440` si la versión lo soporta (≥ 10.16).
  - Versiones exactas en los paquetes críticos: `@stellar/stellar-sdk`, smart-account-kit, stellar-wallets-kit, `hono`, `@hono/*`, `zod`, `@blend-capital/blend-sdk`, `decimal.js`, `next` y `react`.
  - Comprobar el editor de smart-account-kit y del SDK de Blend antes de instalar (*typosquatting*).
  - Probar con `@trustless-work/escrow-js` solo en tests y nunca en el bundle del cliente.
- **Actions:** fijadas por SHA, al menos las de terceros (HAR-6).
- **A evitar:**
  - Next < 15.2.3.
  - Next 15.x/16.x y React 19.x sin el parche de CVE-2025-55182/55183/55184.
  - Hono con avisos abiertos en `pnpm audit`.
  - Cualquier paquete que no esté en el lockfile revisado.

---

## 9. Tests de seguridad

Convenciones de `cargo test`:
- Sin `mock_all_auths`, salvo en la matriz pura de `split`. Se usan `mock_auths` selectivo y `set_auths` con firmas reales para las cuentas contrato.
- Tiempo con `env.ledger().set_timestamp`.
- SAC con `register_stellar_asset_contract_v2`; `mock-vault` como `rlib`.
- `evil_vault.rs` (P1) con un comportamiento configurable: tira de más, desvía, mintea shares falsas, paga menos, hace panic en `get_fees`/`preview` o vuelve a entrar al escrow.
- `fake_factory.rs` (P1) que hace panic en todo, para probar que las salidas no dependen de la factory.

**[H]** entra en la hackatón (G4 como tarde); **[M]**, antes de mainnet.

### 9.1 Escrow (`cargo test -p escrow`)

**`tests/auth.rs`**
| Test | Escenario | P. |
|---|---|---|
| `cancel_requires_landlord_auth` | El inquilino o un tercero llaman a `cancel` → fallo de auth; sigue en `Proposed` | H |
| `fund_requires_tenant_auth` | Un tercero hace `fund_escrow(T, …)` sin la auth de T → falla; el saldo de T no cambia | H |
| `fund_auth_tree_is_exact` | `env.auths()` de T = `fund_escrow(T, code, terms)` con una única subinvocación `token.transfer(T, escrow, amount)` | H |
| `approve_rejects_non_party` | Un tercero se autoriza a sí mismo → `NotParty` | H |
| `approve_requires_approver_auth` | `approver = L` con la auth de T → fallo de auth | H |
| `tenant_cannot_stop` | `stop` con solo la auth de T → fallo de auth del casero; no se cobra el bond | H |
| `staff_fns_reject_non_resolvers` | `assign_expert`, `record_report` y `resolve` con L, T, treasury o factory → `NotResolver` o fallo de auth | H |
| `any_listed_resolver_can_resolve` | Con 3 resolvers, el 2.º resuelve | H |
| `claims_are_permissionless_and_pay_only_terms_parties` | Un tercero sin auth reclama → éxito; el tercero recibe 0 | H |
| `extend_ttl_is_permissionless_and_moves_nothing` | Saldos y estado iguales; los TTL extendidos | H |
| `constructor_cannot_be_called_again` | `try_invoke_contract(escrow, "__constructor", …)` → error | H |
| `terms_are_immutable_across_lifecycle` | `get_terms()` es idéntico en todos los estados | H |

**`tests/quorum.rs`** (invariantes de TW)
| Test | Escenario | P. |
|---|---|---|
| `approve_order_independent` | L→T y T→L liquidan igual, solo en la 2.ª aprobación | H |
| `approve_twice_same_party_fails` | → `AlreadyApproved`; `approval_count` sigue en 1 | H |
| `approved_by_subset_and_count_consistent` | Después de cada aprobación, `approved_by ⊆ {L, T}`, sin duplicados y `count == len` | H |
| `cannot_approve_in_proposed` | → `BadStatus` | H |
| `cannot_approve_when_stopped_or_under_review` | → `BadStatus` | H |
| `quorum_with_contract_accounts` | L y T como contratos con `__check_auth` (ed25519), con `set_auths` reales: crear, fondear y aprobar ×2 → `Settled` | H |
| `contract_account_bad_or_expired_signature_rejected` | Firma ajena o expirada → falla; estado intacto | H |

**`tests/fund.rs`**
| Test | Escenario | P. |
|---|---|---|
| `fund_terms_mismatch_fails` | `expected_terms` con un campo cambiado → `TermsMismatch` | H |
| `fund_twice_fails` | 2.º fondeo → `BadStatus`; sin transferencia | H |
| `fund_wrong_or_missing_invite_fails` | → `InvalidInvite`; saldo intacto | H |
| `fund_other_address_when_tenant_fixed_fails` | → `NotParty` | H |
| `fund_landlord_or_platform_party_fails` | T = L → `SameParty`; T ∈ {staff, treasury, factory, vault, token, tw_receiver} → `InvalidParty` | H |
| `fund_after_end_ts_fails` | → `InvalidEndTs` | H |
| `fund_blocked_when_factory_paused_or_strategy_disabled` | → `Paused` | H |
| `fund_rejects_vault_fee_increase` | `mock.set_fees(vf + 1, pf)` tras crear → `VaultFeeChanged`; sin transferencia | H |
| `fund_allows_vault_fee_decrease` | Comisión menor → éxito | H |
| `fund_noyield_keeps_principal_liquid` | `NoYield` → `shares == 0` y `balance(escrow) == amount` | H |
| `cancel_then_fund_fails_without_moving_funds` | → `BadStatus` | H |

**`tests/vault.rs`**
| Test | Escenario | P. |
|---|---|---|
| `deposit_with_exact_contract_auth` | Sin `mock_all_auths`: el mock recibe exactamente `amount` y las shares son > 0 | H |
| `evil_vault_pulls_more_reverts` | `transfer(escrow, vault, amount + 1)` → revierte | H |
| `evil_vault_redirects_reverts` | `transfer(escrow, tercero, amount)` → revierte | H |
| `evil_vault_fake_shares_reverts` | Shares "devueltas" ≠ Δbalance, o Δbalance = 0 → `VaultError` | H |
| `settle_uses_token_diff_not_return` | `withdraw` devuelve 2X y transfiere X → `Settlement.total == X` | H |
| `evil_vault_reentry_fails` | `deposit` o `withdraw` llaman a `escrow.approve_release` → la transacción falla entera | H |
| `illiquid_vault_reverts_and_keeps_state` | Mock sin reserva → la 2.ª aprobación da `VaultError`; sigue `Active` con `count == 1`; tras reponer, liquida | H |
| `claim_retry_after_liquidity_returns` | Igual con `claim_after_timeout` | H |
| `settle_succeeds_when_get_fees_panics` | `get_fees` con panic al liquidar → liquida y `vault_fees_at_settle == None` | H |
| `reads_survive_vault_failure` | `preview` con panic → `accrued_yield == 0` y `get_view` funciona | H |
| `prefunded_predicted_address_does_not_change_split` | Se envían tokens y shares a la dirección predicha antes de crear → mismo `Settlement` que sin ellos | H |
| `noyield_total_is_amount_not_balance` | `NoYield` con bond retenido y una donación → `Settlement.total == amount`; el bond se paga entero aparte | H |

**`tests/timeout.rs`**
| Test | Escenario | P. |
|---|---|---|
| `stop_allowed_at_exact_timeout_at` | `now = timeout_at` → `stop` funciona | H |
| `stop_fails_after_timeout_at` | `+1` → `DeadlinePassed`; no se cobra el bond | H |
| `claim_fails_at_exact_timeout_at` | `= timeout_at` → `TimeoutNotReached`; `+1` → éxito | H |
| `resolve_allowed_at_exact_review_deadline` | `= review_deadline` → funciona | H |
| `resolve_fails_after_review_deadline` | `+1` → `ReviewDeadlinePassed` | H |
| `review_claim_fails_at_exact_deadline` | `=` → `ReviewTimeoutNotReached`; `+1` → éxito | H |
| `nothing_blocks_claim_after_timeout` | Tras el plazo, `stop`, `assign_expert`, `record_report`, `resolve` y `cancel` fallan; el claim liquida | H |
| `nothing_blocks_review_claim` | Tras el plazo de revisión, `resolve` falla; el claim liquida, devuelve el bond a L y `path = ReviewTimeout` | H |
| `claims_fail_in_wrong_states` | `claim_after_timeout` en Proposed, Cancelled, Stopped, UnderReview o Settled → `BadStatus`; `claim_after_review_timeout` en Active, Proposed o Settled → `BadStatus` | H |
| `stop_after_landlord_approval_fails` | → `AlreadyApproved`; sin bond | H |
| `landlord_can_stop_after_tenant_approval` | → `Stopped` | H |
| `settled_is_terminal` | Todas las mutaciones dan `BadStatus`; saldos sin cambios | H |
| `ending_is_derived_not_stored` | `get_view().status == Ending`; el almacenado sigue `Active` | H |
| `constructor_rejects_overflowing_deadlines` | `end_ts` cerca de `u64::MAX` → panic con `InvalidEndTs`/`Arithmetic` | H |
| `loss_claim_requires_tenant_consent` | Con pérdida, un tercero reclama → falla; con la auth de T → liquida | M |

**`tests/resolve.rs`**
| Test | Escenario | P. |
|---|---|---|
| `resolve_pays_only_terms_parties` | Saldos de staff, factory y terceros sin cambios | H |
| `resolve_deduction_above_amount_fails` | → `DeductionTooHigh` | H |
| `resolve_negative_deduction_fails` | → `InvalidAmount` | H |
| `resolve_without_report_fails` | → `ReportMissing` | H |
| `reassign_expert_clears_report` | `assign`, `report`, `assign` y `resolve` → `ReportMissing` | H |
| `resolve_clamps_on_rounding_loss` | Vault devuelve `amount − 1` y `X = amount` → deducción efectiva `amount − 1` | H |
| `resolve_clamps_on_total_loss` | `total = 0` → todo a 0; el invariante se cumple | H |
| `staff_metadata_calls_move_no_funds` | Saldos y shares iguales | H |
| `staff_cannot_act_on_active` | `assign_expert` en `Active` → `BadStatus` | H |

**`tests/split_matrix.rs`** (pura)
| Test | Escenario | P. |
|---|---|---|
| `split_invariant_matrix` | `tenant_bps {0,1,5000,9999,10000}` × `platform_bps {0,2000,5000}` × `tw_bps {0,30}` × deducción `{0,1,parcial,principal_back}` × total `{0, amount/2, amount−1, amount, amount+1, amount+3, 2·amount}` → la suma de 4 == total, sin negativos, fees = floor sobre el rendimiento | H |
| `split_fees_never_touch_principal` | `total ≤ amount` → `to_treasury == to_tw == 0` | H |
| `split_rounding_remainder_to_tenant` | Rendimiento 1, 3 y 7 con 5000 bps | H |
| `split_rejects_invalid_inputs` | Errores tipados, sin panic | H |
| `split_extreme_values_no_overflow` | `MAX_AMOUNT`, 2·`MAX_AMOUNT`, bps al máximo | H |
| `split_pseudorandom_10k` | LCG determinista → invariante en 10.000 casos | H |

**`tests/stop_bond.rs`**: la lista de la § 12.9.

**`tests/interface.rs` + CI**
| Test | Escenario | P. |
|---|---|---|
| `wasm_exposes_only_expected_functions` | Script de CI: `stellar contract info interface --wasm escrow.wasm` comparado con la lista de la § 6.2. Cualquier función de más (`update_escrow`, `withdraw_remaining_funds`, `release_funds`, `tw_new_*`, `change_milestone_status`, `manage_milestones`, `resolve_dispute`) hace fallar la CI | H |
| `errors_have_unique_codes` | El enum `EscrowError` no tiene códigos repetidos | H |
| `every_state_change_emits_event` | Topics `(fz_*, id)` en cada mutación | H |
| `settle_event_matches_balances` | `fz_settle` = deltas reales de T, L, treasury y TW | H |
| `exits_work_with_broken_factory` | Escrow cuyo `terms.factory` es `fake_factory` (panic en todo), ya fondeado: `approve_release`, `stop`, `resolve` y los dos claims funcionan | H |

**`tests/ttl.rs`**
| Test | Escenario | P. |
|---|---|---|
| `escrow_entry_and_instance_extended_on_every_write` | `get_ttl(DataKey::Escrow)` y el de la instancia ≥ umbral tras cada entrypoint mutante y tras `extend_contract_ttl` | H |

**`tests/payout.rs`**
| Test | Escenario | P. |
|---|---|---|
| `zero_amount_transfers_skipped` | `tenant_bps = 10000` y `tw_bps = 0` → no hay `transfer` al casero ni a TW | H |
| `tw_fee_paid_only_when_receiver_and_positive` | `tw_bps = 30` con receptor → `to_tw > 0` pagado; sin receptor, el constructor falla | H |
| `known_limitation_unpayable_recipient_blocks_settle` | `set_authorized(L, false)` → el claim falla (se documenta la limitación) | H |
| `unpayable_recipient_gets_owed_credit` | Con `Owed`, T cobra y L retira después | M |

### 9.2 Factory (`cargo test -p factory`, con el wasm del escrow compilado antes)

| Test | Escenario | P. |
|---|---|---|
| `create_requires_landlord_auth` | Sin la auth del casero → falla | H |
| `create_auth_tree_has_no_subinvocations` | `env.auths()` de L = solo `create_fianza` | H |
| `predict_address_matches_deployed` | `predict_address(L, n)` == `Created.escrow` | H |
| `salt_binds_landlord` | El mismo `nonce` con otro casero da otra dirección y no hay colisión | H |
| `nonce_reuse_fails` | 2.º `create_fianza(L, n)` → `NonceUsed` | H |
| `created_returns_wasm_hash` | `Created.wasm_hash == escrow_wasm_hash()` y el evento `f_created` lo incluye | H |
| `create_validates_params` | Importe, `end_ts`, invitación (los dos o ninguno), partes (`InvalidParty`/`SameParty`) | H |
| `create_rejects_stale_config_version` | `set_config` entre lectura y creación → `ConfigChanged` | H |
| `create_copies_config_snapshot_into_terms` | Los `Terms` tienen fees, plazos, resolvers, tesorería, bond (`compute_stop_bond`) y comisiones del vault | H |
| `config_change_does_not_affect_existing` | Tras `set_config` y `set_escrow_wasm_hash`, los `Terms` y el wasm de las fianzas antiguas no cambian | H |
| `set_config_validation` | Cada regla de IV-3 → `InvalidConfig`; **cambio de `token` → `InvalidConfig`** | H |
| `admin_fns_require_admin` | `set_config`, `set_escrow_wasm_hash`, `add_strategy`, `set_strategy_enabled`, `set_default_strategy`, `pause` y `unpause` con staff, casero o tesorería → fallo de auth | H |
| `add_strategy_two_step` | Se guarda con `enabled = false`; `create_fianza` con ella → `StrategyDisabled` hasta habilitarla | H |
| `add_strategy_rejects_wrong_asset_or_name` | `asset ≠ token` o `name() ≠ asset_name` → `InvalidStrategy` | H |
| `add_strategy_rejects_forbidden_vault` | `vault ∈ {token, factory, treasury, staff}` → `InvalidStrategy` | H |
| `add_strategy_kind_consistency` | `NoYield` con vault, `DeFindexVault` sin vault, `NoYield` con `risk ≠ NoYield` → `InvalidStrategy` | H |
| `add_strategy_fee_caps` | `max_vault_fee_bps > 2000`, o `get_fees().0 > max` → `VaultFeeTooHigh` | H |
| `add_strategy_requires_platform_manager` | Con `vault_manager = Some(m)` y `get_manager() ≠ m` → `VaultNotPlatformManaged` | H |
| `manager_change_after_add_blocks_new_fianzas` | El manager del mock cambia tras el alta → `create_fianza` y `funding_allowed` fallan; las fianzas ya fondeadas liquidan | H |
| `vault_fee_increase_blocks_create` | `get_fees().0 > max` tras el alta → `VaultFeeTooHigh` | H |
| `strategy_is_immutable` | No hay función que cambie una estrategia; un 2.º `add_strategy` con el mismo id → `StrategyExists` | H |
| `cannot_disable_default_strategy` | → error; tras `set_default_strategy` a otra, sí se puede | H |
| `disabled_strategy_does_not_block_exits` | Fianza fondeada y estrategia deshabilitada → aprobar, resolver y reclamar funcionan | H |
| `pause_blocks_only_entries` | `create_*` y `fund_escrow` → `Paused`; `cancel`, `stop`, `approve_release`, `resolve` y los claims funcionan | H |
| `register_tenant_rejects_impostor` | Un contrato impostor llama a `register_tenant(id_real, X)` → `NotEscrow`/fallo de auth; el índice no cambia | H |
| `register_tenant_rejects_direct_call` | La cuenta del inquilino llama directamente → fallo de auth | H |
| `register_tenant_once` | 2.º registro → `AlreadyRegistered` | H |
| `indexes_only_self` | Nadie añade ids al índice de otro casero o inquilino | H |
| `pagination_limits` | `limit > 50` → `TooMany`; `start` más allá del final → vacío | H |
| `get_fianzas_limits_and_skips_missing` | `> 25` → `TooMany`; ids inexistentes omitidos | H |
| `batch_is_atomic` | 3 items, el 3.º inválido → ningún despliegue | H |
| `batch_rejects_duplicate_nonce` | Dos items con el mismo nonce → `NonceUsed` y nada desplegado | H |
| `batch_max_size` | `> MAX_BATCH` → `TooMany` | H |
| `compute_stop_bond_formula` | Mínimo, porcentaje y tope en el principal | H |
| `factory_has_no_upgrade_fn` | El script de interfaz del wasm de la factory compara contra la lista de la § 6.3 | H |
| `admin_timelock_enforced` | `set_escrow_wasm_hash` no surte efecto antes de 48 h | M |

### 9.3 API (`vitest`, `apps/api`, P2; con RPC y Channels simulados)

| Test | Escenario | P. |
|---|---|---|
| `build_returns_single_invoke_op` | Cada build (G) tiene 1 operación `InvokeHostFunction`, `timeBounds ≤ 300 s` y el fee con tope | H |
| `build_auth_tree_is_expected` | `fund` lleva solo `transfer(T, E, amount)`; `stop`, solo `transfer(L, E, bond)`; el resto, ninguna subinvocación | H |
| `build_c_signer_has_no_source_account_creds` | Signer C → `soroban.auth` solo con credenciales de dirección; `validUntilLedger ≤ latest + 60` | H |
| `build_rejects_unregistered_or_foreign_wasm` | `contractId` no registrado o wasm fuera de la lista → 404 sin simular | H |
| `build_rejects_invalid_strkey_without_rpc` | `contractId` malformado → 400 y 0 llamadas a la RPC | H |
| `fund_amount_mismatch_422` | `amount ≠ terms.amount` → `ESCROW_PROPERTIES_MISMATCH` | H |
| `fund_invite_code_never_logged_or_cached` | Espía sobre el logger y la caché: el `inviteCode` no aparece | H |
| `amount_precision_rejected` | 8 decimales → `AMOUNT_PRECISION_UNSUPPORTED`; `1e3` y negativos → 400 | H |
| `strict_bodies_reject_extra_fields` | Campo desconocido → 400 | H |
| `tw_semantic_routes_return_501_with_replacement` | `deploy`, `release-funds`, `change-milestone-status`, `dispute`, `resolve-dispute`, `withdraw-remaining-funds`, `update`, `manage-milestones` y `graphql` → 501 con `FZ_ENDPOINT_NOT_SUPPORTED` y `replacement` | H |
| `approve_milestones_flags_settlement` | Con la 2.ª aprobación → `extensions.settles = true` | H |
| `snapshot_platform_fee_zero_and_real_fees_in_extension` | `platformFee == 0` y `fianza.fees` completo | H |
| `send_transaction_rejects_foreign_or_multi_op` | Otro contrato, 2 operaciones, `payment` o `setOptions` → 403 `FZ_TX_NOT_ALLOWED` | H |
| `send_transaction_never_calls_relayer` | El mock de Channels no recibe llamadas | H |
| `only_relay_route_calls_channels` | Recorre todas las rutas: solo `/fianzas/v1/relay` llama a Channels | H |
| `relay_policy_enforced` | Contrato o función fuera de la lista, `SOURCE_ACCOUNT`, raíz ≠ `func`, `create_fianzas_batch`, funciones de staff, `token.transfer`, escrow con wasm no permitido o no registrado → 403 | H |
| `relay_requires_same_origin` | `Origin` ajeno o ausente → 403; sin cabeceras CORS | H |
| `relay_rate_limits` | 31/min por IP y 11/min por credencial → 429; 11.º `create_fianza` del día del mismo casero → 429 | H |
| `api_key_valid_invalid_missing` | Válida → 200; inválida o inexistente → 401 con la misma respuesta | H |
| `api_key_in_query_rejected` | `?apiKey=` → 400 | H |
| `api_key_cannot_use_relay` | → 403 | H |
| `api_key_scope_mine_filters_landlords` | Solo devuelve las fianzas de los caseros de la key | H |
| `api_key_never_logged` | Espía sobre el logger: solo aparece el `id` | H |
| `cors_only_for_key_origins_never_credentials` | Origen registrado → `ACAO` concreto; otro → nada; nunca `credentials: true` ni `*` | H |
| `read_rate_limit` | 121/min → 429 | H |
| `cache_is_bounded` | 10.000 `contractId` válidos y distintos → tamaño ≤ 1.000; la memoria es estable | H |
| `rpc_concurrency_capped` | 100 builds simultáneos → ≤ 10 en vuelo y el resto en 429 | H |
| `problem_details_do_not_leak` | Error de la RPC con traza y URL → `detail` sin URL, traza ni cuerpo | H |
| `outbound_fetch_allowlist` | Un parámetro con una URL no provoca `fetch` a otro host (mock del fetch global) | H |
| `events_filtered_by_registered_contract` | Un evento `fz_settle` de un contrato no registrado no se devuelve | H |
| `unsupported_filters_400` | `platformId`, `subjectId`, `createdAfter` → 400 | H |
| `cursor_tampering_rejected` | `nextCursor` manipulado → 400 | H |
| `ramp_guards` | SRV-10…SRV-15 (*passphrase* de mainnet, destino que no es smart account, topes, `RAMP_ENABLED=0`) | H |
| `secrets_not_in_client_bundle` | Build de `apps/web` con valores señuelo en `RELAYER_API_KEY`, `RAMP_FAUCET_SECRET` y `API_KEYS_JSON` → `grep` de `.next/static` vacío (AC-11) | H |

### 9.4 Wallet y backoffice (`vitest`, P3 y P4)
| Test | Escenario | P. |
|---|---|---|
| `verify_rejects_extra_subinvocation` | La API añade `transfer(T, X, n)` → `AUTH_MISMATCH` y la passkey no se invoca | H |
| `verify_rejects_unregistered_escrow_even_if_api_says_ok` | La API dice que está registrado y la RPC propia no → `AUTH_MISMATCH` | H |
| `verify_rejects_disallowed_wasm` | Instancia con wasm fuera de `escrowWasmHashesAllowed` → `AUTH_MISMATCH` | H |
| `verify_uses_own_terms` | `expected_terms` ≠ `get_terms()` leído por el cliente → `AUTH_MISMATCH` | H |
| `verify_rejects_long_expiry` | `validUntilLedger > latest + 60` → `AUTH_MISMATCH` | H |
| `signature_payload_computed_locally` | El hash firmado = `HashIdPreimage` calculado en local; se ignora el `txHash` de la API | H |
| `backoffice_xdr_guard` | `setOptions`, `payment`, 2 operaciones, `source ≠ staff`, otra función o fee alto → `AUTH_MISMATCH` antes de abrir Freighter | H |
| `informative_unsigned_xdr_never_submitted` | Con `soroban`, nunca se llama a `send-transaction` | H |

---

## 10. Revisión de seguridad de la arquitectura

### 10.1 Problemas encontrados
No hay ningún problema **crítico** que impida empezar: la arquitectura ya incorpora el cierre stop/timeout, el bloqueo por staff ausente, la invitación, el bond con coherencia y el snapshot de comisiones. Los problemas altos son de **confianza en la API y en el admin**, y se resuelven en el cliente y en la interfaz antes de G1.

| # | Problema | Sev. | Recomendación | Cuándo |
|---|---|---|---|---|
| 1 | N-10: el cliente verifica contra datos de la API | Alta | WEB-3 con RPC propia y anclas empaquetadas | H [G1] |
| 2 | N-11: el staff firma XDR de la API | Alta | WEB-15 | H [G1] |
| 3 | N-12: admin comprometido → fianzas nuevas | Alta | Anclas empaquetadas, `wasm_hash` en `Created`; *timelock* y multisig [M] | H [G1] / M |
| 4 | N-5: `NoYield` con `balance` | Alta | CT-16 | H |
| 5 | Pagos *push* (tesorería, TW, casero congelado) | Alta (mainnet) | CT-11 | H / M |
| 6 | Iliquidez de Blend que bloquea todas las salidas de la fianza | Alta (mainnet) | VLT-6 | M |
| 7 | N-16: upgrade del vault | Media / Alta (mainnet) | VLT-3 | M |
| 8 | N-13: `send-transaction` como proxy abierto | Media | API-11 | H [G1] |
| 9 | N-3: despliegues patrocinados | Media | SRV-5, SRV-6 | H [G1] |
| 10 | N-14: el casero no firma la configuración | Media | FAC-6 | H [G1] |
| 11 | N-15: el manager del vault cambia | Media | FAC-8 | H [G1] |
| 12 | N-6: pérdida materializada por un tercero | Media | CT-19 | M |
| 13 | N-17: caché sin límite | Media | API-6 | H |
| 14 | N-18: `token` mutable | Media | IV-3 | H [G1] |
| 15 | N-19: `apps/api` sin área | Media | HAR-15 | H (G0) |
| 16 | N-2: funciones del upstream que sobreviven | Media | CT-17 | H |
| 17 | Fork sin auditar (R-1) | Media (hackatón) / Alta (mainnet) | § 4, auditoría [M] | M |
| 18 | Conflicto de interés del bond | Media | § 12 | H / M |
| 19 | `inviteCode` visible para la API (R-18) | Baja | API-4; ed25519 [M] | M |
| 20 | N-20: `platformFee = 0` en la forma TW | Baja | API-16 | H |
| 21 | N-21: inconsistencias del documento | Baja | § 15 | G1 |

### 10.2 Patrones aprobados
- **Fork de TW con cortes en lugar de añadidos:** se eliminan el reparto libre del resolver, `withdraw_remaining_funds`, `update_escrow` y el destino del fee como argumento del llamante. Queda menos superficie que en el upstream.
- **Constructor atómico** `__constructor(EscrowInit)`: sin ventana sin inicializar y sin clave de admin en el escrow.
- **`expected_terms`** en `fund_escrow` (el `expected_escrow` de TW llevado a todas las condiciones).
- **Un contrato por fianza**: aislamiento del riesgo.
- **Snapshot de la configuración en `Terms`**: el admin no toca las fianzas existentes.
- **Las salidas no dependen de la factory**, y la pausa solo afecta a la entrada.
- **Salt con el casero firmante**: sin *squatting* ni colisión.
- **`register_tenant` autenticado por el invocador.**
- **Registro de estrategias en dos pasos**, con emisor fijado y topes de comisión.
- **Snapshot de las comisiones de DeFindex y `VaultFeeChanged` antes de fondear**; las comisiones nunca bloquean una salida.
- **`claim_after_review_timeout`**: la plataforma no gana nada con su inacción.
- **API que nunca firma**, con el envío patrocinado aislado en `/fianzas/v1/relay`.
- **`501` con `replacement`**: falla de forma segura ante un cambio de semántica.
- **`withdraw` con `min = 0`**: la vivacidad pesa más que la protección contra la pérdida, con el matiz de N-6 para mainnet.

---

## 11. Requisitos de pruebas para QA

### 11.1 Pruebas que incluir
- [ ] Todos los tests **[H]** de las § 9.1–9.4 y § 12.9 en verde en la CI.
- [ ] Script de interfaz cerrada del wasm del escrow y de la factory (CT-17).
- [ ] Hash del wasm de `main` = el de `escrowWasmHashesAllowed` (build reproducible).
- [ ] AC-11 ampliado: grep del bundle con valores señuelo en `RELAYER_API_KEY`, `RAMP_FAUCET_SECRET` y `API_KEYS_JSON`.
- [ ] e2e en testnet a través de la API: camino feliz, parada (`stop_justified` `true` y `false`), timeout y revisión vencida, verificando los saldos contra `fz_settle` y `fz_bond`.
- [ ] e2e: `mock-vault` sin reserva → mensaje de liquidez y reintento correcto tras `fund.mjs`.
- [ ] e2e: subir la comisión del mock tras crear → `fund` falla con `VaultFeeChanged` y la UI lo explica; bajarla → `fund` funciona.
- [ ] e2e: `escrow-js` con `baseUrl` apuntando a nuestra API: `fund` y `approve-milestones` funcionan, `dispute` y `resolve-dispute` dan 501 (Q-27).
- [ ] Prueba manual de N-10: un proxy local que reescribe la respuesta de `/fianzas/v1/...` para apuntar a una instancia falsa → la wallet lanza `AUTH_MISMATCH`.
- [ ] Prueba manual de N-11: un proxy añade `setOptions` al XDR de `resolve` → el backoffice lo rechaza antes de abrir Freighter.
- [ ] `/i/[id]#c=…`: tras cargar, `location.hash === ""` y ninguna URL de red contiene el código.
- [ ] Cabeceras CSP, `frame-ancestors`, `Referrer-Policy` y `nosniff` en las dos apps.
- [ ] Backoffice con una cuenta que no es staff: no muestra acciones, y si se fuerza, la cadena lo rechaza (AC-12).

### 11.2 Lista OWASP Top 10 (2021)
- [ ] **A01 Control de acceso roto:** **núcleo**. § 9.1 `auth.rs`, § 9.2 admin y `register_tenant`, lista blanca del Relayer y de `send-transaction`, alcance de las keys.
- [ ] **A02 Fallos criptográficos:** `getRandomValues` para invitación y nonce, compromisos con sal, keys de 256 bits con comparación en tiempo constante, *payload* de firma calculado en local.
- [ ] **A03 Inyección:** XSS (WEB-5), XDR malformado (400 sin traza), `zod` estricto, inyección de plantillas en la CI (HAR-4).
- [ ] **A04 Diseño inseguro:** **núcleo**. Bordes temporales, vivacidad (CT-5), pagos *push*, confianza en la API (N-10, N-11), conflicto de interés del bond y admin (N-12, N-14).
- [ ] **A05 Configuración insegura:** CSP, `NEXT_PUBLIC_`, secretos en las previews de Vercel, CORS, `.claude/settings.json`, protección de rama y `vault_manager = None` solo en testnet.
- [ ] **A06 Componentes vulnerables:** fork de TW sin auditar, Next/React/Hono, acciones sin fijar. `pnpm audit` y `cargo audit`.
- [ ] **A07 Fallos de identificación y autenticación:** `rpId` exacto, expiración de firmas, API keys y staff de una sola clave [M].
- [ ] **A08 Fallos de integridad de software y datos:** el wasm de `contractimport!` compilado en la misma ejecución, build reproducible, anclas empaquetadas, bindings generados, CI que ejecuta el script del harness del propio PR (HAR-1).
- [ ] **A09 Fallos de registro y monitorización:** eventos en cada cambio de estado, logs sin PII (DAT-6), [M] monitor de `f_*`, de las comisiones y roles del vault y del gasto del Relayer.
- [ ] **A10 SSRF:** CS-1 y el test `outbound_fetch_allowlist`.

---

## 12. Depósito de buena fe al parar (*stop bond*)

### 12.1 Decisiones del equipo y efecto
| Decisión | Efecto |
|---|---|
| Solo el casero para (`stop(reason_hash)`) | Desaparece el *griefing* del inquilino. Su protección es el timeout. La UI quita "tengo un problema" y explica el plazo. El proceso off-chain del perito tiene que escuchar al inquilino (política). |
| Bond = `min(max(stop_bond_min, amount × stop_bond_bps / 10000), amount)`, calculado por la factory y fijado en `Terms.stop_bond` | Disuasión con tope en el principal. El casero lo ve al crear y el inquilino al aceptar. |
| El staff decide `stop_justified` de forma explícita en `resolve` | Se evita la "deducción simbólica de 1 unidad", pero aparece un conflicto de interés (12.3). |
| **Q-21 cerrada:** el bond perdido va a la tesorería y se destina a pagar al perito | Es la fuente del conflicto. Se mitiga en 12.3. La alternativa de enviarlo al inquilino (OC-8) quedó **descartada** por el equipo (`DECISIONS.md`). |

### 12.2 Importe y calibración
- Límites de la configuración: `stop_bond_bps ≤ 2000` y `0 ≤ stop_bond_min ≤ MAX_AMOUNT`. Valores de demo: 500 bps y 10 USDC (`100_000_000`).
- **Calibración:**
  - Demasiado bajo (por debajo del coste del perito): parar sin motivo sale barato y la tesorería paga el perito.
  - Demasiado alto: impide disputas legítimas por daños pequeños.
  - Regla: `stop_bond_min ≈ coste medio del perito` y bps bajos. En mainnet se calibra con datos reales. Es inmutable por fianza y la configuración solo afecta a las nuevas.
- El casero necesita el bond en su cuenta. En la demo, `fund.mjs` o el ramp fondean las smart accounts de los caseros. La UI comprueba el saldo antes de pedir la passkey; si no llega, `InsufficientBond`.

### 12.3 Conflicto de interés: el staff decide y la tesorería cobra
**Análisis.** En cada parada, el resultado para la plataforma es `−coste del perito + (bond si "injustificada")`, y quien decide es su propio staff. El único perjudicado por una decisión injustificada es el casero: el inquilino recibe la deducción 0. La colusión contraria (staff y casero) no empeora con el bond: el riesgo de deducción hasta el 100 % existía ya antes.

**Exigible on-chain**
| # | Regla | Estado en la arquitectura | Cuándo |
|---|---|---|---|
| OC-1 | `resolve` exige `report_hash`; reasignar al perito lo borra | Incluido | H |
| OC-2 | `!stop_justified ⇒ deduction == 0` (`IncoherentResolution`), sobre la deducción **recibida**. La combinación `true` con 0 sí se permite, porque va contra el interés de la plataforma | Incluido (y la API lo rechaza antes de simular) | H |
| OC-3 | Destinos fijos del bond (`landlord` o `treasury` de `Terms`); el bond nunca pasa por `split` ni por el vault | Incluido | H |
| OC-4 | Evento público `fz_bond {to, amount, justified}` en la misma transacción que `fz_settle` y `fz_report` | Incluido | H |
| OC-5 | La plataforma no gana nada con su inacción: con `claim_after_review_timeout`, el bond vuelve al casero | **Incluido en la hackatón** (C-7) | H |
| OC-6 | Veredicto firmado por el perito: `assign_expert(resolver, expert: Address, expert_ref)` y `record_report(expert, report_hash, justified, max_deduction)` con `expert.require_auth()`; `resolve` debe coincidir con el veredicto | No | M |
| OC-7 | Staff 2 de 3 en multisig: cualquier `resolve` necesita dos personas | No (1–3 resolvers independientes) | M |

**Política y transparencia** (no exigibles en la cadena)
- **P-1.** Criterios públicos de "parada justificada", mostrados al casero antes de parar junto al importe del bond.
- **P-2.** Contabilidad del bond como fondo para peritos (Q-21). Publicar periódicamente, a partir de los eventos, la tasa de paradas justificadas, la deducción media y los bonds cobrados frente al coste de los peritos.
- **P-3.** El casero recibe el informe y la motivación, y hay un recurso off-chain que revisa otra persona del staff.
- **P-4.** Las condiciones del casero divulgan el conflicto ("si la parada no está justificada, el depósito pasa a la plataforma para pagar al perito").
- **P-5.** La retribución del staff no depende de los bonds cobrados.

### 12.4 Interacciones
- **`DeadlinePassed`** se comprueba antes de cobrar el bond. Todo es atómico.
- **`AlreadyApproved`:** el casero que aprobó no para y no se le cobra.
- **`cancel`:** solo en `Proposed`, donde no hay bond.
- **Pausa:** `stop` **no** se bloquea, porque si no, el casero perdería su derecho a disputar si el plazo vence durante la pausa.
- **`claim_after_timeout`:** solo en `Active`; con el bond retenido la fianza está en `Stopped`/`UnderReview`.
- **Bordes de revisión:** `resolve ⇔ now ≤ review_deadline` y `claim_after_review_timeout ⇔ now > review_deadline`.
- **Pérdida del vault:** no afecta al bond (que es líquido).
- **`NoYield`:** el bond comparte saldo con el principal, de ahí CT-16.
- **`Settled`:** terminal, con `bond_held = 0`.

### 12.5 Bond atrapado
- El staff ausente ya está resuelto (OC-5).
- Si se archiva el saldo del SAC, se restaura.
- Sin `sweep`, el bond no puede acabar en otro sitio.

### 12.6 Trustlines y pagos que revierten
- Si el pago del bond al casero o a la tesorería revierte, revierte **todo** `resolve`, y el principal del inquilino queda bloqueado con él.
  - [H]: el casero es una C-address y la trustline de la tesorería está verificada.
  - [M]: `Owed` también para el bond (CT-11).
- Orden: `withdraw` → `split` → escribir `Settled`, `bond_held = 0` y `stop_justified` → pagos de `Settlement` → pago del bond → eventos.

### 12.7 Contabilidad separada
- El bond nunca va al vault. Su único registro es `Dispute.bond_held`, y se mide por diferencia al cobrarlo.
- `total` se mide justo alrededor del `withdraw` (o es `terms.amount` en `NoYield`), así que el bond no lo contamina.
- Invariante: `balance(escrow) ≥ bond_held + (NoYield ∧ no liquidada ? amount : 0)`.

### 12.8 Interfaz (ya en la arquitectura § 6.2)
- `stop(reason_hash)`: solo `terms.landlord`, con el `transfer` del bond anidado.
- `resolve(resolver, deduction, stop_justified) -> Settlement`.
- `Terms.stop_bond` y `Dispute { bond_held, stop_justified, stopped_ts, … }`.
- Eventos `fz_stop {landlord, reason_hash, bond}` y `fz_bond {to, amount, justified: Option<bool>}`.
- Errores `IncoherentResolution = 15`, `InsufficientBond = 16`, `ReviewDeadlinePassed = 20` y `ReviewTimeoutNotReached = 19`.
- **Sin cambios adicionales de seguridad.**

### 12.9 Tests del bond (`cargo test -p escrow`, `tests/stop_bond.rs`)
| Test | Escenario | P. |
|---|---|---|
| `stop_bond_fixed_in_terms` | `get_terms().stop_bond` igual al bond cobrado | H |
| `stop_bond_min_bps_and_cap` | (factory) importe pequeño → mínimo; grande → bps; mínimo > importe → importe | H |
| `stop_charges_bond_from_landlord` | L −bond; escrow +bond; `bond_held == bond`; las shares del vault sin cambios | H |
| `stop_bond_auth_tree_is_exact` | `env.auths()` de L = `stop` con una única subinvocación `transfer(L, E, bond)` | H |
| `stop_without_bond_balance_fails` | `InsufficientBond`; sigue `Active` | H |
| `stop_after_deadline_or_approval_charges_nothing` | `DeadlinePassed` o `AlreadyApproved`; saldo de L intacto | H |
| `pause_does_not_block_stop` | Factory en pausa → `stop` funciona | H |
| `resolve_justified_returns_bond` | `resolve(S, X, true)` → L recibe `X + parte + bond`; `fz_bond {to: L, justified: Some(true)}` | H |
| `resolve_unjustified_forfeits_bond_to_treasury` | `resolve(S, 0, false)` → treasury recibe `fee + bond`; T recibe el principal y su parte | H |
| `resolve_unjustified_with_deduction_fails` | `resolve(S, 1, false)` → `IncoherentResolution`; nada cambia | H |
| `resolve_justified_with_zero_deduction_allowed` | El bond va a L y T recibe todo el principal | H |
| `review_timeout_returns_bond_to_landlord` | `claim_after_review_timeout` → bond a L, `justified: None` y deducción 0 | H |
| `bond_outside_split` | Mismo `Settlement` con y sin bond; el fee no se aplica al bond | H |
| `bond_survives_vault_total_loss` | El vault devuelve 0 → el bond se paga entero | H |
| `noyield_bond_not_mixed_with_principal` | `NoYield` + bond → `total == amount` y el bond aparte | H |
| `escrow_balance_covers_held_bond` | `balance(escrow) ≥ bond_held + principal NoYield` en cada estado | H |
| `bond_paid_once` | Tras liquidar, `bond_held == 0`; un 2.º `resolve` → `BadStatus` | H |
| `expert_verdict_binds_resolve` | Veredicto firmado → `resolve` incoherente falla | M |
| `unpayable_landlord_bond_goes_to_owed` | El bond queda en `Owed` y el inquilino cobra | M |

---

## 13. Gestión de secretos

| Secreto | Dónde | Quién | Nunca |
|---|---|---|---|
| `RELAYER_API_KEY` | `apps/web/.env.local` (desarrollo) y Vercel *Production* como *Sensitive* | P2 (la API), P3 | Repo, `NEXT_PUBLIC_*`, previews, logs |
| `RAMP_FAUCET_SECRET` | Igual | P2, P3 | Igual; reutilizarla en otro rol |
| `API_KEYS_JSON` (solo hashes) | Vercel *Production* | P2 | Secretos en claro; repo |
| Identidades del CLI (`fianzas-deployer`, `-admin`, `-staff`, `-treasury`, `-faucet`) | Stellar CLI en la máquina de P2, con `--secure-store` si la versión lo soporta | P2 | Archivos del repo, `.env*`, chats |
| Clave de staff en Freighter | Perfil de navegador dedicado | Operador del backoffice | Navegador personal con otras extensiones |

- **[SEC-1] [H]** Una identidad por rol. El faucet con saldo acotado. La tesorería solo recibe en la demo.
- **[SEC-2] [H]** `.env.example` (área `harness`, con lock) con nombres sin valores: `RELAYER_URL`, `RELAYER_API_KEY`, `RAMP_FAUCET_SECRET`, `RAMP_ENABLED`, `SOROBAN_RPC_URL`, `NETWORK_PASSPHRASE`, `API_KEYS_JSON`, `BLEND_POOL_RPC`, `NEXT_PUBLIC_RP_ID` y `NEXT_PUBLIC_USE_FAKES`. **Hoy le faltan seis**: `RAMP_FAUCET_SECRET`, `RAMP_ENABLED`, `API_KEYS_JSON`, `BLEND_POOL_RPC`, `NEXT_PUBLIC_RP_ID` y `NEXT_PUBLIC_USE_FAKES`.
- **[SEC-3] [H]** Vercel: secretos solo en *Production*. Las previews usan `NEXT_PUBLIC_USE_FAKES=1` o una key de Channels distinta y de cupo bajo, con *Deployment Protection*. **Una preview tiene toda la API**, y una rama maliciosa podría exfiltrar los secretos si los tuviera.
- **[SEC-4] [H]** Rotación:
  - Relayer: key nueva y actualizar Vercel.
  - Faucet: mover el saldo, crear una identidad nueva y actualizar `deployments.faucet`.
  - API key de un integrador: quitarla de `API_KEYS_JSON` y redesplegar.
  - **Admin de la factory:** no hay función para cambiar el admin. Si se compromete, se pausa con la propia clave (si aún se tiene), se despliega una factory nueva y se actualiza `deployments`. Las fianzas existentes no se ven afectadas. [M] `set_admin` con *timelock* o admin multisig desde el inicio.
  - **Staff:** el snapshot por fianza hace que la clave antigua siga valiendo en las fianzas existentes (R-9). Mitigación: 1–3 resolvers y `review_timeout`. [M] smart account con rotación de firmantes.
- **[SEC-5] [H]** *Secret scanning* y *push protection* de GitHub, y en la CI gitleaks o el grep `S[A-Z2-7]{55}`.
- **[SEC-6] [M]** Admin, staff y manager de los vaults en multisig, tesorería en frío, KMS o gestor de secretos con rotación, y ninguna clave de testnet en mainnet.

---

## 14. Revisión del harness (Claude Code, git hooks y CI)

El harness sirve para **coordinar**. Las barreras reales están en el servidor: protección de rama, revisión y CI. Respecto a la revisión anterior, `harness/team.json` añade el área `factory` y da dueño a `.gitignore`, `.gitattributes`, `.env.example`, `tsconfig.base.json`, `.npmrc`, `.cargo/**`, `NOTICE.md` y `.kiro/**` (interfaces, con lock). El resto del harness **no ha cambiado**, así que los hallazgos siguen abiertos.

| # | Hueco | Sev. | Arreglo |
|---|---|---|---|
| HAR-1 | El job `harness` de la CI ejecuta el `check-ownership.mjs` y el `team.json` **del propio PR**, que así puede reescribir las reglas que lo juzgan | Media | Checkout de la base y `fetch` del head con `HEAD_SHA` por entorno |
| HAR-2 | Los checks obligatorios se identifican por nombre: un PR que edite `ci.yml` puede suplantarlos | Media | Revisión obligatoria de `.github/**` y `scripts/harness/**` por P2, o *required workflows* |
| HAR-3 | `dismiss_stale_reviews: false` en `init-github.mjs` | Media | `true` + `require_last_push_approval: true` (obligatorio antes de mainnet) |
| HAR-4 | `${{ github.base_ref }}` interpolado en un `run:` | Baja | Pasarlo por `env` |
| HAR-5 | PRs desde forks: `pull_request` con permisos de solo lectura (bien), pero ejecutan código del PR | Baja | Nunca `pull_request_target`; aprobación de workflows para colaboradores externos; `GITHUB_TOKEN` en *read*; Actions sin permiso para aprobar PRs |
| HAR-6 | Acciones fijadas por etiqueta | Media | Fijarlas por SHA |
| HAR-7 | `.claude/settings.json` solo deniega `.env.local`. Quedan abiertos `.env`, `.env.*.local`, `.env.production`, `~/.config/stellar/**`, `./.stellar/**` y `stellar keys show/secret`. Las reglas de `Read` no cubren Bash | **Alta** | Ampliar `deny` (esas rutas, `Bash(stellar keys show:*)` y `Bash(stellar keys secret:*)`), `ask` para `Bash(stellar contract invoke:*)`, `deploy` y `keys`, y activar el sandbox (`"sandbox": {"enabled": true}`) |
| HAR-8 | Bypass del push: `git push --no-verify`, refspecs `HEAD:refs/heads/main` y `+HEAD:main` | Media | Más `deny` (`Bash(git push --no-verify:*)`, `Bash(git -c:*)`…); la barrera real es `enforce_admins: true`, que hay que **verificar** tras `init-github.mjs` |
| HAR-9 | `gh api` sin restringir: P2 es admin del repositorio y podría borrar la protección de `main` | Media | `deny` para `Bash(gh api:*)`, `gh pr merge`, `gh repo edit/delete`, `gh secret`, `gh workflow` y `gh ruleset` |
| HAR-10 | El guard solo cubre Edit/Write; se salta con Bash, `HARNESS_ROLE` o `disableAllHooks` | Baja | Documentarlo como barrera de coordinación; la CI (con HAR-1) es el respaldo |
| HAR-11 | Archivos de raíz sin área: **todavía** `.nvmrc`, `vercel.json` (puede reescribir rutas o cabeceras de seguridad y exponer funciones) y `.vscode/**` | Media | `deps` += `.nvmrc` y `vercel.json`; `harness` += `.vscode/**` |
| HAR-12 | La etiqueta `cross-area` la puede poner el propio autor | Baja | Aceptado; la revisión humana es el control |
| HAR-13 | El hook `format.mjs` ejecuta binarios de `node_modules` y `rustfmt` | Baja | Cubierto por los lockfiles y `rust-toolchain.toml` con lock |
| HAR-14 | No hay job de seguridad en la CI | Media | Job `security`: gitleaks (bloqueante), AC-11 con valores señuelo (bloqueante), interfaz cerrada de los wasm (bloqueante), hash reproducible del wasm, `pnpm audit` y `cargo audit` (informativos) |
| **HAR-15** | **No hay área `api`**: `apps/api/**` queda sin dueño (el guard y la CI lo dejan pasar) y el montaje `apps/web/app/api/[[...path]]/route.ts` cae en `web` (P4), en contra de `CLAUDE.md` | **Media** | `{ "id": "api", "owner": "P2", "paths": ["apps/api/**", "apps/web/app/api/**"], "scopes": ["api"] }` **antes** de `web`; scope `api` en `commitTypes`/scopes; `sync-codeowners` |
| **HAR-16** | La CI tiene que compilar el wasm del escrow antes de `cargo test -p factory` (`contractimport!`). Un artefacto o una caché de otra rama podrían incrustar un wasm que nadie ha revisado | Baja | Compilar en el mismo job; no usar artefactos entre workflows; `rust-cache` solo para dependencias |
| **HAR-17** | `.kiro/**` está ahora en el área compartida `interfaces` (con lock). Los agentes de la pipeline que escriben en `.kiro/pipeline/` lo hacen fuera del flujo de lock | Baja | Aceptado para la pipeline previa a la hackatón; durante ella, `.kiro` solo cambia con `/lock interfaces` |

Lo que está **bien**: permisos mínimos en el workflow; `PR_TITLE`, `HEAD_REF` y `PR_AUTHOR` pasados por `env`; `enforce_admins: true`; solo *squash*; sin *force push*; `pre-push` contra la reescritura de historia; `.gitignore` con `.env*`, `.stellar/` y `*.wasm`; `settings.local.json` fuera de git; y las áreas nuevas de `team.json`.

---

## 15. Cambios propuestos a `docs/INTERFACES.md` por seguridad

INTERFACES se genera desde la § 6 de `architecture.md`. Abajo va la sección de INTERFACES (y entre paréntesis la de arquitectura) junto con el cambio. Todos son **[G1]** salvo que se indique otra cosa.

| INTERFACES § (arq. §) | Cambio | Tipo | Req. |
|---|---|---|---|
| § 2 Escrow (6.2), `settle`/Reparto | Escribir: "`NoYield ⇒ total = terms.amount`, **nunca** `balance(escrow)`". Invariante en reposo con `≥` | Semántica | CT-16 |
| § 2 (6.2), `fund_escrow` | Añadir a las precondiciones: Δ`token.balance(escrow) == −amount` durante el depósito, y `target ≤ approvers.len()` tras añadir al inquilino | Semántica | CT-8, § 4.3 |
| § 2 (6.2), `fz_settle` | Explicitar que `vault_fees_at_settle` se obtiene con `try_` y que su fallo **no** revierte (ya lo indica; añadir test) | Doc | CT-10 |
| § 2 (6.2), lista de funciones | Nota: "el wasm expone **solo** estas funciones; lo comprueba la CI" | Doc | CT-17 |
| § 3 Factory (6.3), `FianzaParams` | += `expected_config_version: u32` | **Rompe** | FAC-6 |
| § 3 (6.3), funciones | += `config_version() -> u32`; `ConfigVersion` sube en cada `set_*`, `add_strategy`, `set_strategy_enabled` y `set_default_strategy` | Aditivo | FAC-6 |
| § 3 (6.3), `Created` y `f_created` | += `wasm_hash: BytesN<32>` | **Rompe** | FAC-4, N-12 |
| § 3 (6.3), `FactoryError` | += `ConfigChanged = 21` | Aditivo | FAC-6 |
| § 3 (6.3), `create_fianza` | Salt: `sha256(landlord.to_xdr() ‖ nonce)` con función única compartida con `predict_address`; `NonceUsed` comprobado con `IdOf(predicted)`; el nonce lo genera el cliente. **Corregir** la § 2, el diagrama de la § 8.4 y la § 9, que dicen `salt = id` | Doc + corrección | FAC-3, N-21 |
| § 3 (6.3), `create_fianza` y `funding_allowed` | Volver a comprobar `vault.get_fees().0 ≤ max_vault_fee_bps` y, si `vault_manager = Some(m)`, `vault.get_manager() == m` (fail-closed; solo en la entrada) | Semántica | FAC-8 |
| § 3 (6.3), `set_config` / `GlobalConfig` | `token` **inmutable** desde el constructor (`InvalidConfig` si cambia) | Semántica | IV-3, N-18 |
| § 3 (6.3), notas | La factory no tiene `upgrade` ni edición de estrategias o mapeos | Doc | FAC-1 |
| § 4 Reparto (6.4) | Invariante de 4 términos con la matemática segura de TW; el bond fuera; `NoYield` con `total = amount` | Doc | CT-3, CT-16 |
| § 5 Vault (6.5) | Requisitos del registro: el script verifica una sola estrategia, el wasm oficial y **si es *upgradable***, y lo anota en DECISIONS | Doc | VLT-1 |
| § 6 deployments (6.6) | `factory`, `token`, `escrowWasmHashesAllowed`, `strategies[].vault` y `smartAccount` son **anclas de confianza empaquetadas en el build**; no se descargan ni se toman de la API | Semántica | WEB-2, N-10 |
| § 7/§ 8 Wallet (6.7) | `signAndSendBuilt`: verificación independiente (RPC propia + anclas), *payload* de firma calculado en local, `validUntilLedger ≤ latest + 60` con el `latest` leído por el cliente, raíz escrow con `id_of` **y** wasm permitido, `strategy.vault ∈ deployments`. `AUTH_MISMATCH` también para el XDR de cuentas G (guardia WEB-15). Actualizar la § 8 de INTERFACES, que todavía muestra la interfaz `Wallet` antigua (sin `signAndSendBuilt`, `SignPhase` ni `address`) | Semántica + corrección | WEB-3, WEB-15 |
| § 7 Paquetes TS (6.7) y § 8.2, `RelayPolicy` | `fixedContracts = { [factory]: ["create_fianza"] }` (sin `create_fianzas_batch`); += `maxRequestsPerMinutePerCredential` y `maxCreatesPerDayPerLandlord`; `Origin` obligatorio | **Rompe** (tipo) | N-3, SRV-6 |
| API (tabla de la 6.8.9, nueva sección de INTERFACES) | `POST /stellar/send-transaction`: "solo una operación `InvokeHostFunction` con raíz = factory o escrow registrado con wasm permitido; si no, `403 FZ_TX_NOT_ALLOWED`; nunca patrocina" | Semántica | API-11, N-13 |
| API | `/fianzas/v1/fianzas/batch` solo con K **y sin Relayer** (fee propio) | Semántica | N-3 |
| API | `approve-milestones` y `approve-and-release-milestones`: `extensions.settles: true` cuando completan el quórum | Aditivo | API-16 |
| API | Respuestas de build: "una operación, `timeBounds ≤ 300 s`, árbol de auth exacto (§ 6.7)". `validUntilLedger` es informativo: lo valida el cliente | Doc | API-1, API-2 |
| API | `x-api-key` solo en la cabecera; sin acceso a `/relay` ni `/ramp`; `scope=mine` solo en lecturas | Doc | AUTH-9, AUTHZ-8 |
| API | Límites: lecturas 120/min por IP; builds 30/min por IP y 10/min por `signer`; semáforo de RPC; caché acotada | Doc | API-5, API-6 |
| API | `GET /escrows/{contractId}/events`: rango acotado y página ≤ 100; solo contratos registrados | Doc | API-8 |
| Arquitectura § 5, `core/escrow.rs` | **Corregir** "guarda en instance storage" por "persistent `DataKey::Escrow` + TTL de la instancia" (C-19) | Corrección | N-21 |
| Arquitectura § 12, R-13 | **Corregir** el invariante a `≥` | Corrección | CT-16 |
| [M] | `Owed` + `withdraw_owed`, `claim_*` con consentimiento del inquilino ante pérdida, invitación ed25519, veredicto firmado por el perito, *timelock* del admin, `extend_ttl(ids)` en la factory y mínimos de plazos de mainnet | Rompe | Redespliegue de mainnet |

---

## 16. Notas para el agente de desarrollo

**Por rol**
- **P1 · escrow y factory**
  - Recorta el fork con `// FIANZAS:` en cada cambio y la cabecera de origen.
  - Fragmentos 1–5 de la § 8.1.
  - Arranca con todos los tests de las § 9.1, § 9.2 y § 12.9 vacíos (`todo!()`) desde el arranque para ver los huecos.
  - `evil_vault.rs` y `fake_factory.rs` son obligatorios.
  - Script de interfaz cerrada de los dos wasm.
  - Checklist de H22: `contracts/escrow/CLAUDE.md` + § 4.3 + CT-16 + FAC-3/5/6/8.
- **P2 · DeFi, infra y API**
  - `mock-vault` con `get_fees`/`set_fees`/`get_manager` y el patrón de `transfer` exacto.
  - Verificación del vault de testnet (VLT-1, incluido el flag *upgradable*).
  - Trustlines de la tesorería y del receptor de TW.
  - API con API-1…API-16 y los tests de la § 9.3.
  - `deploy.mjs` registra el hash del wasm compilado desde el commit revisado.
  - PRs de harness: HAR-1, 3, 4, 6, 7, 8, 9, 11, 14 y **15**.
- **P3 · wallet y anchor**
  - `signAndSendBuilt` con WEB-3 completo (fragmento 6) y los tests de la § 9.4.
  - `RelayPolicy` con N-3.
  - Ramp con SRV-10…SRV-15.
  - Confirma en el spike cómo despliega smart-account-kit y ajusta `createContractWasmHashes` o la *factory*.
- **P4 · apps**
  - Guardia de XDR del backoffice (fragmento 7, WEB-15).
  - CSP (fragmento 9).
  - Pantalla de aceptación con WEB-11 (comisiones con su base, "vault de terceros" y APY "variable").
  - Nunca comisiones desde la forma TW.
  - Sin analítica.
  - Compromisos con sal en el backoffice.
  - Textos de error de WEB-13.

**Checklist de revisión de cada PR**
1. ¿`require_auth` sobre la dirección almacenada correcta y antes de escribir?
2. ¿Se valida el estado almacenado? ¿Hay alguna fianza con fondos sin camino de salida, o algún camino de salida que llame a la factory?
3. ¿Hay algún pago fuera de `settle`/`pay_bond`, a destinos que no salen de `Terms`, antes de escribir `Settled`, o con importe 0?
4. ¿`total` se mide por diferencia alrededor del `withdraw`, o es `terms.amount` en `NoYield`?
5. ¿Matemática segura en todo? ¿Algún `unwrap`? ¿Algún `mock_all_auths` en un test de auth o de vault?
6. ¿Sobrevive alguna función del upstream? ¿Se ha cambiado alguna firma sin pasar por INTERFACES?
7. ¿El cliente firma algo sin verificarlo contra la RPC propia y las anclas empaquetadas? ¿El backoffice firma XDR sin la guardia?
8. ¿La API registra cuerpos, keys o PII? ¿Algún error filtra internos? ¿Alguna ruta además de `/relay` llama a Channels? ¿`send-transaction` acepta contratos ajenos?
9. ¿Algún secreto con `NEXT_PUBLIC_` o en un módulo de cliente?
10. ¿Se toca `.github/**`, `scripts/harness/**`, `harness/**`, `.claude/**`, `vercel.json` o un archivo sin área? Revisión explícita de P2.


---

# Anexo A · Revisión de la arquitectura v2 (Ricardo, PR #2)

> Conservada tal cual del PR #2 (`d5b962d`). Sus cambios a `docs/INTERFACES.md` (N-1, N-2, N-4, WEB-14…) ya están aplicados. Si algo contradice el informe v3 de arriba, manda el informe v3; los hallazgos N-* siguen vigentes salvo que el v3 diga lo contrario.

## A. Revisión de la arquitectura v2 (fork de Trustless Work + `FianzaFactory`)

> Revisión del 2026-10-25 sobre `.kiro/pipeline/architecture.md` (v2) y `docs/INTERFACES.md` (borrador v2).
> Verificado contra el upstream: la rama `single-release-develop-v2` de `Trustless-Work/trustlesswork-smart-contract-stellar` apunta a `1d22d0c1b9c5788f4fd7184e42024bbe10303756` (2026-09-29, PR #122, `soroban-sdk 28.0.0`), el repositorio no declara licencia (`license: null`) y la lista de entrypoints públicos de `contracts/escrow/src/contract.rs` en ese commit es la que recoge N-2.
> **Esta sección prevalece sobre las secciones 1–12 donde choquen.** Todo lo que no se menciona aquí sigue vigente con la traducción de 13.1.

### A.1 Equivalencias con las secciones anteriores

| Secciones 1–12 (singleton) | Arquitectura v2 |
|---|---|
| `propose(landlord, …)` | `factory.create_fianza(landlord, FianzaParams)` |
| `accept_and_fund(id, tenant, code)` | `escrow.fund_escrow(tenant, invite_code, expected_terms)` |
| `stop(id, reason_hash)` | `escrow.stop(reason_hash)` |
| `assign_expert(id, …)`, `record_report(id, …)`, `resolve(id, …)` | Las mismas, sin `id` y con `resolver` como primer argumento, que debe pertenecer a `terms.dispute_resolvers` |
| `pause`/`unpause` en el escrow | En la factory (bloquea `create_*` y, vía `funding_allowed`, `fund_escrow`) |
| `Config` inmutable en el constructor | `GlobalConfig` en la factory, copiada a `Terms` en cada fianza (inmutable) |
| `get(id)`, `get_many(ids)` | `escrow.get_view()`, `factory.get_fianzas(ids)` |
| `Deposit` | `Escrow` |
| Errores 18, 19 y 20 | `InvalidParty = 14`, `IncoherentResolution = 15`, `InsufficientBond = 16` (enum `EscrowError`) |
| `yield-adapter` entre escrow y vault | Llamada directa al vault de DeFindex. CT-9 se aplica a `mock-vault` |
| `claim_after_review_timeout` [M] | **[H]** (cierra CT-6 y OC-5 en la hackatón) |

**Nivel de riesgo:** sin cambios (ALTO para el diseño, MEDIO para la hackatón). Un contrato por fianza elimina el *honeypot* del singleton (6.1 #12 baja a **Baja**), pero aparecen superficies nuevas: el admin de la factory, las direcciones dinámicas, las llamadas escrow → factory y un fork sin auditar.

### A.2 Respuesta a los riesgos R-1…R-16 de la arquitectura

| # | Veredicto | Requisito o acción | Cuándo |
|---|---|---|---|
| R-1 Fork sin auditar | Aceptado en la hackatón | Cabecera de origen y `// FIANZAS:` en cada cambio, para que el diff con el upstream sea revisable. Tests de las secciones 5 y 12.9 adaptados más los de 13.5. Nunca citar la auditoría de TW (4.2 #12) | H / auditoría del fork y la factory: M |
| R-2 Poder del admin de la factory | Aceptado con controles | Eventos `f_wasm`/`f_strategy`/`f_config`, listas permitidas en `deployments` y **WEB-14** (13.4): el front compara los `Terms` con `deployments` antes de dejar fondear | H / timelock y multisig: M |
| R-3 Instancias falsas del escrow | Correcto | El enlace lleva el `id`; la dirección sale **solo** de `factory.escrow_of(id)` (WEB-2). El Relayer comprueba wasm **y** registro. Test `register_tenant_rejects_impostor` | H |
| R-4 Callback `register_tenant` | Correcto | `escrow_of(id).require_auth()` solo pasa si ese escrow es el **invocador directo**. Ningún argumento lleva la dirección del escrow | H |
| R-5 Confianza en el vault de DeFindex | Aceptado en testnet | `scripts/` verifica wasm oficial, una sola estrategia, managers y fees, y la UI lo divulga. Antes de mainnet hay que **verificar en el código de DeFindex** a dónde pueden mover fondos `rescue` y `upgrade` | H (script) / M |
| R-6 Iliquidez o pérdida en Blend | Aceptado | Mensaje claro y reintento (WEB-13); tests `illiquid_vault_reverts_and_keeps_state` y `claim_retry_after_liquidity_returns` sobre `fund_escrow`/`approve_release`/`claim_after_timeout` | H / pago parcial u `Owed`: M |
| R-7 Suplantación de eventos | Correcto | El feed solo acepta eventos cuyo `contractId` sea la factory o un `escrow_of(id)`; `id_of` se cachea | H |
| R-8 Destino del fee de TW | Correcto | Con `tw_fee_bps = 0` no hay transferencia (CT-1: nunca se transfiere 0). Si se activa: receptor obligatorio en el constructor y trustline verificada por `fund.mjs` | H |
| R-9 Snapshot del staff | Aceptado | Rotar una clave de staff comprometida **no** protege las fianzas existentes. La salida es `review_timeout` (ahora [H]) y 1–3 resolvers | H / staff multisig: M |
| R-10 Guard de reentrada eliminado | Aprobado | Soroban impide volver a entrar en un contrato que ya está en la pila de llamadas. Se mantiene el orden de CT-1 (escribir `Settled` antes de pagar) | H |
| R-11 Auth del vault | Correcto | Fragmento 1 de 4.1 con `vault.balance(escrow)` en lugar de `shares_of`, y `deposit(..., amounts_min = [amount], ...)`. Tests de `vault_auth.rs` sobre `fund_escrow`, sin `mock_all_auths` | H |
| R-12 Presupuesto | Correcto | Medir en el spike el coste de `create_fianza` (despliegue) y de `fund_escrow` con `invest = true`. Ver N-3 | H |
| R-13 Bond | Correcto | Sección 12 completa. Invariante por instancia: `balance(escrow) == bond_held + (amount si NoYield y no liquidada) + donaciones` | H |
| R-15 Regulación | Aceptado (fuera de la hackatón) | Ningún texto dice "sin riesgo" ni "garantizado"; el rendimiento es "variable". MiCA art. 50 y custodia quedan para la revisión legal | H (textos) / M |
| R-16 Registro de estrategias y RWA | Correcto, con un matiz | Ver N-4 sobre `asset_name`. Una estrategia desactivada no bloquea salidas (test `disabled_strategy_blocks_fund_not_exits`) | H |

### A.3 Hallazgos nuevos

| # | Problema | Severidad | Recomendación | Cuándo |
|---|---|---|---|---|
| N-1 | Si `register_tenant` o `funding_allowed` fallan dentro de `fund_escrow`, la transacción revierte con un error **de la factory** (`Error(Contract, #8)` es `NotEscrow` en la factory y `VaultError` en el escrow). El cliente traduciría mal el error. | **Media** | El escrow llama a la factory con `try_` y convierte cualquier error en `EscrowError::FactoryCall = 24`. `funding_allowed == false` sigue siendo `Paused` | H [G1] |
| N-2 | **Superficie del wasm.** El upstream en `1d22d0c` expone `tw_new_single_release_escrow`, `initialize_escrow`, `update_escrow`, `manage_milestones`, `release_funds`, `change_milestone_status`, `approve_milestones`, `approve_and_release_milestones`, `resolve_dispute` (reparto libre con `Map`), `dispute_escrow`, `withdraw_remaining_funds`, `extend_contract_ttl(admin, …)`, `get_escrow_by_contract_id` y `get_multiple_escrow_balances`. Si alguna sobrevive al recorte, devuelve poderes al admin o permite pagar a terceros. Además, la caché del Relayer por dirección (arquitectura § 8.2) solo es válida porque el escrow no tiene upgrade. | **Alta** | Regla: el wasm del escrow exporta **exactamente** las funciones de INTERFACES § 2. Comprobación automática en `scripts/` o en la CI: `stellar contract info interface --wasm <escrow.wasm>` comparado con la lista. Ninguna función de upgrade | H [G1] |
| N-3 | El Relayer paga los **despliegues** de `create_fianza`, que cuestan más que una invocación, y `create_fianzas_batch` despliega hasta 10 contratos por petición. Es la forma más barata de agotar el cupo de Channels (V10). | **Media** | En la `RelayPolicy`: `create_fianzas_batch` **fuera** de `fixedContracts` en la demo (se hace por script si hace falta) y un tope propio de `create_fianza` por dirección de credencial (por ejemplo, 5 por hora) además de SRV-6 | H [G1 § 8] |
| N-4 | `asset_name` se presenta como antifalsificación, pero `name()` solo es fiable en un SAC: un contrato SEP-41 cualquiera puede devolver `"USDC:G…"`. El control real es `asset == config.token`. | **Baja** | Corregir el comentario en INTERFACES. `deploy.mjs` comprueba que `config.token` es el SAC del emisor oficial (`Asset(code, issuer).contractId(passphrase)`) | H |
| N-5 | Con `NoYield`, el principal, el bond y cualquier donación comparten el saldo del escrow. Si `settle` usara `balance(escrow)` como `total`, el inquilino cobraría el bond o las donaciones. | **Media** | `NoYield` ⇒ `total = terms.amount`, **nunca** el saldo. El bond se paga solo desde `bond_held`. Test `noyield_ignores_donation_and_bond` | H |
| N-6 | `withdraw(shares, [0], escrow)` en los caminos **sin permisos** (`claim_after_timeout`, `claim_after_review_timeout`): cualquiera elige el momento de liquidar, y una bajada temporal del precio de la share se acepta sin aviso. Con Blend Fixed (el `b_rate` solo baja con mala deuda) el riesgo es bajo. | **Baja** | Hackatón: se mantiene `0` (prima la salida) y `fz_settle` publica `total`. [M]: en los caminos que inicia una parte, `min_amounts_out = preview × (1 − tolerancia)`; solo los *claims* usan `0` | H (documentar) / M |
| N-7 | Todo el `Escrow` vive en **instance storage**: si la instancia se archiva, fallan todas las llamadas (también los *claims*) hasta restaurarla. En la factory, si se archiva `Escrow(id)`, el front y el Relayer no pueden validar el escrow y `register_tenant` falla al fondear. Las salidas no dependen de la factory. | **Baja** (hackatón) / **Media** (mainnet) | `instance().extend_ttl` en **cada** escritura del escrow y `extend_ttl` en cada escritura persistente de la factory (CT-12). `extend_contract_ttl()` sin permisos. El cliente aplica la restauración que devuelva la simulación. [M]: *keeper* | H / M |
| N-8 | La factory compila los tipos del escrow con `contractimport!`. Si el wasm subido (`escrowWasmHash`) no es el mismo que el importado (build desactualizado), `EscrowInit` puede codificarse distinto y `create_fianza` falla al desplegar o, peor, interpreta mal los campos. | **Media** | `deploy.mjs` sube **el mismo archivo** que importa la factory y comprueba `hash == factory.escrow_wasm_hash()`. Los tests de la factory usan `upload_contract_wasm` con el wasm importado | H |
| N-9 | La pantalla de aceptación muestra los `Terms` de la cadena (WEB-11), pero el inquilino no sabe si `treasury`, `dispute_resolvers` y `strategy.vault` son los de la plataforma. Un `set_config` erróneo o un admin comprometido pasarían desapercibidos. | **Media** | **WEB-14** (13.4) | H |

### A.4 Requisitos actualizados

Sustituyen a los de la sección 3 donde choquen.

- **[AUTH-1 v2] [H]** `require_auth` exactamente sobre:
  - `factory.create_fianza` y `create_fianzas_batch`: `landlord`.
  - `escrow.cancel` y `escrow.stop`: `terms.landlord` almacenado.
  - `escrow.fund_escrow`: `tenant` (argumento), validado después contra el inquilino fijado o la invitación.
  - `escrow.approve_release`: `approver`, que debe ser `terms.landlord` o el `tenant` almacenado.
  - `assign_expert`, `record_report` y `resolve`: `resolver`, que debe pertenecer a `terms.dispute_resolvers` **almacenado** (`NotResolver`).
  - Funciones de admin de la factory: el `admin` almacenado.
  - `factory.register_tenant`: `escrow_of(id)` (invocador directo).
  - `claim_after_timeout`, `claim_after_review_timeout` y `extend_contract_ttl`: ninguna.
- **[AUTHZ-1 v2] [H]** Ninguna función cambia `Terms` después del constructor. El admin de la factory solo afecta a fianzas **nuevas**. El staff solo puede deducir hasta `amount` a favor de `terms.landlord`, y el bond solo va a `terms.landlord` o `terms.treasury`.
- **[AUTHZ-2 v2] [H]** La pausa vive en la factory y solo bloquea `create_*` y `fund_escrow`. Nunca bloquea `cancel`, `approve_release`, `stop`, `assign_expert`, `record_report`, `resolve`, los *claims* ni `extend_contract_ttl`. **Las salidas del escrow no llaman a la factory.**
- **[AUTHZ-4 v2] [H]** `InvalidParty` en la factory (`create_fianza`) y en el escrow (`fund_escrow`), con el conjunto `{staff/dispute_resolvers, treasury, factory, el propio escrow, vault, token, tw_fee_receiver}`.
- **[IV-1/IV-2 v2] [H]** Las validaciones de importe, plazo, bps y vinculación se hacen en `create_fianza` (con su error tipado) y se repiten en el constructor del escrow como defensa en profundidad (`panic_with_error!`).
- **[CT-6 v2] [H]** `claim_after_review_timeout` entra en la hackatón con bordes complementarios a `resolve` (`now ≤ review_deadline` frente a `now > review_deadline`).
- **[CT-14 v2] [M]** Sustituye al requisito del singleton: tope de TVL por estrategia (`max_tvl`), auditoría del fork y de la factory, y timelock y multisig del admin.
- **[SRV-2/SRV-5 v2] [H]** La lista blanca es la `RelayPolicy` de INTERFACES § 8 (dirección fija de la factory más escrows por wasm hash **y** registro), con N-3.
- **[WEB-3 v2] [H]** La raíz del árbol de auth es la factory o un escrow con `factory.id_of(addr)` válido. Subinvocaciones esperadas: ninguna, salvo `fund_escrow` (`token.transfer(tenant, escrow, terms.amount)`) y `stop` (`token.transfer(landlord, escrow, terms.stop_bond)`).
- **[WEB-11 v2] [H]** La pantalla de aceptación resuelve la dirección con `factory.escrow_of(id)` y muestra importe, `end_ts`, `timeout_at`, `review_timeout_secs`, `tenant_yield_bps`, `platform_fee_bps`, `stop_bond`, la estrategia con su `RiskTier` y quién resuelve, leyéndolo **solo** de `get_terms()`.
- **[WEB-14] [H] (nuevo)** Antes de pedir la passkey para `fund_escrow`, el front comprueba que `terms.factory == deployments.factory`, `terms.treasury == deployments.treasury`, `terms.dispute_resolvers ⊆ deployments.staff`, `terms.strategy.vault` (si existe) está en `deployments.strategies` `terms.tw_fee_bps == deployments.twFeeBps` y `terms.tenant_yield_bps == deployments.tenantYieldBps` (#16). Si algo no coincide, no deja fondear y muestra "Estas condiciones no coinciden con las de la plataforma".

### A.5 Tests nuevos

Prioridad [H] salvo indicación. Se suman a las secciones 5 y 12.9, que se adaptan a los nombres de 13.1.

**`contracts/factory/src/tests/`**

| Test | Escenario |
|---|---|
| `create_requires_landlord_auth` | Sin auth del casero → falla; `count()` no cambia |
| `create_validates_params` | Un caso por error: `InvalidAmount`, `InvalidEndTs`, `InvalidInvite` (ninguno o los dos), `InvalidParty`, `SameParty`, `StrategyNotFound`, `StrategyDisabled`, `Paused` |
| `create_snapshots_config` | `set_config` después de crear → `get_terms()` de la fianza existente no cambia; una fianza nueva sí recibe la configuración nueva |
| `set_wasm_hash_only_affects_new` | Las fianzas existentes conservan su wasm; las nuevas usan el nuevo |
| `deploy_is_deterministic_and_constructor_runs_once` | `escrow_of(id)` coincide con la dirección derivada de `salt = id`; volver a invocar `__constructor` falla |
| `register_tenant_rejects_impostor` | Una instancia del mismo wasm desplegada fuera de la factory, otro contrato y una cuenta de usuario llaman a `register_tenant` → `NotEscrow` o fallo de auth |
| `register_tenant_only_once` | Segundo registro → `AlreadyRegistered` |
| `admin_functions_require_admin` | `set_config`, `set_escrow_wasm_hash`, `add_strategy`, `set_strategy_enabled`, `set_default_strategy`, `pause` y `unpause` firmados por staff, casero o inquilino → fallo de auth |
| `add_strategy_validations` | `asset ≠ token`, `vault ∈ {token, factory, treasury, staff}`, `NoYield` con `risk ≠ NoYield`, `DeFindexVault` sin vault, id repetido y más de 10 → error; toda estrategia nueva entra con `enabled = false` |
| `cannot_disable_default_strategy` | Desactivar la estrategia por defecto sin cambiarla antes → error |
| `disabled_strategy_blocks_fund_not_exits` | Fianza creada, estrategia desactivada → `fund_escrow` da `Paused`; en otra fianza ya fondeada, `approve_release` ×2 y los *claims* funcionan |
| `pause_blocks_create_and_fund_never_exits` | Igual que `pause_never_blocks_exits` (sección 5), con la pausa en la factory |
| `indexes_paginate_and_cap` | `list_by_landlord` y `list_by_tenant` respetan `start`/`limit`; `limit > MAX_PAGE` → error |
| `get_fianzas_makes_no_vault_calls` | Con un vault que hace panic en cualquier llamada, `get_fianzas` devuelve las vistas |
| `batch_is_atomic` **[Could]** | Un item inválido en el lote → no se despliega ninguno |

**`contracts/escrow/src/tests/`**

| Test | Escenario |
|---|---|
| `fund_rejects_terms_mismatch` | `expected_terms` con un solo campo distinto (uno por campo: importe, `end_ts`, bps, estrategia, tesorería, resolvers) → `TermsMismatch`; el saldo del inquilino no cambia |
| `fund_maps_factory_failure` | Factory de prueba que falla en `register_tenant` → `FactoryCall` (N-1) |
| `exits_never_call_factory` | Tras fondear, se sustituye la factory por una que hace panic: `approve_release`, `stop`, `assign_expert`, `record_report`, `resolve` y los dos *claims* funcionan |
| `noyield_ignores_donation_and_bond` | `NoYield` con una donación y un bond retenido → `Settlement.total == amount`; el bond va solo a su destino (N-5) |
| `review_deadline_borders` | En `review_deadline` exacto: `resolve` funciona y `claim_after_review_timeout` da `ReviewTimeoutNotReached`; un segundo después, al revés |
| `review_timeout_returns_bond_and_principal` | `claim_after_review_timeout` → inquilino con deducción 0, bond al casero, `stop_justified == None` |
| `resolver_not_in_terms_rejected` | Un staff añadido con `set_config` **después** de crear la fianza intenta `assign_expert` → `NotResolver` |
| `quorum_with_contract_accounts` | Casero e inquilino como cuentas contrato con `__check_auth` real: liquida solo en la segunda aprobación; la misma parte dos veces → `AlreadyApproved` |
| `tw_fee_matrix` | `tw_fee_bps ∈ {0, 30}`; con `30` y sin receptor, el constructor falla; con `0` no hay transferencia al receptor |

**Comprobación fuera de `cargo test`:** `scripts/` (P2) compara `stellar contract info interface --wasm <escrow.wasm>` con la lista de INTERFACES § 2 y falla si sobra o falta alguna función (N-2). `deploy.mjs` verifica el hash del wasm (N-8) y el SAC del token (N-4).

### A.6 Cambios a `docs/INTERFACES.md`

Aplicados en el mismo PR que esta sección:

| § | Cambio | Tipo | Origen |
|---|---|---|---|
| 2 | `EscrowError` += `FactoryCall = 24`; `fund_escrow` llama a la factory con `try_` | aditivo (error) + semántica | N-1 |
| 2 | Regla de superficie: el wasm exporta exactamente las funciones de la tabla | semántica | N-2 |
| 2 | Comentario de `Strategy.asset_name` corregido | documentación | N-4 |
| 1 | Paso 3 de la vinculación: comprobación WEB-14 antes de firmar | semántica (front) | N-9 |
| 7 | Referencias cruzadas corregidas (wallet § 8, anchor § 9, presets § 10) | documentación | — |
| 8 | `WalletErrorCode` mínimo, reglas de firma y `RelayPolicy` con los topes de N-3 | aditivo + semántica | WEB-3, AUTH-5, AUTH-6, N-3 |
| 9 | Restricciones del ramp simulado | semántica | SRV-10…SRV-15 |

### A.7 Notas por rol

- **P1:** N-1, N-2 (recorte completo del upstream), N-5, N-7 y N-8 en los tests de la factory. Los tests de 13.5.
- **P2:** comprobación de la superficie del wasm (N-2), SAC del token (N-4) y hash del wasm (N-8) en `scripts/`; trustlines de `treasury` y del receptor del fee de TW; verificación off-chain de cada estrategia antes de `add_strategy`.
- **P3:** `RelayPolicy` con N-3, verificación de wasm **y** registro con caché por dirección, WEB-3 v2 y los códigos de error de § 8.
- **P4:** WEB-11 v2 y WEB-14 en la aceptación, feed filtrado por `contractId`, texto para `FactoryCall` ("No se ha podido registrar la fianza. Inténtalo de nuevo") y la estrategia con su nivel de riesgo y su APY "variable".
