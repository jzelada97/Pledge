// POST /stellar/send-transaction — misma ruta y forma que Trustless Work. La cuenta origen paga su fee;
// este endpoint NUNCA patrocina (el patrocinio vive solo en /fianzas/v1/relay, arquitectura § 6.8.4).
// Solo reenvía transacciones a contratos de la plataforma (tx-policy.ts, security API-11).
import { Hono } from "hono";
import { z } from "zod";
import type { Chain, TtlCache } from "../chain";
import type { ApiConfig } from "../config";
import { escrowHelpers } from "../escrows";
import { validationError } from "../problem";
import { assertAllowedTransaction } from "../tx-policy";

const body = z.object({ signedXdr: z.string().min(1) });

export function stellarRoutes(cfg: ApiConfig, chain: Chain, cache: TtlCache) {
  const r = new Hono();
  const esc = escrowHelpers(cfg, chain, cache);
  r.post("/stellar/send-transaction", async (c) => {
    let json: unknown;
    try {
      json = await c.req.json();
    } catch {
      throw validationError("El cuerpo debe ser JSON");
    }
    const parsed = body.safeParse(json);
    if (!parsed.success) throw validationError("Falta signedXdr", { issues: parsed.error.issues });
    const contractId = await assertAllowedTransaction(parsed.data.signedXdr, cfg, chain, esc, cache);
    const out = await chain.send(parsed.data.signedXdr);
    return c.json({ ...out, contractId, code: "STELLAR_TX_SUBMITTED" });
  });
  return r;
}
