// Comprueba que una rama solo toca su área. Lo usa la CI y /pr.
//   CI:     BASE_REF, HEAD_REF, PR_TITLE, PR_LABELS (JSON), PR_AUTHOR, GH_TOKEN en el entorno
//   Local:  node scripts/harness/check-ownership.mjs --local
import { TEAM, git, areaFor, describeArea, roleFromBranch, BRANCH_RE, commitRegExp, openLocks } from "./lib.mjs";

const local = process.argv.includes("--local");
const base = process.env.BASE_REF || "main";
const branch = process.env.HEAD_REF || git(["rev-parse", "--abbrev-ref", "HEAD"]);
const labels = local ? [] : JSON.parse(process.env.PR_LABELS || "[]").map((l) => (typeof l === "string" ? l : l.name));
const errors = [];
const notes = [];

if (!BRANCH_RE.test(branch)) {
  errors.push(`La rama "${branch}" no sigue el formato p<n>/<tarea-en-minusculas> (ej. p1/approve-release).`);
}
const role = roleFromBranch(branch);

if (!local && process.env.PR_TITLE !== undefined && !commitRegExp().test(process.env.PR_TITLE)) {
  errors.push(`El título del PR "${process.env.PR_TITLE}" no sigue el formato tipo(scope): descripción. Se usa como mensaje del squash.`);
}

let files = [];
try {
  files = git(["diff", "--name-only", `origin/${base}...HEAD`]).split("\n").filter(Boolean);
} catch {
  files = git(["diff", "--name-only", `${base}...HEAD`]).split("\n").filter(Boolean);
}

const crossArea = labels.includes(TEAM.labels.crossArea);
const sharedTouched = new Set();
for (const f of files) {
  const area = areaFor(f);
  if (!area || area.owner === "*" || area.owner === role) continue;
  if (area.generated) {
    if (role !== TEAM.integrator) errors.push(`${f}: código generado; solo lo actualiza ${TEAM.integrator} con scripts/bindings.sh.`);
    continue;
  }
  if (area.shared) {
    sharedTouched.add(area.id);
    continue;
  }
  if (crossArea) notes.push(`${f}: ${describeArea(area)} (permitido por la etiqueta "${TEAM.labels.crossArea}").`);
  else errors.push(`${f}: ${describeArea(area)}. La rama es de ${role ?? "?"}. Sácalo del PR o pide al dueño la etiqueta "${TEAM.labels.crossArea}".`);
}

if (sharedTouched.size) {
  if (local) {
    notes.push(`Tocas áreas compartidas (${[...sharedTouched].join(", ")}): mantén el lock hasta que se fusione el PR.`);
  } else {
    let locks = [];
    try {
      locks = openLocks();
    } catch (e) {
      errors.push(`No he podido leer los locks: ${e.message}`);
    }
    for (const id of sharedTouched) {
      const lock = locks.find((l) => l.area === id);
      if (!lock) errors.push(`Área compartida "${id}" modificada sin lock abierto. Toma /lock ${id} y relanza la CI.`);
      else if (process.env.PR_AUTHOR && lock.holder !== process.env.PR_AUTHOR)
        errors.push(`Área compartida "${id}": el lock lo tiene @${lock.holder}, no @${process.env.PR_AUTHOR}.`);
      else notes.push(`Área compartida "${id}" con lock de @${lock.holder} (${lock.url}).`);
    }
  }
}

console.log(`Rama ${branch} (${role ?? "sin rol"}) · ${files.length} archivo(s) cambiados respecto a ${base}.`);
for (const n of notes) console.log(`  · ${n}`);
if (errors.length) {
  console.error("\n✖ Problemas de propiedad:");
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log("✔ Propiedad correcta.");
