// "Lo que ves es lo que firmas" (security WEB-3 v2). Antes de pedir la passkey se comprueba que la
// transacción llama a nuestra factory o a un escrow registrado, con una función permitida, y que la
// entrada de auth del firmante autoriza exactamente esa llamada y las subinvocaciones esperadas.
import { scValToNative, xdr } from "@stellar/stellar-sdk";
import { WalletError } from "./errors";
import type { ContractsConfig } from "./types";
import {
  ESCROW_USER_FUNCTIONS,
  FACTORY_USER_FUNCTIONS,
  PERMISSIONLESS_FUNCTIONS,
  TRANSFER_FUNCTIONS,
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

  if (contract === cfg.factory) {
    if (!(FACTORY_USER_FUNCTIONS as readonly string[]).includes(fn)) mismatch(`factory.${fn} no permitida`);
  } else {
    if (!(ESCROW_USER_FUNCTIONS as readonly string[]).includes(fn)) mismatch(`escrow.${fn} no permitida`);
    if (!(await cfg.isRegisteredEscrow(contract))) mismatch("el contrato no es un escrow de la factory");
  }

  // Ninguna entrada con credenciales de la cuenta origen (las firmaría el Relayer).
  if (inv.auth.some((e) => credentialAddress(e) === null)) mismatch("credenciales no admitidas");

  const mine = inv.auth.filter((e) => credentialAddress(e) === signer);
  if (PERMISSIONLESS_FUNCTIONS.has(fn)) {
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
  if (TRANSFER_FUNCTIONS.has(fn)) {
    const amount = fn === "fund_escrow" ? fundAmount(args) : opts.expectedTransferAmount;
    if (amount === undefined) mismatch("stop necesita expectedTransferAmount (terms.stop_bond)");
    if (subs.length !== 1 || !isExactTransfer(subs[0], cfg.token, signer, contract, amount)) {
      mismatch(`${fn} debe autorizar solo token.transfer(firmante, escrow, ${amount})`);
    }
  } else if (subs.length !== 0) {
    mismatch(`${fn} no debe autorizar subinvocaciones`);
  }
  return mine[0];
}
