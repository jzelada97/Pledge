---
description: Checks del área, commit con formato, push y PR
argument-hint: "[número de issue]"
---
Prepara y abre el PR de la rama actual. Issue: $ARGUMENTS (si está vacío, sácalo del nombre de la rama o pregunta).

1. Comprueba que no estás en `main`. Si lo estás, para.
2. Propiedad: `node scripts/harness/check-ownership.mjs --local`. Si falla, saca del cambio los archivos de otras áreas (no los fuerces) y explica al humano qué hacer con ellos.
3. Checks de tu área, según `harness/.role`:
   - P1: `cargo fmt -p escrow -- --check && cargo clippy -p escrow -- -D warnings && cargo test -p escrow`
   - P2: `cargo test -p mock-vault -p yield-adapter` y, si hay cambios en `scripts/`, su typecheck
   - P3: `pnpm --filter ./packages/wallet --filter ./packages/anchor typecheck test`
   - P4: `pnpm --filter ./apps/web --filter ./apps/backoffice typecheck lint test`
   Si algo falla, arréglalo dentro de tu área o para y explica por qué no puedes.
4. Commit con `git add` de archivos concretos (nunca `git add -A` a ciegas) y mensaje `tipo(scope): descripción` (ver CLAUDE.md), con `Refs: #<issue>` en el cuerpo. Nunca `--no-verify`.
5. `git push -u origin HEAD`.
6. Abre el PR con `gh pr create --base main --title "<tipo(scope): descripción>" --body "<cuerpo>"`. El cuerpo sigue `.github/pull_request_template.md` rellenado: qué cambia, `Closes #<issue>`, cómo probarlo, y la checklist marcada solo con lo que se cumple de verdad.
7. Si el PR toca `contracts/escrow`, añade un comentario mencionando al integrador (P2 en `harness/team.json`) para regenerar bindings tras el merge.
8. Si tienes un lock abierto, recuerda al humano que lo libere con `/unlock <área>` **después** del merge.
9. Devuelve la URL del PR.
