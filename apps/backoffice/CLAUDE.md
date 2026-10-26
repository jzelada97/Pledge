# apps/backoffice · área libre (desde el 26-oct, #111)

Herramienta interna del staff, **solo plan A** (`docs/DECISIONS.md`). Flujo: cola de fianzas paradas → **resolver** (deducción al casero, resto al inquilino) → **repartir el rendimiento sobrante**.

- Rutas de `apps/api`:
  - `POST /api/fianzas/v1/fianzas/{id}/resolve` `{ resolver, deduction, stopJustified }`;
  - `POST …/{id}/distribute-yield` `{ resolver }`;
  - vista previa en `GET …/{id}/preview-settlement?deduction=`, que muestra los importes brutos y `afterTwFee`.
- Solo puede firmar la cuenta `staff` de `deployments/testnet.json` (una cuenta G, con Freighter o la CLI). La UI comprueba la cuenta conectada antes de mostrar acciones.
- `stopJustified = false` exige una deducción de 0: la API responde `422 FZ_INCOHERENT_RESOLUTION`.
- **No existen** el perito, el informe ni su hash, ni los plazos de revisión. No los muestres. Si queda una columna o un botón de eso, quítalo.
- La deducción va de 0 al importe de la fianza. Si el vault perdió valor, se reparte lo que queda (`buildResolveBody` de `@fianzas/trustless`).
