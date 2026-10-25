// Utilidades compartidas del harness. Sin dependencias: solo Node >= 20.
import { readFileSync, existsSync, realpathSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, basename, join, relative, resolve, isAbsolute, sep } from "node:path";
import { fileURLToPath } from "node:url";

// Ruta canónica aunque el archivo aún no exista: en Windows expande nombres cortos (JOSEZE~1)
// y unifica mayúsculas, para que la misma carpeta escrita de dos formas compare igual.
function canonical(p) {
  const tail = [];
  let cur = resolve(p);
  while (!existsSync(cur)) {
    const parent = dirname(cur);
    if (parent === cur) break;
    tail.unshift(basename(cur));
    cur = parent;
  }
  let real = cur;
  try { real = realpathSync.native(cur); } catch { /* se queda como está */ }
  const full = join(real, ...tail);
  return process.platform === "win32" ? full.toLowerCase() : full;
}

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ROOT_CANON = canonical(ROOT);
export const TEAM = JSON.parse(readFileSync(join(ROOT, "harness", "team.json"), "utf8"));
const ROLE_FILE = join(ROOT, "harness", ".role");

// Convierte un glob sencillo (** , *, ?) en RegExp. Rutas siempre con "/".
export function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        // "**/" coincide con cero o más directorios; "**" al final, con todo.
        if (glob[i + 2] === "/") { re += "(?:.*/)?"; i += 2; } else { re += ".*"; i += 1; }
      } else re += "[^/]*";
    } else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`, process.platform === "win32" ? "i" : "");
}

const COMPILED = TEAM.areas.map((a) => ({ ...a, regexps: a.paths.map(globToRegExp) }));

// Ruta relativa al repo con "/" o null si queda fuera del repo.
export function toRepoPath(p) {
  const abs = isAbsolute(p) ? p : resolve(process.cwd(), p);
  const rel = relative(ROOT_CANON, canonical(abs));
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) return null;
  // La ruta canónica sale en minúsculas en Windows: se devuelven los mismos segmentos tal y como
  // venían en la ruta original, para que los mensajes muestren el nombre real del archivo.
  const n = rel.split(sep).length;
  return abs.split(/[\\/]/).slice(-n).join("/");
}

export function areaFor(repoPath) {
  return COMPILED.find((a) => a.regexps.some((r) => r.test(repoPath))) ?? null;
}

export function areaForScope(scope) {
  return TEAM.areas.find((a) => a.scopes.includes(scope)) ?? null;
}

export function allScopes() {
  return TEAM.areas.flatMap((a) => a.scopes);
}

export function readRole() {
  if (process.env.HARNESS_ROLE) return process.env.HARNESS_ROLE.trim().toUpperCase();
  if (!existsSync(ROLE_FILE)) return null;
  return readFileSync(ROLE_FILE, "utf8").trim().toUpperCase() || null;
}

export function roleFromBranch(branch) {
  const m = /^(p[1-4])\//i.exec(branch ?? "");
  return m ? m[1].toUpperCase() : null;
}

export const BRANCH_RE = /^p[1-4]\/[a-z0-9][a-z0-9-]{2,50}$/;

export function commitRegExp() {
  const types = TEAM.commitTypes.join("|");
  const scopes = allScopes().join("|");
  return new RegExp(`^(${types})\\((${scopes})\\)!?: \\S.{2,71}$`);
}

// Mensajes que git genera solo y no deben bloquearse.
export const COMMIT_EXEMPT_RE = /^(Merge |Revert "|fixup! |squash! |amend! )/;

export function describeArea(a) {
  if (!a) return "sin área";
  if (a.shared) return `área compartida "${a.id}" (necesita lock)`;
  if (a.owner === "*") return `área libre "${a.id}"`;
  return `área "${a.id}" de ${a.owner} (${TEAM.roles[a.owner]?.name ?? "?"})`;
}

// Llama a gh y devuelve stdout, o lanza un Error con un mensaje claro.
export function gh(args, { json = false } = {}) {
  let out;
  try {
    out = execFileSync("gh", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    if (e.code === "ENOENT") throw new Error("No encuentro la CLI de GitHub (gh). Instálala desde https://cli.github.com y ejecuta: gh auth login");
    throw new Error(`gh ${args.join(" ")} falló: ${(e.stderr || e.message).toString().trim()}`);
  }
  return json ? JSON.parse(out || "null") : out.trim();
}

export function ghLogin() {
  return gh(["api", "user", "--jq", ".login"]);
}

export function lockTitle(areaId) {
  return `LOCK: ${areaId}`;
}

// Locks abiertos: [{ area, holder, number, url, createdAt }]
export function openLocks() {
  const issues = gh(
    ["issue", "list", "--label", TEAM.labels.lock, "--state", "open", "--limit", "100", "--json", "number,title,author,url,createdAt"],
    { json: true },
  );
  return issues
    .filter((i) => i.title.startsWith("LOCK: "))
    .map((i) => ({ area: i.title.slice(6).trim(), holder: i.author.login, number: i.number, url: i.url, createdAt: i.createdAt }));
}

export function git(args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}
