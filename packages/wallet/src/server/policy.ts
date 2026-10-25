// Política del Relayer: qué { func, auth } aceptamos patrocinar (INTERFACES § 8, security SRV-2…SRV-5, N-3).
import "server-only";
import { Address, xdr } from "@stellar/stellar-sdk";
import { PERMISSIONLESS_FUNCTIONS, contractOf, credentialAddress, fnNameOf, sameXdr, toHex } from "../xdr";
import type { ChainLookups } from "./chain";

export interface RelayPolicy {
  fixedContracts: Record<string, string[]>; // { [factory]: ["create_fianza"] }. create_fianzas_batch NO pasa (N-3)
  escrow: {
    wasmHashes: string[]; // deployments.escrowWasmHashesAllowed
    factory: string; // la instancia debe estar registrada aquí
    functions: string[]; // cancel, fund_escrow, approve_release, stop y los dos claims
  };
  // Plan A: escrows de Trustless Work, reconocidos solo por su wasm (no están en nuestra factory).
  // Funciones: fund_escrow, approve_milestone, release_funds, dispute_escrow.
  externalEscrows?: { wasmHashes: string[]; functions: string[] };
  token: string; // única subinvocación permitida: token.transfer(firmante, …)
  createContractWasmHashes: string[]; // solo smart accounts (deployments.smartAccount.accountWasmHash)
  smartAccountDeployers: string[]; // dirección que despliega las cuentas (el deployer compartido del kit)
  allowedOrigins: string[]; // orígenes de nuestras apps (security CS-3)
  maxResourceFeeStroops: bigint; // tope de fee por transacción
  maxRequestsPerMinutePerIp: number; // 30
  maxRequestsPerMinutePerCredential: number; // 10
  maxCreateFianzaPerHourPerCredential: number; // 5 (N-3)
  globalHourlyCap: number; // tope por instancia, p. ej. 600
}

export type RelayErrorCode =
  | "BAD_REQUEST"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "PAYLOAD_TOO_LARGE"
  | "NOT_ALLOWED"
  | "RATE_LIMITED"
  | "SIMULATION_FAILED"
  | "FEE_TOO_HIGH"
  | "RELAYER_DOWN"
  | "TX_FAILED";

export class RelayError extends Error {
  constructor(
    readonly code: RelayErrorCode,
    readonly status: number,
    detail?: string,
  ) {
    super(detail ?? code);
  }
}

const MAX_AUTH_ENTRIES = 4; // security IV-5

export interface Submission {
  func: string;
  auth: string[];
}

export interface ValidatedSubmission {
  func: xdr.HostFunction;
  auth: xdr.SorobanAuthorizationEntry[];
  fn: string; // "create_fianza", "fund_escrow", "__deploy_account", …
  signers: string[]; // direcciones de las credenciales, para los límites por credencial
}

const notAllowed = (detail: string) => new RelayError("NOT_ALLOWED", 403, detail);

// Esquema estricto: exactamente { func: string, auth: string[] }, sin campos extra.
export function parseSubmission(text: string): Submission {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new RelayError("BAD_REQUEST", 400, "JSON no válido");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new RelayError("BAD_REQUEST", 400);
  const body = value as Record<string, unknown>;
  const keys = Object.keys(body);
  if (keys.length !== 2 || typeof body.func !== "string" || !Array.isArray(body.auth)) {
    throw new RelayError("BAD_REQUEST", 400, "se espera { func, auth }");
  }
  if (body.auth.length > MAX_AUTH_ENTRIES || !body.auth.every((a) => typeof a === "string" && a.length > 0)) {
    throw new RelayError("BAD_REQUEST", 400, "auth no válido");
  }
  return { func: body.func, auth: body.auth as string[] };
}

// Despliegue de una cuenta inteligente nueva (createWallet del kit con el deployer compartido).
function validateDeploy(func: xdr.HostFunction, auth: xdr.SorobanAuthorizationEntry[], policy: RelayPolicy): string[] {
  const deploy = func.createContractV2();
  const executable = deploy.executable();
  if (executable.switch().name !== "contractExecutableWasm") throw notAllowed("despliegue sin wasm");
  if (!policy.createContractWasmHashes.includes(toHex(executable.wasmHash()))) throw notAllowed("wasm no permitido");
  const preimage = deploy.contractIdPreimage();
  if (preimage.switch().name !== "contractIdPreimageFromAddress") throw notAllowed("preimage no permitido");
  const deployer = Address.fromScAddress(preimage.fromAddress().address()).toString();
  if (!policy.smartAccountDeployers.includes(deployer)) throw notAllowed("deployer no permitido");
  if (auth.length !== 1) throw notAllowed("el despliegue lleva exactamente una auth entry");
  const entry = auth[0];
  const root = entry.rootInvocation();
  const rootFn = root.function();
  if (
    entry.credentials().switch().name !== "sorobanCredentialsAddress" ||
    credentialAddress(entry) !== deployer ||
    root.subInvocations().length !== 0 ||
    rootFn.switch().name !== "sorobanAuthorizedFunctionTypeCreateContractV2HostFn" ||
    !sameXdr(rootFn.createContractV2HostFn(), deploy)
  ) {
    throw notAllowed("la auth del despliegue no coincide");
  }
  return [deployer];
}

async function validateInvoke(
  func: xdr.HostFunction,
  auth: xdr.SorobanAuthorizationEntry[],
  policy: RelayPolicy,
  chain: ChainLookups,
): Promise<{ fn: string; signers: string[] }> {
  const args = func.invokeContract();
  const contract = contractOf(args);
  const fn = fnNameOf(args);

  const fixed = policy.fixedContracts[contract];
  if (fixed) {
    if (!fixed.includes(fn)) throw notAllowed(`${fn} no permitida en la factory`);
  } else {
    const hash = await chain.wasmHashOf(contract);
    const external = policy.externalEscrows;
    if (hash && policy.escrow.wasmHashes.includes(hash)) {
      // Escrow de nuestra factory: las dos comprobaciones, porque el wasm es público y cualquiera puede
      // desplegar una instancia propia (security R-3).
      if (!policy.escrow.functions.includes(fn)) throw notAllowed(`${fn} no permitida`);
      if (!(await chain.isRegisteredEscrow(policy.escrow.factory, contract))) throw notAllowed("escrow no registrado");
    } else if (hash && external?.wasmHashes.includes(hash)) {
      // Escrow de TW: no hay registro on-chain que consultar. Lo acotan la lista de funciones, que los
      // firmantes sean cuentas nuestras y los topes de ritmo y de fee.
      if (!external.functions.includes(fn)) throw notAllowed(`${fn} no permitida`);
    } else {
      throw notAllowed("wasm del escrow no permitido");
    }
  }

  if (auth.length === 0 && !PERMISSIONLESS_FUNCTIONS.has(fn)) throw notAllowed(`${fn} necesita auth`);

  const signers: string[] = [];
  for (const entry of auth) {
    const signer = credentialAddress(entry);
    if (!signer) throw notAllowed("credenciales no admitidas"); // SRV-3: nada de SOURCE_ACCOUNT
    // Solo cuentas inteligentes nuestras: el Relayer no patrocina a terceros.
    const signerHash = signer.startsWith("C") ? await chain.wasmHashOf(signer) : null;
    if (!signerHash || !policy.createContractWasmHashes.includes(signerHash)) throw notAllowed("firmante no permitido");
    const root = entry.rootInvocation();
    const rootFn = root.function();
    if (rootFn.switch().name !== "sorobanAuthorizedFunctionTypeContractFn" || !sameXdr(rootFn.contractFn(), args)) {
      throw notAllowed("la raíz de la auth no coincide con func"); // SRV-4
    }
    for (const sub of root.subInvocations()) {
      const subFn = sub.function();
      if (subFn.switch().name !== "sorobanAuthorizedFunctionTypeContractFn" || sub.subInvocations().length !== 0) {
        throw notAllowed("subinvocación no permitida");
      }
      const subArgs = subFn.contractFn();
      const from = subArgs.args()[0];
      if (
        contractOf(subArgs) !== policy.token ||
        fnNameOf(subArgs) !== "transfer" ||
        !from ||
        from.switch().name !== "scvAddress" ||
        Address.fromScAddress(from.address()).toString() !== signer
      ) {
        throw notAllowed("solo se permite token.transfer del propio firmante");
      }
    }
    signers.push(signer);
  }
  return { fn, signers };
}

export async function validateSubmission(
  body: Submission,
  policy: RelayPolicy,
  chain: ChainLookups,
): Promise<ValidatedSubmission> {
  let func: xdr.HostFunction;
  let auth: xdr.SorobanAuthorizationEntry[];
  try {
    func = xdr.HostFunction.fromXDR(body.func, "base64");
    auth = body.auth.map((a) => xdr.SorobanAuthorizationEntry.fromXDR(a, "base64"));
  } catch {
    throw new RelayError("BAD_REQUEST", 400, "XDR no válido");
  }

  let fn: string;
  let signers: string[];
  switch (func.switch().name) {
    case "hostFunctionTypeCreateContractV2":
      fn = "__deploy_account";
      signers = validateDeploy(func, auth, policy);
      break;
    case "hostFunctionTypeInvokeContract":
      ({ fn, signers } = await validateInvoke(func, auth, policy, chain));
      break;
    default:
      throw notAllowed("tipo de host function no permitido");
  }

  // La simulación filtra llamadas que fallarían (no gastan cupo) y acota el coste.
  const sim = await chain.simulate(func, auth);
  if (!sim.ok) throw new RelayError("SIMULATION_FAILED", 400);
  if (sim.minResourceFee > policy.maxResourceFeeStroops) throw new RelayError("FEE_TOO_HIGH", 413);
  return { func, auth, fn, signers };
}
