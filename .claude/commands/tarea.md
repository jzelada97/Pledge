---
description: Empezar una tarea a partir de un issue de GitHub
argument-hint: <número de issue>
---
Vas a empezar el issue #$ARGUMENTS.

1. Lee el rol en `harness/.role`. Si no existe, para y pide al humano `node scripts/harness/setup.mjs P<n>`.
2. Lee el issue con `gh issue view $ARGUMENTS`. Si es de otro rol, dilo y para.
3. Ponte al día: `git fetch origin` y `git switch main && git merge --ff-only origin/main`.
4. Crea la rama `p<n>/<slug-corto-del-issue>` (minúsculas, guiones, ≤ 50 caracteres) con `git switch -c`.
5. Lee `docs/INTERFACES.md`, la fase del issue en `docs/PIPELINE.md` y el `CLAUDE.md` de tu carpeta.
6. Si el issue depende de algo de otro rol que no existe todavía, planifica un mock **dentro de tu carpeta** que cumpla INTERFACES.
7. Asígnate el issue: `gh issue edit $ARGUMENTS --add-assignee @me`.
8. Propón al humano un plan corto (3–6 pasos) con los archivos que vas a tocar, todos dentro de tu área, y el criterio de "hecho" del issue. Espera su OK antes de editar.
