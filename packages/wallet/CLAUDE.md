# packages/wallet · P3

Cuenta con passkey y envío sin fees. API pública: `docs/INTERFACES.md` § 4. P4 consume solo esa API.

## Stack
- `smart-account-kit` (o `passkey-kit`, según la decisión de G2 en `docs/DECISIONS.md`). No mezcles los dos: no son compatibles.
- OpenZeppelin Relayer (Channels) para patrocinar fees. Testnet: `https://channels.openzeppelin.com/testnet`, API key en `.env.local` (`RELAYER_API_KEY`), nunca en el repo.

## Reglas
- La API no expone términos cripto: nada de "seed", "XLM" ni "gas" en mensajes de error que lleguen al usuario.
- Los errores se devuelven como `WalletError` con un `code` estable (`USER_CANCELLED`, `RELAYER_DOWN`, `SIMULATION_FAILED`, …) para que P4 los traduzca.
- Mantén un `FakeWallet` exportado con la misma interfaz para tests y para el front mientras no haya testnet.
