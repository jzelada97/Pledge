---
description: Traer lo último de main a tu rama sin reescribir historia
---
1. Si hay cambios sin commitear, pregunta al humano si hace commit o `git stash` antes de seguir.
2. `git fetch origin` y `git merge origin/main` (merge, nunca rebase: el pre-push bloquea reescribir historia).
3. Si hay conflictos:
   - En archivos de **tu área**: resuélvelos tú y explica qué elegiste.
   - En archivos de **otra área**: quédate con la versión de `origin/main` (`git checkout --theirs <archivo>`), porque el dueño manda en su carpeta.
   - En `docs/INTERFACES.md` u otra área compartida: para y avisa al humano.
4. Si `main` trae cambios en `contracts/escrow` o `packages/bindings`, recuerda que los tipos del front pueden haber cambiado: ejecuta el typecheck de tu área.
5. Ejecuta los tests de tu área y resume qué ha entrado de `main` (`git log --oneline HEAD@{1}..HEAD`).
