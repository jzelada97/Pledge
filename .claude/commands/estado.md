---
description: Panel del equipo (PRs, bloqueos, locks, cambios de interfaz)
---
Ejecuta `node scripts/harness/status.mjs` y muestra el resultado.

Después, en 3–5 líneas:
- Qué PR de otro rol está esperando **mi** revisión (soy el rol de `harness/.role`).
- Qué bloqueo está asignado a mí.
- Cualquier ⚠ (PR > 2 h, bloqueo > 15 min, lock > 30 min) y la acción concreta para resolverlo.
