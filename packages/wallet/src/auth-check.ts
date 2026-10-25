// "Lo que ves es lo que firmas" (security WEB-3 v2). Antes de pedir la passkey se comprueba que la
// transacción llama a nuestra factory, a un escrow registrado o (plan A) a un escrow de Trustless Work,
// con una función permitida, y que la entrada de auth del firmante autoriza exactamente esa llamada y
// las subinvocaciones esperadas.
import { Address, scValToNative, xdr } from "@stellar/stellar-sdk";
import { WalletError } from "./errors";
import type { ContractsConfig } from "./types";
import {
  ESCROW_USER_FUNCTIONS,
  FACTORY_USER_FUNCTIONS,
  PERMISSIONLESS_FUNCTIONS,
  TRANSFER_FUNCTIONS,
  TRUSTLESS_USER_FUNCTIONS,
  contractOf,
  credentialAddress,
  fnNameOf,
  isExactTransfer,
  sameXdr,
} from "./xdr";

export interface Invocation {
  func: xdr.HostFunction;
  auth: xdr.SorobanAuthorizationEntry[];
}

function mismatch(reason: string): never {
  throw new WalletError("AUTH_MISMATCH", reason);
}

// Importe de la transferencia anidada en fund_escrow: sale de `expected_terms.amount` (tercer argumento).
// El contrato exige expected_terms == terms, así que es el importe que se va a cobrar.
function fundAmount(args: xdr.InvokeContractArgs): bigint {
  const terms = args.args()[2];
  if (!terms) mismatch("fund_escrow sin expected_terms");
  const amount = (scValToNative(terms) as { amount?: unknown }).amount;
  if (typeof amount !== "bigint" || amount <= 0n) mismatch("expected_terms.amount no válido");
  return amount;
}

// Escrow de TW: fund_escrow(signer, expected_escrow, amount) transfiere `amount` (tercer argumento).
function trustlessFundAmount(args: xdr.InvokeContractArgs): bigint {
  const raw = args.args()[2];
  const amount = raw ? scValToNative(raw) : undefined;
  if (typeof amount !== "bigint" || amount <= 0n) mismatch("fund_escrow: importe no válido");
  return amount;
}

type Target = "factory" | "fianza" | "trustless";

async function targetOf(contract: string, fn: string, cfg: ContractsConfig): Promise<Target> {
  const allowed = (list: readonly string[]) => list.includes(fn);
  if (contract === cfg.factory) {
    if (!allowed(FACTORY_USER_FUNCTIONS)) mismatch(`factory.${fn} no permitida`);
    return "factory";
  }
  if (allowed(ESCROW_USER_FUNCTIONS) && (await cfg.isRegisteredEscrow(contract))) return "fianza";
  if (cfg.trustless && allowed(TRUSTLESS_USER_FUNCTIONS) && (await cfg.trustless.isEscrow(contract))) return "trustless";
  return mismatch(`${fn} sobre un contrato no reconocido o con una función no permitida`);
}

/**
 * Verifica la invocación que va a firmar `signer`. Devuelve su auth entry, o null si la función no
 * necesita firma (claims sin permisos). Lanza WalletError("AUTH_MISMATCH") si algo no cuadra.
 */
export async function verifyAuthTree(
  inv: Invocation,
  signer: string,
  cfg: ContractsConfig,
  opts: { expectedTransferAmount?: bigint } = {},
): Promise<xdr.SorobanAuthorizationEntry | null> {
  if (inv.func.switch().name !== "hostFunctionTypeInvokeContract") mismatch("no es una llamada a contrato");
  const args = inv.func.invokeContract();
  const contract = contractOf(args);
  const fn = fnNameOf(args);

  const target = await targetOf(contract, fn, cfg);

  // Ninguna entrada con credenciales de la cuenta origen (las firmaría el Relayer).
  if (inv.auth.some((e) => credentialAddress(e) === null)) mismatch("credenciales no admitidas");

  const mine = inv.auth.filter((e) => credentialAddress(e) === signer);
  if (target === "fianza" && PERMISSIONLESS_FUNCTIONS.has(fn)) {
    if (mine.length !== 0) mismatch(`${fn} no necesita firma`);
    return null;
  }
  if (mine.length !== 1) mismatch("se esperaba exactamente una entrada de auth del firmante");

  const root = mine[0].rootInvocation();
  const rootFn = root.function();
  if (rootFn.switch().name !== "sorobanAuthorizedFunctionTypeContractFn" || !sameXdr(rootFn.contractFn(), args)) {
    mismatch("la raíz de la auth no coincide con la llamada");
  }

  const subs = root.subInvocations();
  if (target === "trustless" && fn === "release_funds") {
    // La comisión de TW va a una dirección que pasa el llamante: tiene que ser la configurada.
    const fee = args.args()[1];
    const feeTo = fee?.switch().name === "scvAddress" ? Address.fromScAddress(fee.address()).toString() : null;
    if (feeTo !== cfg.trustless!.feeAddress) mismatch("release_funds con una dirección de comisión que no es la de TW");
  }
  if (TRANSFER_FUNCTIONS.has(fn)) {
    const amount =
      fn !== "fund_escrow"
        ? opts.expectedTransferAmount
        : target === "trustless"
          ? trustlessFundAmount(args)
          : fundAmount(args);
    if (amount === undefined) mismatch("stop necesita expectedTransferAmount (terms.stop_bond)");
    if (subs.length !== 1 || !isExactTransfer(subs[0], cfg.token, signer, contract, amount)) {
      mismatch(`${fn} debe autorizar solo token.transfer(firmante, escrow, ${amount})`);
    }
  } else if (subs.length !== 0) {
    mismatch(`${fn} no debe autorizar subinvocaciones`);
  }
  return mine[0];
}
