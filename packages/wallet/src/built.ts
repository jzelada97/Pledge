// Firma y envío de lo que construye apps/api (INTERFACES § 8.4). Con `soroban` (cuenta con passkey) se
// verifica el árbol de auth (WEB-3), se firma solo la entrada del firmante y se envía por el Relayer.
// Sin `soroban` (cuenta G) se firma el XDR fuera de la wallet y se envía con send-transaction.
import { xdr } from "@stellar/stellar-sdk";
import { verifyAuthTree } from "./auth-check";
import { WalletError, type WalletErrorCode } from "./errors";
import type { ContractsConfig, SignBuiltOptions, UnsignedTransactionResponse } from "./types";

// Ventana de validez de la firma: unos 5 minutos (security AUTH-5).
export const SIGNATURE_LEDGERS = 60;
const DEFAULT_SEND_PATH = "/api/stellar/send-transaction";

export interface BuiltDeps {
  signer: string; // C-address conectada
  cfg: ContractsConfig & { relayPath: string; sendTransactionPath?: string };
  latestLedger(): Promise<number>;
  signAuthEntry(entry: xdr.SorobanAuthorizationEntry, expiration: number): Promise<xdr.SorobanAuthorizationEntry>;
  fetch: typeof fetch;
}

// Códigos del relay (createRelayHandler) y de la API (Problem Details) → códigos de la wallet.
function mapServerCode(code: string | undefined, status: number): WalletErrorCode {
  if (status === 429 || code === "RATE_LIMITED" || code === "TOO_MANY_REQUESTS") return "RATE_LIMITED";
  if (code === "SIMULATION_FAILED" || code === "STELLAR_SIMULATION_FAILED") return "SIMULATION_FAILED";
  if (code === "NOT_ALLOWED") return "AUTH_MISMATCH";
  if (status >= 500 && status !== 502) return "RELAYER_DOWN";
  return "TX_FAILED";
}

async function post(deps: BuiltDeps, path: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  let res: Response;
  try {
    res = await deps.fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new WalletError("RELAYER_DOWN");
  }
  const json = ((await res.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  return { status: res.status, json };
}

function fail(status: number, json: Record<string, unknown>): never {
  const code = typeof json.code === "string" ? json.code : undefined;
  const ext = json.extensions as { contractError?: unknown } | undefined;
  const contractError = typeof ext?.contractError === "number" ? ext.contractError : undefined;
  throw new WalletError(mapServerCode(code, status), code, contractError);
}

export async function sendBuilt(
  res: UnsignedTransactionResponse,
  deps: BuiltDeps,
  opts: SignBuiltOptions = {},
): Promise<{ hash: string }> {
  if (!res.soroban) {
    if (!opts.signXdr) throw new WalletError("NOT_CONNECTED", "build para una cuenta G sin firmante externo");
    opts.onPhase?.("signing");
    const signedXdr = await opts.signXdr(res.unsignedXdr);
    opts.onPhase?.("submitting");
    const { status, json } = await post(deps, deps.cfg.sendTransactionPath ?? DEFAULT_SEND_PATH, { signedXdr });
    if (status >= 300 || typeof json.txHash !== "string") fail(status, json);
    return { hash: json.txHash as string };
  }

  opts.onPhase?.("verifying");
  let func: xdr.HostFunction;
  let auth: xdr.SorobanAuthorizationEntry[];
  try {
    func = xdr.HostFunction.fromXDR(res.soroban.func, "base64");
    auth = res.soroban.auth.map((a) => xdr.SorobanAuthorizationEntry.fromXDR(a, "base64"));
  } catch {
    throw new WalletError("AUTH_MISMATCH", "XDR del build no válido");
  }
  const mine = await verifyAuthTree({ func, auth }, deps.signer, deps.cfg, opts);

  const latest = await deps.latestLedger();
  // La API propone la expiración; nunca se acepta más de la ventana de AUTH-5.
  const expiration = Math.min(res.soroban.validUntilLedger, latest + SIGNATURE_LEDGERS);
  if (expiration <= latest) throw new WalletError("TX_FAILED", "el build ha caducado; vuelve a construirlo");

  opts.onPhase?.("signing");
  const signed = mine
    ? await Promise.all(auth.map((e) => (e === mine ? deps.signAuthEntry(e, expiration) : e)))
    : auth;

  opts.onPhase?.("submitting");
  const { status, json } = await post(deps, deps.cfg.relayPath, {
    func: res.soroban.func,
    auth: signed.map((e) => e.toXDR("base64")),
  });
  const data = json.data as { hash?: unknown } | undefined;
  if (json.success !== true || typeof data?.hash !== "string") fail(status, json);
  return { hash: data!.hash as string };
}
