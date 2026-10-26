// Utilidades XDR compartidas por la verificación del cliente (WEB-3) y la del servidor (SRV-2…SRV-5).
import { Address, nativeToScVal, xdr } from "@stellar/stellar-sdk";

// Funciones que la passkey de un casero o inquilino puede firmar (INTERFACES § 8).
export const FACTORY_USER_FUNCTIONS = ["create_fianza"] as const;
export const ESCROW_USER_FUNCTIONS = [
  "cancel",
  "fund_escrow",
  "approve_release",
  "stop",
  "claim_after_timeout",
  "claim_after_review_timeout",
] as const;
// Sin require_auth en el contrato: no llevan auth entries.
export const PERMISSIONLESS_FUNCTIONS: ReadonlySet<string> = new Set(["claim_after_timeout", "claim_after_review_timeout"]);
// Llevan exactamente una subinvocación token.transfer(firmante, escrow, importe) (INTERFACES § 7).
export const TRANSFER_FUNCTIONS: ReadonlySet<string> = new Set(["fund_escrow", "stop"]);

// Escrow single-release con rendimiento de Trustless Work (rama feat/single-release-v1-defindex-yield).
// Solo las funciones que firma una parte con passkey; las del staff y las de admin no pasan por aquí.
export const TRUSTLESS_USER_FUNCTIONS = ["fund_escrow", "approve_milestone", "release_funds", "dispute_escrow"] as const;

// Dirección de unas credenciales Address o AddressV2 (cuentas inteligentes). null para SOURCE_ACCOUNT y
// delegados, que nunca se aceptan (security SRV-3).
export function credentialAddress(entry: xdr.SorobanAuthorizationEntry): string | null {
  const c = entry.credentials();
  switch (c.switch().name) {
    case "sorobanCredentialsAddress":
      return Address.fromScAddress(c.address().address()).toString();
    case "sorobanCredentialsAddressV2":
      return Address.fromScAddress(c.addressV2().address()).toString();
    default:
      return null;
  }
}

export function contractOf(args: xdr.InvokeContractArgs): string {
  return Address.fromScAddress(args.contractAddress()).toString();
}

export function fnNameOf(args: xdr.InvokeContractArgs): string {
  return args.functionName().toString();
}

export function sameXdr(a: { toXDR(): Uint8Array }, b: { toXDR(): Uint8Array }): boolean {
  const x = a.toXDR();
  const y = b.toXDR();
  return x.length === y.length && x.every((byte, i) => byte === y[i]);
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

// Comprueba que `inv` es exactamente token.transfer(from, to, amount) y que no anida nada más.
export function isExactTransfer(
  inv: xdr.SorobanAuthorizedInvocation,
  token: string,
  from: string,
  to: string,
  amount: bigint,
): boolean {
  const fn = inv.function();
  if (fn.switch().name !== "sorobanAuthorizedFunctionTypeContractFn") return false;
  const args = fn.contractFn();
  if (contractOf(args) !== token || fnNameOf(args) !== "transfer" || inv.subInvocations().length !== 0) return false;
  const expected = [new Address(from).toScVal(), new Address(to).toScVal(), nativeToScVal(amount, { type: "i128" })];
  const got = args.args();
  return got.length === 3 && got.every((v, i) => sameXdr(v, expected[i]));
}
