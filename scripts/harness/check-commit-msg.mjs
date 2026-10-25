// Valida el mensaje de commit. Uso: node scripts/harness/check-commit-msg.mjs <archivo-del-mensaje>
// También acepta --text "<mensaje>" para validar un título de PR.
import { readFileSync } from "node:fs";
import { TEAM, commitRegExp, COMMIT_EXEMPT_RE, allScopes, areaForScope, readRole } from "./lib.mjs";

const args = process.argv.slice(2);
const raw = args[0] === "--text" ? args.slice(1).join(" ") : readFileSync(args[0], "utf8");
const lines = raw.split(/\r?\n/).filter((l) => !l.startsWith("#"));
const subject = (lines.find((l) => l.trim() !== "") ?? "").trim();

if (COMMIT_EXEMPT_RE.test(subject)) process.exit(0);

if (!commitRegExp().test(subject)) {
  console.error(`
✖ Formato de commit no válido:
    "${subject}"

  Formato:  tipo(scope): descripción en imperativo (3–72 caracteres)
  Tipos:    ${TEAM.commitTypes.join(", ")}
  Scopes:   ${allScopes().join(", ")}
  Ruptura:  tipo(scope)!: …  y "BREAKING: …" en el cuerpo
  Ejemplo:  feat(escrow): añadir approve_release con doble aprobación
`);
  process.exit(1);
}

const scope = /\(([^)]+)\)/.exec(subject)[1];
const area = areaForScope(scope);
const role = readRole();
if (role && area && area.owner && area.owner !== "*" && area.owner !== role) {
  console.error(`⚠ Aviso: el scope "${scope}" es del área de ${area.owner} y tú eres ${role}. Si es correcto, sigue; el PR necesitará la etiqueta "${TEAM.labels.crossArea}".`);
}
if (subject.includes(")!:") && !/^BREAKING: /m.test(raw)) {
  console.error('✖ Un commit con "!" debe explicar la ruptura en el cuerpo con una línea "BREAKING: …".');
  process.exit(1);
}
process.exit(0);
