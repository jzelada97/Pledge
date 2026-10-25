// Handler de /api/relay. Recibe el { func, auth } que envía smart-account-kit, lo valida con la
// RelayPolicy y lo envía a OpenZeppelin Channels, que pone la cuenta origen y paga los fees.
// Uso en Next.js (app/api/relay/route.ts):  export const POST = createRelayHandler({ … });
import "server-only";
import { createChainLookups, type ChainLookups } from "./chain";
import { RelayError, parseSubmission, validateSubmission, type RelayPolicy } from "./policy";

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
function fail(code: string, status: number): Response {
  return Response.json({ success: false, error: code, code }, { status });
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
      const origin = req.headers.get("origin");
      if (origin && !policy.allowedOrigins.includes(origin)) return fail("NOT_ALLOWED", 403);
      if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
        return fail("UNSUPPORTED_MEDIA_TYPE", 415);
      }
      const t = now();
      if (!perIp.allow(clientIp(req), t) || !global.allow("global", t)) return fail("RATE_LIMITED", 429);

      const text = await req.text();
      if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return fail("PAYLOAD_TOO_LARGE", 413);
      const body = parseSubmission(text);
      const valid = await validateSubmission(body, policy, chain);

      for (const signer of valid.signers) {
        if (!perCredential.allow(signer, t)) return fail("RATE_LIMITED", 429);
        if (valid.fn === "create_fianza" && !createsPerCredential.allow(signer, t)) return fail("RATE_LIMITED", 429);
      }

      let res: Response;
      try {
        res = await doFetch(`${relayerUrl}/`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` },
          body: JSON.stringify({ params: { func: body.func, auth: body.auth } }),
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
      if (e instanceof RelayError) return fail(e.code, e.status);
      return fail("RELAYER_DOWN", 503);
    }
  };
}
