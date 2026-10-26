// Acceso a la cadena: lecturas por simulación (sin firma, con readSource como origen), builds sin
// firmar (INTERFACES § 8, UnsignedTransactionResponse) y envío de transacciones ya firmadas.
// La cadena es la fuente de verdad; la caché solo ahorra RPC.
import {
  Account,
  BASE_FEE,
  Contract,
  Operation,
  StrKey,
  TransactionBuilder,
  rpc,
  scValToNative,
  xdr,
  type FeeBumpTransaction,
  type Transaction,
} from "@stellar/stellar-sdk";
import { createChainLookups } from "@fianzas/wallet/server";
import type { ApiConfig } from "./config";
import { Problem, validationError } from "./problem";

export const STROOPS = 10_000_000n;
// Ventana de validez de las auth entries de una passkey (security AUTH-5): ~5 minutos.
export const SIGNATURE_LEDGERS = 60;

export interface UnsignedTransactionResponse {
  unsignedXdr: string;
  txHash: string;
  contractId?: string | null;
  soroban?: { func: string; auth: string[]; validUntilLedger: number };
}

// Lo que devuelve build(): la respuesta pública más el retorno simulado, que algunas rutas
// necesitan (approve-and-release comprueba si la aprobación liquida).
export interface Built extends UnsignedTransactionResponse {
  result: unknown;
}

// API-12: al cliente solo el número de error del contrato y un texto genérico; la respuesta cruda de la
// RPC va al log con el traceId (Problem.internal).
export function simulationProblem(error: string, contractId: string, fn: string): Problem {
  const m = /Error\(Contract, #(\d+)\)/.exec(error);
  const detail = m ? `El contrato rechazó ${fn} (error #${m[1]})` : `La simulación de ${fn} falló`;
  return new Problem(502, "STELLAR_SIMULATION_FAILED", "La simulación falló", detail, { contractId, fn, ...(m ? { contractError: Number(m[1]) } : {}) }, error);
}

export function toDecimal(stroops: bigint | string | number, decimals = 7): string {
  const v = BigInt(stroops);
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const base = 10n ** BigInt(decimals);
  const int = abs / base;
  const frac = (abs % base).toString().padStart(decimals, "0");
  return `${neg ? "-" : ""}${int}.${frac}`;
}

// Tope de la caché: con muchos contractId distintos un Map sin límite crece sin parar.
export const CACHE_MAX_ENTRIES = 1000;

export class TtlCache {
  private readonly m = new Map<string, { exp: number; p: Promise<unknown> }>();
  constructor(
    private readonly now: () => number = Date.now,
    private readonly maxEntries = CACHE_MAX_ENTRIES,
  ) {}

  get size(): number {
    return this.m.size;
  }

  get<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
    const hit = this.m.get(key);
    if (hit && hit.exp > this.now()) return hit.p as Promise<T>;
    const p = load().catch((e) => {
      this.m.delete(key);
      throw e;
    });
    this.m.delete(key); // vuelve al final del orden de inserción
    if (this.m.size >= this.maxEntries) this.evict();
    this.m.set(key, { exp: this.now() + ttlMs, p });
    return p;
  }

  // Primero las caducadas; si no basta, la más antigua (el Map conserva el orden de inserción).
  private evict(): void {
    const t = this.now();
    for (const [k, v] of this.m) if (v.exp <= t) this.m.delete(k);
    while (this.m.size >= this.maxEntries) {
      const oldest = this.m.keys().next().value;
      if (oldest === undefined) break;
      this.m.delete(oldest);
    }
  }
}

export interface Chain {
  read<T = unknown>(contractId: string, fn: string, args?: xdr.ScVal[]): Promise<T>;
  // Igual que read pero sin decodificar: para reenviar un valor de la cadena tal cual (expected_terms).
  readRaw(contractId: string, fn: string, args?: xdr.ScVal[]): Promise<xdr.ScVal>;
  // Prepara (simula y ensambla) una invocación para que `signer` la firme. La API nunca firma.
  build(contractId: string, fn: string, args: xdr.ScVal[], signer: string): Promise<Built>;
  send(signedXdr: string): Promise<{ txHash: string; ledger: number | null; status: string }>;
  latestLedger(): Promise<number>;
  // Hash (hex) del wasm de un contrato, o null si no existe o no es wasm. Para reconocer escrows de TW.
  wasmHashOf(contractId: string): Promise<string | null>;
  // Una transacción ya incluida en un ledger (para verificar quién hizo qué y cuándo), o null si no existe.
  getTransaction(hash: string): Promise<ConfirmedTransaction | null>;
}

export interface ConfirmedTransaction {
  success: boolean;
  ledger: number;
  /** Unix seconds del cierre del ledger. */
  createdAt: number;
  envelope: Transaction | FeeBumpTransaction;
}

export function createChain(cfg: ApiConfig): Chain {
  const server = new rpc.Server(cfg.rpcUrl, { allowHttp: cfg.rpcUrl.startsWith("http://") });
  const lookups = createChainLookups(cfg.rpcUrl, cfg.networkPassphrase);

  async function simulateRead(contractId: string, fn: string, args: xdr.ScVal[]): Promise<xdr.ScVal> {
    const source = await server.getAccount(cfg.readSource);
    const tx = new TransactionBuilder(source, { fee: BASE_FEE, networkPassphrase: cfg.networkPassphrase })
      .addOperation(new Contract(contractId).call(fn, ...args))
      .setTimeout(30)
      .build();
    const sim = await server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(sim)) throw simulationProblem(sim.error, contractId, fn);
    if (!rpc.Api.isSimulationSuccess(sim) || !sim.result) {
      throw new Problem(502, "STELLAR_SIMULATION_FAILED", "La simulación no devolvió resultado", undefined, { contractId, fn });
    }
    return sim.result.retval;
  }

  return {
    async read<T>(contractId: string, fn: string, args: xdr.ScVal[] = []): Promise<T> {
      return scValToNative(await simulateRead(contractId, fn, args)) as T;
    },

    readRaw(contractId: string, fn: string, args: xdr.ScVal[] = []) {
      return simulateRead(contractId, fn, args);
    },

    async build(contractId: string, fn: string, args: xdr.ScVal[], signer: string): Promise<Built> {
      const isContract = StrKey.isValidContract(signer);
      if (!isContract && !StrKey.isValidEd25519PublicKey(signer)) {
        throw validationError("signer debe ser una dirección G… o C…");
      }
      // Cuenta G: es el origen y firma la tx entera. C-address (passkey): el origen es readSource
      // y el XDR es solo informativo; lo que se firma son las auth entries (INTERFACES § 8.4).
      let source;
      try {
        source = await server.getAccount(isContract ? cfg.readSource : signer);
      } catch {
        throw new Problem(422, "STELLAR_ACCOUNT_NOT_FOUND", "La cuenta firmante no existe en la red", "Hay que fondearla con XLM antes de firmar", { signer });
      }
      const tx = new TransactionBuilder(source, { fee: BASE_FEE, networkPassphrase: cfg.networkPassphrase })
        .addOperation(new Contract(contractId).call(fn, ...args))
        .setTimeout(SIGNATURE_LEDGERS * 5)
        .build();
      const sim = await server.simulateTransaction(tx);
      if (rpc.Api.isSimulationError(sim)) throw simulationProblem(sim.error, contractId, fn);
      if (rpc.Api.isSimulationRestore(sim)) {
        // Como TW: se adjunta la transacción de restauración (misma cuenta y secuencia que la operación).
        const pre = sim.restorePreamble;
        const restore = new TransactionBuilder(new Account(tx.source, (BigInt(tx.sequence) - 1n).toString()), {
          fee: pre.minResourceFee,
          networkPassphrase: cfg.networkPassphrase,
        })
          .setSorobanData(pre.transactionData.build())
          .addOperation(Operation.restoreFootprint({}))
          .setTimeout(SIGNATURE_LEDGERS * 5)
          .build();
        throw new Problem(409, "STELLAR_STATE_ARCHIVED", "El estado del contrato está archivado", "Firma y envía restoreXdr antes de repetir la operación", {
          contractId,
          restoreXdr: restore.toXDR(),
        });
      }
      const prepared = rpc.assembleTransaction(tx, sim).build();
      const built: Built = {
        unsignedXdr: prepared.toXDR(),
        txHash: prepared.hash().toString("hex"),
        result: sim.result ? scValToNative(sim.result.retval) : undefined,
      };
      if (isContract) {
        const op = tx.operations[0] as Operation.InvokeHostFunction;
        built.soroban = {
          func: op.func.toXDR("base64"),
          auth: (sim.result?.auth ?? []).map((a) => a.toXDR("base64")),
          validUntilLedger: sim.latestLedger + SIGNATURE_LEDGERS,
        };
      }
      return built;
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

    wasmHashOf(contractId: string) {
      return lookups.wasmHashOf(contractId);
    },

    async getTransaction(hash: string) {
      const got = await server.getTransaction(hash);
      if (got.status === rpc.Api.GetTransactionStatus.NOT_FOUND) return null;
      return {
        success: got.status === rpc.Api.GetTransactionStatus.SUCCESS,
        ledger: got.ledger,
        createdAt: Number(got.createdAt),
        envelope: TransactionBuilder.fromXDR(got.envelopeXdr.toXDR("base64"), cfg.networkPassphrase),
      };
    },

    async latestLedger() {
      return (await server.getLatestLedger()).sequence;
    },
  };
}
