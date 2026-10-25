// Constructores de XDR para los tests: llamadas a contrato y auth entries como las que genera el kit.
import { Address, Keypair, StrKey, nativeToScVal, xdr } from "@stellar/stellar-sdk";

export function randomContract(): string {
  return StrKey.encodeContract(Buffer.from(crypto.getRandomValues(new Uint8Array(32))));
}

export function randomAccount(): string {
  return Keypair.random().publicKey();
}

export function invoke(contract: string, fn: string, args: xdr.ScVal[] = []): xdr.InvokeContractArgs {
  return new xdr.InvokeContractArgs({
    contractAddress: new Address(contract).toScAddress(),
    functionName: fn,
    args,
  });
}

export function hostFn(args: xdr.InvokeContractArgs): xdr.HostFunction {
  return xdr.HostFunction.hostFunctionTypeInvokeContract(args);
}

export function call(
  args: xdr.InvokeContractArgs,
  subs: xdr.SorobanAuthorizedInvocation[] = [],
): xdr.SorobanAuthorizedInvocation {
  return new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(args),
    subInvocations: subs,
  });
}

export function transfer(token: string, from: string, to: string, amount: bigint): xdr.SorobanAuthorizedInvocation {
  return call(
    invoke(token, "transfer", [new Address(from).toScVal(), new Address(to).toScVal(), nativeToScVal(amount, { type: "i128" })]),
  );
}

export function entry(
  signer: string,
  root: xdr.SorobanAuthorizedInvocation,
  kind: "v1" | "v2" | "source" = "v2",
): xdr.SorobanAuthorizationEntry {
  const creds = new xdr.SorobanAddressCredentials({
    address: new Address(signer).toScAddress(),
    nonce: xdr.Int64.fromString("1"),
    signatureExpirationLedger: 100,
    signature: xdr.ScVal.scvVoid(),
  });
  const credentials =
    kind === "source"
      ? xdr.SorobanCredentials.sorobanCredentialsSourceAccount()
      : kind === "v1"
        ? xdr.SorobanCredentials.sorobanCredentialsAddress(creds)
        : xdr.SorobanCredentials.sorobanCredentialsAddressV2(creds);
  return new xdr.SorobanAuthorizationEntry({ credentials, rootInvocation: root });
}

// expected_terms reducido a lo que lee la wallet (amount).
export function terms(amount: bigint): xdr.ScVal {
  return nativeToScVal({ amount }, { type: { amount: ["symbol", "i128"] } });
}
