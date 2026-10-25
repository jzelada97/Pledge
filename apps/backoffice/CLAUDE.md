# apps/backoffice · P4

Herramienta interna del staff: cola de fianzas paradas → asignar perito → registrar el hash del informe → resolver la deducción.

- Solo la cuenta `staff` de `deployments/testnet.json` puede firmar `assign_expert`, `record_report` y `resolve`. La UI comprueba la cuenta conectada antes de mostrar acciones.
- Al resolver, el staff marca **"parada justificada: sí/no"** (`stop_justified`). La UI impide combinaciones incoherentes: si no estaba justificada, la deducción es 0. Tampoco deja resolver sin el hash del informe del perito.
- Muestra el tiempo que queda hasta el timeout de revisión de cada fianza parada.
- El informe del perito se guarda fuera de la cadena. On-chain solo va su hash SHA-256 (`BytesN<32>`).
- Si hay que recortar alcance, el backoffice se sustituye por un script en `scripts/e2e/` (de P2): avisa con un issue.
