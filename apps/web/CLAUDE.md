# apps/web · área libre (desde el 26-oct, #111)

Panel del casero (desktop) y flujo del inquilino (móvil, mobile-first). **Solo plan A** (`docs/DECISIONS.md`): el escrow es de Trustless Work y se maneja por `apps/api`.

## Reglas
- Habla con el escrow solo a través de `apps/api` (`/api/fianzas/v1/…`) y firma solo con `packages/wallet`. `packages/bindings` es del plan B (descartado): no lo uses.
- Direcciones de contratos: de `deployments/testnet.json`, nunca escritas a mano.
- Lenguaje de usuario: "fianza", "aprobar devolución", "parar devolución", "rendimiento". Nunca "wallet", "seed", "XLM", "gas", "transacción".
- Cada acción que firma muestra 3 estados: firmando (Face ID), enviando, hecho o error con un mensaje que diga qué hacer.
- **Rendimiento:** variable, nunca "garantizado", "0 riesgo" ni "sin riesgo". El vault es el de DeFindex de Trustless Work (Blend USDC); no hay selector de estrategia. El reparto del sobrante tras una disputa lo fija la jurisdicción (`tenantYieldBps`; Portugal = 0, al casero): la UI solo informa y nunca afirma qué dice la ley.
- **Así funciona:** primero aprueba el casero y después el inquilino libera, y recibe fianza + rendimiento − el 0,3 % de TW (`t.invitation.twFee`).
- **No existen** el depósito por parar (*good-faith deposit*), el perito, el plazo para que el inquilino reclame ni el plazo del staff. No los muestres: ni el botón "Claim", ni "within 30 days", ni "expert".
- **Parar devolución:** solo el casero, antes de aprobar y sin coste. Antes de firmar, explica que el staff de Pledge revisa el caso y decide el reparto.
- **Reparto:** muestra siempre por separado la fianza (vuelve entera) y el rendimiento (cuánto va a cada parte y a la plataforma).
- El ramp simulado (`anchor.isSimulated`) se muestra con una etiqueta visible.
