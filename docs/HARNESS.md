# Harness del equipo · Fianzas de habitación en Soroban

Guía del equipo: cómo trabajamos con el harness (roles, áreas, locks, hooks y PRs). Qué es el proyecto y cómo probarlo: [`README.md`](../README.md).

- Reglas del equipo y del harness: [`CLAUDE.md`](../CLAUDE.md)
- Fases, puertas y reparto de las 28 h: [`docs/PIPELINE.md`](PIPELINE.md)
- Contrato entre piezas: [`docs/INTERFACES.md`](INTERFACES.md)
- Decisiones: [`docs/DECISIONS.md`](DECISIONS.md)

## Puesta en marcha

### Una vez, el integrador (P2)
1. Crea el repo vacío en GitHub y sube este contenido a `main`:
   ```bash
   git init -b main && git add -A && git commit -m "chore(harness): harness inicial del equipo"
   git remote add origin https://github.com/<usuario>/<repo>.git
   git push -u origin main
   ```
   Es el único push directo a `main`: el hook `pre-push` aún no está activo porque nadie ha ejecutado `setup`.
2. Configura GitHub (invita al equipo con permiso de escritura, crea las etiquetas, deja solo squash merge y protege `main`):
   ```bash
   node scripts/harness/init-github.mjs
   ```
   Proteger ramas en un repo **privado** requiere GitHub Pro o Team. En un repo público es gratis.
3. Cada persona acepta la invitación en github.com/notifications. Hasta entonces, sus aprobaciones no cuentan como code owner.

Los usuarios ya están en [`harness/team.json`](../harness/team.json) y el `CODEOWNERS` ya está generado. Si cambia alguien, edita `team.json` y ejecuta `node scripts/harness/sync-codeowners.mjs`.

### Cada persona
Requisitos: Git, Node 20+, [GitHub CLI](https://cli.github.com) con `gh auth login`, Claude Code. Además, según el rol: Rust + `stellar` CLI (P1, P2) o pnpm (P3, P4).
```bash
git clone https://github.com/<usuario>/<repo>.git && cd <repo>
node scripts/harness/setup.mjs P1   # tu rol: P1, P2, P3 o P4
```
Después abre Claude Code en la raíz del repo y usa `/estado` y `/tarea <issue>`.

## Cómo funciona el harness
| Pieza | Qué impide | Dónde |
|---|---|---|
| Reparto de áreas | Fuente única de quién es dueño de qué | `harness/team.json` |
| Guard de Claude Code | Que Claude edite fuera de tu área o en un área compartida sin lock | `.claude/hooks/guard-ownership.mjs` |
| Permisos de Claude Code | `push --force`, push a `main`, `--no-verify`, `rebase`, leer `.env.local` | `.claude/settings.json` |
| Hook `commit-msg` | Commits sin formato `tipo(scope): …` | `.githooks/commit-msg` |
| Hook `pre-push` | Push a `main`, borrar ramas y reescribir historia | `.githooks/pre-push` |
| CI `harness` | PR que tocan otra área sin `cross-area`, áreas compartidas sin lock, ramas o títulos sin formato | `.github/workflows/ci.yml` |
| CI `tests` | Fusionar con tests, clippy o typecheck en rojo | `.github/workflows/ci.yml` |
| CODEOWNERS + protección | Fusionar sin la aprobación de otro miembro del equipo | `.github/CODEOWNERS` |
| Locks | Dos personas editando un área compartida a la vez | issues con etiqueta `lock` |
| Bloqueos | Gente parada sin que nadie lo sepa | issues con etiqueta `bloqueado`, `/estado` |

**Límite conocido:** el guard frena a Claude Code, no a una persona editando a mano. Para eso están la CI y CODEOWNERS, que son la barrera final.
