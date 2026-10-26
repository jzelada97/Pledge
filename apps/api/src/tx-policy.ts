// Qué transacciones firmadas reenvía POST /stellar/send-transaction (security API-11, N-13). Sin esto la
// ruta es un proxy abierto a nuestra RPC: cualquier transacción, a cualquier contrato, desde nuestra IP.
// Solo pasa una única InvokeHostFunction de tipo invokeContract sobre un contrato de la plataforma:
//   - plan A: un escrow de Trustless Work, reconocido por su wasm (`@fianzas/trustless`);
//   - plan B: la factory o un escrow registrado en ella (`factory.id_of`).
// Nunca fee bumps (no patrocinamos) ni restores de terceros.
import { Address, FeeBumpTransaction, TransactionBuilder } from "@stellar/stellar-sdk";
import { TW_ESCROW_WASM_TESTNET } from "@fianzas/trustless";
import type { Chain, TtlCache } from "./chain";
import type { ApiConfig } from "./config";
import type { EscrowHelpers } from "./escrows";
import { Problem } from "./problem";

// El código de un contrato no cambia (ni el escrow de TW ni el nuestro tienen upgrade): caché larga.
const ALLOWED_TTL = 10 * 60_000;

export const txNotAllowed = (detail: string) => new Problem(403, "FZ_TX_NOT_ALLOWED", "Transacción no admitida", detail);

/** Wasm de escrows externos que la API reconoce en esta red. */
export function externalEscrowWasmHashes(cfg: ApiConfig): string[] {
  return cfg.deployments.network === "testnet" ? [TW_ESCROW_WASM_TESTNET] : [];
}

/** Dirección del único contrato que invoca la transacción, o un 403 si no cumple la forma exigida. */
export function invokedContractOf(signedXdr: string, networkPassphrase: string): string {
  let tx;
  try {
    tx = TransactionBuilder.fromXDR(signedXdr, networkPassphrase);
  } catch {
    throw new Problem(400, "STELLAR_TX_UNPARSEABLE", "signedXdr no es un sobre de transacción válido");
  }
  if (tx instanceof FeeBumpTransaction) throw txNotAllowed("No se admiten fee bumps: la API nunca patrocina");
  if (tx.operations.length !== 1) throw txNotAllowed("La transacción debe tener una sola operación");
  const op = tx.operations[0];
  if (op.type !== "invokeHostFunction") throw txNotAllowed("Solo se admiten llamadas a contratos (invokeHostFunction)");
  if (op.func.switch().name !== "hostFunctionTypeInvokeContract") throw txNotAllowed("Solo se admiten invocaciones de contrato");
  return Address.fromScAddress(op.func.invokeContract().contractAddress()).toString();
}

export async function assertAllowedTransaction(
  signedXdr: string,
  cfg: ApiConfig,
  chain: Chain,
  esc: EscrowHelpers,
  cache: TtlCache,
): Promise<string> {
  const contract = invokedContractOf(signedXdr, cfg.networkPassphrase);
  const allowed = await cache.get(`txAllowed:${contract}`, ALLOWED_TTL, async () => {
    if (cfg.deployments.factory && contract === cfg.deployments.factory) return true;
    if (cfg.deployments.factory) {
      try {
        await esc.ensureEscrow(contract);
        return true;
      } catch {
        // no es un escrow de nuestra factory: se prueba como escrow externo
      }
    }
    const wasm = await chain.wasmHashOf(contract).catch(() => null);
    return wasm !== null && externalEscrowWasmHashes(cfg).includes(wasm);
  });
  if (!allowed) throw txNotAllowed(`${contract} no es la factory, ni una fianza registrada, ni un escrow de Trustless Work`);
  return contract;
}
