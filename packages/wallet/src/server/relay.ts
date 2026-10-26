// Handler de /api/relay. Recibe el { func, auth } que envía smart-account-kit, lo valida con la
// RelayPolicy y lo envía a OpenZeppelin Channels, que pone la cuenta origen y paga los fees.
// Uso en Next.js (app/api/relay/route.ts):  export const POST = createRelayHandler({ … });
import "server-only";
import { readLimited } from "./body";
import { createChainLookups, type ChainLookups } from "./chain";
import { RelayError, decodeSubmission, parseSubmission, validateSubmission, type RelayPolicy } from "./policy";

const MAX_BODY_BYTES = 64 * 1024; // security IV-5
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export interface RelayHandlerConfig {
  policy: RelayPolicy;
  relayerUrl: string; // RELAYER_URL, p. ej. https://channels.openzeppelin.com/testnet
  apiKey: string; // RELAYER_API_KEY: nunca sale del servidor
  rpcUrl: string;
  networkPassphrase: string;
  chain?: ChainLookups; // para tests
  fetch?: typeof fetch; // para tests
  now?: () => number; // para tests
}

// Límite de ventana fija en memoria, por instancia (aceptado en la arquitectura para la hackatón).
class FixedWindow {
  private readonly hits = new Map<string, { start: number; count: number }>();
  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** ¿Queda cupo? No consume: sirve para rechazar pronto sin gastar nada. */
  check(key: string, now: number): boolean {
    const cur = this.hits.get(key);
    return !cur || now - cur.start >= this.windowMs || cur.count < this.limit;
  }

  /** Consume una unidad del cupo (si queda). */
  allow(key: string, now: number): boolean {
    const cur = this.hits.get(key);
    if (!cur || now - cur.start >= this.windowMs) {
      this.hits.set(key, { start: now, count: 1 });
      return true;
    }
    if (cur.count >= this.limit) return false;
    cur.count += 1;
    return true;
  }
}

// IP que pone la plataforma (security CS-4): x-real-ip de Vercel, o el primer valor de x-forwarded-for.
function clientIp(req: Request): string {
  return (
    req.headers.get("x-real-ip")?.trim() || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
  );
}

// Respuesta con la forma que entiende el RelayerClient del kit, y sin detalles internos (security SRV-8).
function fail(code: string, status: number, extra: Record<string, unknown> = {}): Response {
  return Response.json({ success: false, error: code, code, ...extra }, { status });
}

// Una simulación fallida se registra entera en el servidor (es lo único que explica un 400 del relay) y al
// cliente solo le llega el número de error del contrato, si lo hay (API-12).
function simulationFailure(e: RelayError): Response {
  console.error(`[relay] SIMULATION_FAILED: ${e.message}`);
  const m = /Error\(Contract, #(\d+)\)/.exec(e.message);
  return fail(e.code, e.status, m ? { contractError: Number(m[1]) } : {});
}

export function createRelayHandler(cfg: RelayHandlerConfig): (req: Request) => Promise<Response> {
  const { policy } = cfg;
  const chain = cfg.chain ?? createChainLookups(cfg.rpcUrl, cfg.networkPassphrase);
  const doFetch = cfg.fetch ?? fetch;
  const now = cfg.now ?? Date.now;
  const perIp = new FixedWindow(policy.maxRequestsPerMinutePerIp, MINUTE);
  const perCredential = new FixedWindow(policy.maxRequestsPerMinutePerCredential, MINUTE);
  const createsPerCredential = new FixedWindow(policy.maxCreateFianzaPerHourPerCredential, HOUR);
  const global = new FixedWindow(policy.globalHourlyCap, HOUR);
  const relayerUrl = cfg.relayerUrl.replace(/\/+$/, "");

  return async (req) => {
    try {
      // CS-3: Origin presente y permitido. Sin Origin no es una petición de nuestras apps.
      const origin = req.headers.get("origin");
      if (!origin || !policy.allowedOrigins.includes(origin)) return fail("NOT_ALLOWED", 403);
      if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
        return fail("UNSUPPORTED_MEDIA_TYPE", 415);
      }
      const t = now();
      if (!perIp.allow(clientIp(req), t) || !global.allow("global", t)) return fail("RATE_LIMITED", 429);

      const text = await readLimited(req, MAX_BODY_BYTES);
      if (text === null) return fail("PAYLOAD_TOO_LARGE", 413);
      const body = decodeSubmission(parseSubmission(text));

      // Los cupos por credencial se comprueban antes de consultar la red (wasm, registro, simulación):
      // una credencial sin cupo no gasta RPC. Pero solo se CONSUMEN tras validar: la credencial sale del
      // cuerpo sin verificar, y si contara antes, cualquiera podría agotar el cupo de un casero mandando
      // peticiones con firmas falsas (que la simulación rechaza).
      const isCreate = body.fn === "create_fianza";
      for (const key of body.rateKeys) {
        if (!perCredential.check(key, t) || (isCreate && !createsPerCredential.check(key, t))) {
          return fail("RATE_LIMITED", 429);
        }
      }
      await validateSubmission(body, policy, chain);
      for (const key of body.rateKeys) {
        if (!perCredential.allow(key, t) || (isCreate && !createsPerCredential.allow(key, t))) {
          return fail("RATE_LIMITED", 429);
        }
      }

      let res: Response;
      try {
        res = await doFetch(`${relayerUrl}/`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` },
          body: JSON.stringify({ params: { func: body.raw.func, auth: body.raw.auth } }),
        });
      } catch {
        return fail("RELAYER_DOWN", 503);
      }
      const out = (await res.json().catch(() => null)) as {
        success?: boolean;
        data?: { transactionId?: string; hash?: string; status?: string };
      } | null;
      if (!out || typeof out.success !== "boolean") return fail("RELAYER_DOWN", 503);
      if (!out.success) return fail("TX_FAILED", 502);
      const { transactionId, hash, status } = out.data ?? {};
      return Response.json({ success: true, data: { transactionId, hash, status } });
    } catch (e) {
      if (e instanceof RelayError) return e.code === "SIMULATION_FAILED" ? simulationFailure(e) : fail(e.code, e.status);
      return fail("RELAYER_DOWN", 503);
    }
  };
}
