---
description: Liberar el lock de un área compartida
argument-hint: <área>
---
Antes de liberar, comprueba con `gh pr list --author @me --state open` que no queda un PR tuyo abierto que toque esa área. Si queda uno, avisa al humano: el lock se libera después del merge.

Si no queda ninguno, ejecuta `node scripts/harness/lock.mjs release $ARGUMENTS`.
