// Configura el repo de GitHub una sola vez (lo ejecuta el integrador tras el primer push a main).
//   node scripts/harness/init-github.mjs
// Crea las etiquetas, deja solo "squash merge", borra ramas al fusionar y protege main.
// Nota: proteger ramas en repos privados requiere GitHub Pro/Team; en repos públicos es gratis.
import { TEAM, gh } from "./lib.mjs";

const repo = gh(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]);
console.log(`Repo: ${repo}`);

const labels = [
  [TEAM.labels.blocked, "d73a4a", "Alguien está parado esperando a otra persona"],
  [TEAM.labels.lock, "5319e7", "Lock de un área compartida"],
  [TEAM.labels.crossArea, "fbca04", "PR que toca el área de otro rol, aprobado por su dueño"],
  [TEAM.labels.interfaceChange, "0e8a16", "Propuesta de cambio en docs/INTERFACES.md"],
  ...Object.entries(TEAM.roles).map(([k, r]) => [k, "c5def5", r.name]),
];
for (const [name, color, description] of labels) {
  gh(["label", "create", name, "--color", color, "--description", description, "--force"]);
  console.log(`✔ Etiqueta ${name}`);
}

// Los code owners necesitan permiso de escritura; cada persona acepta la invitación en github.com/notifications.
const me = gh(["api", "user", "--jq", ".login"]).toLowerCase();
for (const [k, r] of Object.entries(TEAM.roles)) {
  if (r.github.toLowerCase() === me) continue;
  gh(["api", "-X", "PUT", `repos/${repo}/collaborators/${r.github}`, "-f", "permission=push"]);
  console.log(`✔ Invitación de escritura enviada a @${r.github} (${k})`);
}

gh(["api", "-X", "PATCH", `repos/${repo}`,
  "-F", "allow_squash_merge=true", "-F", "allow_merge_commit=false", "-F", "allow_rebase_merge=false",
  "-F", "delete_branch_on_merge=true", "-f", "squash_merge_commit_title=PR_TITLE", "-f", "squash_merge_commit_message=PR_BODY"]);
console.log("✔ Solo squash merge, título del commit = título del PR, ramas borradas al fusionar");

const protection = {
  required_status_checks: { strict: false, contexts: ["harness", "tests"] },
  enforce_admins: true,
  required_pull_request_reviews: { required_approving_review_count: 1, require_code_owner_reviews: true, dismiss_stale_reviews: false },
  restrictions: null,
  required_linear_history: true,
  allow_force_pushes: false,
  allow_deletions: false,
};
const { execFileSync } = await import("node:child_process");
execFileSync("gh", ["api", "-X", "PUT", `repos/${repo}/branches/main/protection`, "--input", "-"], {
  input: JSON.stringify(protection),
  stdio: ["pipe", "ignore", "inherit"],
});
console.log("✔ main protegida: PR obligatorio, 1 aprobación de code owner, CI (harness + tests), sin force push");
