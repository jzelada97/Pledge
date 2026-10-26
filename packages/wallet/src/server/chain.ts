// Consultas a la red que necesita la política del Relayer. Se inyectan en el handler para poder
// probarlo sin red.
import "server-only";
import { Account, Address, Contract, Operation, TransactionBuilder, rpc, xdr } from "@stellar/stellar-sdk";
import { toHex } from "../xdr";

// Cuenta sin claves conocida, solo para simular (no firma ni paga nada).
const SIMULATION_SOURCE = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

export interface SimulationResult {
  ok: boolean;
  minResourceFee: bigint;
  // Texto del error de la RPC cuando falla (solo para el log del servidor; al cliente va saneado).
  error?: string;
}

export interface ChainLookups {
  // Hash (hex) del wasm de un contrato, o null si no existe o no es wasm.
  wasmHashOf(contractId: string): Promise<string | null>;
  // true si factory.id_of(escrow) devuelve un id.
  isRegisteredEscrow(factory: string, escrow: string): Promise<boolean>;
  simulate(func: xdr.HostFunction, auth: xdr.SorobanAuthorizationEntry[]): Promise<SimulationResult>;
}

export function createChainLookups(rpcUrl: string, networkPassphrase: string): ChainLookups {
  const server = new rpc.Server(rpcUrl);
  // El código de un contrato y su registro en la factory no cambian (el escrow no tiene upgrade,
  // security N-2): se cachean los positivos.
  const wasmCache = new Map<string, string>();
  const registered = new Set<string>();

  function buildTx(op: xdr.Operation) {
    return new TransactionBuilder(new Account(SIMULATION_SOURCE, "0"), { fee: "100", networkPassphrase })
      .addOperation(op)
      .setTimeout(30)
      .build();
  }

  return {
    async wasmHashOf(contractId) {
      const cached = wasmCache.get(contractId);
      if (cached) return cached;
      const res = await server.getLedgerEntries(new Contract(contractId).getFootprint());
      const entry = res.entries[0];
      if (!entry) return null;
      const executable = entry.val.contractData().val().instance().executable();
      if (executable.switch().name !== "contractExecutableWasm") return null;
      const hash = toHex(executable.wasmHash());
      wasmCache.set(contractId, hash);
      return hash;
    },

    async isRegisteredEscrow(factory, escrow) {
      const key = `${factory}:${escrow}`;
      if (registered.has(key)) return true;
      const sim = await server.simulateTransaction(
        buildTx(new Contract(factory).call("id_of", new Address(escrow).toScVal())),
      );
      const ok = rpc.Api.isSimulationSuccess(sim);
      if (ok) registered.add(key);
      return ok;
    },

    async simulate(func, auth) {
      const sim = await server.simulateTransaction(buildTx(Operation.invokeHostFunction({ func, auth })));
      if (rpc.Api.isSimulationError(sim)) return { ok: false, minResourceFee: 0n, error: sim.error };
      if (!rpc.Api.isSimulationSuccess(sim) || rpc.Api.isSimulationRestore(sim)) {
        return { ok: false, minResourceFee: 0n, error: "estado archivado: hace falta restaurarlo" };
      }
      return { ok: true, minResourceFee: BigInt(sim.minResourceFee) };
    },
  };
}
