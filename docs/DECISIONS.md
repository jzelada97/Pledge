# Decisiones

Una entrada por decisión, la más reciente arriba. Formato corto: qué se decidió, por qué y quién.

## Plantilla
```
## AAAA-MM-DD HH:MM · <título>
- Decisión:
- Alternativas descartadas:
- Motivo:
- Decide: P<n> · Revisa: P<n>
```

---

## 2026-10-25 · Vuelta al fork de Trustless Work (sustituye a "Escrow propio")
- **Decisión:** el escrow vuelve a ser un **fork del Single-Release v2 de Trustless Work** (`single-release-develop-v2` @ `1d22d0c`, con v1 @ `f0b706e` como plan B), con el permiso explícito de Trustless Work para copiarlo y modificarlo. Se cambian los roles y se añade el movimiento escrow → DeFindex → escrow → reparto. Se recupera `NOTICE.md` con el permiso.
- **Motivo:** decisión del equipo. Trustless Work ha dado permiso y su V2 aún no está publicada. Partir de su código auditado (v1, Runtime Verification) es mejor que escribirlo desde cero, y el pitch puede decir "construido sobre Trustless Work, con permiso".
- **Condición:** el permiso tiene que cubrir un **repositorio público** y quedar registrado en `NOTICE.md` (enlace, fecha y persona de Trustless Work).
- **Sustituye a:** "Escrow propio, sin fork de Trustless Work" (PR #5, revertido).
- Decide: equipo · Implementa: P1

## 2026-10-25 · API propia compatible con la Core API v2 de Trustless Work
- **Decisión:** `apps/api` (P2, Hono montado en `apps/web`) implementa con la **misma ruta y la misma forma** los endpoints de Trustless Work que encajan (fund, approve, extend-ttl, send-transaction y lecturas). Los que cambian de semántica (dispute → `stop` con bond, resolve-dispute → `resolve` con `stop_justified`) van a `/fianzas/v1` y la ruta de Trustless Work responde `501` remitiendo a la nueva. Lo nuevo (crear fianza vía factory, estrategias, comisiones, preview, claims, relay) también va en `/fianzas/v1`. Detalle: arquitectura § 6.8 e INTERFACES § 8.
- **Motivo:** la API de Trustless Work solo sirve su propia revisión del contrato, y la nuestra es un fork. La compatibilidad permite usar su SDK y sus Blocks.
- **SDK:** `@trustless-work/escrow-js` para los endpoints compatibles, con nuestra `baseUrl`, y el cliente propio `@fianzas/api/client` (lo exporta `apps/api`, de P2) para `/fianzas/v1`. Si en el spike el SDK no acepta nuestra `baseUrl` o los campos extra, se usa solo el cliente propio.
- Decide: equipo · Implementa: P2

## 2026-10-25 · Comisiones de DeFindex y vault propio
- **Decisión:** DeFindex cobra **sobre lo generado en su pool**, y esa comisión se reparte entre DeFindex (`defindex_protocol_fee`) y nosotros (`vault_fee`, que va al `fee_receiver` del vault, es decir, a la tesorería). Es una **fuente de ingresos adicional** a nuestro `platform_fee_bps` del escrow.
- **Vault propio también en testnet:** lo crea P2 con la factory de DeFindex sobre `USDC_blend_strategy`, y la plataforma es su manager (`config.vault_manager = Some(...)` también en testnet). `usdc_paltalabs_vault` queda solo como plan B del spike.
- **Fijado al crear:** el factory lee `get_fees()` y guarda `defindex_vault_fee_bps` y `defindex_protocol_fee_bps` en los `Terms`. El vault ya las descuenta del rendimiento, así que `split()` no las vuelve a restar. `fund_escrow` rechaza el fondeo si la comisión ha subido (`VaultFeeChanged`). Una subida nunca bloquea un retiro.
- **Pendiente:** confirmar en el spike sobre qué base exacta calcula DeFindex su comisión de protocolo. En el PoC se fijarán los números: `vault_fee` y `platform_fee_bps` a la vez, para no cobrar dos veces lo mismo sin querer.
- Decide: equipo · Implementa: P2 (vault) y P1 (Terms)

## 2026-10-25 · Kit de passkeys: smart-account-kit + Relayer propio
- **Decisión:** `smart-account-kit` **0.8.0** (cuentas de OpenZeppelin con passkey) con `@stellar/stellar-sdk` **16.4.1** (el kit exige `^16.3`). El kit envía `{ func, auth }` a nuestro `/api/relay` (`createRelayHandler` de `@fianzas/wallet/server`), que valida con la `RelayPolicy` y reenvía a OpenZeppelin Channels por HTTP (sin `@openzeppelin/relayer-plugin-channels`, que arrastra otra versión del SDK).
- **Datos de testnet** (comprobados on-chain el 25-oct-2026, protocolo 29), para `deployments/testnet.json`:
  - `smartAccount.accountWasmHash`: `1b5f4534a76322da2ad7c745f6900857a6802b0ca79850c35a03561df997785a`
  - `smartAccount.webauthnVerifier`: `CC7EKIHQP3TN4CARQDND6CEOY2UXLWWC2X5GHTD5NLAT7BG5GPZIOM3F`
  - Deployer compartido del kit (`RelayPolicy.smartAccountDeployers`): `GAAH4OT36RRCCAGKARGPN2HLHT2NOBVFHO4GUHA6CF7UKQ4MMV24WQ4N`. Solo firma el despliegue; nunca paga.
- **Descartado:** `passkey-kit` (otro modelo de autorización, no compatible) y el proxy oficial del kit, que solo deja pasar llamadas a la propia cuenta y no a nuestros contratos.
- **Pendiente del spike en navegador:** crear una cuenta con passkey y firmar `fund_escrow` contra una instancia de la factory (cuando P1 y P2 desplieguen).
- Decide: P3

## 2026-10-25 · Escrow propio, sin fork de Trustless Work (**sustituida** por "Vuelta al fork de Trustless Work")
- **Decisión:** el escrow se escribe **desde cero**. No se copia ni se modifica código de Trustless Work. Se mantienen la factory, un contrato por fianza, el vault de DeFindex y todas las firmas de `docs/INTERFACES.md`.
- **Consecuencias:**
  - No hay `NOTICE` de TW, ni permiso que registrar, ni cabeceras de origen.
  - Desaparece el fee de TW (`tw_fee_bps`, `tw_fee_receiver`, `Settlement.to_tw`) y `get_roles()`.
  - El pitch no dice "construido sobre Trustless Work".
- **Motivo:** evita depender de un permiso sin licencia publicada en un repositorio público, y quita código que no necesitamos (milestones, reparto libre, funciones de admin).
- **Sustituye a:** "Escrow: fork de Trustless Work + DeFindex + factory" (más abajo).
- Decide: equipo · Implementa: P1

## 2026-10-25 · Estrategia de rendimiento: Blend Fixed Pool USDC vía DeFindex
- **Decisión:** la estrategia por defecto del MVP es el vault de DeFindex sobre el **Blend Fixed Pool USDC**: `usdc_blend_autocompound_fixed_strategy` (`CDB2WMKQ…VZSAP`) en mainnet; en testnet, el equivalente se confirma en el spike. En la UI y el pitch se presenta como "~6-7 %, variable".
- **Datos** (leídos on-chain en mainnet el 25-oct-2026):

  | Pool | Activo | Supply APY | Notas |
  |---|---|---|---|
  | Fixed | USDC | **5,88 %** | Media de 30 días: 6,76 % (DefiLlama). Uso del 74 %, ~53 M de USDC suministrados |
  | Fixed | EURC | 0,16 % | — |
  | Etherfuse (RWA) | USDC | **0,05 %** | Solo ~5.500 USDC suministrados |
  | Etherfuse (RWA) | USTRY | 0 % | — |
  | Etherfuse (RWA) | CETES | 0 % | — |

- **Descartado:**
  - **El pool RWA de Etherfuse.** Casi no rinde y presta contra colateral RWA con poca liquidez, que es el tipo de riesgo del caso YieldBlox (22-feb-2026).
  - **CETES y TESOURO**, por el riesgo de cambio.
  - **Ondo USDY por ahora.** Crearlo exige KYC, no ser de EE. UU. y 40-50 días de espera, comprarlo en el DEX necesita una estrategia propia, y su emisor puede congelar y recuperar tokens.
- **Ruta de escalabilidad:** el registro de estrategias de `FianzaFactory` permite añadir sin redeploy nuevas estrategias de DeFindex, incluidas las de RWA:
  - las de Etherfuse que ya existen;
  - una estrategia propia sobre letras del Tesoro tokenizadas, como Ondo USDY (emisor `GAJMPX5…DAZ6`; en Stellar hay al menos 10 tokens USDY falsos) o Spiko EUTBL.

  Cada fianza mantiene la estrategia con la que se creó.
- **Regla:** ninguna estrategia se describe como "0 riesgo" ni "sin riesgo".
- Decide: equipo · Revisa: P2

## 2026-10-25 · Escrow: fork de Trustless Work + DeFindex + factory (vigente de nuevo; ver "Vuelta al fork")
- **Decisión:**
  - El escrow parte del contrato de **Trustless Work** (Single-Release), con su permiso explícito para copiarlo y modificarlo (ver `NOTICE.md`).
  - Lo modificamos para que, al fondear, el dinero vaya a un vault de DeFindex, y para que al liberar o resolver se retire y se reparta.
  - Un contrato **`FianzaFactory`** crea un escrow por fianza, con el patrón de despliegue `tw_new_single_release_escrow` que ya trae Trustless Work. También lleva un registro de estrategias, la configuración global y los índices por casero e inquilino.
- **Descartado:**
  - **Trustless Work sin modificar:** sin rendimiento, con un solo receptor y con los fees sobre el bruto.
  - **Escrow escrito desde cero:** más código sin auditar.
- **Pendiente:**
  - Rama base (v1 `single-release-develop` o v2 `single-release-develop-v2`, que aún no está publicada).
  - Fee del 0,3 % de Trustless Work: **0 en el MVP**, a negociar con ellos más adelante.
- Decide: equipo · Implementa: P1

## 2026-10-25 · Reparto del dinero
- **Decisión:**
  - **La fianza (principal) vuelve entera al inquilino**, menos la deducción que fije el staff según el informe del perito.
  - **Solo se reparte el rendimiento:** `platform_fee_bps` para la plataforma (propuesta: 20 %) y el neto según `tenant_yield_bps`, el preset del país: todo al inquilino, 50/50, todo al casero o personalizado.
  - Si el vault devuelve menos que el principal, la pérdida va primero contra el rendimiento.
- **Pendiente:** fijar los números definitivos en el PoC.
- Decide: equipo

## 2026-10-25 · Parada y depósito de buena fe (stop bond)
- **Decisión:**
  - Solo el **casero** puede parar, y para hacerlo deposita `max(stop_bond_min, fianza × stop_bond_bps)`.
  - El staff resuelve indicando de forma explícita `stop_justified`. Si es `true`, el bond vuelve al casero. Si es `false`, va a la tesorería, que lo destina a pagar al perito.
  - Para limitar el conflicto de interés se exige on-chain:
    - `!stop_justified ⇒ deduction == 0`;
    - el hash del informe del perito es obligatorio;
    - un evento público del bond;
    - si el staff no resuelve a tiempo, el bond vuelve al casero.
- **Descartado:**
  - Que el inquilino también pueda parar: ya tiene el timeout.
  - Que el bond perdido vaya al inquilino.
- Decide: equipo · Implementa: P1

## 2026-10-25 · Revisión de PRs
- **Decisión:** cualquiera de los otros tres puede aprobar un PR. `CODEOWNERS` = los 4 en todo el repo. Quién edita cada carpeta lo controlan el guard de Claude Code y la CI.
- Decide: equipo

## Pendientes en G2 (hora 3)
- [ ] Base del fork de Trustless Work: v2 `1d22d0c` o v1 `f0b706e` (P1)
- [ ] Vault propio de DeFindex en testnet sobre `USDC_blend_strategy` y cómo fondearlo (P2)
- [ ] ¿`@trustless-work/escrow-js` acepta nuestra `baseUrl` y los campos extra? (P2)
- [ ] Base de cálculo de la comisión de protocolo de DeFindex (P2)
- [x] Kit de passkeys: smart-account-kit (P3)
- [ ] Anchor: testanchor con SEP-45 o ramp simulado (P3)
- [ ] Quién asume una pérdida del vault más allá del rendimiento (equipo, antes de G1)
- [ ] Registrar en `NOTICE.md` el permiso de Trustless Work para un repo público (equipo, antes de copiar el código)
