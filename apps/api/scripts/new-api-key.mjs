#!/usr/bin/env node
// Genera una API key para API_KEYS_JSON (security AUTH-9): <id>.<secret> con un secreto aleatorio de
// 256 bits en base64url. Imprime la key UNA vez (dásela al integrador por un canal seguro) y la
// entrada JSON a añadir, que solo lleva sha256(secret). P2 las da a mano.
// Uso: node apps/api/scripts/new-api-key.mjs <id> "<label>" [rpm] [scopes=read,build,submit]
import { createHash, randomBytes } from "node:crypto";

const [id, label, rpmArg, scopesArg] = process.argv.slice(2);
if (!id || !label || !/^[a-z0-9][a-z0-9_-]{1,31}$/.test(id)) {
  console.error('Uso: node apps/api/scripts/new-api-key.mjs <id: [a-z0-9_-]{2,32}> "<label>" [rpm=300] [scopes=read,build,submit]');
  process.exit(1);
}
const secret = randomBytes(32).toString("base64url");
const entry = {
  id,
  secretSha256: createHash("sha256").update(secret).digest("hex"),
  label,
  landlords: [],
  scopes: (scopesArg ?? "read,build,submit").split(",").map((s) => s.trim()),
  rpm: Number(rpmArg ?? 300),
};
console.log(`API key (solo se muestra ahora):\n  ${id}.${secret}\n`);
console.log("Entrada para API_KEYS_JSON (añádela al array):");
console.log(JSON.stringify(entry, null, 2));
