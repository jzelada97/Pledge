// Operaciones de red del ramp simulado: comprobar el destino y transferir desde la cuenta faucet.
import "server-only";
import { Address, BASE_FEE, Contract, Keypair, TransactionBuilder, nativeToScVal, rpc } from "@stellar/stellar-sdk";

export interface RampChain {
  // Hash (hex) del wasm de un contrato, o null si no existe o no es wasm.
  wasmHashOf(contractId: string): Promise<string | null>;
  // token.transfer(faucet, to, stroops) firmada por la faucet. Devuelve el hash cuando se confirma.
  transfer(to: string, stroops: bigint): Promise<string>;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function createRampChain(cfg: {
  rpcUrl: string;
  networkPassphrase: string;
  faucetSecret: string;
  token: string;
}): RampChain {
  const server = new rpc.Server(cfg.rpcUrl);
  const faucet = Keypair.fromSecret(cfg.faucetSecret);

  return {
    async wasmHashOf(contractId) {
      const res = await server.getLedgerEntries(new Contract(contractId).getFootprint());
      const entry = res.entries[0];
      if (!entry) return null;
      const executable = entry.val.contractData().val().instance().executable();
      return executable.switch().name === "contractExecutableWasm" ? toHex(executable.wasmHash()) : null;
    },

    async transfer(to, stroops) {
      // Transacción construida en el servidor; la secuencia se lee de la red (security SRV-14).
      const account = await server.getAccount(faucet.publicKey());
      const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: cfg.networkPassphrase })
        .addOperation(
          new Contract(cfg.token).call(
            "transfer",
            new Address(faucet.publicKey()).toScVal(),
            new Address(to).toScVal(),
            nativeToScVal(stroops, { type: "i128" }),
          ),
        )
        .setTimeout(30)
        .build();
      const prepared = await server.prepareTransaction(tx);
      prepared.sign(faucet);
      const sent = await server.sendTransaction(prepared);
      if (sent.status === "ERROR") throw new Error("envío rechazado");
      const result = await server.pollTransaction(sent.hash, { attempts: 30 });
      if (result.status !== "SUCCESS") throw new Error(`transacción ${result.status}`);
      return sent.hash;
    },
  };
}
