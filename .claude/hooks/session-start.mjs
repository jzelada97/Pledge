// SessionStart: lo que imprime se añade al contexto de Claude al abrir la sesión.
import { TEAM, readRole, git } from "../../scripts/harness/lib.mjs";

const role = readRole();
const lines = [];
if (!role || !TEAM.roles[role]) {
  lines.push("[harness] Este clon no tiene rol. Antes de editar nada, pide al humano: node scripts/harness/setup.mjs P1|P2|P3|P4");
} else {
  const mine = TEAM.areas.filter((a) => a.owner === role).flatMap((a) => a.paths);
  lines.push(`[harness] Rol: ${role} · ${TEAM.roles[role].name}. Tus carpetas: ${mine.join(", ")}.`);
}
try {
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
  if (branch === "main") lines.push("[harness] Estás en main. Crea una rama p<n>/<tarea> antes de cambiar nada (/tarea <issue>).");
  else lines.push(`[harness] Rama actual: ${branch}.`);
} catch {
  // Sin git todavía: no hay nada que decir.
}
lines.push("[harness] Reglas en CLAUDE.md. Contrato entre piezas: docs/INTERFACES.md. Fases: docs/PIPELINE.md.");
process.stdout.write(lines.join("\n") + "\n");
