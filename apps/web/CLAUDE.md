# apps/web · P4

Panel del casero (desktop) y flujo del inquilino (móvil, mobile-first).

## Reglas
- Habla con el contrato solo a través de `packages/bindings` y firma solo con `packages/wallet`. Mientras no estén, usa mocks locales con las formas de `docs/INTERFACES.md` y bórralos al integrar.
- Direcciones de contratos: de `deployments/testnet.json`, nunca escritas a mano.
- Lenguaje de usuario: "fianza", "aprobar devolución", "parar devolución", "rendimiento". Nunca "wallet", "seed", "XLM", "gas", "transacción".
- Cada acción que firma muestra 3 estados: firmando (Face ID), enviando, hecho o error con un mensaje que diga qué hacer.
- **Rendimiento:** a quién va lo fija la jurisdicción (`GlobalConfig.tenant_yield_bps`, issue #16), no el casero: no hay presets ni selector. MVP en Portugal: todo el rendimiento neto al casero. La UI solo informa de a quién va y nunca afirma qué dice la ley.
- **Estrategia de rendimiento:** el casero la ve al proponer, con el nivel de riesgo y el APY leídos en vivo, como "~X %, variable". Nunca "garantizado", "0 riesgo" ni "sin riesgo". Por defecto, Fixed Pool USDC.
- **Parar devolución:** antes de firmar, muestra cuánto cuesta el depósito de buena fe y la regla: "si el perito te da la razón, se te devuelve; si no, se destina a pagar el perito".
- **Reparto:** muestra siempre por separado la fianza (vuelve entera) y el rendimiento (cuánto va a cada parte y a la plataforma).
- El ramp simulado (`anchor.isSimulated`) se muestra con una etiqueta visible.
