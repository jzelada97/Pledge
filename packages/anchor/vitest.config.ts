import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // "server-only" lanza una excepción fuera del bundler de Next; en los tests se sustituye por un módulo vacío.
    alias: { "server-only": fileURLToPath(new URL("./src/server/server-only-stub.ts", import.meta.url)) },
  },
  test: { environment: "node" },
});
