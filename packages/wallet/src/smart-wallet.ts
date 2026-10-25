// Wallet real: cuenta inteligente con passkey (smart-account-kit) y fees patrocinados por el Relayer.
// El kit envía { func, auth } a cfg.relayerUrl, que es nuestro createRelayHandler (./server).
import { IndexedDBStorage, SmartAccountErrorCode, SmartAccountKit } from "smart-account-kit";
import { rpc, type contract } from "@stellar/stellar-sdk";
import { verifyAuthTree } from "./auth-check";
import { WalletError, type WalletErrorCode } from "./errors";
import type { SignAndSendOptions, Wallet, WalletConfig } from "./types";

// Ventana de validez de la firma: unos 5 minutos (security AUTH-5).
const SIGNATURE_LEDGERS = 60;

function contractCodeOf(message: string): number | undefined {
  const m = /Error\(Contract, #(\d+)\)/.exec(message);
  return m ? Number(m[1]) : undefined;
}

// Traduce los errores del kit (o los que llegan del handler) a nuestros códigos estables.
export function toWalletError(e: unknown): WalletError {
  if (e instanceof WalletError) return e;
  const err = e as { code?: number; message?: string; contractCode?: number } | undefined;
  const message = err?.message ?? String(e);
  const code = err?.code;
  let mapped: WalletErrorCode = "TX_FAILED";
  if (code === SmartAccountErrorCode.WEBAUTHN_CANCELLED) mapped = "USER_CANCELLED";
  else if (code === SmartAccountErrorCode.WALLET_NOT_CONNECTED) mapped = "NOT_CONNECTED";
  else if (code === SmartAccountErrorCode.TRANSACTION_SIMULATION_FAILED || code === SmartAccountErrorCode.CONTRACT_ERROR)
    mapped = "SIMULATION_FAILED";
  else if (code === SmartAccountErrorCode.TRANSACTION_TIMEOUT || /RELAYER_DOWN|timed out/i.test(message)) mapped = "RELAYER_DOWN";
  else if (/RATE_LIMITED|Rate limit/i.test(message)) mapped = "RATE_LIMITED";
  else if (/SIMULATION_FAILED/.test(message)) mapped = "SIMULATION_FAILED";
  return new WalletError(mapped, message, err?.contractCode ?? contractCodeOf(message));
}

export function createWallet(cfg: WalletConfig): Wallet {
  if (typeof location !== "undefined" && location.hostname !== cfg.rpId) {
    throw new WalletError("WRONG_ORIGIN", `rpId ${cfg.rpId} ≠ ${location.hostname}`);
  }
  const kit = new SmartAccountKit({
    rpcUrl: cfg.rpcUrl,
    networkPassphrase: cfg.networkPassphrase,
    accountWasmHash: cfg.accountWasmHash,
    webauthnVerifierAddress: cfg.webauthnVerifierAddress,
    rpId: cfg.rpId,
    rpName: cfg.rpName,
    relayerUrl: cfg.relayerUrl,
    storage: new IndexedDBStorage(),
  });
  const server = new rpc.Server(cfg.rpcUrl);
  let address: string | null = null;

  return {
    async createAccount(displayName) {
      try {
        const r = await kit.createWallet(cfg.rpName, displayName, { autoSubmit: true });
        if (r.submitResult && !r.submitResult.success) throw r.submitResult.error;
        address = r.contractId;
        return { address };
      } catch (e) {
        throw toWalletError(e);
      }
    },

    async connect() {
      try {
        const r = await kit.connectWallet();
        address = r?.contractId ?? null;
        return address ? { address } : null;
      } catch {
        // Reconexión silenciosa: si no hay sesión válida, simplemente no hay cuenta.
        address = null;
        return null;
      }
    },

    async signAndSend(tx: contract.AssembledTransaction<unknown>, opts: SignAndSendOptions = {}) {
      if (!address) throw new WalletError("NOT_CONNECTED");
      opts.onPhase?.("verifying");
      const op = tx.built?.operations[0];
      if (!op || op.type !== "invokeHostFunction") throw new WalletError("AUTH_MISMATCH", "no es una llamada a contrato");
      await verifyAuthTree({ func: op.func, auth: op.auth ?? [] }, address, cfg, opts);
      try {
        const { sequence } = await server.getLatestLedger();
        opts.onPhase?.("signing");
        const res = await kit.signAndSubmit(tx, { expiration: sequence + SIGNATURE_LEDGERS });
        if (!res.success) throw res.error;
        opts.onPhase?.("submitting");
        return { hash: res.hash };
      } catch (e) {
        throw toWalletError(e);
      }
    },

    async disconnect() {
      await kit.disconnect();
      address = null;
    },
  };
}
