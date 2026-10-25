// PreToolUse (Edit|Write|MultiEdit|NotebookEdit): bloquea ediciones fuera del área del rol.
// Exit 2 = bloquear; el mensaje de stderr le llega a Claude.
import { readFileSync } from "node:fs";
import { TEAM, toRepoPath, areaFor, readRole, describeArea, openLocks, ghLogin, lockTitle } from "../../scripts/harness/lib.mjs";

function block(msg) {
  process.stderr.write(`[harness] ${msg}\n`);
  process.exit(2);
}

let input = {};
try {
  input = JSON.parse(readFileSync(0, "utf8") || "{}");
} catch {
  process.exit(0);
}
const file = input.tool_input?.file_path ?? input.tool_input?.notebook_path;
if (!file) process.exit(0);

const repoPath = toRepoPath(file);
if (!repoPath) process.exit(0); // fuera del repo (scratch, temporales…)

const role = readRole();
if (!role || !TEAM.roles[role]) {
  block("No sé qué rol tienes. Pide al humano que ejecute: node scripts/harness/setup.mjs P1|P2|P3|P4");
}

const area = areaFor(repoPath);
if (!area || area.owner === "*") process.exit(0);

if (area.generated) {
  block(`${repoPath} es código generado (${describeArea(area)}). No se edita a mano: ejecuta scripts/bindings.sh.`);
}

if (area.owner === role) process.exit(0);

if (area.shared) {
  let locks, me;
  try {
    locks = openLocks();
    me = ghLogin();
  } catch (e) {
    block(`${repoPath} está en el ${describeArea(area)} y no he podido comprobar el lock: ${e.message}`);
  }
  const lock = locks.find((l) => l.area === area.id);
  if (lock && lock.holder === me) process.exit(0);
  if (lock) {
    block(`${repoPath} está en el ${describeArea(area)} y el lock lo tiene @${lock.holder} (${lock.url}). Espera a que lo libere o coordínalo con esa persona. Mientras, sigue con un mock en tu carpeta.`);
  }
  block(`${repoPath} está en el ${describeArea(area)}. Toma el lock primero con /lock ${area.id} (crea el issue "${lockTitle(area.id)}") y vuelve a intentarlo.`);
}

const owner = TEAM.roles[area.owner];
block(
  `${repoPath} pertenece al ${describeArea(area)}. Tú eres ${role}. No la edites: ` +
    `si te bloquea, abre un issue con /bloqueo; si cambia una firma o tipo, usa la plantilla "Cambio de interfaz" y avisa a @${owner?.github}. ` +
    `Mientras tanto, crea un mock dentro de tu carpeta.`,
);
