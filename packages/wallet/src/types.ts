import type { contract } from "@stellar/stellar-sdk";

// Fases de signAndSend, para que la UI muestre en qué punto está.
export type SignPhase = "verifying" | "signing" | "submitting";

export interface SignAndSendOptions {
  onPhase?: (phase: SignPhase) => void;
  // Importe exacto que ve el usuario para la transferencia anidada. Obligatorio en `fund_escrow` (la fianza)
  // y en `stop` (terms.stop_bond): sin él no se firma (security WEB-3, N-10).
  expectedTransferAmount?: bigint;
  // Escrow que ve el usuario. Si llega, la llamada tiene que ir a ese contrato.
  expectedContract?: string;
}

// Respuesta de los builds de apps/api (INTERFACES § 8): la de TW más la extensión `soroban`.
export interface UnsignedTransactionResponse {
  unsignedXdr: string; // firmable tal cual solo si el firmante es una cuenta G
  txHash: string;
  contractId?: string | null;
  soroban?: {
    // solo si el firmante es una C-address (passkey)
    func: string; // base64 XDR HostFunction
    auth: string[]; // base64 SorobanAuthorizationEntry sin firmar
    validUntilLedger: number; // latestLedger + 60
  };
}

export interface SignBuiltOptions extends SignAndSendOptions {
  // Solo para builds sin `soroban` (cuenta G, p. ej. Freighter): firma el XDR y devuelve el XDR firmado.
  signXdr?: (unsignedXdr: string) => Promise<string>;
}

// API pública que consume P4 (INTERFACES § 10).
export interface Wallet {
  createAccount(displayName: string): Promise<{ address: string }>; // passkey nueva → C-address
  connect(): Promise<{ address: string } | null>; // reconexión silenciosa
  signAndSend(tx: contract.AssembledTransaction<unknown>, opts?: SignAndSendOptions): Promise<{ hash: string }>; // fees vía Relayer
  // Firma lo que construye apps/api: con `soroban`, las auth entries con la passkey y envío por relayPath;
  // sin él, el XDR con opts.signXdr y envío por sendTransactionPath.
  signAndSendBuilt(res: UnsignedTransactionResponse, opts?: SignBuiltOptions): Promise<{ hash: string }>;
  disconnect(): Promise<void>;
}

// Lo que la wallet necesita saber de nuestros contratos para verificar lo que firma.
export interface ContractsConfig {
  factory: string; // deployments.factory
  token: string; // deployments.token (SAC de USDC)
  // true si `addr` es un escrow registrado en la factory (factory.id_of(addr) no da NotFound).
  isRegisteredEscrow(addr: string): Promise<boolean>;
  // Plan A: escrows single-release con rendimiento de Trustless Work (API v1 + vault).
  trustless?: {
    // true si `addr` es un escrow de TW que reconocemos (p. ej. su wasm está en la lista permitida).
    isEscrow(addr: string): Promise<boolean>;
    // Dirección que cobra la comisión de TW: release_funds la recibe como argumento y se comprueba.
    feeAddress: string;
  };
}

export interface WalletConfig extends ContractsConfig {
  rpcUrl: string;
  networkPassphrase: string;
  rpId: string; // hostname exacto del despliegue (security AUTH-6)
  rpName: string; // nombre que ve el usuario al crear la passkey
  accountWasmHash: string; // deployments.smartAccount.accountWasmHash
  webauthnVerifierAddress: string; // deployments.smartAccount.webauthnVerifier
  relayPath: string; // "/api/fianzas/v1/relay" (createRelayHandler montado en apps/api)
  sendTransactionPath?: string; // por defecto "/api/stellar/send-transaction"
}
