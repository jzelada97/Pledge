// PostToolUse (Edit|Write|MultiEdit): formatea el archivo tocado si la herramienta existe. Nunca falla.
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, extname } from "node:path";
import { ROOT, toRepoPath } from "../../scripts/harness/lib.mjs";

try {
  const input = JSON.parse(readFileSync(0, "utf8") || "{}");
  const file = input.tool_input?.file_path;
  if (!file || !toRepoPath(file)) process.exit(0);
  const ext = extname(file);
  const run = (cmd, args) => execFileSync(cmd, args, { cwd: ROOT, stdio: "ignore", timeout: 20000 });

  if (ext === ".rs") {
    run("rustfmt", ["--edition", "2021", file]);
  } else if ([".ts", ".tsx", ".js", ".jsx", ".mjs", ".json", ".css", ".md"].includes(ext)) {
    const bin = join(ROOT, "node_modules", ".bin", process.platform === "win32" ? "prettier.cmd" : "prettier");
    if (existsSync(bin)) run(bin, ["--write", "--log-level", "silent", file]);
  }
} catch {
  // Formatear es una ayuda: si falla o no hay formateador, no se bloquea nada.
}
process.exit(0);
