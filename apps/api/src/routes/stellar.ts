// POST /stellar/send-transaction — misma ruta y forma que Trustless Work. La cuenta origen paga su fee;
// este endpoint NUNCA patrocina (el patrocinio vive solo en /fianzas/v1/relay, arquitectura § 6.8.4).
import { Hono } from "hono";
import { z } from "zod";
import type { Chain } from "../chain";
import { validationError } from "../problem";

const body = z.object({ signedXdr: z.string().min(1) });

export function stellarRoutes(chain: Chain) {
  const r = new Hono();
  r.post("/stellar/send-transaction", async (c) => {
    let json: unknown;
    try {
      json = await c.req.json();
    } catch {
      throw validationError("El cuerpo debe ser JSON");
    }
    const parsed = body.safeParse(json);
    if (!parsed.success) throw validationError("Falta signedXdr", { issues: parsed.error.issues });
    const out = await chain.send(parsed.data.signedXdr);
    return c.json({ ...out, code: "STELLAR_TX_SUBMITTED" });
  });
  return r;
}
