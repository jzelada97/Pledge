// Panel del equipo: PRs abiertos, bloqueos, locks y cambios de interfaz pendientes.
//   node scripts/harness/status.mjs
import { TEAM, gh, openLocks, roleFromBranch } from "./lib.mjs";

const mins = (iso) => Math.round((Date.now() - new Date(iso).getTime()) / 60000);
const fmt = (m) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`);
const warn = (cond) => (cond ? " ⚠" : "");

try {
  const [prs, blockers, changes] = [
    gh(["pr", "list", "--state", "open", "--limit", "50", "--json", "number,title,author,headRefName,reviewDecision,isDraft,createdAt,statusCheckRollup,url"], { json: true }),
    gh(["issue", "list", "--label", TEAM.labels.blocked, "--state", "open", "--limit", "50", "--json", "number,title,author,assignees,createdAt,url"], { json: true }),
    gh(["issue", "list", "--label", TEAM.labels.interfaceChange, "--state", "open", "--limit", "50", "--json", "number,title,author,createdAt,url"], { json: true }),
  ];
  const locks = openLocks();

  console.log("\n== PRs abiertos ==");
  if (!prs.length) console.log("  (ninguno)");
  for (const p of prs) {
    const checks = p.statusCheckRollup ?? [];
    const ci = checks.some((c) => ["FAILURE", "ERROR"].includes(c.conclusion ?? c.state)) ? "CI ✖"
      : checks.some((c) => (c.status ?? c.state) !== "COMPLETED" && c.state !== "SUCCESS") ? "CI …" : "CI ✔";
    const review = p.isDraft ? "borrador" : p.reviewDecision === "APPROVED" ? "aprobado" : p.reviewDecision === "CHANGES_REQUESTED" ? "cambios pedidos" : "sin revisar";
    const m = mins(p.createdAt);
    console.log(`  #${p.number} [${roleFromBranch(p.headRefName) ?? "?"}] ${p.title}\n      ${ci} · ${review} · abierto hace ${fmt(m)}${warn(m > 120)}`);
  }

  console.log("\n== Bloqueos ==");
  if (!blockers.length) console.log("  (ninguno)");
  for (const b of blockers) {
    const m = mins(b.createdAt);
    const who = b.assignees?.map((a) => "@" + a.login).join(", ") || "sin asignar";
    console.log(`  #${b.number} ${b.title}\n      de @${b.author.login} → ${who} · hace ${fmt(m)}${warn(m > 15)}`);
  }

  console.log("\n== Locks ==");
  if (!locks.length) console.log("  (ninguno)");
  for (const l of locks) {
    const m = mins(l.createdAt);
    console.log(`  ${l.area} · @${l.holder} · hace ${fmt(m)}${warn(m > 30)}`);
  }

  console.log("\n== Cambios de interfaz pendientes ==");
  if (!changes.length) console.log("  (ninguno)");
  for (const c of changes) console.log(`  #${c.number} ${c.title} · de @${c.author.login} · hace ${fmt(mins(c.createdAt))}`);
  console.log("\n⚠ = PR > 2 h, bloqueo > 15 min o lock > 30 min.\n");
} catch (e) {
  console.error(`✖ ${e.message}`);
  process.exit(1);
}
