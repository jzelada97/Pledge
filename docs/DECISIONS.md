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

## 2026-10-25 · Kit de passkeys: smart-account-kit + Relayer propio
- **Decisión:** `smart-account-kit` **0.8.0** (cuentas de OpenZeppelin con passkey) con `@stellar/stellar-sdk` **16.4.1** (el kit exige `^16.3`). El kit envía `{ func, auth }` a nuestro `/api/relay` (`createRelayHandler` de `@fianzas/wallet/server`), que valida con la `RelayPolicy` y reenvía a OpenZeppelin Channels por HTTP (sin `@openzeppelin/relayer-plugin-channels`, que arrastra otra versión del SDK).
- **Datos de testnet** (comprobados on-chain el 25-oct-2026, protocolo 29), para `deployments/testnet.json`:
  - `smartAccount.accountWasmHash`: `1b5f4534a76322da2ad7c745f6900857a6802b0ca79850c35a03561df997785a`
  - `smartAccount.webauthnVerifier`: `CC7EKIHQP3TN4CARQDND6CEOY2UXLWWC2X5GHTD5NLAT7BG5GPZIOM3F`
  - Deployer compartido del kit (`RelayPolicy.smartAccountDeployers`): `GAAH4OT36RRCCAGKARGPN2HLHT2NOBVFHO4GUHA6CF7UKQ4MMV24WQ4N`. Solo firma el despliegue; nunca paga.
- **Descartado:** `passkey-kit` (otro modelo de autorización, no compatible) y el proxy oficial del kit, que solo deja pasar llamadas a la propia cuenta y no a nuestros contratos.
- **Pendiente del spike en navegador:** crear una cuenta con passkey y firmar `fund_escrow` contra una instancia de la factory (cuando P1 y P2 desplieguen).
- Decide: P3

## 2026-10-25 · Escrow propio, sin fork de Trustless Work
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

## 2026-10-25 · Escrow: fork de Trustless Work + DeFindex + factory (**sustituida** por "Escrow propio")
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
- [ ] Vault de DeFindex en testnet para Fixed USDC y cómo fondearlo (P2)
- [x] Kit de passkeys: smart-account-kit (P3)
- [ ] Anchor: testanchor con SEP-45 o ramp simulado (P3)
- [ ] Quién asume una pérdida del vault más allá del rendimiento (equipo, antes de G1)
