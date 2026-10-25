export { WalletError, isWalletError, type WalletErrorCode } from "./errors";
export type {
  ContractsConfig,
  SignAndSendOptions,
  SignBuiltOptions,
  SignPhase,
  UnsignedTransactionResponse,
  Wallet,
  WalletConfig,
} from "./types";
export { sendBuilt, type BuiltDeps } from "./built";
export { verifyAuthTree, type Invocation } from "./auth-check";
export { FakeWallet } from "./fake";
export { createWallet, toWalletError } from "./smart-wallet";
