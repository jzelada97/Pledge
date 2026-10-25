export { WalletError, isWalletError, type WalletErrorCode } from "./errors";
export type { ContractsConfig, SignAndSendOptions, SignPhase, Wallet, WalletConfig } from "./types";
export { verifyAuthTree, type Invocation } from "./auth-check";
export { FakeWallet } from "./fake";
export { createWallet, toWalletError } from "./smart-wallet";
