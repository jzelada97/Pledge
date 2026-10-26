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

## 2026-10-26 11:45 · Liberación a plazo en el plan A: la garantía la da la plataforma, no la cadena (#115)
- **Contexto:** el escrow de Trustless Work no tiene plazos: sin aprobación del casero, el inquilino no puede recuperar la fianza solo. De las tres opciones de #115 (fork del contrato de TW, volver al plan B, o regla en la plataforma) se elige la tercera para la demo.
- **Decisión:**
  - La fecha de fin del alquiler (`endTs`) va en el engagementId del escrow (`fianza-<id>-end<endTs>`), que es inmutable y público. `claimableAt = endTs + TW_CLAIM_TIMEOUT_SECS` (30 días en producción; 120 s en la demo).
  - Pasado `claimableAt` sin aprobación del casero, `POST /fianzas/v1/fianzas/{id}/claim-timeout` guía tres pasos: el inquilino abre la disputa (`dispute_escrow`, que TW le permite), el staff la resuelve con deducción 0 y reparte el sobrante. Con `STAFF_SECRET` en el servidor los pasos 2 y 3 son automáticos; sin ella el staff firma a mano.
  - El servidor solo resuelve si la disputa es la del inquilino y posterior al plazo (se verifica en la cadena). Una parada del casero anterior al plazo la resuelve el staff como cualquier disputa (en el plan A no hay perito).
  - Textos del front (P3): «Si a los 30 días del fin del contrato el casero no ha aprobado ni abierto una disputa, puedes reclamar la fianza y te la devolvemos íntegra».
- **Descartado para la demo:** fork del contrato de TW con `claim_after_timeout` on-chain (queda como roadmap: es lo único que da la garantía sin confiar en la plataforma) y volver al plan B.
- Decide: P2 con P1 · Implementa: P2 (API) · Probado en testnet: `CA5U6SNN…JERA`, disputa `b9a32710…`, resolve `99db6986…`.

## 2026-10-26 11:30 · Solo existe el plan A: el plan B queda descartado (lo leen todas las IAs)
- **Decisión:** el producto (Pledge) es **solo el plan A**. Cada fianza es un escrow single-release con rendimiento de Trustless Work (TrustYield, vault de DeFindex sobre Blend), creado y gestionado con su API desde `apps/api` mediante `@fianzas/trustless`.
- **El plan B queda descartado para siempre**, no "en reserva". Comprende:
  - el escrow fork de TW y la `FianzaFactory` (`contracts/`);
  - `packages/bindings`;
  - el backend `factory` de `apps/api`;
  - #48 y #58.

  No se desarrolla, no se despliega, no se revisa y **no se tiene en cuenta en ninguna parte**: ni en código nuevo, ni en la UI, ni en los docs, el README o el pitch.
- **Conceptos que no existen en el plan A** y no deben aparecer:
  - perito;
  - depósito por parar (*stop bond*, "good-faith deposit");
  - plazos **en el contrato** (*timeout* on-chain, "el staff decide en 30 días"). El plazo de 30 días para que el inquilino reclame sí existe, pero lo aplica la plataforma, no la cadena: ver la entrada de las 11:45 (#115);
  - `stop_justified` con efecto en un bond;
  - estrategias del registro de la factory.
- **Así es el plan A**, mapeo en `packages/trustless/CLAUDE.md`:
  - el casero aprueba y el inquilino libera (fianza + rendimiento − 0,3 % de TW);
  - solo el casero para, antes de aprobar y gratis;
  - el staff resuelve: deducción al casero y resto al inquilino;
  - el rendimiento sobrante se reparte después (`distribute-yield`: comisión de plataforma y `tenantYieldBps`).
- **Qué queda como histórico (no lo uses de referencia):**
  - `contracts/`, `packages/bindings`;
  - las secciones de contratos y factory de `docs/INTERFACES.md`;
  - `.kiro/pipeline/` y las fases de `docs/PIPELINE.md`;
  - las entradas de abajo que hablan del plan B "en reserva".
- **Pendiente:**
  - la UI aún tiene textos del plan B (perito, depósito de buena fe): hay que quitarlos; el texto de la reclamación a los 30 días se sustituye por el de la entrada de las 11:45;
  - el backend `factory` de `apps/api` (`FIANZAS_BACKEND=factory`) se puede borrar cuando haya tiempo (P2).
- **Sustituye a:** la decisión de dejar el plan B en reserva (#60, #67 y la entrada del 2026-10-25 de abajo).
- **Motivo:** el plan A ya funciona de punta a punta en testnet (#80, #84, #104). Mantener dos planes confunde al equipo, a las IAs y al jurado.
- Decide: P1 (Carlos), con el equipo · Revisa: P2

## 2026-10-26 11:00 · P4 pasa al pitch; el front queda libre para el equipo
- **Decisión:** Diego (P4) se dedica al pitch (`pitch/`). `apps/web` y `apps/backoffice` pasan a ser **áreas libres** (`owner: "*"` en `harness/team.json`, como `docs/`): cualquiera las edita sin lock ni `cross-area`. `apps/web/app/api/` sigue siendo del área `api` (P2). El trabajo del front se reparte con issues asignados: conectar las pantallas del plan A con `apps/api` (#84), el flujo de la passkey del inquilino (#82) y el backoffice del staff (resolver y `distribute-yield`, #104).
- **Estado de lo que deja Diego:** #100 (rediseño "Pledge") **ya está fusionado** (aprobado por P3, CI en verde). #96 (cabeceras de seguridad, cierra #77) sigue abierto y en conflicto con `main`; le falta el indexador de las passkeys en `connect-src` (`deployments.smartAccount.indexerUrl`, #107). Quien coja el front lo hereda: commits a su rama con su permiso, sin reescribir historia. El lock `deps` #98 lo libera él.
- **Alternativa descartada:** un dueño concreto (P2) para el front, porque obligaría a P1 y P3 a usar `cross-area` en cada PR.
- Decide: equipo (propuesta de P1 en #105; confirmado por Jose) · Implementa: P2

## 2026-10-26 10:40 · Modo MVP de la hackatón hasta la entrega (lo leen todas las IAs)
- **Decisión:** desde ahora y hasta la entrega, el único objetivo es que **el camino feliz funcione en la demo** (testnet, plan A): crear la fianza, depositar con passkey, aprobar y devolver.
  - No se tratan casos raros ni extremos, ni se endurece más allá de lo que ya hay.
  - Un PR **solo se bloquea si rompe el camino feliz de la demo**. Lo demás (seguridad extra, validaciones, bordes) va como comentario o como issue "fuera del MVP", y el PR sigue adelante.
  - Las revisiones son cortas: aprobar si funciona y la CI está en verde. No pedir cambios por cosas que no afectan a la demo.
  - Prioridad: demo funcionando > aspecto visual > robustez.
  - Ricardo (P3) trabaja en el front (`apps/web`), solo en la parte visual. Conectar la interfaz con la API es de Jose (P2).
- **Alternativas descartadas:** seguir revisando y bloqueando por robustez. No da tiempo antes de la entrega.
- **Motivo:** quedan unas 2 horas para la entrega y es testnet, sin dinero real.
- **Decide:** P3 (Ricardo), con el equipo · **Revisa:** P2

## 2026-10-25 · Plan A: solo la API de Trustless Work; el escrow propio queda como plan B
- **Decisión:** las fianzas serán escrows **Single-Release v2 de Trustless Work**, creados y operados **solo con sus endpoints** (`beta.api.trustlesswork.com`, cabecera `x-api-key`). Trustless Work añadirá el depósito en DeFindex sobre esa misma API. **Esperamos a que lo publiquen** antes de activar nada propio.
- **Motivo:** recomendación de Trustless Work. Si usamos su API tal cual, cuando añadan DeFindex la migración es mínima; cada capa propia (contratos, una API que imite la suya, endpoints inventados) habría que migrarla después.
- **Plan A (principal):** `packages/trustless` (P1, #55 y #57). Cliente de su API v2 y mapeo de la fianza: un hito con 2 aprobaciones (casero e inquilino), la segunda aprueba y libera; el inquilino es el `receiver`; el staff resuelve las disputas. Lo que suponemos de DeFindex está aislado en `src/defindex.ts` (marcado `// SUPUESTO:`), para cambiar solo ese archivo cuando lo publiquen. `platformFee = 0`, porque TW lo cobra sobre el total.
- **Plan B (reserva):** escrow fork de TW + `FianzaFactory` propios (`contracts/`). La factory está en `main` (#41); el camino feliz con DeFindex está en **#48, en borrador a propósito** (aprobado, CI en verde, probado por P2 contra el vault real de testnet). El camino de parada está en #58. **No se fusiona salvo que el equipo active el plan B**, por ejemplo si DeFindex no llega a tiempo para la demo.
- **Actualización (decisión del equipo, #60):** se va con el plan A y **el plan B no se desarrolla más**. #48 y #58 se quedan en borrador, sin cerrar, solo como respaldo.
- **Actualización (#64, guía de migración de TW a "TrustYield"):** la API con rendimiento es **TW v2 (TrustYield, con vault) con API key de v1**, en `trustless-backend-production.up.railway.app` (sus rutas no llevan `/v2`). Un rol por dirección, así que la doble aprobación es: el casero aprueba (`approve-milestone`) y el inquilino libera (`release-funds`). El rendimiento se consulta con `vault-position` y el sobrante de una disputa sale con `withdraw-remaining-funds`. `packages/trustless` se migra a esta API (lo hace P3 con `cross-area`, revisa P1). Datos de testnet (#62): wasm del escrow `828ae584…4b95`, vault de TW `CCG3G4YU…S7ZJ`, dirección de comisión de TW `GBPUACN7…AMUB`.
- **Comisión de TW sobre la fianza (#62):** TW cobra su 0,3 % (y el `platformFee`) sobre **todo lo retirado**, capital incluido. En una prueba de 10 USDC el inquilino recuperó 9,97. Contradice "la fianza vuelve entera al inquilino" salvo que el rendimiento supere ese 0,3 % (unas 3 semanas al 6 % anual). **Pendiente del equipo:** pedir a TW que cobre solo sobre el rendimiento, compensarlo desde la plataforma o explicarlo en el pitch.
- **Passkeys en el plan A (#60, #61, lo lleva P3):** una passkey (`C…`) puede tener roles (receptor, aprobador), pero la API no la acepta como `signer` (400 `invalid version byte`), porque el XDR que construye tiene como cuenta origen al firmante. Esas acciones habría que construirlas llamando al contrato directamente y patrocinarlas con nuestro Relayer (#62).
- **Consecuencia:** las rutas de `apps/api` (#53) para aprobar y para `view`, `yield` y `preview-settlement` llaman a funciones del escrow que solo existen en #48, así que **fallan en testnet** mientras el plan B no se active. Crear, fondear y cancelar sí funcionan.
- **Lo que el plan A no tiene** (frente al plan B): stop bond, perito pagado por el bond y timeouts (si el casero no responde, el inquilino no puede reclamar solo). Los roles se fijan al desplegar, así que el escrow se despliega cuando el inquilino acepta la invitación.
- **Pendiente de confirmar con Trustless Work:** la forma exacta de los campos de DeFindex y si hay una versión nueva de la API; el calendario en testnet; si los escrows ya creados podrán activarlo; si la API key puede ir en el navegador o solo en un servidor; si su flujo de firmar XDR funciona con smart accounts de passkey; y si su SDK sirve fuera de React.
- **Pendiente del equipo:** qué queda de `apps/api` en el plan A (como mucho, un proxy que guarde la API key).
- **Sustituye en parte a:** "Vuelta al fork de Trustless Work" (el fork pasa a ser el plan B) y "API propia compatible con la Core API v2 de Trustless Work".
- Decide: equipo (recomendación de Trustless Work) · Implementa: P1 (`packages/trustless`) · Revisa: P2

## 2026-10-25 · Spike G2 de P2: vault propio en testnet, USDC de prueba y comisiones
- **Vault propio desplegado** con la factory de DeFindex (`CDSCWE4G…4A32`) en testnet: **`CDKNUOYYDNSHVOKVT7XNQAYUQ7U4OGNJ4Z5DGXY5QW6AIYG6VUPKDOQO`** ("Fianzas USDC Vault", FZUSDC). Activo BlendUSDC `CAQCFVLO…RCJU` (`USDC:GATALTGT…5V56`), estrategia `USDC_blend_strategy` `CALLOM5I…FSUY`, router Soroswap `CCJUD55A…7BRD`, `upgradable = false`, `vault_fee = 100` bps. Roles: emergency, manager y rebalance = `fianzas-admin` (`GBKASLNH…XYQ7`); fee receiver = `fianzas-treasury` (`GBNOMT2V…L4N7`).
- **Para el escrow basta `deposit(…, invest = true)`.** Comprobado: el **primer** depósito del vault se queda ocioso hasta que el manager hace un `rebalance` con `Invest` (lo hizo P2 con 100 USDC); desde entonces los depósitos con `invest = true` van directos a la estrategia (10 USDC más → idle 0, invertido 110,00 USDC) y el rendimiento ya se acumula. El escrow no necesita el rol de rebalance.
- **El vault público `usdc_paltalabs_vault` no sirve**: 33.249 USDC ociosos, 0 invertidos (rinde 0 %) y manager de PaltaLabs.
- **USDC de prueba:** el faucet de Blend testnet (`GET …/getAssets?userId=G…` con `Origin: https://testnet.blend.capital`) **solo da BLND, wETH y wBTC**. El USDC se compra en **Soroswap testnet**, par XLM/USDC `CBR76WMT…YM3V` (`swap_exact_tokens_for_tokens`): 5.000 XLM → 639,87 USDC. Liquidez restante ~1.000 USDC, así que `scripts/fund` reparte con cuidado y las cuentas se refondean con friendbot.
- **Base de la comisión de protocolo (cierra la pendiente):** DeFindex cobra el **20 % de la comisión del vault**, no de las ganancias (`distribute_fees`: `defindex_fee = locked_fee × protocol_rate / 10000`; el resto a nuestro fee receiver). Con `vault_fee = 1 %`, de 100 USDC de ganancia el vault retiene 1 USDC: 0,80 a nuestra tesorería y 0,20 a DeFindex. El ingreso principal sigue siendo el `platform_fee_bps` del escrow.
- **Identidades de despliegue** (CLI local de P2, testnet, fondeadas): `fianzas-admin` GBKASLNH25VETEB5MGCLPIX5DG7SY5PLFOBKMIWMTRFJVQNNJAOHXYQ7 · `fianzas-staff` GAO7MHQHL6LAGUSFGTSDVMISV4UILI33PGOSJEBBR5XB5OXBXKJDR3C2 · `fianzas-treasury` GBNOMT2VMMNGWPENBY2FP66ASRMUVSJRCJZWIZ2ENZ45OYJKSL67L4N7 · `fianzas-faucet` GDHIKULVY3XBBWE53GZNMABKZIHO6G6TLKMUQLY4ODQ2BHFRKWBFYDC3 · `fianzas-read` GDQQBJ4Y6V24VOROSCFZQXKA7IAIG5HETIQMLC36GQ3KF6KAIHP4PRLX.
- Decide: P2 · Revisa: P1 (deposit desde el escrow), P3 (`deployments/testnet.json`)

## 2026-10-25 · El rendimiento lo fija la jurisdicción: en el MVP (Portugal), al casero
- **Decisión:** quién se lleva el rendimiento neto no lo elige el casero en cada fianza: depende de las normas de cada jurisdicción. El MVP y el pitch son para **Portugal**, con **todo el rendimiento neto para el casero** (`tenant_yield_bps = 0`). La fianza sigue volviendo entera al inquilino y el fee de plataforma sigue saliendo solo del rendimiento.
- **Cambio de interfaz propuesto (#16):** `tenant_yield_bps` sale de `FianzaParams` y pasa a `GlobalConfig` (la fija el admin; demo 0). La factory la copia en `Terms.tenant_yield_bps`, así que el escrow, `split()`, `Settlement` y los eventos no cambian. `deployments/testnet.json` lleva `tenantYieldBps` y WEB-14 lo comprueba antes de fondear.
- **UI:** sin presets ni selector. La pantalla de crear fianza, la invitación y el panel solo informan de a quién va el rendimiento, y nunca afirman qué dice la ley.
- **Descartado:** los presets por fianza (todo al inquilino, 50/50, todo al casero, personalizado), porque el reparto es una cuestión legal y no una elección comercial; y dejarlo en `FianzaParams` con la UI enviando 0, porque un casero podría saltárselo llamando a la factory directamente.
- **Sustituye en parte a:** "Reparto del dinero" (el neto ya no va "según el preset del país").
- Decide: P4 · Implementa: P1 (factory), P2 (config del deploy y `deployments`), P4 (UI) · Revisa: equipo

## 2026-10-25 · Todas las fianzas se crean con enlace de invitación
- **Decisión:** el casero siempre crea la fianza con invitación (`tenant: None`, `invite_hash: Some(h)`) y el inquilino la fondea por ese enlace, tenga ya cuenta o no. En la invitación, Face ID inicia sesión si ya tiene cuenta (`wallet.connect()`) o la crea (`wallet.createAccount()`).
- **Sin cambio de interfaz:** el contrato puede seguir aceptando `tenant: Some(t)`; la UI no lo usa.
- **Descartado:** la opción "ya tengo la cuenta del inquilino". Un solo camino es más simple para el casero y para la demo.
- Decide: P4 · Implementa: P4

## 2026-10-25 · Vuelta al fork de Trustless Work (sustituye a "Escrow propio")
- **Decisión:** el escrow vuelve a ser un **fork del Single-Release v2 de Trustless Work** (`single-release-develop-v2` @ `1d22d0c`, con v1 @ `f0b706e` como plan B). Se cambian los roles y se añade el movimiento escrow → DeFindex → escrow → reparto. Se recupera `NOTICE.md` con la atribución.
- **Motivo:** decisión del equipo. La V2 de Trustless Work aún no está publicada. Partir de su código auditado (v1, Runtime Verification) es mejor que escribirlo desde cero, y el pitch puede decir "construido sobre Trustless Work".
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
- **Confirmado en el spike:** la comisión de protocolo es el 20 % de la comisión del vault (ver "Spike G2 de P2"). En el PoC se fijarán los números: `vault_fee` y `platform_fee_bps` a la vez, para no cobrar dos veces lo mismo sin querer.
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
  - No hay `NOTICE` de TW ni cabeceras de origen.
  - Desaparece el fee de TW (`tw_fee_bps`, `tw_fee_receiver`, `Settlement.to_tw`) y `get_roles()`.
  - El pitch no dice "construido sobre Trustless Work".
- **Motivo:** quita código que no necesitamos (milestones, reparto libre, funciones de admin).
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
  - El escrow parte del contrato de **Trustless Work** (Single-Release) (ver `NOTICE.md`).
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
  - **Solo se reparte el rendimiento:** `platform_fee_bps` para la plataforma (propuesta: 20 %) y el neto según `tenant_yield_bps`. ~~El preset del país: todo al inquilino, 50/50, todo al casero o personalizado.~~ **Sustituido:** lo fija la jurisdicción en `GlobalConfig` (ver "El rendimiento lo fija la jurisdicción", arriba).
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
- [x] Base del fork de Trustless Work (P1): v2 `single-release-develop-v2` @ `1d22d0c`. Compila con `soroban-sdk 28.0.0` y nuestro toolchain (Rust 1.99.1, stellar-cli 28.1.0), los 57 tests upstream pasan y el wasm de release pesa 35 910 bytes. No hace falta el plan B (v1).
- [x] Vault propio de DeFindex en testnet sobre `USDC_blend_strategy` y cómo fondearlo (P2): `CDKNUOYY…KDOQO`, USDC vía Soroswap
- [ ] ¿`@trustless-work/escrow-js` acepta nuestra `baseUrl` y los campos extra? (P2)
- [x] Base de cálculo de la comisión de protocolo de DeFindex (P2): 20 % de la comisión del vault
- [x] Kit de passkeys: smart-account-kit (P3)
- [ ] Anchor: testanchor con SEP-45 o ramp simulado (P3)
- [ ] Quién asume una pérdida del vault más allá del rendimiento (equipo, antes de G1)
