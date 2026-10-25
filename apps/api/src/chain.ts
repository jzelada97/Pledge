// Acceso a la cadena: lecturas por simulación (sin firma, con readSource como origen) y envío de
// transacciones ya firmadas. La cadena es la fuente de verdad; la caché solo ahorra RPC.
import { BASE_FEE, Contract, TransactionBuilder, rpc, scValToNative, xdr } from "@stellar/stellar-sdk";
import type { ApiConfig } from "./config";
import { Problem } from "./problem";

export const STROOPS = 10_000_000n;

export function toDecimal(stroops: bigint | string | number, decimals = 7): string {
  const v = BigInt(stroops);
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const base = 10n ** BigInt(decimals);
  const int = abs / base;
  const frac = (abs % base).toString().padStart(decimals, "0");
  return `${neg ? "-" : ""}${int}.${frac}`;
}

export class TtlCache {
  private readonly m = new Map<string, { exp: number; p: Promise<unknown> }>();
  constructor(private readonly now: () => number = Date.now) {}
  get<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
    const hit = this.m.get(key);
    if (hit && hit.exp > this.now()) return hit.p as Promise<T>;
    const p = load().catch((e) => {
      this.m.delete(key);
      throw e;
    });
    this.m.set(key, { exp: this.now() + ttlMs, p });
    return p;
  }
}

export interface Chain {
  read<T = unknown>(contractId: string, fn: string, args?: xdr.ScVal[]): Promise<T>;
  send(signedXdr: string): Promise<{ txHash: string; ledger: number | null; status: string }>;
  latestLedger(): Promise<number>;
}

export function createChain(cfg: ApiConfig): Chain {
  const server = new rpc.Server(cfg.rpcUrl, { allowHttp: cfg.rpcUrl.startsWith("http://") });

  return {
    async read<T>(contractId: string, fn: string, args: xdr.ScVal[] = []): Promise<T> {
      const source = await server.getAccount(cfg.readSource);
      const tx = new TransactionBuilder(source, { fee: BASE_FEE, networkPassphrase: cfg.networkPassphrase })
        .addOperation(new Contract(contractId).call(fn, ...args))
        .setTimeout(30)
        .build();
      const sim = await server.simulateTransaction(tx);
      if (rpc.Api.isSimulationError(sim)) {
        const m = /Error\(Contract, #(\d+)\)/.exec(sim.error);
        throw new Problem(502, "STELLAR_SIMULATION_FAILED", "La simulación falló", sim.error.slice(0, 500), {
          contractId,
          fn,
          ...(m ? { contractError: Number(m[1]) } : {}),
        });
      }
      if (!rpc.Api.isSimulationSuccess(sim) || !sim.result) {
        throw new Problem(502, "STELLAR_SIMULATION_FAILED", "La simulación no devolvió resultado", undefined, { contractId, fn });
      }
      return scValToNative(sim.result.retval) as T;
    },

    async send(signedXdr: string) {
      let tx;
      try {
        tx = TransactionBuilder.fromXDR(signedXdr, cfg.networkPassphrase);
      } catch {
        throw new Problem(400, "STELLAR_TX_UNPARSEABLE", "signedXdr no es un sobre de transacción válido");
      }
      if (tx.signatures.length === 0) {
        throw new Problem(400, "STELLAR_TX_UNSIGNED", "La transacción no lleva firmas; la API nunca firma");
      }
      const res = await server.sendTransaction(tx);
      if (res.status === "ERROR") {
        throw new Problem(422, "STELLAR_TX_FAILED", "La red rechazó la transacción", undefined, {
          errorResultXdr: res.errorResult?.toXDR("base64") ?? null,
        });
      }
      // Espera acotada a que se incluya en un ledger (~5 s por ledger).
      for (let i = 0; i < 12; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        const got = await server.getTransaction(res.hash);
        if (got.status === rpc.Api.GetTransactionStatus.SUCCESS) {
          return { txHash: res.hash, ledger: got.ledger, status: "SUCCESS" };
        }
        if (got.status === rpc.Api.GetTransactionStatus.FAILED) {
          throw new Problem(422, "STELLAR_TX_FAILED", "La transacción falló al ejecutarse", undefined, {
            txHash: res.hash,
            resultXdr: got.resultXdr?.toXDR("base64") ?? null,
          });
        }
      }
      return { txHash: res.hash, ledger: null, status: "PENDING" };
    },

    async latestLedger() {
      return (await server.getLatestLedger()).sequence;
    },
  };
}
