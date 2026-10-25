# packages/anchor · P3

Depósito y retiro desde el banco con SEP-24. API pública: `docs/INTERFACES.md` § 5.

- Testnet: `testanchor.stellar.org`. Las cuentas con passkey (C-address) necesitan **SEP-45**, que sigue en Draft: compruébalo en el spike de G2.
- **Plan B:** si SEP-45 no funciona, implementa la misma interfaz con `isSimulated = true` (ramp simulado). La UI debe mostrarlo; nunca lo presentes como real en la demo.
- Producción (no en la hackatón): MYKOBO para EUR ↔ EURC por SEPA. Pendiente de confirmar tarifas y qué EURC entrega.
