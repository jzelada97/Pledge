// Genera .github/CODEOWNERS a partir de harness/team.json.
//   node scripts/harness/sync-codeowners.mjs
// Regla del equipo: cualquier PR lo puede aprobar cualquiera de los otros tres, así que
// los 4 son code owners de todo. Quién edita cada carpeta lo controlan el guard y la CI,
// no CODEOWNERS.
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { ROOT, TEAM } from "./lib.mjs";

const everyone = Object.values(TEAM.roles).map((r) => "@" + r.github).join(" ");
const lines = [
  "# Generado por scripts/harness/sync-codeowners.mjs desde harness/team.json. No editar a mano.",
  "# Cualquier miembro del equipo (que no sea el autor) puede aprobar cualquier PR.",
  `* ${everyone}`,
];

mkdirSync(join(ROOT, ".github"), { recursive: true });
writeFileSync(join(ROOT, ".github", "CODEOWNERS"), lines.join("\n") + "\n");
console.log("✔ .github/CODEOWNERS actualizado");
const missing = Object.entries(TEAM.roles).filter(([, r]) => r.github.startsWith("CAMBIAR")).map(([k]) => k);
if (missing.length) console.log(`⚠ Faltan usuarios de GitHub en harness/team.json para: ${missing.join(", ")}`);
