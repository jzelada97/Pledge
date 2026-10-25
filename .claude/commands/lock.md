---
description: Tomar el lock de un área compartida (interfaces, harness, ci, deps)
argument-hint: <área> [motivo]
---
Ejecuta `node scripts/harness/lock.mjs take $ARGUMENTS`.

- Si lo consigue: recuerda al humano que el lock dura como mucho 30 minutos y se libera con `/unlock <área>` cuando se fusione el PR.
- Si lo tiene otra persona: muestra quién y desde cuándo, y propón seguir con otra tarea o un mock mientras tanto. No intentes editar el área.
