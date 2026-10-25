// Handler de /api/ramp (ramp simulado, plan B). La cuenta faucet envía USDC de testnet a la cuenta
// inteligente del usuario. Restricciones: security SRV-10…SRV-15.
// Uso en Next.js (app/api/ramp/route.ts):  export const { POST, GET } = createSimRampHandler({ … });
import "server-only";
import { Networks, StrKey } from "@stellar/stellar-sdk";
import { isValidAmount, toStroops } from "../amount";
import type { AnchorStatus } from "../types";
import { createRampChain, type RampChain } from "./chain";

const HOUR = 60 * 60 * 1000;

export interface SimRampConfig {
  networkPassphrase: string;
  rpcUrl: string;
  faucetSecret: string; // RAMP_FAUCET_SECRET: cuenta exclusiva y con saldo acotado (SRV-13)
  token: string; // deployments.token
  accountWasmHashes: string[]; // solo se envía a smart accounts nuestros (SRV-11)
  enabled: boolean; // RAMP_ENABLED; con false, 403 (interruptor para la demo)
  allowedOrigins: string[];
  maxAmount: string; // por petición, p. ej. "100"
  perAddressCap: string; // acumulado por dirección, p. ej. "500"
  perIpPerHour: number; // 5
  globalHourlyCap: number; // p. ej. 50
  chain?: RampChain; // para tests
  now?: () => number; // para tests
}

function fail(code: string, status: number): Response {
  return Response.json({ code }, { status });
}

function clientIp(req: Request): string {
  return (
    req.headers.get("x-real-ip")?.trim() || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
  );
}

class HourlyCounter {
  private readonly hits = new Map<string, { start: number; count: number }>();
  constructor(private readonly limit: number) {}

  allow(key: string, now: number): boolean {
    const cur = this.hits.get(key);
    if (!cur || now - cur.start >= HOUR) {
      this.hits.set(key, { start: now, count: 1 });
      return true;
    }
    if (cur.count >= this.limit) return false;
    cur.count += 1;
    return true;
  }
}

export function createSimRampHandler(cfg: SimRampConfig): {
  POST: (req: Request) => Promise<Response>;
  GET: (req: Request) => Promise<Response>;
} {
  // El ramp simulado no puede existir en mainnet (SRV-10).
  if (cfg.networkPassphrase === Networks.PUBLIC) throw new Error("El ramp simulado no se puede usar en mainnet");
  const chain = cfg.chain ?? createRampChain(cfg);
  const now = cfg.now ?? Date.now;
  const maxStroops = toStroops(cfg.maxAmount);
  const capStroops = toStroops(cfg.perAddressCap);
  const perIp = new HourlyCounter(cfg.perIpPerHour);
  const global = new HourlyCounter(cfg.globalHourlyCap);
  const sentTo = new Map<string, bigint>();
  const issued = new Map<string, AnchorStatus>(); // solo ids emitidos por esta instancia (SRV-15)
  let queue: Promise<unknown> = Promise.resolve(); // una transacción de la faucet a la vez (SRV-14)

  async function POST(req: Request): Promise<Response> {
    if (!cfg.enabled) return fail("DISABLED", 403);
    const origin = req.headers.get("origin");
    if (origin && !cfg.allowedOrigins.includes(origin)) return fail("NOT_ALLOWED", 403);
    if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
      return fail("UNSUPPORTED_MEDIA_TYPE", 415);
    }
    let body: unknown;
    try {
      body = JSON.parse(await req.text());
    } catch {
      return fail("BAD_REQUEST", 400);
    }
    const { to, amount, ...rest } = (body ?? {}) as { to?: unknown; amount?: unknown };
    if (Object.keys(rest).length || typeof to !== "string" || typeof amount !== "string") return fail("BAD_REQUEST", 400);
    if (!StrKey.isValidContract(to)) return fail("BAD_REQUEST", 400);
    if (!isValidAmount(amount)) return fail("BAD_REQUEST", 400);
    const stroops = toStroops(amount);
    if (stroops > maxStroops) return fail("BAD_REQUEST", 400);

    const t = now();
    if (!perIp.allow(clientIp(req), t) || !global.allow("global", t)) return fail("RATE_LIMITED", 429);
    const already = sentTo.get(to) ?? 0n;
    if (already + stroops > capStroops) return fail("RATE_LIMITED", 429);

    const hash = await chain.wasmHashOf(to).catch(() => null);
    if (!hash || !cfg.accountWasmHashes.includes(hash)) return fail("NOT_ALLOWED", 403);

    sentTo.set(to, already + stroops); // se reserva antes de enviar para que dos peticiones no superen el tope
    const run = queue.then(() => chain.transfer(to, stroops));
    queue = run.catch(() => undefined);
    try {
      const id = await run;
      issued.set(id, "completed");
      return Response.json({ id, status: "completed" });
    } catch {
      sentTo.set(to, (sentTo.get(to) ?? stroops) - stroops);
      return fail("RAMP_DOWN", 502);
    }
  }

  async function GET(req: Request): Promise<Response> {
    const id = new URL(req.url).searchParams.get("id") ?? "";
    const status = issued.get(id);
    return status ? Response.json({ status }) : fail("NOT_FOUND", 404);
  }

  return { POST, GET };
}
