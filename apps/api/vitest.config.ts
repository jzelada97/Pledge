import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // "server-only" (de @fianzas/wallet/server y @fianzas/anchor/server) lanza fuera de Next;
    // en los tests se sustituye por un módulo vacío, igual que en packages/wallet.
    alias: { "server-only": fileURLToPath(new URL("./src/server-only-stub.ts", import.meta.url)) },
  },
  test: { environment: "node" },
});
