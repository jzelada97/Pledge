// Prepara este clon para una persona del equipo.
//   node scripts/harness/setup.mjs P1|P2|P3|P4
import { writeFileSync, chmodSync, existsSync } from "node:fs";
import { join } from "node:path";
import { ROOT, TEAM, git, gh } from "./lib.mjs";

const role = (process.argv[2] ?? "").toUpperCase();
if (!TEAM.roles[role]) {
  console.error(`Uso: node scripts/harness/setup.mjs ${Object.keys(TEAM.roles).join("|")}`);
  process.exit(1);
}

writeFileSync(join(ROOT, "harness", ".role"), role + "\n");
git(["config", "core.hooksPath", ".githooks"]);
for (const h of ["commit-msg", "pre-push"]) {
  const p = join(ROOT, ".githooks", h);
  if (existsSync(p)) chmodSync(p, 0o755);
}

console.log(`✔ Rol ${role} · ${TEAM.roles[role].name}`);
console.log("✔ Hooks de git activados (.githooks)");
console.log("  Tus carpetas:");
for (const a of TEAM.areas.filter((x) => x.owner === role)) console.log(`   - ${a.paths.join(", ")}  (scope: ${a.scopes.join(", ")})`);

try {
  const login = gh(["api", "user", "--jq", ".login"]);
  console.log(`✔ GitHub CLI con sesión de @${login}`);
  if (TEAM.roles[role].github.toLowerCase() !== login.toLowerCase()) {
    console.log(`⚠ En harness/team.json el ${role} figura como "${TEAM.roles[role].github}". Si eres tú, pide al integrador (${TEAM.integrator}) que lo cambie.`);
  }
} catch (e) {
  console.log(`⚠ ${e.message}`);
  console.log("  Sin gh no funcionan /estado, /lock ni /bloqueo.");
}
console.log("\nSiguiente paso: abre Claude Code en la raíz del repo y usa /tarea <número de issue>.");
