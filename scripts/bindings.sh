#!/usr/bin/env bash
# Genera los bindings TypeScript de los contratos en packages/bindings (código generado: no se edita a mano).
# Uso: scripts/bindings.sh [--no-build]
#   1. Compila los wasm con `stellar contract build` (soroban-sdk 28 no admite cargo build directo).
#   2. Para cada crate de contracts/ con wasm, ejecuta `stellar contract bindings typescript`.
# Requiere: stellar-cli >= 25.2 en el PATH. En Windows, ejecútalo desde Git Bash pero con cargo
# resolviendo el enlazador de MSVC (ver apps/api/CLAUDE.md): si falla el link, compila antes desde PowerShell.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/packages/bindings"
WASM_DIR="$ROOT/target/wasm32v1-none/release"
NETWORK="${STELLAR_NETWORK:-testnet}"

if [[ "${1:-}" != "--no-build" ]]; then
  echo "== stellar contract build"
  (cd "$ROOT" && stellar contract build)
fi

shopt -s nullglob
wasms=("$WASM_DIR"/*.wasm)
if (( ${#wasms[@]} == 0 )); then
  echo "No hay wasm en $WASM_DIR. Compila primero." >&2
  exit 1
fi

mkdir -p "$OUT"
cat > "$OUT/package.json" <<'JSON'
{
  "name": "@fianzas/bindings",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Bindings TypeScript generados por scripts/bindings.sh. NO EDITAR A MANO.",
  "exports": {}
}
JSON

for wasm in "${wasms[@]}"; do
  name="$(basename "$wasm" .wasm)"
  echo "== bindings de $name"
  rm -rf "$OUT/$name"
  stellar contract bindings typescript \
    --wasm "$wasm" \
    --output-dir "$OUT/$name" \
    --overwrite \
    --network "$NETWORK" >/dev/null
  # Registra el export "./<crate>" → src/index.ts del paquete generado.
  node -e '
    const fs = require("fs"); const p = process.argv[1]; const name = process.argv[2];
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    j.exports["./" + name] = "./" + name + "/src/index.ts";
    fs.writeFileSync(p, JSON.stringify(j, null, 2) + "\n");
  ' "$OUT/package.json" "$name"
done

# Hash de cada wasm, para deployments.escrowWasmHashesAllowed y para detectar bindings desfasados.
{
  echo "# Generado por scripts/bindings.sh. wasm → sha256 (= hash que instala stellar contract upload)."
  for wasm in "${wasms[@]}"; do
    printf '%s  %s\n' "$(sha256sum "$wasm" | cut -d' ' -f1)" "$(basename "$wasm")"
  done
} > "$OUT/WASM_HASHES.txt"

echo "== listo: $OUT"
cat "$OUT/WASM_HASHES.txt"
