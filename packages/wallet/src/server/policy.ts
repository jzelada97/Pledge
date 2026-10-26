// Política del Relayer: qué { func, auth } aceptamos patrocinar (INTERFACES § 8, security SRV-2…SRV-5, N-3).
import "server-only";
import { Address, xdr } from "@stellar/stellar-sdk";
import { PERMISSIONLESS_FUNCTIONS, TRANSFER_FUNCTIONS, contractOf, credentialAddress, fnNameOf, sameXdr, toHex } from "../xdr";
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

// Lo que se saca del cuerpo sin consultar la red: basta para aplicar los cupos antes de cualquier RPC.
export interface DecodedSubmission {
  raw: Submission;
  func: xdr.HostFunction;
  auth: xdr.SorobanAuthorizationEntry[];
  fn: string; // "create_fianza", "fund_escrow", "__deploy_account", …
  rateKeys: string[]; // claves de los límites por credencial
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

export function decodeSubmission(raw: Submission): DecodedSubmission {
  let func: xdr.HostFunction;
  let auth: xdr.SorobanAuthorizationEntry[];
  try {
    func = xdr.HostFunction.fromXDR(raw.func, "base64");
    auth = raw.auth.map((a) => xdr.SorobanAuthorizationEntry.fromXDR(a, "base64"));
  } catch {
    throw new RelayError("BAD_REQUEST", 400, "XDR no válido");
  }
  switch (func.switch().name) {
    case "hostFunctionTypeCreateContractV2": {
      // Todas las altas las firma el deployer compartido del kit: el cupo va por la cuenta nueva, cuya
      // dirección sale de deployer + salt (un salt por passkey).
      const preimage = func.createContractV2().contractIdPreimage();
      const key =
        preimage.switch().name === "contractIdPreimageFromAddress"
          ? `deploy:${Address.fromScAddress(preimage.fromAddress().address()).toString()}:${toHex(preimage.fromAddress().salt())}`
          : "deploy:otro";
      return { raw, func, auth, fn: "__deploy_account", rateKeys: [key] };
    }
    case "hostFunctionTypeInvokeContract": {
      const rateKeys = auth.map(credentialAddress).filter((a): a is string => a !== null);
      return { raw, func, auth, fn: fnNameOf(func.invokeContract()), rateKeys };
    }
    default:
      throw notAllowed("tipo de host function no permitido");
  }
}

// Despliegue de una cuenta inteligente nueva (createWallet del kit con el deployer compartido).
function validateDeploy(func: xdr.HostFunction, auth: xdr.SorobanAuthorizationEntry[], policy: RelayPolicy): void {
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
}

async function validateInvoke(
  func: xdr.HostFunction,
  auth: xdr.SorobanAuthorizationEntry[],
  policy: RelayPolicy,
  chain: ChainLookups,
): Promise<void> {
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
    // Solo fund_escrow (y stop en el plan B) lleva una transferencia, una como mucho y al escrow invocado.
    const subs = root.subInvocations();
    if (subs.length > (TRANSFER_FUNCTIONS.has(fn) ? 1 : 0)) throw notAllowed(`${fn} no admite esas subinvocaciones`);
    for (const sub of subs) {
      const subFn = sub.function();
      if (subFn.switch().name !== "sorobanAuthorizedFunctionTypeContractFn" || sub.subInvocations().length !== 0) {
        throw notAllowed("subinvocación no permitida");
      }
      const subArgs = subFn.contractFn();
      const [from, to] = subArgs.args();
      const addressOf = (v: xdr.ScVal | undefined) =>
        v?.switch().name === "scvAddress" ? Address.fromScAddress(v.address()).toString() : null;
      if (
        contractOf(subArgs) !== policy.token ||
        fnNameOf(subArgs) !== "transfer" ||
        addressOf(from) !== signer ||
        addressOf(to) !== contract
      ) {
        throw notAllowed("solo se permite token.transfer del propio firmante al escrow");
      }
    }
  }
}

export async function validateSubmission(body: DecodedSubmission, policy: RelayPolicy, chain: ChainLookups): Promise<void> {
  const { func, auth } = body;
  if (body.fn === "__deploy_account") validateDeploy(func, auth, policy);
  else await validateInvoke(func, auth, policy, chain);

  // La simulación filtra llamadas que fallarían (no gastan cupo) y acota el coste.
  const sim = await chain.simulate(func, auth);
  if (!sim.ok) throw new RelayError("SIMULATION_FAILED", 400, sim.error);
  if (sim.minResourceFee > policy.maxResourceFeeStroops) throw new RelayError("FEE_TOO_HIGH", 413);
}
