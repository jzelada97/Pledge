# Informe de análisis de seguridad · Fianzas de habitación en Soroban

> Generado por el agente de seguridad el 2026-10-25 a partir de `.kiro/pipeline/enriched-prompt.md` (v2) y `.kiro/pipeline/architecture.md`.
> Contexto revisado: `CLAUDE.md`, `docs/INTERFACES.md` (versión actual, anterior al diff de G1), `contracts/escrow/CLAUDE.md`, los `CLAUDE.md` de cada área, `harness/team.json`, `.claude/settings.json`, `.claude/hooks/*.mjs`, `.githooks/*`, `scripts/harness/*.mjs`, `.github/workflows/ci.yml`, `.github/CODEOWNERS`, `.gitignore` y `.env.example`.
> El repo solo contiene el harness. No hay código de producto que auditar. La búsqueda de secretos (`S[A-Z2-7]{55}`, claves privadas PEM y API keys) no encontró nada.

**Cómo leer las etiquetas**
- **[H]**: obligatorio en la hackatón (testnet). Sin esto no se llega a G3/G4 o la demo es frágil.
- **[M]**: obligatorio antes de mainnet. En la hackatón se documenta y no se implementa.
- **[G1]**: cambia la interfaz y tiene que entrar en `docs/INTERFACES.md` antes de congelarla (H2).
- Los identificadores `DAT-n` sustituyen al `DP-n` de la plantilla, porque `DP-n` ya significa "decisión provisional" en la spec.

**Decisiones del usuario incorporadas tras la arquitectura** (prevalecen sobre la spec y sobre la arquitectura; análisis completo en la sección 12):
1. **Solo el casero puede parar** (`stop`). El inquilino pierde `stop`; su protección es el timeout. Esto sustituye a [DP-6]/Q-6 y simplifica [AD-5].
2. Parar exige un **depósito de buena fe** (*stop bond*) de `max(stop_bond_min, amount × stop_bond_bps / 10000)`.
3. El staff decide **explícitamente** si la parada estaba justificada: `resolve(id, deduction, stop_justified)`.
4. El bond perdido va a la **tesorería**.

---

## 1. Evaluación del nivel de riesgo

- **Nivel de riesgo global: ALTO** para el diseño (custodia de fondos de terceros en un contrato singleton, invertidos en DeFi, pensado para llegar a mainnet). **MEDIO** para la hackatón: testnet, tokens sin valor y equipo de confianza. Allí el riesgo real es que la demo falle (faucet o Relayer drenados, liquidación bloqueada), no que se pierda dinero.
- **Sensibilidad de los datos**
  - On-chain y públicos: importes, direcciones (C-address de casero e inquilino), fechas, política de reparto y los hashes de motivo, perito, informe e invitación.
  - Off-chain y personales (RGPD): nombre, email, dirección de la habitación, contrato de alquiler, motivo de la parada e informe pericial. En la demo solo hay datos ficticios en `localStorage`.
  - Secretos: `RELAYER_API_KEY`, `RAMP_FAUCET_SECRET` y las identidades del Stellar CLI (deployer, admin, staff, treasury, faucet).
- **Cumplimiento normativo**
  - Hackatón: ninguno exigible (testnet y datos ficticios). Lo simulado se etiqueta (NFR-11).
  - Antes de mainnet, con revisión legal y sin conclusiones en este documento:
    - RGPD + LOPDGDD: base legal, EIPD, derecho de supresión frente a datos inmutables. Ver DAT-3.
    - LAU art. 36 y normativa autonómica de fianzas.
    - **MiCA**: el art. 50 prohíbe a emisores y a proveedores de servicios de criptoactivos conceder intereses ligados a tokens de dinero electrónico, y USDC lo es en la UE. Pagar al inquilino un "rendimiento" sobre USDC custodiado puede chocar con esa regla. También hay que valorar si custodiar y administrar USDC de terceros es un servicio de criptoactivos que exige licencia.
    - PBC/FT (Ley 10/2010) si hay rampa fiat real.

---

## 2. Modelo de amenazas

### 2.1 Activos que proteger

| Activo | Sensibilidad | Impacto si se compromete |
|---|---|---|
| Principal de las fianzas (shares en el adaptador) | Crítica | Pérdida de dinero del inquilino. En un singleton afecta a **todas** las fianzas. |
| Rendimiento acumulado y fee de la plataforma | Alta | Reparto incorrecto o robo del yield |
| Vivacidad de las salidas (`approve_release`, `resolve`, `claim_after_timeout`) | Crítica | Fondos bloqueados aunque no se roben: el inquilino no recupera su fianza |
| Clave de `staff` | Alta | Puede deducir hasta el 100 % del principal a favor del casero en fianzas paradas. No puede enviar fondos a terceros. |
| Clave de `admin` | Media | Solo pausa entradas nuevas (DoS de altas) |
| Smart accounts con passkey de los usuarios | Crítica | Quien firma con la passkey controla la cuenta. Un XSS en el origen del `rpId` permite firmar cualquier cosa. |
| `RELAYER_API_KEY` | Media (testnet) / Alta (mainnet) | Agotar el cupo de Channels; la demo se queda sin fees |
| `RAMP_FAUCET_SECRET` | Baja (testnet) | Drenar el faucet; el inquilino no puede depositar en vivo |
| Identidades del CLI (deployer, admin, staff, treasury) | Alta | Toma de roles del contrato y de la tesorería |
| Datos personales off-chain e informes periciales | Alta (RGPD) | Brecha de datos y sanción |
| Integridad del repo y de la CI | Media | Código malicioso en `main` que acaba en Vercel o en el contrato |

### 2.2 Actores de amenaza
1. **Casero malicioso**: quiere quedarse la fianza o bloquear la salida del inquilino (parar en el último segundo, impedir el pago, abusar del staff).
2. **Inquilino malicioso**: quiere salir sin deducción o hacer *griefing* (parar sin motivo).
3. **Staff comprometido, negligente o ausente**: puede deducir de más o no resolver nunca.
4. **Atacante externo sin cuenta**: abusa de `/api/relay` y `/api/ramp`, intenta XSS o phishing contra las passkeys, o se adelanta a la invitación.
5. **Proveedores comprometidos o con fallos**: vault, pool de Blend, oráculo, RPC público, OZ Channels o un paquete npm/crate.
6. **Colaborador o agente de IA del equipo** que se salta el harness, por error o a propósito: lee secretos o empuja a `main`.
7. **Contribuidor externo** (PR desde un fork) que ejecuta código en la CI.

### 2.3 Vectores de ataque

| # | Vector | Probabilidad | Impacto | Mitigación (requisito) |
|---|---|---|---|---|
| V1 | El casero hace `stop` justo antes de que el inquilino pueda hacer `claim_after_timeout` | Alta | Alto | [AD-4] `DeadlinePassed`. Bordes probados (CT-4) |
| V2 | El casero para y el staff no resuelve nunca (Q-14) | Media | Crítico (fondos sin salida) | [H] guardar `stopped_ts`; [M] plazo de revisión con salida a favor del inquilino (CT-6) |
| V3 | Un receptor no puede cobrar (sin trustline, congelado por el emisor, cuenta fusionada) y bloquea todo el `settle`, incluido el timeout del inquilino | Baja [H] / Media [M] | Crítico | [H] los receptores son C-address y `treasury` tiene trustline verificada; [M] pago *pull* de respaldo (CT-11) |
| V4 | Vault ilíquido o en pausa: `withdraw` revierte | Media (Blend con alta utilización) | Alto (salidas bloqueadas temporalmente) | Atomicidad, reintento y mensaje claro [H]; lista blanca de vaults y topes [M] |
| V5 | Pérdida del vault (oráculo o mala deuda, como el incidente de YieldBlox de feb-2026) | Baja | Alto | `split` con `total < amount`, divulgación al inquilino, pausa de entradas [H]; topes, reserva o seguro [M] |
| V6 | Vault o adaptador malicioso o con fallos: tira más del escrow, devuelve shares falsas o paga menos | Baja | Crítico | `authorize_as_current_contract` exacto; medición por diferencia; adaptador sin poderes de admin sobre fondos (CT-8, CT-9) |
| V7 | `deduction` que revierte por 1 stroop de redondeo o por pérdida, de modo que el staff no puede liquidar | Media | Medio | Recortar la deducción tras el `withdraw` (CT-7) [G1] |
| V8 | `end_ts` enorme: `end_ts + timeout_secs` desborda y `stop` y `claim` dejan de funcionar | Baja | Alto | Tope de `end_ts` en `propose` (IV-2) [G1] |
| V9 | Una parte es la tesorería, el staff, el admin, el propio escrow, el vault o el token | Baja | Medio | `InvalidParty` (AUTHZ-4) [G1] |
| V10 | Abuso del Relayer: spam de `propose` o de cuentas, `token.transfer` patrocinado, credenciales `SOURCE_ACCOUNT` | Alta (endpoint público) | Medio (testnet) / Alto (mainnet) | Política estricta del handler (SRV-1…SRV-9) |
| V11 | Drenaje del faucet del ramp con C-address inventadas | Alta (endpoint público) | Medio (demo rota) | Topes globales, solo smart accounts con nuestro wasm, interruptor (SRV-10…SRV-15) |
| V12 | Un RPC o un bug del cliente hace firmar a la passkey un árbol de auth distinto del que muestra la UI | Baja [H] / Media [M] | Crítico | Verificar el árbol de auth antes de firmar (WEB-3) |
| V13 | XSS en `apps/web`, lo que equivale a firmar con la passkey de la víctima | Baja | Crítico | React sin HTML crudo, CSP con nonce y sin scripts de terceros (WEB-5…WEB-8) |
| V14 | Fuga del código de invitación (fragmento capturado por analítica o por la vista previa de un mensajero) o *front-running* | Baja | Bajo (el atacante bloquea su propio dinero) | Fragmento borrado al leerlo y sin analítica (WEB-10); [M] invitación firmada ed25519 (CT-13) |
| V15 | Página de aceptación que muestra condiciones distintas de las del contrato (enlace manipulado) | Media | Alto | La UI de aceptación lee todo de `get(id)` y nunca de la URL (WEB-11) |
| V16 | Hash del informe o del motivo sin sal: se puede revertir por diccionario y es dato personal inmutable on-chain | Media | Medio (RGPD) | Compromiso `sha256(sal ‖ contenido)` con la sal off-chain (DAT-2, DAT-3) |
| V17 | Entradas archivadas por TTL en fianzas largas | Baja [H] / Media [M] | Medio (hay que restaurar) | `extend_ttl` en cada escritura [H]; *keeper* o `bump` [M] (CT-12) |
| V18 | Un PR modifica el script que lo valida en la CI, o un job con el mismo nombre que el check obligatorio | Media | Medio | Ejecutar el script del harness desde la base y revisar `.github/**` (HAR-1, HAR-2) |
| V19 | Un agente lee las identidades del CLI o `.env.*` vía Bash, o empuja a `main` saltándose los hooks | Media | Alto | Ampliar `deny`, sandbox y protección de rama en el servidor (HAR-5…HAR-9) |
| V20 | Las previews de Vercel reciben `RELAYER_API_KEY` y una rama con código malicioso la exfiltra | Media | Medio | Secretos solo en el entorno *Production* de Vercel (SEC-4) |
| V21 | Paquete npm o crate comprometido (gusano Shai-Hulud de 2025, tj-actions de 2025) | Media | Alto | Lockfile congelado, scripts de instalación bloqueados, acciones fijadas por SHA, auditorías (sección 4.3) |
| V22 | Conflicto de interés del stop bond: el staff de la plataforma declara "injustificada" una parada para que la tesorería se quede el bond | Media | Medio (pérdida del bond del casero y de confianza) | Regla de coherencia on-chain, bond devuelto si el staff no resuelve a tiempo, veredicto firmado por el perito [M], evento público (sección 12) |
| V23 | Casero que para sin motivo para retrasar la devolución o presionar al inquilino | Media | Medio | Bond disuasorio, `DeadlinePassed`, el que aprobó no para (sección 12) |
| V24 | Bond atrapado o pagos que revierten al devolverlo (contabilidad mezclada con el principal) | Baja | Alto | Bond líquido fuera del vault, contabilidad separada e invariante de saldo (sección 12) |

---

## 3. Requisitos de seguridad

### 3.1 Autenticación (AUTH)

- **[AUTH-1] [H]** `require_auth` exactamente sobre estas direcciones (tabla de la arquitectura § 1):
  - `propose` y `cancel`: `landlord`.
  - `accept_and_fund`: `tenant`.
  - `approve_release`: `who`.
  - `stop`: **`landlord` almacenado** (decisión 1). La firma pasa a ser `stop(id, reason_hash)`, sin `who`. El árbol de auth incluye `token.transfer(landlord, escrow, stop_bond)`.
  - `assign_expert`, `record_report` y `resolve`: `staff` de `Config`.
  - `pause` y `unpause`: `admin` de `Config`.
  - `claim_after_timeout`: **ninguna** (sin permisos, [AD-6]).
  Las direcciones de rol se leen **siempre** de storage, nunca de un argumento.
- **[AUTH-2] [H]** `require_auth` se llama **antes** de cualquier escritura o llamada externa del entrypoint. En `approve_release`, `who.require_auth()` va primero y la pertenencia a las partes (`NotParty`) se comprueba después.
- **[AUTH-3] [H]** `claim_after_timeout` no puede depender de quién llama: ningún importe va a `invoker` ni a una dirección pasada por argumento. Solo `tenant`, `landlord` y `treasury` almacenados.
- **[AUTH-4] [H]** `__constructor` es de un solo uso (garantía del protocolo). Hay un test que intenta invocarlo después del despliegue y falla. `AlreadyInitialized = 10` queda reservado.
- **[AUTH-5] [H]** Las firmas de las auth entries de la passkey llevan `signatureExpirationLedger ≤ latestLedger + 60` (unos 5 minutos). Así se limita la ventana en la que una entrada firmada y no enviada sirve para algo.
- **[AUTH-6] [H]** `rpId` fijo e igual al **hostname exacto** del despliegue definitivo, no a un dominio padre, para que un subdominio comprometido no pueda pedir firmas. Las cuentas de demo se crean solo ahí (Q-15). `createWallet` falla si `location.hostname !== cfg.rpId`.
- **[AUTH-7] [M]** Recuperación de la cuenta: segundo firmante (otra passkey o un guardián) en la política del smart account. Sin él, quien pierde el dispositivo pierde también lo que `claim_after_timeout` le envíe.
- **[AUTH-8] [M]** `staff` y `admin` como cuentas multifirma (multisig nativa de Stellar o smart account con política de umbral). Ninguna clave individual basta.

### 3.2 Autorización (AUTHZ)

- **[AUTHZ-1] [H]** Poderes del staff limitados por el contrato:
  - `assign_expert` y `record_report` solo escriben metadatos. No llaman al vault ni al token.
  - `resolve` solo envía `deduction` al `landlord` **almacenado**, con `0 ≤ deduction ≤ amount`. El bond solo puede ir al `landlord` (justificada) o a la `treasury` (injustificada), y `stop_justified = false` exige `deduction == 0` (sección 12).
  - No existe ninguna función que cambie `landlord`, `tenant`, `treasury`, `vault`, `token`, `staff`, `admin`, `platform_fee_bps` ni `timeout_secs` después del constructor.
- **[AUTHZ-2] [H]** El admin solo puede `pause`/`unpause`, y la pausa solo bloquea `propose` y `accept_and_fund`. Hay un test que comprueba que, con la pausa activa, funcionan `cancel`, `approve_release`, `stop`, `assign_expert`, `record_report`, `resolve` y `claim_after_timeout`.
- **[AUTHZ-3] [H]** Máquina de estados: cada entrypoint valida el **estado almacenado** (no el efectivo) antes de actuar. `Settled` y `Cancelled` son terminales: cualquier mutación sobre ellos devuelve `BadStatus`.
- **[AUTHZ-4] [H] [G1]** Partes prohibidas: `propose` rechaza `landlord ∈ {staff, admin, treasury, escrow, vault, token}` y `accept_and_fund` rechaza lo mismo para `tenant`, con el nuevo `Error::InvalidParty = 18`. Evita conflictos de rol (el staff resolviendo su propia fianza) y pagos a contratos que no pueden gastar.
- **[AUTHZ-5] [H] [G1]** Reasignar al perito (`assign_expert` en `UnderReview`) **borra** `report_hash`. Si no, el staff podría resolver citando el informe del perito anterior. `record_report` puede sobrescribir, y cada llamada emite su evento `report` (el historial vive en los eventos).
- **[AUTHZ-6] [H]** Backoffice: el chequeo "cuenta conectada == staff" es solo de UX. La seguridad real es `require_auth` (AC-12), y así se documenta en el código.
- **[AUTHZ-7] [M]** Para limitar al staff comprometido: `resolve` en dos pasos (`propose_resolution` y luego `finalize` tras N días) con una ventana en la que el inquilino puede ver la deducción, o un tope de deducción por fianza (`max_deduction_bps`) fijado al proponer y aceptado por el inquilino.

### 3.3 Protección de datos (DAT)

- **[DAT-1] [H]** On-chain no va ningún dato personal en claro. Solo `BytesN<32>`: `invite_hash`, `reason_hash`, `expert_ref` y `report_hash`.
- **[DAT-2] [H]** Todos los hashes de contenido de baja entropía o personal (`reason_hash`, `expert_ref`, `report_hash`) son **compromisos con sal**: `sha256(sal_32B ‖ contenido)`. La sal es aleatoria por valor y se guarda off-chain junto al contenido. `invite_hash = sha256(code)` sin sal, porque el código ya tiene 256 bits ([AD-3]).
- **[DAT-3] [M]** Borrado criptográfico (RGPD art. 17): borrar la sal y el contenido off-chain hace que el hash on-chain sea imposible de vincular. Se documenta en la EIPD que direcciones, importes y fechas son seudónimos y permanentes.
- **[DAT-4] [H]** El informe pericial no sale del equipo del staff. El hash se calcula con WebCrypto en el navegador y no se sube a ningún servidor ni a la RPC.
- **[DAT-5] [H]** Los datos de demo son ficticios. `localStorage` solo guarda metadatos de demo, la referencia de la cuenta (no es secreta) y los códigos de invitación pendientes del casero.
- **[DAT-6] [H]** Los handlers de servidor no registran el cuerpo de la petición, la IP completa (como mucho truncada o con hash), las direcciones de usuario junto a la IP ni ninguna clave.
- **[DAT-7] [M]** Divulgación al inquilino antes de `accept_and_fund`: el rendimiento no está garantizado, la fianza devuelta puede ser menor si el fondo pierde valor (fórmula vigente de Q-13), y existen el plazo de timeout y el proceso de perito. Se registra la aceptación off-chain.

### 3.4 Validación de entradas (IV)

- **[IV-1] [H]** `propose`:
  - `0 < amount ≤ MAX_AMOUNT`, con `MAX_AMOUNT = 10^15` (10^8 USDC con 7 decimales). Elimina cualquier camino de desbordamiento en `split` y bloquea importes absurdos.
  - `tenant_yield_bps ≤ 10000`.
  - Exactamente uno de `tenant` o `invite_hash` presente.
  - `tenant ≠ landlord`.
- **[IV-2] [H] [G1]** `now < end_ts ≤ now + MAX_TERM_SECS`, con `MAX_TERM_SECS = 3 × 365 × 86400`, devolviendo `InvalidEndTs`. Además, `end_ts.checked_add(timeout_secs)` en todos los usos. Así ni `stop` ni `claim_after_timeout` pueden quedar inutilizables por desbordamiento.
- **[IV-3] [H]** Constructor:
  - `platform_fee_bps ≤ 10000`.
  - `timeout_secs ≥ 60`.
  - `vault.asset() == token`.
  - `staff`, `admin` y `treasury` distintos de `current_contract_address()`.
  - [M] `platform_fee_bps ≤ 5000` y `timeout_secs ≥ 7 días`.
- **[IV-4] [H]** `get_many`: `len ≤ 50` (`TooManyIds`). Los ids inexistentes se omiten sin fallar.
- **[IV-5] [H]** `/api/relay`:
  - Cuerpo `≤ 64 KB`, `Content-Type: application/json` obligatorio y JSON con esquema estricto (`{func: string, auth: string[]}`, sin campos extra).
  - `auth.length ≤ 4`.
  - Fallo al decodificar el XDR → `400`.
- **[IV-6] [H]** `/api/ramp`:
  - `to` válido con `StrKey.isValidContract`.
  - `amount` con la regex `^\d{1,6}(\.\d{1,7})?$`, convertido a stroops con aritmética entera (`BigInt`) y **nunca** con `parseFloat`. `0 < amount ≤ maxAmount`.
- **[IV-7] [H]** Front: el código de invitación del fragmento se valida como base64url de 43 caracteres (32 bytes). Si no es válido, la página no llama al contrato.

### 3.5 Seguridad de las comunicaciones (CS)

- **[CS-1] [H]** Solo HTTPS (Vercel con HSTS). `RELAYER_URL` y `SOROBAN_RPC_URL` salen de variables de entorno del servidor. **Nunca** de la petición (SSRF).
- **[CS-2] [H]** Cabeceras en las dos apps:
  - CSP con nonce (sección 4, WEB-6).
  - `frame-ancestors 'none'`.
  - `Referrer-Policy: no-referrer`.
  - `X-Content-Type-Options: nosniff`.
  - `Permissions-Policy: camera=(), microphone=(), geolocation=(), publickey-credentials-get=(self), publickey-credentials-create=(self)`.
- **[CS-3] [H]** `/api/relay` y `/api/ramp` comprueban que `Origin` sea el propio origen y no emiten cabeceras CORS. No para a `curl`, pero sí el uso desde otras webs.
- **[CS-4] [H]** El límite de ritmo usa la IP que da la plataforma (`x-real-ip` de Vercel o el primer valor de `x-forwarded-for` **puesto por Vercel**). Fuera de Vercel no se confía en `x-forwarded-for`.
- **[CS-5] [M]** RPC propia o de un proveedor con SLA en mainnet. En cualquier caso, el cliente verifica el árbol de auth que devuelve la simulación (WEB-3).

### 3.6 Contrato: lógica y fondos (CT)

- **[CT-1] [H]** Patrón Checks → interacciones medidas → efectos → transferencias → eventos. `settle` es el **único** sitio que paga. Escribe `Settled` y `settlement` antes de cualquier `transfer` y no transfiere importes 0. Soroban impide la reentrada, pero el orden se mantiene para la revisión.
- **[CT-2] [H]** `withdraw` del vault **antes** de calcular el reparto. `total` = balance del token del escrow después − antes, en la misma invocación. Nunca el valor que devuelve el vault. Si `total < 0` (imposible salvo bug), `VaultError`.
- **[CT-3] [H]** `split()` es puro, usa `checked_*` y comprueba el invariante `to_tenant + to_landlord + to_treasury == total` (si falla, `panic!`, porque es un bug). Ningún importe es negativo. El fee se calcula solo sobre `max(total − amount, 0)`.
- **[CT-4] [H]** Bordes temporales coherentes y complementarios:
  - `Ending` ⇔ `Active ∧ now ≥ end_ts`.
  - `stop` permitido ⇔ `now ≤ end_ts + timeout_secs`.
  - `claim_after_timeout` permitido ⇔ `now > end_ts + timeout_secs`.
  Para el mismo `now` no hay ningún instante en que `stop` y `claim` sean posibles a la vez, ni ninguno en que no lo sea ninguno de los dos.
- **[CT-5] [H]** Ningún camino bloquea `claim_after_timeout` después del plazo. `assign_expert`, `record_report` y `resolve` exigen `Stopped`/`UnderReview`, `cancel` exige `Proposed` y `stop` falla con `DeadlinePassed`. Lo cubre un test que lo recorre todo (sección 5).
- **[CT-6] [H → M]** Staff ausente (Q-14).
  - [H] [G1]: `Deposit.stopped_ts: u64` se guarda en `stop`. Cuesta una línea y permite añadir la salida sin cambiar el tipo.
  - [M]: `claim_after_review_timeout(id)` sin permisos. Si `now > stopped_ts + review_timeout_secs` y el estado es `Stopped`/`UnderReview`, liquida con `deduction = 0` (path `ReviewTimeout`).
- **[CT-7] [H] [G1]** Deducción en `resolve`:
  - Antes del `withdraw`: `0 ≤ deduction ≤ amount`. Si no, `InvalidAmount` o `DeductionTooHigh`, y AC-4 se sigue cumpliendo.
  - Después del `withdraw`: `deduction_efectiva = min(deduction, principal_back)`, guardada en `Deposit.deduction` y emitida en `settled`.
  - Motivo: con un vault que devuelve `amount − 1` por redondeo, una deducción del 100 % revertiría y el staff no podría liquidar. El resultado es el mismo que obtendría el staff reintentando con una deducción menor.
- **[CT-8] [H]** Integración con el vault:
  - `authorize_as_current_contract` autoriza **exactamente** `token.transfer(escrow, vault, amount)`, sin subinvocaciones (fragmento en la sección 4.1).
  - Las llamadas al vault van con `try_*` y cualquier error se convierte en `VaultError`.
  - Las shares se miden como diferencia de `shares_of(escrow)`, que debe ser `> 0` e igual al valor devuelto. Si no coincide, `VaultError` y la transacción revierte entera.
- **[CT-9] [H]** Adaptador y mock-vault (P2):
  - El `yield-adapter` **no** tiene funciones de admin que muevan fondos, cambien el vault subyacente ni actualicen el wasm.
  - Su libro de shares es 1:1 con las shares subyacentes recibidas (sin tipo de cambio propio, así que no hay ataque de inflación en el adaptador).
  - Si se despliega un vault DeFindex **nuevo**, `fund.mjs` hace un depósito semilla antes del primer escrow (mitiga el ataque de inflación del primer depositante).
  - `mock-vault` tiene reserva suficiente (si no, `InsufficientReserve` bloquea la liquidación de la demo). `scripts/deploy` se niega a desplegar `mock` si la *passphrase* es la de mainnet.
- **[CT-10] [H]** Lecturas robustas: `accrued_yield`, `get_many` y `preview_settlement` usan `try_preview_redeem`. Si falla, `accrued_yield = 0` y el panel sigue funcionando.
- **[CT-11] [H → M]** Pagos *push*.
  - [H]: los receptores son C-address (smart accounts, que no necesitan trustline en el SAC). `treasury` (G) tiene trustline creada por `fund.mjs` y verificada por `deploy.mjs` antes de dar el entorno por bueno. Con importe 0 no se transfiere.
  - [M]: si un `transfer` falla (`try_transfer`), el importe se acredita en `Owed(id, Address)` y el receptor lo retira después con `withdraw_owed(id, who)` (con `who.require_auth()`). Así un casero congelado, sin trustline o malicioso no bloquea la salida del inquilino. Hay que verificar con un test que el error del SAC es recuperable con `try_`.
- **[CT-12] [H → M]** TTL.
  - [H]: `extend_ttl(threshold ≈ 30 días en ledgers, env.storage().max_ttl())` en cada escritura de `Deposit`, `ByLandlord` y `ByTenant`, y `instance().extend_ttl` en cada llamada que escribe (extiende también el código del contrato).
  - [M]: entrypoint sin permisos `bump(ids: Vec<u64>)` (≤ 50) y un *keeper* que lo llame. El front y el Relayer gestionan la restauración de entradas archivadas (desde el protocolo 23 puede ir en la propia transacción).
- **[CT-13] [M]** Invitación ligada al inquilino: sustituir el preimage de sha256 por un par ed25519 de un solo uso. `propose` guarda `invite_pk`, y `accept_and_fund` recibe `invite_sig` sobre `(escrow, id, tenant)` y lo verifica con `env.crypto().ed25519_verify`. Un atacante que vea la transacción no puede reutilizar la firma con su propia dirección. En la hackatón se acepta el sha256 ([AD-3]); el riesgo es bajo.
- **[CT-14] [M]** Singleton: tope de TVL (`max_total_amount`), auditoría externa del contrato y del adaptador, verificación formal o fuzzing de `split`, y lista blanca de vaults con tope por vault.
- **[CT-15] [H]** Nada de `unwrap()`/`expect()` en los entrypoints. `d.tenant` se lee con `ok_or(Error::BadStatus)`. El único `panic!` permitido es el invariante de `split`.

### 3.7 Servicios de servidor (SRV)

**Relay handler (`@fianzas/wallet/server`)**
- **[SRV-1] [H]** `import "server-only"` en `server/*`. Ninguna variable con secreto lleva el prefijo `NEXT_PUBLIC_`. AC-11: un grep de `.next/static/**` sobre el **valor** de la key y sobre `RELAYER_API_KEY` debe salir vacío. Se ejecuta en la CI con un valor señuelo.
- **[SRV-2] [H]** `func` debe ser `InvokeContract` con contrato y función en la lista blanca, o `CreateContract`/`CreateContractV2` con un wasm hash permitido. Cualquier otro tipo se rechaza. Si smart-account-kit despliega a través de una *factory*, se permite **solo** `factory.<función>` y se elimina `CreateContract` crudo.
- **[SRV-3] [H]** Se rechaza cualquier auth entry con credenciales `SOURCE_ACCOUNT`. Sin esto, la cuenta canal del Relayer firmaría como origen, por ejemplo `accept_and_fund(tenant = cuenta_del_relayer)` o `token.transfer(from = relayer)`.
- **[SRV-4] [H]** Cada auth entry debe tener una `rootInvocation` cuyo `contractFn` sea **idéntico byte a byte** a `func.invokeContract()`. Las entradas que autorizan otras llamadas se rechazan.
- **[SRV-5] [H]** Lista blanca mínima:
  - `escrow`: `propose, cancel, accept_and_fund, approve_release, stop, claim_after_timeout`. Nunca funciones de staff ni de admin.
  - `token.transfer`: **solo** si el anchor real está activo y con `to` dentro de las cuentas de destino del anchor, decodificando los argumentos. Con el ramp simulado (el camino por defecto, [AD-8]), `token.transfer` sale de la lista. Si el "retiro" simulado necesita una transferencia, solo con `to == deployments.faucet`.
- **[SRV-6] [H]** Límites: 30 peticiones/min por IP y 10/min por dirección de credencial (en memoria, como acepta la arquitectura), más un tope global por instancia (por ejemplo 600/h) que devuelve `429`. [M]: almacén compartido (KV), cuota por cuenta y alertas de gasto en Channels.
- **[SRV-7] [H]** El handler no acepta `fee`, `source`, `relayerUrl` ni ningún otro parámetro de red desde el cliente.
- **[SRV-8] [H]** Las respuestas solo llevan `{code}` (y `detail` saneado en `TX_FAILED`, sin trazas ni cuerpos del Relayer que pudieran contener la key).
- **[SRV-9] [M]** El endpoint exige una sesión de usuario (login con email verificado o SEP-10/45) antes de patrocinar fees, y hay un presupuesto diario por cuenta.

**Faucet del ramp simulado (`@fianzas/anchor/server`)**
- **[SRV-10] [H]** `createSimRampHandler` lanza una excepción al construirse si `networkPassphrase === Networks.PUBLIC`. El ramp simulado no puede existir en mainnet.
- **[SRV-11] [H]** Solo admite destinos C-address **que sean smart accounts nuestros**: `getLedgerEntries` de la instancia del contrato y el ejecutable debe ser `smartAccount.accountWasmHash`. Evita drenar el faucet hacia direcciones inventadas.
- **[SRV-12] [H]** Topes: `maxAmount` por petición, `perAddressCap` acumulado, 5 peticiones/h por IP y un **tope global por hora**. Con `RAMP_ENABLED=0` el endpoint devuelve `403` (interruptor para la demo).
- **[SRV-13] [H]** La cuenta faucet es **exclusiva**: no es staff, ni admin, ni treasury, ni deployer. Su saldo está acotado (stock para la demo más un margen) y se repone con `fund.mjs`. Si se filtra, el impacto se limita a ese saldo de testnet.
- **[SRV-14] [H]** El faucet firma una transacción construida en el servidor (`token.transfer(faucet, to, amount)`), con fee pagado por él y número de secuencia leído de la red. Las peticiones se serializan por instancia para evitar `tx_bad_seq`.
- **[SRV-15] [H]** `GET ?id=` solo devuelve `{status}` de ids emitidos por esa instancia. No hay consultas arbitrarias.

### 3.8 Cliente (WEB)

- **[WEB-1] [H]** Los clientes de bindings usan `publicKey = deployments.readSource` para simular. `readSource` nunca firma.
- **[WEB-2] [H]** Todas las direcciones de contratos salen de `@fianzas/deployments`. Nunca de la URL, de `localStorage` ni de una respuesta del servidor.
- **[WEB-3] [H] [G1]** **Lo que ves es lo que firmas.** Antes de pedir la passkey, `signAndSend` decodifica las auth entries de la C-address y comprueba:
  - La raíz es `deployments.escrow` (o el token permitido), con la función y los argumentos esperados.
  - Las subinvocaciones son **exactamente** las esperadas: ninguna, salvo en dos casos. `accept_and_fund` lleva una sola, `token.transfer(tenant, escrow, amount)` con `amount == get(id).amount`. `stop` lleva una sola, `token.transfer(landlord, escrow, bond)` con `bond == get(id).stop_bond`.
  Si no coincide, lanza `WalletError("AUTH_MISMATCH")`, que es un código nuevo, y no firma.
- **[WEB-4] [H]** Nunca se usa `mock_all_auths` en el código ni nada equivalente en TS. El cliente no firma entradas con credenciales de otras direcciones.
- **[WEB-5] [H]** XSS: está prohibido `dangerouslySetInnerHTML`, `eval`, `new Function` y `href`/`src` construidos con datos de usuario o de `localStorage` sin validar el esquema (solo `https:` y rutas relativas). Lo que viene del contrato o de los eventos (direcciones, importes) se renderiza siempre como texto.
- **[WEB-6] [H]** CSP con nonce por petición en el middleware de Next (fragmento en la sección 4.4): `script-src 'self' 'nonce-…' 'strict-dynamic'`, `object-src 'none'`, `base-uri 'none'`, `frame-ancestors 'none'` y `connect-src` limitado a `'self'`, la RPC de Soroban y (en el backoffice) lo que necesite Stellar Wallets Kit.
- **[WEB-7] [H]** Sin scripts de terceros (ni analítica, ni chat, ni Sentry) en `apps/web`. Con un XSS o un script de terceros comprometido en el origen del `rpId`, un atacante puede pedir firmas con la passkey del usuario.
- **[WEB-8] [H]** Next.js y React en la última versión de parche disponible en G0. Como mínimo deben incluir las correcciones de CVE-2025-29927 (bypass del middleware, Next ≥ 15.2.3) y de CVE-2025-55182 (RCE en React Server Components, dic-2025) y sus derivadas (CVE-2025-55183/55184). `pnpm audit --prod` sin críticas en G0.
- **[WEB-9] [H]** Generación de la invitación: `crypto.getRandomValues(new Uint8Array(32))`. **Nunca** `Math.random`. Va en base64url en el fragmento `#c=`.
- **[WEB-10] [H]** En `/i/[id]`, el código se lee de `location.hash`, se guarda en memoria (estado de React) y se borra **en el acto** con `history.replaceState(null, "", location.pathname)`. Nunca se envía a `/api/*`, a logs ni a ninguna analítica.
- **[WEB-11] [H]** La pantalla de aceptación muestra importe, `end_ts`, `tenant_yield_bps`, `platform_fee_bps`, el momento del timeout y el estado leyéndolos **solo** de `get(id)` y `config()`. Ningún dato económico viene de la URL ni de los metadatos de demo. Si `status ≠ Proposed`, se muestra "este enlace ya no es válido".
- **[WEB-12] [H]** Backoffice: Freighter vía Stellar Wallets Kit en un perfil de navegador dedicado. Antes de `resolve`, se muestra `preview_settlement` y el staff confirma en Freighter función y argumentos.
- **[WEB-13] [H]** Traducción de errores: `VaultError` → "El fondo no tiene liquidez ahora mismo. Inténtalo más tarde"; `DeadlinePassed`, `InvalidInvite`, `InvalidParty` y `AUTH_MISMATCH` tienen texto propio. Nunca se muestra la traza.

---

## 4. Guía de código seguro

### 4.1 OBLIGATORIO

1. **Auth exacta para el vault** (CT-8). Nada de comodines.
```rust
use soroban_sdk::{auth::{ContractContext, InvokerContractAuthEntry, SubContractInvocation}, vec, IntoVal, Symbol};

fn deposit_into_vault(env: &Env, cfg: &Config, amount: i128) -> Result<i128, Error> {
    let me = env.current_contract_address();
    let vault = YieldAdapterClient::new(env, &cfg.vault);
    env.authorize_as_current_contract(vec![
        env,
        InvokerContractAuthEntry::Contract(SubContractInvocation {
            context: ContractContext {
                contract: cfg.token.clone(),
                fn_name: Symbol::new(env, "transfer"),
                args: (me.clone(), cfg.vault.clone(), amount).into_val(env),
            },
            sub_invocations: vec![env],
        }),
    ]);
    let before = vault.try_shares_of(&me).map_err(|_| Error::VaultError)?.map_err(|_| Error::VaultError)?;
    let ret = vault.try_deposit(&me, &amount).map_err(|_| Error::VaultError)?.map_err(|_| Error::VaultError)?;
    let after = vault.try_shares_of(&me).map_err(|_| Error::VaultError)?.map_err(|_| Error::VaultError)?;
    let shares = after.checked_sub(before).ok_or(Error::VaultError)?;
    if shares <= 0 || shares != ret { return Err(Error::VaultError); }
    Ok(shares)
}
```

2. **`stop` solo del casero, con plazo, aprobación previa y bond** (CT-4, [AD-4], [AD-5], sección 12).
```rust
pub fn stop(env: Env, id: u64, reason_hash: BytesN<32>) -> Result<(), Error> {
    let cfg = storage::config(&env);
    let mut d = storage::deposit(&env, id)?;                       // NotFound
    d.landlord.require_auth();                                       // solo el casero (decisión 1)
    if d.status != Status::Active { return Err(Error::BadStatus); }
    if d.landlord_approved { return Err(Error::AlreadyApproved); }
    let deadline = d.end_ts.checked_add(cfg.timeout_secs).ok_or(Error::InvalidEndTs)?;
    if env.ledger().timestamp() > deadline { return Err(Error::DeadlinePassed); }
    // bond: fijado en propose (d.stop_bond), líquido en el escrow, NUNCA al vault
    let me = env.current_contract_address();
    let token = token::Client::new(&env, &cfg.token);
    if token.balance(&d.landlord) < d.stop_bond { return Err(Error::InsufficientBond); }
    let before = token.balance(&me);
    if d.stop_bond > 0 { token.transfer(&d.landlord, &me, &d.stop_bond); }
    let got = token.balance(&me).checked_sub(before).ok_or(Error::InvalidAmount)?;
    if got != d.stop_bond { return Err(Error::InvalidAmount); }
    d.bond_held = got;
    d.status = Status::Stopped;
    d.reason_hash = Some(reason_hash.clone());
    d.stopped_ts = env.ledger().timestamp();                        // CT-6
    storage::put_deposit(&env, &d);                                  // + extend_ttl
    events::stopped(&env, id, d.landlord.clone(), reason_hash, got);
    Ok(())
}
```

3. **`settle`: medir, escribir y después pagar** (CT-1, CT-2, CT-7).
```rust
fn settle(env: &Env, cfg: &Config, d: &mut Deposit, deduction: i128, path: SettlePath) -> Result<Settlement, Error> {
    let me = env.current_contract_address();
    let token = token::Client::new(env, &cfg.token);
    let tenant = d.tenant.clone().ok_or(Error::BadStatus)?;
    let before = token.balance(&me);
    YieldAdapterClient::new(env, &cfg.vault)
        .try_withdraw(&me, &d.shares).map_err(|_| Error::VaultError)?.map_err(|_| Error::VaultError)?;
    let total = token.balance(&me).checked_sub(before).ok_or(Error::VaultError)?;
    if total < 0 { return Err(Error::VaultError); }
    let principal_back = core::cmp::min(total, d.amount);
    let deduction = core::cmp::min(deduction, principal_back);       // CT-7 (resolve ya validó ≤ amount)
    let s = split::split(total, d.amount, deduction, cfg.platform_fee_bps, d.tenant_yield_bps)?;
    d.status = Status::Settled;
    d.deduction = deduction;
    d.settlement = Some(s.clone());
    storage::put_deposit(env, d);                                    // efectos ANTES de transferir
    pay(&token, &me, &tenant, s.to_tenant);
    pay(&token, &me, &d.landlord, s.to_landlord);
    pay(&token, &me, &cfg.treasury, s.to_treasury);
    events::settled(env, d.id, s.clone(), path, deduction);
    Ok(s)
}
fn pay(t: &token::Client, from: &Address, to: &Address, amt: i128) { if amt > 0 { t.transfer(from, to, &amt); } }
```

4. **`split` con aritmética comprobada y el resto al inquilino** (CT-3).
```rust
pub fn split(total: i128, amount: i128, deduction: i128, fee_bps: u32, tenant_bps: u32) -> Result<Settlement, Error> {
    if amount <= 0 || total < 0 || deduction < 0 { return Err(Error::InvalidAmount); }
    if fee_bps > 10_000 || tenant_bps > 10_000 { return Err(Error::InvalidBps); }
    let principal_back = total.min(amount);
    if deduction > principal_back { return Err(Error::DeductionTooHigh); }
    let yld = (total - amount).max(0);
    let fee = yld.checked_mul(fee_bps as i128).ok_or(Error::InvalidAmount)? / 10_000;
    let net = yld.checked_sub(fee).ok_or(Error::InvalidAmount)?;
    let landlord_yield = net.checked_mul((10_000 - tenant_bps) as i128).ok_or(Error::InvalidAmount)? / 10_000;
    let tenant_yield = net - landlord_yield;
    let s = Settlement {
        to_tenant: principal_back.checked_sub(deduction).and_then(|x| x.checked_add(tenant_yield)).ok_or(Error::InvalidAmount)?,
        to_landlord: deduction.checked_add(landlord_yield).ok_or(Error::InvalidAmount)?,
        to_treasury: fee,
        yield_total: yld,
    };
    assert!(s.to_tenant + s.to_landlord + s.to_treasury == total, "split invariant");
    Ok(s)
}
```

5. **Storage con TTL en cada escritura** (CT-12).
```rust
const DAY_LEDGERS: u32 = 17_280;
pub fn put_deposit(env: &Env, d: &Deposit) {
    let k = DataKey::Deposit(d.id);
    env.storage().persistent().set(&k, d);
    env.storage().persistent().extend_ttl(&k, 30 * DAY_LEDGERS, env.storage().max_ttl());
    env.storage().instance().extend_ttl(30 * DAY_LEDGERS, env.storage().max_ttl());
}
```

6. **Validación del Relay handler** (SRV-2…SRV-5).
```ts
import "server-only";
import { xdr, Address } from "@stellar/stellar-sdk";

export function validate(funcB64: string, authB64: string[], policy: RelayPolicy): void {
  if (authB64.length > 4) throw new HttpError(400, "BAD_REQUEST");
  const fn = xdr.HostFunction.fromXDR(funcB64, "base64");
  const T = xdr.HostFunctionType;
  if (fn.switch() === T.hostFunctionTypeInvokeContract()) {
    const ic = fn.invokeContract();
    const contract = Address.fromScAddress(ic.contractAddress()).toString();
    const name = ic.functionName().toString();
    if (!policy.contracts[contract]?.includes(name)) throw new HttpError(403, "NOT_ALLOWED");
    if (contract === policy.token && name === "transfer") assertTransferDestination(ic.args(), policy); // SRV-5
  } else if (fn.switch() === T.hostFunctionTypeCreateContractV2() || fn.switch() === T.hostFunctionTypeCreateContract()) {
    assertAllowedWasm(fn, policy.createContractWasmHashes);
  } else throw new HttpError(403, "NOT_ALLOWED");

  for (const b of authB64) {
    const e = xdr.SorobanAuthorizationEntry.fromXDR(b, "base64");
    if (e.credentials().switch() !== xdr.SorobanCredentialsType.sorobanCredentialsAddress())
      throw new HttpError(403, "NOT_ALLOWED");                                  // SRV-3: nada de SOURCE_ACCOUNT
    const root = e.rootInvocation().function();
    if (fn.switch() === T.hostFunctionTypeInvokeContract()) {
      if (root.switch() !== xdr.SorobanAuthorizedFunctionType.sorobanAuthorizedFunctionTypeContractFn()
          || !root.contractFn().toXDR().equals(fn.invokeContract().toXDR()))
        throw new HttpError(403, "NOT_ALLOWED");                                // SRV-4
    }
  }
}
```

7. **Compromiso con sal en el navegador** (DAT-2).
```ts
export async function commit(content: Uint8Array): Promise<{ hash: Uint8Array; salt: Uint8Array }> {
  const salt = crypto.getRandomValues(new Uint8Array(32));
  const buf = new Uint8Array(32 + content.length);
  buf.set(salt, 0); buf.set(content, 32);
  return { hash: new Uint8Array(await crypto.subtle.digest("SHA-256", buf)), salt };
}
```

8. **Invitación** (WEB-9, WEB-10).
```ts
// Casero
const code = crypto.getRandomValues(new Uint8Array(32));
const inviteHash = new Uint8Array(await crypto.subtle.digest("SHA-256", code));
const link = `${origin}/i/${id}#c=${base64url(code)}`;
// Inquilino (/i/[id])
const c = new URLSearchParams(location.hash.slice(1)).get("c");
history.replaceState(null, "", location.pathname);  // el código sale de la barra y del historial
```

9. **CSP con nonce** (WEB-6), en `middleware.ts` de cada app.
```ts
export function middleware(req: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const csp = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data:`,
    `connect-src 'self' https://soroban-testnet.stellar.org`,
    `object-src 'none'`, `base-uri 'none'`, `frame-ancestors 'none'`, `form-action 'self'`,
  ].join("; ");
  const headers = new Headers(req.headers);
  headers.set("x-nonce", nonce);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set("Content-Security-Policy", csp);
  res.headers.set("Referrer-Policy", "no-referrer");
  res.headers.set("X-Content-Type-Options", "nosniff");
  return res;
}
```

10. **Tests de auth sin `mock_all_auths`.** Se usa `env.mock_auths(&[MockAuth { address, invoke: &MockAuthInvoke { … } }])` para el árbol exacto y `env.set_auths` con firmas reales en `contract_account.rs`. Tras cada llamada con éxito se comprueba `env.auths()`.

### 4.2 PROHIBIDO

1. `env.mock_all_auths()` en tests de permisos, de vault o de cuentas contrato. Oculta justo los fallos de auth. Solo se admite en los tests de `split` (que no lo necesitan) y en *fixtures* de lectura.
2. Fiarse del retorno de `vault.deposit` o `vault.withdraw` para importes o shares.
3. Transferir antes de escribir `Settled`. Transferir importes 0. Pagar a una dirección que no sea `tenant`, `landlord` o `treasury` almacenados.
4. Añadir funciones de "rescate", `sweep`, `set_vault`, `set_staff`, `set_treasury`, `upgrade` o equivalentes en el escrow o en el adaptador durante la hackatón. Cualquiera de ellas convierte al admin en dueño de los fondos.
5. Usar `temporary` storage para cualquier cosa ligada a una fianza.
6. `unwrap()`/`expect()` en los entrypoints, y `panic!` salvo el invariante de `split`.
7. Pasar la API key del Relayer o el secreto del faucet al cliente, usar `NEXT_PUBLIC_` con secretos o importar `@fianzas/*/server` desde un componente cliente.
8. Firmar en el cliente auth entries devueltas por la simulación sin verificarlas (WEB-3).
9. `dangerouslySetInnerHTML`, `eval`, scripts de terceros y analítica en `apps/web`.
10. `Math.random` para cualquier valor de seguridad. Hashes de motivo, perito o informe sin sal.
11. Mostrar en la UI de aceptación condiciones económicas que no vengan de `get(id)`/`config()`.
12. Citar la auditoría de Trustless Work (anterior a V2) o insinuar que nuestro contrato está auditado. Presentar el rendimiento como garantizado.
13. Reutilizar en mainnet cualquier clave de testnet, o usar la misma identidad para dos roles (deployer, admin, staff, treasury, faucet).

### 4.3 Seguridad de dependencias

- **Rust**: `soroban-sdk` en la última estable compatible con el protocolo de testnet, fijada con `=x.y.z` en `[workspace.dependencies]`, y `Cargo.lock` commiteado. Sin crates de OpenZeppelin en el escrow ([AD-2]: además del choque de versiones, reduce superficie). Si se usan en `smart-account-kit`, viven en el lado TS y en los wasm ya auditados de la cuenta. `cargo audit` (RustSec) en la CI, sin bloquear en la hackatón y bloqueando en mainnet.
- **npm/pnpm**:
  - `pnpm install --frozen-lockfile` (ya está en la CI).
  - pnpm ≥ 10, que **no ejecuta scripts de instalación** de dependencias salvo los listados en `onlyBuiltDependencies`. La lista se mantiene vacía o mínima.
  - Si la versión lo soporta (≥ 10.16), `minimumReleaseAge: 1440` en `pnpm-workspace.yaml`, para no instalar versiones publicadas hace menos de un día (defensa frente a gusanos como Shai-Hulud, 2025).
  - Versiones exactas (sin `^`) en los paquetes críticos: `@stellar/stellar-sdk`, `smart-account-kit`, `@creit.tech/stellar-wallets-kit`, `@stellar/typescript-wallet-sdk`, `next`, `react`.
  - Antes de añadir cada paquete se verifica el nombre exacto y el repositorio de origen, para evitar *typosquatting*. Es especialmente importante en `smart-account-kit`: confirmar el editor oficial en npm antes de instalar.
- **GitHub Actions**: fijar por **SHA de commit** como mínimo las acciones de terceros (`dtolnay/rust-toolchain`, `Swatinem/rust-cache`, `pnpm/action-setup`). Precedente: tj-actions/changed-files, CVE-2025-30066.
- **Paquetes y versiones a evitar**: Next.js < 15.2.3 (CVE-2025-29927); versiones de Next 15.x/16.x y React 19.x anteriores al parche de CVE-2025-55182/55183/55184; cualquier paquete que no esté en el lockfile revisado.

---

## 5. Tests de seguridad para `cargo test` (P1 los copia tal cual)

Convenciones: entorno sin `mock_all_auths` salvo indicación; `env.ledger().set_timestamp(..)` para el tiempo; `SAC` con `register_stellar_asset_contract_v2`; `mock-vault` como `rlib`. En los tests de vault malicioso se usa un contrato de prueba `EvilVault` dentro de `src/test/evil_vault.rs`, con la misma firma del trait y un comportamiento configurable. Prioridad: **[H]** entra en la hackatón (G4 como tarde) y **[M]** antes de mainnet.

### `test/auth.rs`
| Test | Escenario | Prioridad |
|---|---|---|
| `propose_requires_landlord_auth` | `mock_auths` solo de un tercero → `propose(landlord=L, …)` falla por auth; `count()` no cambia | H |
| `cancel_requires_landlord_auth` | El inquilino y un tercero intentan `cancel` → fallo de auth; el estado sigue en `Proposed` | H |
| `accept_requires_tenant_auth` | Un tercero llama `accept_and_fund(id, T, code)` sin auth de T → falla; el saldo de T no cambia | H |
| `approve_release_rejects_non_party` | Un tercero autorizado como sí mismo → `NotParty` | H |
| `approve_release_requires_who_auth` | `who = L`, pero solo hay auth de T → fallo de auth | H |
| `tenant_cannot_stop` | `stop` con auth solo de T (o de un tercero) → fallo de auth del casero; no se cobra bond | H |
| `staff_functions_reject_parties_and_admin` | `assign_expert`, `record_report` y `resolve` firmados por L, T y admin → fallo de auth (9 casos) | H |
| `pause_and_unpause_require_admin` | staff, L y T intentan `pause`/`unpause` → fallo de auth | H |
| `claim_after_timeout_is_permissionless_and_pays_only_parties` | Sin ninguna auth, un tercero reclama tras el plazo → éxito; el tercero recibe 0; T, L y treasury reciben lo de `split` | H |
| `constructor_cannot_be_called_twice` | `env.try_invoke_contract(escrow, "__constructor", args)` tras desplegar → error | H |
| `config_is_immutable_across_lifecycle` | `config()` antes y después de propose, accept, stop, assign, report, resolve, pause y claim → idéntica | H |
| `accept_auth_tree_is_exact` | Tras `accept_and_fund`, `env.auths()` de T == `accept_and_fund(id,T,code)` con una única subinvocación `token.transfer(T, escrow, amount)` | H |

### `test/vault_auth.rs`
| Test | Escenario | Prioridad |
|---|---|---|
| `vault_deposit_works_with_exact_contract_auth` | Auth real (solo `mock_auths` del árbol de T). El mock-vault recibe exactamente `amount`; shares > 0 | H |
| `evil_vault_cannot_pull_more_than_amount` | `EvilVault.deposit` intenta `transfer(escrow, vault, amount + 1)` → la transacción revierte y T conserva su saldo | H |
| `evil_vault_cannot_redirect_transfer` | `EvilVault.deposit` intenta `transfer(escrow, tercero, amount)` → revierte | H |
| `share_mismatch_reverts` | `EvilVault` devuelve 1000 shares y acredita 10 → `VaultError`; estado `Proposed`; saldo de T intacto | H |
| `zero_shares_reverts` | `EvilVault` acredita 0 shares → `VaultError` | H |
| `settle_uses_token_balance_diff_not_return` | `EvilVault.withdraw` devuelve `2 × X` pero transfiere `X` → `Settlement` suma `X` | H |
| `illiquid_vault_reverts_and_keeps_state` | mock-vault sin reserva → la 2.ª `approve_release` devuelve `VaultError`; sigue `Active` con `tenant_approved == false` si era la de T; tras reponer la reserva, la misma llamada liquida | H |
| `claim_retry_after_liquidity_returns` | Igual que el anterior con `claim_after_timeout` | H |
| `constructor_rejects_vault_with_other_asset` | `vault.asset() ≠ token` → `VaultError` en el despliegue | H |
| `donation_to_escrow_does_not_change_split` | `mint` directo al escrow antes de liquidar → `Settlement` idéntico al caso sin donación | H |
| `reads_survive_vault_preview_failure` | `EvilVault.preview_redeem` hace panic → `accrued_yield == 0` y `get_many` devuelve la vista | H |

### `test/timeout.rs` (máquina de estados y plazos)
| Test | Escenario | Prioridad |
|---|---|---|
| `stop_allowed_at_exact_deadline` | `now = end_ts + timeout` → `stop` funciona | H |
| `stop_fails_one_second_after_deadline` | `now = end_ts + timeout + 1` → `DeadlinePassed`; el saldo de L no cambia (no se cobra bond) | H |
| `claim_fails_at_exact_deadline` | `now = end_ts + timeout` → `TimeoutNotReached`; `+1` → éxito | H |
| `nothing_blocks_claim_after_deadline` | Tras el plazo: `stop` → `DeadlinePassed`; `assign_expert`, `record_report`, `resolve` y `cancel` → `BadStatus`; después `claim_after_timeout` liquida | H |
| `claim_fails_in_non_active_states` | `Proposed`, `Cancelled`, `Stopped`, `UnderReview` y `Settled` → `BadStatus` | H |
| `stop_after_own_approval_fails` | L aprueba y luego L para → `AlreadyApproved`; no se cobra bond | H |
| `landlord_can_stop_after_tenant_approval` | T aprueba y L para → `Stopped` | H |
| `approve_twice_same_party_fails` | → `AlreadyApproved` | H |
| `approve_after_stop_fails` | → `BadStatus` | H |
| `settled_is_terminal` | Tras liquidar: `approve_release`, `stop`, `assign_expert`, `record_report`, `resolve`, `claim_after_timeout` y `cancel` → `BadStatus`; saldos sin cambios | H |
| `ending_is_derived_not_stored` | `now ≥ end_ts` → `get().status == Ending`; el valor almacenado sigue `Active`; `approve_release` funciona | H |
| `propose_rejects_end_ts_beyond_max_term` | `end_ts = now + MAX_TERM_SECS + 1` y `end_ts = u64::MAX` → `InvalidEndTs` | H |
| `accept_after_end_ts_fails` | → `InvalidEndTs` | H |
| `stop_records_stopped_ts` | `stopped_ts == now` tras `stop` | H |
| `review_timeout_releases_to_tenant` | `claim_after_review_timeout` tras `stopped_ts + review_timeout` → T recibe el principal; antes → `TimeoutNotReached` | M |

### `test/stop_resolve.rs` (poder del staff)
Desde la decisión 3, `resolve` lleva un tercer argumento: `resolve(id, deduction, stop_justified)`. En estos tests se usa `true` salvo que se indique otra cosa. Los tests propios del bond están en `test/stop_bond.rs` (sección 12.9).
| Test | Escenario | Prioridad |
|---|---|---|
| `resolve_pays_only_stored_landlord_tenant_treasury` | Saldos de staff, admin y un tercero sin cambios; L = `X + parte`; T = `principal − X + parte` | H |
| `resolve_deduction_above_amount_fails` | `X = amount + 1` → `DeductionTooHigh` (AC-4) | H |
| `resolve_negative_deduction_fails` | `X = −1` → `InvalidAmount` | H |
| `resolve_without_report_fails` | → `ReportMissing` | H |
| `reassign_expert_clears_report` | `assign` → `report` → `assign` (otro perito) → `resolve` → `ReportMissing` | H |
| `resolve_clamps_deduction_on_rounding_loss` | El vault devuelve `amount − 1`; `X = amount` → liquida con `deduction == amount − 1`; T recibe 0 | H |
| `resolve_clamps_deduction_on_total_loss` | `total = 0`, `X > 0` → liquida con todo a 0 y el invariante se cumple | H |
| `staff_metadata_calls_move_no_funds` | `assign_expert` y `record_report` → saldos de token y `shares_of(escrow)` sin cambios | H |
| `staff_cannot_act_on_active_deposit` | `assign_expert` en `Active` → `BadStatus` | H |

### `test/invite.rs`
| Test | Escenario | Prioridad |
|---|---|---|
| `accept_with_wrong_code_fails` | → `InvalidInvite`; saldo de T intacto | H |
| `accept_without_code_when_invite_required_fails` | `invite_code = None` → `InvalidInvite` | H |
| `accept_by_other_address_when_tenant_fixed_fails` | `tenant = Some(T)`; acepta U → `NotParty` | H |
| `landlord_cannot_accept_own_invite` | → `SameParty` | H |
| `invite_cannot_be_reused` | T acepta; U intenta con el mismo código → `BadStatus` | H |
| `propose_requires_exactly_one_binding` | `(None, None)` y `(Some, Some)` → `InvalidInvite` | H |
| `parties_cannot_be_platform_accounts` | L o T ∈ {staff, admin, treasury, escrow, vault, token} → `InvalidParty` | H |
| `cancel_then_accept_fails_without_moving_funds` | L cancela; T acepta → `BadStatus`; saldo de T intacto | H |

### `test/pause.rs`
| Test | Escenario | Prioridad |
|---|---|---|
| `pause_blocks_only_propose_and_accept` | Pausado → `propose` y `accept_and_fund` dan `Paused` | H |
| `pause_never_blocks_exits` | Pausado → `cancel`, `approve_release`×2, `stop`, `assign_expert`, `record_report`, `resolve` y `claim_after_timeout` funcionan (en fianzas distintas) | H |
| `admin_has_no_fund_powers` | El admin intenta `approve_release`, `stop` y `resolve` → `NotParty` o fallo de auth | H |

### `test/split_matrix.rs` (pura, sin `Env`)
| Test | Escenario | Prioridad |
|---|---|---|
| `split_invariant_matrix` | `tenant_bps ∈ {0, 1, 5000, 9999, 10000}` × `fee_bps ∈ {0, 2000, 10000}` × `deduction ∈ {0, 1, amount/2, principal_back}` × `total ∈ {0, amount/2, amount−1, amount, amount+1, amount+3, 2·amount}` → suma == total, sin negativos, `to_treasury == floor(yield·fee/10000)` (AC-1) | H |
| `split_fee_never_touches_principal` | `total ≤ amount` → `to_treasury == 0` (AC-7) | H |
| `split_rounding_remainder_goes_to_tenant` | `yield = 1`, `3`, `7` con `5000` bps → la parte del casero es `floor` y el inquilino recibe el resto | H |
| `split_rejects_invalid_inputs` | `amount ≤ 0`, `total < 0`, `deduction < 0`, bps > 10000 → errores tipados (sin panic) | H |
| `split_extreme_values_no_overflow` | `amount = MAX_AMOUNT`, `total = 2·MAX_AMOUNT`, `fee = 10000` → `Ok` y el invariante se cumple | H |
| `split_pseudorandom_10k` | Generador LCG determinista sin dependencias, 10 000 casos válidos → invariante | H |

### `test/contract_account.rs`
| Test | Escenario | Prioridad |
|---|---|---|
| `full_flow_with_contract_accounts` | L y T son contratos de prueba con `__check_auth` (firmante ed25519), auth real con `set_auths` y entradas firmadas → propose, accept, approve×2 → `Settled` | H |
| `contract_account_bad_signature_rejected` | Firma de otra clave → falla `__check_auth`; estado sin cambios | H |
| `contract_account_expired_signature_rejected` | `signatureExpirationLedger` pasado → falla | H |

### `test/ttl.rs`
| Test | Escenario | Prioridad |
|---|---|---|
| `deposit_ttl_extended_on_every_write` | Tras cada entrypoint que escribe, `get_ttl(Deposit(id)) ≥ threshold` (con `env.as_contract`) | H |
| `indexes_and_instance_ttl_extended` | Igual para `ByLandlord`, `ByTenant` y la instancia | H |
| `bump_extends_ttl_permissionless` | `bump(ids)` sin auth extiende las entradas | M |

### `test/payout.rs`
| Test | Escenario | Prioridad |
|---|---|---|
| `zero_amount_transfers_are_skipped` | `tenant_bps = 10000`: no hay evento de `transfer` al casero | H |
| `known_limitation_unpayable_recipient_blocks_settle` | Emisor con `RevocableFlag`; `set_authorized(L, false)` → `claim_after_timeout` falla. Documenta la limitación de la hackatón (se espera el error) | H |
| `unpayable_recipient_gets_owed_credit` | Lo mismo, pero `claim` liquida; T cobra; `Owed(id, L)` registra la parte de L; L la retira tras reautorizarse | M |

### `test/events.rs`
| Test | Escenario | Prioridad |
|---|---|---|
| `every_state_change_emits_event` | Cada entrypoint mutante emite su evento con topics `(nombre, id)` | H |
| `settled_event_matches_balances` | Los datos de `settled` coinciden con los deltas reales de saldo de T, L y treasury y con `path` | H |

---

## 6. Revisión de seguridad de la arquitectura

### 6.1 Problemas encontrados

Ninguno es **crítico** en el sentido de impedir empezar a desarrollar: la arquitectura ya corrige el fallo grave (carrera stop/timeout, [AD-4]). Los marcados **[G1]** deben entrar en `docs/INTERFACES.md` antes de congelarlo, porque después cuestan un cambio de interfaz.

| # | Problema | Severidad | Recomendación | Cuándo |
|---|---|---|---|---|
| 1 | Sin salida de `Stopped`/`UnderReview` si el staff no actúa o pierde la clave (Q-14). Una parada justo antes del plazo deja la fianza congelada para siempre. | **Alta** | `stopped_ts` ahora; `claim_after_review_timeout` antes de mainnet (CT-6) | H (campo) [G1] / M |
| 2 | Pagos *push*: un receptor que no puede cobrar bloquea **toda** la liquidación, también el timeout del inquilino. Un casero G malicioso puede borrar su trustline cuando la política le da yield > 0. | **Alta** (mainnet) / Baja (hackatón) | Solo C-address y trustline de treasury verificada [H]; pago *pull* `Owed` [M] (CT-11) | H / M |
| 3 | El cliente firma lo que devuelve la simulación de la RPC. WebAuthn no muestra qué se firma, así que la UI es el único "lo que ves es lo que firmas". | **Alta** | Verificar el árbol de auth antes de la passkey y añadir `AUTH_MISMATCH` (WEB-3) | H [G1] |
| 4 | Relayer: `token.transfer` en la lista blanca sin restringir el destino (permite transferencias patrocinadas arbitrarias) y falta vincular `rootInvocation` con `func` | **Media** | SRV-4 y SRV-5: sin `transfer` con el ramp simulado; si lo hay, solo a destinos del anchor | H [G1] |
| 5 | Faucet del ramp: `perAddressCap` en memoria y destinos C inventados, lo que permite drenarlo y romper la demo en vivo | **Media** | Solo smart accounts con nuestro wasm, tope global, interruptor y cuenta exclusiva (SRV-10…SRV-15) | H [G1 § 5b] |
| 6 | `resolve` revierte si `deduction > principal_back` por 1 stroop de redondeo del vault: el staff no puede liquidar el caso límite (deducción total) | **Media** | Recortar tras el `withdraw` (CT-7) | H [G1] |
| 7 | `end_ts` sin tope: `end_ts + timeout_secs` puede desbordar y dejar `stop` y `claim` inservibles | **Media** | `MAX_TERM_SECS` y `checked_add` (IV-2) | H [G1] |
| 8 | Partes = cuentas de la plataforma o contratos del sistema (conflicto de rol; pagos a contratos que no gastan) | **Media** | `InvalidParty = 18` (AUTHZ-4) | H [G1] |
| 9 | Reasignar al perito conserva el informe anterior | **Baja** | Borrar `report_hash` al reasignar (AUTHZ-5) | H [G1] |
| 10 | `report_hash` definido como "SHA-256 del archivo" sin sal: dato personal seudónimo e inmutable | **Media** (RGPD) | Compromiso con sal y borrado criptográfico (DAT-2, DAT-3) | H (sal) / M (EIPD) |
| 11 | Poderes de admin del adaptador real y del mock no especificados (`NotAdmin` aparece en los errores) | **Media** | El adaptador no tiene funciones de admin sobre fondos, ni `set_vault`, ni upgrade (CT-9) | H |
| 12 | Riesgo concentrado en el singleton, sin upgrade (bueno para la confianza, malo para los parches) | **Media** (mainnet) | Tope de TVL, auditoría, lista blanca de vaults; decidir "inmutable + migración" frente a "upgrade con *timelock* y multisig" (CT-14) | M |
| 13 | TTL de fianzas de 12 meses por encima del `max_ttl` de la red | **Baja** (hackatón) / **Media** (mainnet) | `extend_ttl` en cada escritura [H]; `bump` + *keeper* [M] (CT-12) | H / M |
| 14 | *Front-running* del preimage de la invitación | **Baja** | Aceptado en la hackatón; invitación ed25519 [M] (CT-13) | M |
| 15 | El inquilino absorbe la pérdida del vault (Q-13) sin consentimiento informado, y la parte regulatoria del yield sobre USDC (MiCA art. 50) | **Media** (producto y legal) | Divulgación en la aceptación [H en la UI]; decisión de producto y revisión legal [M] | H / M |
| 16 | Previews de Vercel con secretos | **Media** | Secretos solo en *Production* (SEC-4) | H |
| 17 | Staff que paga en XLM desde una cuenta G con Freighter: correcto, pero es una sola clave | **Media** (mainnet) | Multisig (AUTH-8) | M |
| 18 | Stop bond: el staff de la plataforma decide si la parada era justificada y la tesorería cobra el bond si no lo era (conflicto de interés) | **Media** | Coherencia on-chain `!stop_justified ⇒ deduction == 0`, informe obligatorio, evento público y, antes de mainnet, veredicto firmado por el perito y bond devuelto si el staff no resuelve a tiempo (sección 12) | H [G1] / M |
| 19 | Stop bond mezclado con el principal o depositado en el vault, o devuelto por un pago que revierte | **Media** | Bond líquido en el escrow, campo `bond_held`, pago fuera de `split` e invariante de saldo (sección 12) | H [G1] |

### 6.2 Patrones aprobados
- **Opción A** (escrow propio) frente a Trustless Work: `resolve(deduction)` acotado al casero es más seguro que el reparto libre del *dispute resolver* de TW. El pitch **no** cita la auditoría de TW ni insinúa que el contrato esté auditado (§ 1.3 de la arquitectura). Cumple lo pedido por la spec.
- [AD-4] `DeadlinePassed` y [AD-5] "quien aprueba no para": cierran la carrera stop/timeout y el "apruebo y luego bloqueo".
- [AD-6] `claim_after_timeout` sin permisos: no hay vector de robo, porque los destinos son fijos, y mejora la vivacidad.
- [AD-7] `resolve` exige informe.
- [AD-2] Pausa manual que **nunca** bloquea salidas, y admin sin más poderes.
- [AD-3] Invitación de 256 bits en el fragmento.
- [AD-10] Staff fuera del Relayer: mantiene pequeña la lista blanca.
- Núcleo puro `split()` compartido por `settle` y `preview_settlement`, con el invariante comprobado.
- Medición por diferencia de balance en token y shares, y `withdraw` antes de pagar.
- Configuración inmutable tras el constructor (fee, timeout, vault, roles).
- BFF mínimo con `server-only` para los secretos, y lecturas por simulación con una cuenta `readSource` que no firma.
- Identidades del Stellar CLI en vez de claves en archivos del repo ([AD-11]).

---

## 7. Requisitos de pruebas de seguridad (para QA)

### 7.1 Pruebas a incluir
- [ ] Todos los tests de la sección 5 marcados [H] están en verde en `cargo test --workspace` (CI).
- [ ] AC-11: `pnpm build` de `apps/web` con `RELAYER_API_KEY=canary-<uuid>` y `RAMP_FAUCET_SECRET=canary-<uuid>`; `grep -r "canary-" apps/web/.next/static` vacío.
- [ ] `/api/relay` (Vitest con XDR de ejemplo):
  - `func` de un contrato fuera de la lista → 403.
  - Función de staff (`resolve`) → 403.
  - Auth con `SOURCE_ACCOUNT` → 403.
  - Auth cuya `rootInvocation` difiere de `func` → 403.
  - `token.transfer` a un destino no permitido → 403.
  - Cuerpo de 65 KB → 400.
  - 31 peticiones/min → 429.
  - `Origin` ajeno → 403.
- [ ] `/api/ramp`:
  - Destino G → 400.
  - C-address inventada → 403.
  - `amount = "1e3"`, `"-1"`, `"0.00000001"` → 400.
  - Tope por dirección y tope global → 429.
  - `RAMP_ENABLED=0` → 403.
  - Construir el handler con la *passphrase* de mainnet → lanza excepción.
- [ ] `signAndSend` con una simulación manipulada (subinvocación extra `token.transfer(T, X, …)`) → `AUTH_MISMATCH` y la passkey no se invoca.
- [ ] `/i/[id]#c=…`: tras cargar, `location.hash === ""` y no hay peticiones de red que contengan el código (DevTools, pestaña Red).
- [ ] La pantalla de aceptación con el `id` de una fianza de otro importe muestra el importe del contrato, no el de la URL ni el de los metadatos.
- [ ] Cabeceras: `curl -I` de las dos apps muestra CSP con nonce, `frame-ancestors 'none'`, `Referrer-Policy` y `nosniff`. Ningún `<script>` en línea sin nonce.
- [ ] Backoffice: con una cuenta distinta de staff, la UI no muestra acciones y una llamada forzada (por consola o script) falla on-chain (AC-12).
- [ ] e2e en testnet: liquidación con `treasury` sin trustline (en un entorno aparte) falla, y `deploy.mjs` lo detecta antes. Con la trustline, liquida.
- [ ] e2e: vault mock con reserva insuficiente → la UI muestra el mensaje de liquidez y el reintento tras `fund.mjs` funciona.
- [ ] Grep del repo y del historial en busca de secretos Stellar (`S[A-Z2-7]{55}`) y de `RELAYER_API_KEY=` con valor → vacío.

### 7.2 Lista OWASP Top 10 (2021)
- [ ] **A01 Control de acceso roto**: **aplica (núcleo)**. Tests de auth de la sección 5; AC-12; lista blanca del Relayer; staff y admin acotados.
- [ ] **A02 Fallos criptográficos**: **aplica**. Aleatoriedad con `crypto.getRandomValues`; sha256 con sal en compromisos; invitación de 256 bits; nada de `Math.random`. Prueba: revisión de código y test de longitud del código.
- [ ] **A03 Inyección**: **aplica parcialmente**. XSS en React (WEB-5), XDR malformado en los handlers (400 sin trazas), inyección de plantillas en la CI (HAR-4). No hay SQL. Prueba: fuzz del cuerpo del handler y grep de `dangerouslySetInnerHTML`.
- [ ] **A04 Diseño inseguro**: **aplica (núcleo)**. Carrera stop/timeout, staff ausente, pagos *push*, singleton. Prueba: tests de `timeout.rs` y `payout.rs`, y revisión de la sección 6.1.
- [ ] **A05 Configuración insegura**: **aplica**. CSP y cabeceras, variables `NEXT_PUBLIC_`, previews de Vercel con secretos, `.claude/settings.json`, protección de rama. Prueba: `curl -I`, revisión de las variables en Vercel y `gh api …/branches/main/protection`.
- [ ] **A06 Componentes vulnerables**: **aplica**. Next/React (CVE-2025-29927, CVE-2025-55182), acciones sin fijar y paquetes npm. Prueba: `pnpm audit --prod`, `cargo audit` y revisión de versiones en G0.
- [ ] **A07 Fallos de identificación y autenticación**: **aplica**. `rpId` exacto, expiración de firmas, recuperación [M] y staff con una sola clave [M]. Prueba: crear una cuenta en una preview con otro dominio → la passkey no sirve en producción (comportamiento esperado y documentado).
- [ ] **A08 Fallos de integridad de software y datos**: **aplica**. Lockfiles congelados, bindings generados (no a mano), CI que ejecuta el script del harness del propio PR (HAR-1), acciones por SHA. Prueba: PR de prueba que modifica `check-ownership.mjs` → la CI lo detecta tras aplicar HAR-1.
- [ ] **A09 Fallos de registro y monitorización**: **aplica**. Eventos en todos los cambios de estado (test `every_state_change_emits_event`); los handlers registran `code`, contrato y función sin datos personales. [M]: alertas por picos de 403/429 y por gasto del Relayer.
- [ ] **A10 SSRF**: **aplica poco**. Los handlers solo llaman a `RELAYER_URL` y `SOROBAN_RPC_URL` de entorno. Prueba: enviar `relayerUrl` en el cuerpo → se ignora (esquema estricto).

---

## 8. Gestión de secretos

- **[SEC-1] [H] Dónde vive cada secreto**

| Secreto | Dónde | Quién lo tiene | Nunca |
|---|---|---|---|
| `RELAYER_API_KEY` | `apps/web/.env.local` (desarrollo) y Vercel *Production* marcado como *Sensitive* | P3 y P4 | Repo, `NEXT_PUBLIC_*`, previews, logs |
| `RAMP_FAUCET_SECRET` | Igual | P3 y P4 | Igual; reutilizarla en otro rol |
| Identidades `fianzas-deployer`, `-admin`, `-staff`, `-treasury`, `-faucet` | Stellar CLI en la máquina de P2 (y de P1 para pruebas). Usar el almacén seguro del sistema (`--secure-store`) si la versión del CLI lo soporta | P2 | Archivos del repo, `.env*`, chats |
| Clave de staff en Freighter | Perfil de navegador dedicado de quien opera el backoffice | P4 o P2 | Navegador personal con otras extensiones |

- **[SEC-2] [H]** Una identidad por rol, sin reutilizarlas. El faucet tiene saldo acotado. La treasury es solo receptora en la demo.
- **[SEC-3] [H]** `.env.example` lista **nombres** sin valores: `RELAYER_URL`, `RELAYER_API_KEY`, `RAMP_FAUCET_SECRET`, `RAMP_ENABLED`, `SOROBAN_RPC_URL`, `NETWORK_PASSPHRASE`, `NEXT_PUBLIC_RP_ID`, `NEXT_PUBLIC_USE_FAKES` (cambio de harness con `/lock harness`).
- **[SEC-4] [H]** En Vercel, los secretos solo en el entorno **Production**. Las previews funcionan con `NEXT_PUBLIC_USE_FAKES=1` o con una key de Channels distinta y de bajo cupo. Se activa *Deployment Protection* en las previews.
- **[SEC-5] [H]** Plan de rotación (5 minutos):
  - Si se filtra la key del Relayer, se genera otra en `channels.openzeppelin.com/testnet/gen` y se actualiza Vercel.
  - Si se filtra la del faucet, se mueve el saldo a una nueva identidad, se actualizan Vercel y `deployments.faucet`, y se redespliega la app.
  - Si se filtra la de staff o la de admin, hay que **redesplegar el escrow** (los roles son inmutables) y volver a crear el escrow largo. Por eso esas claves no salen de la máquina de P2.
- **[SEC-6] [H]** Activar en GitHub *secret scanning* y *push protection* (gratis en repos públicos) y añadir a la CI un paso de detección de secretos (gitleaks o el grep `S[A-Z2-7]{55}`).
- **[SEC-7] [M]** En mainnet: admin y staff multisig, treasury en frío, secretos de servidor en un gestor (Vercel *Sensitive* + rotación periódica o un KMS), y ninguna clave de testnet reutilizada.

---

## 9. Revisión del harness (Claude Code, git hooks y CI)

El harness está bien pensado para **coordinar** a cuatro personas y sus agentes, pero casi todas sus barreras son locales y se pueden saltar. Las barreras **reales** son de servidor: protección de rama, revisión humana y CI. Hallazgos, de mayor a menor:

| # | Hueco | Severidad | Arreglo propuesto (área `harness`/`ci`, con lock) |
|---|---|---|---|
| HAR-1 | El job `harness` de la CI ejecuta `scripts/harness/check-ownership.mjs` y lee `harness/team.json` **del propio PR**. Un PR puede reescribir las reglas que lo juzgan (por ejemplo, marcar su área como libre o borrar el chequeo de locks). | **Media** | Hacer checkout de la **base** (`ref: ${{ github.event.pull_request.base.sha }}`), traer el head con `git fetch origin pull/${{ github.event.number }}/head` y comparar con `HEAD_SHA` por variable de entorno (pequeño cambio en `check-ownership.mjs`). Las reglas siempre salen de `main`. |
| HAR-2 | Los checks obligatorios (`harness`, `tests`) se identifican por **nombre**. Un PR que edite `ci.yml` puede sustituir el job por un `echo ok` con el mismo nombre. | **Media** | Lo único que lo frena es la revisión humana: en `CODEOWNERS`, `.github/` y `scripts/harness/` con dos revisores designados; o una *ruleset* de GitHub que exija el workflow desde la rama por defecto (*required workflows*). En la hackatón basta una regla escrita: "los PR que tocan `.github/**` o `scripts/harness/**` los revisa P2". |
| HAR-3 | `dismiss_stale_reviews: false` en `init-github.mjs`: se aprueba un PR y después se empuja otro commit que entra sin revisión. | **Media** | `dismiss_stale_reviews: true` y `require_last_push_approval: true`. Si frena demasiado en la hackatón, como mínimo `require_last_push_approval`. **Obligatorio antes de mainnet.** |
| HAR-4 | `${{ github.base_ref }}` interpolado directamente en un `run:` de la CI. El riesgo es bajo, porque la rama base la crean colaboradores, pero es el patrón de inyección de plantillas. | **Baja** | Pasarlo por `env: BASE_REF` y usar `"$BASE_REF"` (como ya se hace con `HEAD_REF` y `PR_TITLE`, que están bien). |
| HAR-5 | PRs desde forks: el workflow usa `pull_request`, no `pull_request_target`, y tiene `permissions` de solo lectura, así que **no hay token con escritura ni secretos**. Aun así, `cargo test` (build.rs, macros), `pnpm install` y los scripts de Node ejecutan código del PR en el runner. | **Baja** | Mantener `pull_request` (**nunca** `pull_request_target` con checkout del head). En los ajustes del repo: "Require approval for all outside collaborators" en workflows de forks; permisos por defecto de `GITHUB_TOKEN` en *read*; desactivar "Allow GitHub Actions to create and approve pull requests". |
| HAR-6 | Acciones fijadas por etiqueta (`@v4`, `@stable`, `@v2`). | **Media** | Fijar por SHA, al menos las de terceros (sección 4.3). |
| HAR-7 | `.claude/settings.json` solo deniega `Read(./.env.local)` y `./**/.env.local`. Quedan abiertos `.env`, `.env.production`, `.env.*.local`, las identidades del Stellar CLI (`~/.config/stellar/**`, `./.stellar/**`) y `stellar keys show/secret`. Además, las reglas `Read` no cubren `cat` ni `type` por Bash. | **Alta** (las identidades contienen las claves de admin, staff y treasury en claro) | Añadir a `deny`: `Read(./**/.env)`, `Read(./**/.env.*.local)`, `Read(./**/.env.production)`, `Read(~/.config/stellar/**)`, `Read(./.stellar/**)`, `Bash(stellar keys show:*)`, `Bash(stellar keys secret:*)`. Añadir a `ask`: `Bash(stellar contract invoke:*)`, `Bash(stellar contract deploy:*)`, `Bash(stellar keys:*)`. Activar el **sandbox** de Claude Code (`"sandbox": {"enabled": true}`), que convierte las reglas de lectura en restricciones a nivel de sistema operativo también para Bash. |
| HAR-8 | Las reglas de push son por prefijo y se saltan con facilidad: `git push origin HEAD:refs/heads/main`, `git push -u origin main`, `git push origin +HEAD:main` y, sobre todo, `git push --no-verify` (se salta `pre-push`; solo está denegado `git commit --no-verify`). | **Media** | Añadir `Bash(git push --no-verify:*)`, `Bash(git push -u origin main:*)`, `Bash(git push origin HEAD\:refs/heads/main:*)` y `Bash(git -c:*)`. Asumir que no es exhaustivo: la barrera real es la protección de `main` con `enforce_admins: true`, que ya está y que hay que **verificar** tras `init-github.mjs` (en repos privados del plan gratuito no se aplica). |
| HAR-9 | `gh` sin restricciones: un agente en la sesión de quien es admin del repo (P2 ejecutó `init-github.mjs`) puede hacer `gh api -X DELETE repos/…/branches/main/protection`, `gh pr merge`, `gh secret set` o `gh repo edit`. | **Media** | Añadir a `deny`: `Bash(gh api:*)`, `Bash(gh pr merge:*)`, `Bash(gh repo edit:*)`, `Bash(gh repo delete:*)`, `Bash(gh secret:*)`, `Bash(gh workflow:*)`, `Bash(gh ruleset:*)`. Los scripts del harness llaman a `gh` desde Node, así que no se rompen. |
| HAR-10 | El guard de propiedad (`guard-ownership.mjs`) solo cubre Edit/Write/MultiEdit/NotebookEdit. Se salta con Bash (`sed -i`, `node -e`, `git apply`), con `HARNESS_ROLE=…` en el entorno o con `disableAllHooks` en `settings.local.json`. Además, deja pasar sin control lo que está fuera del repo o sin área, y no bloquea si falla al leer el JSON de entrada. | **Baja** (es una ayuda de coordinación, y el `CLAUDE.md` ya prohíbe saltárselo) | Documentarlo como "barrera de coordinación". La CI (con HAR-1) es el respaldo. |
| HAR-11 | Archivos de raíz **sin área**, que el guard y la CI dejan pasar: `.gitignore` (un PR podría dejar de ignorar `.env.local`), `.gitattributes`, `.npmrc` (puede cambiar el registro o reactivar scripts), `.cargo/**` (`config.toml` puede fijar `linker` o `rustflags`, es decir, ejecución de código en la CI), `vercel.json`, `.vscode/**`, `.env.example`, `tsconfig.base.json`, `.nvmrc`. | **Media** | Ampliar el PR de `team.json` que ya propone la arquitectura: `deps` += `.npmrc`, `.nvmrc`, `tsconfig.base.json`, `.cargo/**`, `vercel.json`; `harness` += `.gitignore`, `.gitattributes`, `.env.example`, `.vscode/**`. |
| HAR-12 | La etiqueta `cross-area` la puede poner el propio autor del PR, y los locks son issues que cualquiera puede abrir. Ninguno de los dos demuestra que lo apruebe el dueño. | **Baja** | Aceptado en la hackatón (la revisión humana es el control). Opcional: que la CI compruebe en el *timeline* que quien puso la etiqueta no es el autor. |
| HAR-13 | El hook `format.mjs` ejecuta `node_modules/.bin/prettier` y `rustfmt` en cada edición. Un `rust-toolchain.toml` o un paquete comprometido ejecutaría código local. | **Baja** | Cubierto por los lockfiles, por `rust-toolchain.toml` en el área `deps` con lock y por la revisión. |
| HAR-14 | Falta un job de seguridad en la CI. | **Media** | Job `security`: detección de secretos (bloqueante), grep de AC-11 sobre el build con un valor señuelo (bloqueante cuando exista `apps/web`), `pnpm audit --prod` y `cargo audit` (informativos en la hackatón, bloqueantes en mainnet). |

Lo que está **bien**: `permissions` mínimas en el workflow; `PR_TITLE`, `HEAD_REF` y `PR_AUTHOR` pasados por `env` (sin inyección); `enforce_admins: true`; solo *squash*; `allow_force_pushes: false`; `pre-push` contra reescritura de historia; `.gitignore` con `.env*`, `.stellar/` y `*.wasm`; `settings.local.json` fuera de git.

---

## 10. Cambios propuestos a `docs/INTERFACES.md` por seguridad (además del diff de la arquitectura)

Todos son pequeños. P1 los incorpora en el `/lock interfaces` de G1.

| § | Cambio | Tipo | Requisito |
|---|---|---|---|
| 1 | `Deposit.stopped_ts: u64` (0 si no hay parada) | rompe (campo) | CT-6 |
| 1 | `propose`: `end_ts ≤ now + MAX_TERM_SECS` (`InvalidEndTs`), `amount ≤ MAX_AMOUNT` (`InvalidAmount`), y las constantes publicadas en INTERFACES | semántica | IV-1, IV-2 |
| 1 | `propose` y `accept_and_fund`: parte ∉ {staff, admin, treasury, escrow, vault, token} → **`InvalidParty = 18`** | aditivo (error) + semántica | AUTHZ-4 |
| 1 | `resolve`: `0 ≤ deduction ≤ amount` antes del `withdraw`; después, **se recorta** a `principal_back` en vez de revertir. `Deposit.deduction` guarda la efectiva | semántica | CT-7 |
| 1 | `assign_expert` en `UnderReview` borra `report_hash`. `record_report` sobrescribe y emite un evento por llamada | semántica | AUTHZ-5 |
| 1 | Evento `settled`: += `deduction` (efectiva) | rompe (formato del evento) | auditoría y CT-7 |
| 1 | Constructor: `timeout_secs ≥ 60`; `staff`, `admin` y `treasury` ≠ escrow | semántica | IV-3 |
| 1 | `accrued_yield`, `get_many` y `preview_settlement` no fallan si falla el vault (`accrued_yield = 0`) | semántica | CT-10 |
| 1 | Convención: `reason_hash`, `expert_ref` y `report_hash` = `sha256(sal_32B ‖ contenido)`, con la sal off-chain. `invite_hash = sha256(code_32B)` | documentación | DAT-2 |
| 1 | Nota de limitaciones de la hackatón: pagos *push* (CT-11), staff sin plazo (CT-6) y TTL (CT-12), con su solución de mainnet | documentación | — |
| 2 | El adaptador real **no** tiene funciones de admin que muevan fondos ni upgrade; el mock-vault solo `set_rate_bps`. Se documenta qué puede hacer cada `admin` | semántica | CT-9 |
| 4 | `WalletErrorCode` += **`"AUTH_MISMATCH"`**. `signAndSend` verifica el árbol de auth antes de firmar y fija `signatureExpirationLedger ≤ latest + 60` | aditivo + semántica | WEB-3, AUTH-5 |
| 4 | `createWallet` exige `location.hostname === cfg.rpId` | semántica | AUTH-6 |
| 4b | Validación += `rootInvocation` idéntica a `func`; `auth.length ≤ 4`; `Content-Type` JSON y `Origin` propio; límite por dirección de credencial y tope global. `token.transfer` **fuera** de la política con el ramp simulado (o solo a destinos permitidos) | semántica | SRV-2…SRV-6, CS-3 |
| 5b | `createSimRampHandler`: += `globalHourlyCap`, `enabled` (`RAMP_ENABLED`), `accountWasmHash` (verifica que el destino es nuestro smart account); lanza excepción con la *passphrase* de mainnet; `amount` con regex y `BigInt` | aditivo + semántica | SRV-10…SRV-15 |
| 3 | `deployments/testnet.json`: sin cambios de formato. `deploy.mjs` rechaza `vaultKind: "mock"` en mainnet y verifica la trustline de `treasury` | semántica de scripts | CT-9, CT-11 |
| 1 | **Stop bond** (decisiones del usuario): `stop(id, reason_hash)` solo del casero; constructor y `Config` += `stop_bond_min`, `stop_bond_bps`; `Deposit` += `stop_bond`, `bond_held`, `stop_justified`; `Deposit.stopped_by` se elimina; `resolve(id, deduction, stop_justified)`; errores `IncoherentResolution = 19` e `InsufficientBond = 20`; eventos `stopped` += `bond` y nuevo `bond`. Detalle exacto en la sección 12.8 | rompe | Sección 12 |
| [M] | `claim_after_review_timeout` (devuelve también el bond al casero), `bump`, `Owed` + `withdraw_owed`, invitación ed25519 (`invite_pk`/`invite_sig`), `Config.review_timeout_secs`, veredicto firmado por el perito | rompe | Solo en el redespliegue de mainnet |

---

## 11. Notas para el agente de desarrollo

**Patrones críticos (por rol)**
- **P1 · escrow**
  - Implementa los fragmentos 1–5 de la sección 4.1 tal cual.
  - Copia la tabla de tests de la sección 5 a `src/test/*` en el arranque (H0:30), aunque estén vacíos con `todo!()`. Así se ven los huecos.
  - `evil_vault.rs` en tests es obligatorio: sin él no se prueba CT-8.
  - Revisa el checklist de `contracts/escrow/CLAUDE.md` en H22 **más** estos puntos:
    - Ningún `unwrap`.
    - `DeadlinePassed` y `TimeoutNotReached` complementarios.
    - `InvalidParty`.
    - Recorte de la deducción.
    - `stopped_ts`.
    - `report_hash` borrado al reasignar.
- **P2 · vault e infra**
  - Adaptador sin funciones de admin sobre fondos.
  - Depósito semilla si el vault DeFindex es nuevo.
  - Reserva del mock.
  - `fund.mjs` crea la trustline de `treasury` y `deploy.mjs` la verifica.
  - Una identidad del CLI por rol.
  - Cambios de harness: HAR-1, HAR-3, HAR-4, HAR-6, HAR-7, HAR-8, HAR-9, HAR-11 y HAR-14, en un PR con `/lock harness` y `/lock ci` en G0.
- **P3 · wallet y anchor**
  - El fragmento 6 de la sección 4.1 (handler) con tests de XDR maliciosos.
  - `AUTH_MISMATCH` en `signAndSend`.
  - Expiración corta de las firmas.
  - `rpId` exacto.
  - Faucet con SRV-10…SRV-15.
  - Confirmar en el spike de G2 cómo despliega smart-account-kit (factory o `CreateContract`) y ajustar la lista blanca.
- **P4 · apps**
  - Middleware con CSP (fragmento 9).
  - `/i/[id]` con WEB-10 y WEB-11.
  - Sin analítica.
  - Compromisos con sal en el backoffice (fragmento 7).
  - Textos de error para `VaultError`, `DeadlinePassed`, `InvalidParty` y `AUTH_MISMATCH`.
  - Aviso de "rendimiento no garantizado" en la aceptación.
  - Secretos solo en Vercel *Production*.

**Librerías para funciones de seguridad**
- Contrato: `soroban-sdk` (`env.crypto().sha256`, `authorize_as_current_contract`, `token::Client`) y nada más.
- TS: `@stellar/stellar-sdk` (`xdr`, `Address`, `StrKey`) para validar en el handler; WebCrypto (`crypto.getRandomValues`, `crypto.subtle.digest`) para la invitación y los compromisos; `server-only`.
- No hace falta ninguna librería de criptografía extra en la hackatón. En mainnet, `@noble/ed25519` para CT-13 si el navegador objetivo no tiene Ed25519 en WebCrypto.

**Checklist de revisión de código (para cada PR)**
1. ¿Hay `require_auth` sobre la dirección almacenada correcta antes de escribir?
2. ¿Se valida el estado **almacenado**? ¿Se puede dejar una fianza sin salida?
3. ¿Hay alguna transferencia fuera de `settle`, a un destino no almacenado o antes de escribir `Settled`?
4. ¿Toda la aritmética usa `checked_*`? ¿Hay algún `unwrap`?
5. ¿El test de auth usa `mock_all_auths`? (Si es así, se rechaza.)
6. ¿Algún secreto con `NEXT_PUBLIC_` o importado en el cliente? ¿Algún `dangerouslySetInnerHTML` o script de terceros?
7. ¿Se firma algo sin verificar el árbol de auth?
8. ¿Algún dato personal o hash sin sal on-chain?
9. ¿El PR toca `.github/**`, `scripts/harness/**`, `harness/**`, `.claude/**` o archivos de raíz sin área? Si es así, revisión explícita de P2.
10. ¿El bond se mezcla con el principal, entra en el vault o se paga por un camino distinto de `resolve`? ¿Se cumple `!stop_justified ⇒ deduction == 0`?

---

## 12. Depósito de buena fe al parar (*stop bond*)

### 12.1 Decisiones y efecto en el modelo de amenazas

| Decisión del usuario | Efecto de seguridad |
|---|---|
| Solo el casero puede parar | **Positivo.** Desaparece el *griefing* del inquilino (parar para retrasar o presionar) y [AD-5] se simplifica a "si el casero aprobó, no puede parar". La protección del inquilino es el timeout: si no está de acuerdo, no aprueba, y el casero tiene que parar (pagando el bond) o dejar que venza el plazo. Coste: el inquilino no tiene voz on-chain en la revisión, así que el proceso off-chain del perito debe escucharle (política). La UI pierde el botón "tengo un problema" y gana el texto "si el casero no aprueba ni para antes de <fecha>, recuperas la fianza automáticamente". |
| Bond = `max(stop_bond_min, amount × stop_bond_bps / 10000)` | Disuade la parada sin motivo. Hay que calibrarlo (12.2). |
| El staff decide `stop_justified` de forma explícita | Evita el truco de "deducción simbólica de 1 unidad para recuperar el bond". A cambio, crea un **conflicto de interés** (12.3). |
| El bond perdido va a la tesorería | Es el origen del conflicto de interés. Se mitiga en 12.3. |

### 12.2 Importe y calibración (riesgo de *griefing*)

- **Fijado al proponer.** `propose` calcula `stop_bond` y lo guarda en `Deposit.stop_bond`. Como `amount` y la configuración son inmutables, el valor no cambia, y el casero lo ve antes de crear la fianza. Aritmética con `checked_mul`.
- **Mejora propuesta: tope en el principal.** `stop_bond = min(max(stop_bond_min, ⌊amount × stop_bond_bps / 10000⌋), amount)`. Sin tope, en fianzas pequeñas el mínimo puede superar la propia fianza, y entonces parar deja de tener sentido incluso con daños reales.
- **Límites en el constructor:** `0 ≤ stop_bond_min ≤ MAX_AMOUNT` y `stop_bond_bps ≤ 2000` (20 %). Por encima de eso, el bond impide disputas legítimas. Si se incumplen, `InvalidAmount` o `InvalidBps`.
- **Criterio de calibración.** El casero que tiene razón recupera el bond, así que para él solo cuesta liquidez y el riesgo de un fallo erróneo.
  - **Demasiado bajo** (por debajo del coste del perito): parar sin motivo sale barato, y la plataforma paga el perito de su bolsillo.
  - **Demasiado alto**: un casero con un daño real de 80 € en una fianza de 300 € no arriesga 100 €.
  - **Regla:** `stop_bond_min ≈ coste medio del perito` y `stop_bond_bps` bajo.
- **Valores de demo:** `stop_bond_bps = 500` (5 %) y `stop_bond_min = 10 USDC` (`100_000_000` stroops). En mainnet se calibran con el coste real del perito y la distribución de importes, y son inmutables por despliegue.
- **Liquidez del casero.** Necesita el bond en su cuenta. En la demo, `fund.mjs` o el ramp simulado fondean también la smart account del casero (SRV-11 ya lo permite, porque es una cuenta nuestra). La UI comprueba el saldo antes de pedir la passkey, y el contrato devuelve `InsufficientBond` (código tipado) en lugar de un error genérico del token.

### 12.3 Conflicto de interés: el staff decide y la tesorería cobra

**Análisis.** En cada parada, el resultado para la plataforma es `−coste del perito + (bond si "injustificada")`. Quien decide es su propio staff. El incentivo estructural es marcar las paradas como injustificadas. Lo frena la reputación (los caseros, sobre todo los grandes, son los clientes que pagan), pero eso no se puede exigir en la cadena.
- **Perjudicado:** solo el casero (pierde el bond). El inquilino **no** sale perjudicado: una parada injustificada implica deducción 0.
- **Dirección opuesta** (staff que colude con el casero): marcar "justificada" devuelve el bond y permite una deducción de hasta el 100 % del principal. Es el mismo riesgo que existía sin bond (AUTHZ-7); el bond no lo empeora.

**Mitigaciones exigibles on-chain**

| # | Regla | Cuándo |
|---|---|---|
| OC-1 | `resolve` exige `report_hash` registrado ([AD-7], `ReportMissing`). Ninguna decisión sobre el bond sin informe. Reasignar perito borra el informe (AUTHZ-5). | H |
| OC-2 | **Coherencia:** `stop_justified == false ⇒ deduction == 0`. Si no se cumple, `IncoherentResolution`. La plataforma no puede quedarse el bond y a la vez dar la razón económica al casero. Se valida sobre la `deduction` **recibida**, antes del recorte de CT-7. La combinación contraria (`justified == true` con `deduction == 0`, es decir, sospecha razonable sin daño probado) **sí** se permite, porque va contra el interés de la plataforma y no hay conflicto. | H [G1] |
| OC-3 | Destinos fijos: el bond solo va al `landlord` o a la `treasury` almacenados. No hay argumento de dirección ni otra función que mueva el bond. El admin no tiene poder sobre él y la pausa no le afecta. | H |
| OC-4 | Transparencia exigida por el contrato: el evento `bond {to, amount, justified}` se emite en la misma transacción que `settled`, junto con `report`. Cualquiera puede calcular desde los eventos la tasa de paradas "injustificadas" y lo que ha cobrado la tesorería. | H |
| OC-5 | La plataforma no puede beneficiarse de su propia inacción: con `claim_after_review_timeout` (CT-6), si el staff no resuelve en `review_timeout_secs`, el bond **vuelve al casero** y el inquilino cobra con deducción 0. En la hackatón se guarda `stopped_ts` para poder añadirlo sin cambiar el tipo. | H (campo) / M (función) |
| OC-6 | **Veredicto firmado por el perito:** `assign_expert(id, expert: Address, expert_ref)` y `record_report(id, report_hash, justified: bool, max_deduction: i128)` con `expert.require_auth()`. `resolve` exige `stop_justified == verdict.justified` y `deduction ≤ verdict.max_deduction`. El staff ya no puede contradecir al perito, solo ejecutar. El perito no puede ser staff, tesorería ni parte (`InvalidParty`). Riesgo residual: la plataforma elige al perito, lo que pide un registro y una rotación de peritos (política). | M |
| OC-7 | Doble firma: `staff` como multisig 2 de 3 (AUTH-8). Cualquier `resolve` necesita dos personas, y en particular un `stop_justified = false`. | M |
| OC-8 | **Recomendación de producto para antes de mainnet:** reconsiderar el destino del bond perdido. Si va al **inquilino** (como compensación por el retraso) o a medias inquilino/tesorería, el conflicto desaparece o se reduce a la mitad, y el cambio on-chain es una línea. Si se mantiene la tesorería, al menos debería ir a una dirección `expert_fund` distinta de `treasury`, dedicada a pagar peritos y auditable por eventos. | M (decisión del equipo) |

**Mitigaciones de política y transparencia (no exigibles en la cadena)**
- **P-1.** Criterios públicos y escritos de "parada justificada" (por ejemplo: el perito constata un daño o un incumplimiento atribuible al inquilino, o el casero tenía indicios objetivos). Se muestran al casero **antes** de pulsar parar, junto al importe del bond.
- **P-2.** El bond perdido se contabiliza como partida para pagar peritos. Se publican periódicamente las estadísticas calculadas desde los eventos: porcentaje de paradas justificadas, deducción media, bonds cobrados frente a coste de peritos.
- **P-3.** El casero recibe el informe y la motivación, y existe una vía de recurso off-chain revisada por otra persona del staff distinta de quien resolvió.
- **P-4.** Las condiciones del casero divulgan el conflicto: "si la parada no está justificada, el depósito de buena fe pasa a la plataforma".
- **P-5.** La retribución del staff no depende de los bonds cobrados.

### 12.4 Interacción con el resto de la máquina de estados

- **`DeadlinePassed`:** el plazo se comprueba **antes** de cobrar el bond. De todas formas la transacción es atómica: si `stop` falla, no se mueve nada. En `end_ts + timeout_secs` exacto, parar se permite (y se cobra); un segundo después ya no.
- **`AlreadyApproved`:** el casero que aprobó no puede parar y no se le cobra nada.
- **`cancel`:** solo en `Proposed`, donde no existe bond. No hay interacción.
- **Pausa:** `stop` **no** se bloquea con la pausa, aunque meta fondos en el contrato. Si se bloqueara, el plazo podría vencer durante la pausa y el casero perdería su derecho a disputar. El bond no entra en el vault, así que una emergencia del vault no le afecta. Se añade al test `pause_never_blocks_exits`.
- **`claim_after_timeout` y `approve_release`:** solo en `Active`. Con un bond retenido la fianza está en `Stopped`/`UnderReview`, así que el bond solo se liquida en `resolve` (y en mainnet también en `claim_after_review_timeout`). No hay un camino en el que el bond quede sin destino al liquidar.
- **Pérdida del vault y recorte de CT-7:** el bond es independiente de `total`. Una pérdida del vault no lo toca.
- **`Settled` es terminal:** tras pagar, `bond_held = 0`. Un segundo `resolve` da `BadStatus`, así que no hay doble pago.

### 12.5 Bond atrapado

- **Staff ausente o clave de staff perdida:** el bond queda atrapado junto con el principal (Q-14). En la hackatón es un riesgo aceptado, y se guarda `stopped_ts`. En mainnet, OC-5 (`claim_after_review_timeout` con el bond devuelto al casero).
- **Archivado por TTL:** el bond es saldo del escrow en el SAC (entrada de balance persistente del token, que se extiende en cada `transfer`). Si se archivara, cualquiera puede restaurarlo. No se pierde.
- **Sin `sweep`:** ninguna función puede mover el saldo del escrow fuera de `settle` y del pago del bond. Así el bond no puede acabar en otra parte por error del admin.

### 12.6 Trustlines y pagos que revierten

- **Devolver el bond al casero** en `resolve`: si el casero no puede cobrar (cuenta G sin trustline o saldo congelado por el emisor), revierte **todo** `resolve` y el principal del inquilino también queda bloqueado. Un casero que sabe que va a ganar no tiene motivo para hacerlo, pero un fallo ajeno (congelación) sí podría ocurrir.
  - [H]: el casero es una C-address (no necesita trustline) y acaba de pagar el bond desde esa misma cuenta. La trustline de la tesorería se verifica en `deploy.mjs`.
  - [M]: patrón `Owed` (CT-11) también para el bond. La liquidación del inquilino nunca depende de que el casero o la tesorería puedan cobrar.
- **Orden en `resolve`:** `withdraw` → `split` → escribir `Settled`, `bond_held = 0` y `stop_justified` → transferencias (inquilino, casero, tesorería y, por último, el bond) → eventos `settled` y `bond`.

### 12.7 Contabilidad separada del principal y de las shares

- El bond **nunca** va al vault. Se queda como saldo del token en el escrow y su único registro es `Deposit.bond_held`.
- `stop` mide el bond por diferencia de balance, y debe ser igual a `d.stop_bond`.
- En `settle`, `total` se mide **justo antes y justo después** del `withdraw`. El bond que ya está en el saldo del escrow no contamina `total`, y `split()` y su invariante no cambian.
- El bond se paga **fuera** de `Settlement`, así que el fee de la plataforma nunca se aplica al bond, y `to_tenant + to_landlord + to_treasury == total` sigue valiendo.
- **Invariante global:** en reposo, `token.balance(escrow) == Σ bond_held` de las fianzas en `Stopped`/`UnderReview` (más las donaciones que alguien haya enviado). Lo cubre un test con varias fianzas.

### 12.8 Cambios exactos a `docs/INTERFACES.md` (G1)

```rust
// Constructor
__constructor(admin, staff, treasury, token, vault,
              platform_fee_bps: u32, timeout_secs: u64,
              stop_bond_min: i128, stop_bond_bps: u32)      // 0 ≤ min ≤ MAX_AMOUNT; bps ≤ 2000

pub struct Config { /* … */ pub stop_bond_min: i128, pub stop_bond_bps: u32 }

pub struct Deposit {
    // … campos de la arquitectura, SIN `stopped_by` (siempre es el casero)
    pub stop_bond: i128,              // fijado en propose: min(max(min, amount·bps/10000), amount)
    pub bond_held: i128,              // 0, o stop_bond mientras está Stopped/UnderReview
    pub stop_justified: Option<bool>, // Some al resolver
    pub stopped_ts: u64,              // CT-6
}
```

| Función | Auth | Precondiciones (error) | Estado |
|---|---|---|---|
| `propose(…)` | landlord | lo anterior + calcula y guarda `stop_bond` | — → `Proposed` |
| `stop(id, reason_hash)` **[firma nueva, sin `who`]** | **landlord almacenado** | `Active` (BadStatus); el casero no aprobó (AlreadyApproved); `now ≤ end_ts + timeout_secs` (DeadlinePassed); `balance(landlord) ≥ stop_bond` (InsufficientBond); cobra `token.transfer(landlord → escrow, stop_bond)` medido por diferencia. **La pausa no lo bloquea.** | `Active` → `Stopped` |
| `resolve(id, deduction, stop_justified: bool) -> Settlement` **[firma nueva]** | staff | `UnderReview`; `report_hash` (ReportMissing); `0 ≤ deduction ≤ amount`; `!stop_justified ⇒ deduction == 0` (**IncoherentResolution**); el bond va al casero si es `true` y a la tesorería si es `false` | → `Settled` |
| `preview_settlement(id, deduction)` | — | sin cambios (el bond no forma parte de `Settlement`) | lectura |

- **Eventos**
  - `stopped`: data `landlord, reason_hash, bond` (sustituye a `who`).
  - **Nuevo** `bond` (topic 1 = id): data `to: Address, amount: i128, justified: bool`.
- **Errores:** `InvalidParty = 18` (sección 10), **`IncoherentResolution = 19`**, **`InsufficientBond = 20`**.
- **§ 4b Relayer:** `stop` sigue en la lista blanca. La transferencia anidada del bond va en el árbol de auth del casero, y la regla SRV-4 (raíz idéntica a `func`) sigue valiendo.
- **§ 4 Wallet:** WEB-3 espera en `stop` exactamente una subinvocación `token.transfer(landlord, escrow, stop_bond)`. P4 traduce los nuevos `contractError` 19 y 20.
- **Front:**
  - Se elimina `stop` en el flujo del inquilino.
  - La pantalla de parar del casero muestra el importe del bond, los criterios de P-1 y el saldo disponible.
  - El backoffice pide `stop_justified` de forma explícita (sin valor por defecto) y desactiva "no justificada" si `deduction > 0`.

### 12.9 Tests de `cargo test` del bond (`test/stop_bond.rs`)

| Test | Escenario | Prioridad |
|---|---|---|
| `stop_bond_fixed_at_propose` | `get(id).stop_bond` tras `propose` es igual al bond cobrado en `stop` | H |
| `stop_bond_uses_min_for_small_deposits` | `amount` pequeño → `stop_bond == stop_bond_min` | H |
| `stop_bond_uses_bps_for_large_deposits` | `amount` grande → `stop_bond == amount × bps / 10000` | H |
| `stop_bond_capped_at_amount` | `stop_bond_min > amount` → `stop_bond == amount` (si se adopta el tope) | H |
| `constructor_rejects_invalid_bond_params` | `stop_bond_bps = 2001` → `InvalidBps`; `stop_bond_min < 0` → `InvalidAmount` | H |
| `stop_charges_bond_from_landlord` | Saldo de L −bond; saldo del escrow +bond; `bond_held == bond`; `shares_of(escrow)` sin cambios (el bond no entra en el vault) | H |
| `stop_bond_auth_tree_is_exact` | `env.auths()` de L == `stop(id, reason)` con una única subinvocación `token.transfer(L, escrow, bond)` | H |
| `stop_without_bond_balance_fails` | Saldo de L < bond → `InsufficientBond`; sigue `Active`; saldos intactos | H |
| `tenant_cannot_stop` | Auth solo de T → fallo de auth; no se cobra nada | H |
| `stop_after_deadline_charges_nothing` | `DeadlinePassed` y saldo de L intacto | H |
| `stop_after_landlord_approval_charges_nothing` | `AlreadyApproved` y saldo de L intacto | H |
| `pause_does_not_block_stop` | Pausado → `stop` funciona y cobra el bond | H |
| `resolve_justified_returns_bond_to_landlord` | `resolve(id, X, true)` → L recibe `X + parte del yield + bond`; tesorería solo el fee; evento `bond {to: L, justified: true}` | H |
| `resolve_unjustified_forfeits_bond_to_treasury` | `resolve(id, 0, false)` → tesorería `fee + bond`; T recibe principal + su parte; evento `bond {to: treasury, justified: false}` | H |
| `resolve_unjustified_with_deduction_fails` | `resolve(id, 1, false)` → `IncoherentResolution`; estado y saldos intactos | H |
| `resolve_justified_with_zero_deduction_allowed` | `resolve(id, 0, true)` → bond a L; T recibe todo el principal | H |
| `bond_outside_split_invariant` | El `Settlement` de una fianza con bond es idéntico al de la misma fianza resuelta sin bond; el fee no se aplica al bond | H |
| `bond_survives_vault_loss` | Vault con pérdida total → el bond se paga entero a su destino | H |
| `escrow_balance_equals_sum_of_held_bonds` | 3 fianzas paradas y 1 resuelta → `balance(escrow) == Σ bond_held` | H |
| `bond_paid_once` | Tras `resolve`, `bond_held == 0`; un segundo `resolve` da `BadStatus`; saldos sin cambios | H |
| `stop_justified_recorded` | `get(id).stop_justified == Some(valor)` tras `resolve` | H |
| `review_timeout_returns_bond_to_landlord` | Sin `resolve` antes de `stopped_ts + review_timeout` → `claim_after_review_timeout` devuelve el bond a L y el principal a T | M |
| `expert_verdict_binds_resolve` | Veredicto firmado `justified = true, max_deduction = Y` → `resolve(id, Y + 1, true)` y `resolve(id, 0, false)` fallan | M |
| `unpayable_landlord_bond_goes_to_owed` | L congelado → `resolve` liquida; el bond queda en `Owed(id, L)` | M |

**Notas por rol (bond)**
- **P1:** `stop` y `resolve` con el fragmento 2 de la sección 4.1 y las reglas OC-1…OC-4. El bond se paga después de las transferencias de `split`, nunca dentro de él.
- **P2:** `fund.mjs` fondea las smart accounts de los caseros de demo con el bond. `e2e/stop.mjs` cubre los dos valores de `stop_justified`. Valores de demo en el constructor: `stop_bond_bps = 500` y `stop_bond_min = 100_000_000`.
- **P3:** WEB-3 con la subinvocación del bond.
- **P4:**
  - Se quita `stop` del flujo del inquilino.
  - Pantalla de parada con bond, saldo y criterios (P-1).
  - El backoffice obliga a elegir `stop_justified` y aplica OC-2 en la UI.
  - El pitch explica que el bond disuade paradas sin motivo y declara a dónde va el bond perdido.
