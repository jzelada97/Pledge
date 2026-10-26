import { Address, xdr } from "@stellar/stellar-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { call, entry, hostFn, invoke, randomAccount, randomContract, terms, transfer } from "../test-utils";
import type { ChainLookups } from "./chain";
import type { RelayPolicy } from "./policy";
import { createRelayHandler } from "./relay";

const ACCOUNT_WASM = "11".repeat(32);
const ESCROW_WASM = "22".repeat(32);
const factory = randomContract();
const token = randomContract();
const escrow = randomContract();
const tenant = randomContract();
const deployer = randomAccount();
const ORIGIN = "https://fianzas.example";

const policy: RelayPolicy = {
  fixedContracts: { [factory]: ["create_fianza"] },
  escrow: {
    wasmHashes: [ESCROW_WASM],
    factory,
    functions: ["cancel", "fund_escrow", "approve_release", "stop", "claim_after_timeout", "claim_after_review_timeout"],
  },
  token,
  createContractWasmHashes: [ACCOUNT_WASM],
  smartAccountDeployers: [deployer],
  allowedOrigins: [ORIGIN],
  maxResourceFeeStroops: 1_000_000n,
  maxRequestsPerMinutePerIp: 30,
  maxRequestsPerMinutePerCredential: 10,
  maxCreateFianzaPerHourPerCredential: 5,
  globalHourlyCap: 600,
};

const wasm = new Map<string, string>([
  [escrow, ESCROW_WASM],
  [tenant, ACCOUNT_WASM],
]);
let sim = { ok: true, minResourceFee: 1000n };
const chain: ChainLookups = {
  wasmHashOf: async (c) => wasm.get(c) ?? null,
  isRegisteredEscrow: async (f, e) => f === factory && e === escrow,
  simulate: async () => sim,
};

const relayer = vi.fn(async () => Response.json({ success: true, data: { transactionId: "t1", hash: "ab".repeat(32), status: "confirmed" } }));

function handler() {
  return createRelayHandler({
    policy,
    relayerUrl: "https://channels.example/testnet/",
    apiKey: "secret-api-key",
    rpcUrl: "http://unused",
    networkPassphrase: "Test SDF Network ; September 2015",
    chain,
    fetch: relayer as unknown as typeof fetch,
  });
}

function request(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("https://fianzas.example/api/relay", {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN, "x-real-ip": "1.2.3.4", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function payload(func: xdr.HostFunction, auth: xdr.SorobanAuthorizationEntry[]) {
  return { func: func.toXDR("base64"), auth: auth.map((a) => a.toXDR("base64")) };
}

function fund(subs?: xdr.SorobanAuthorizedInvocation[]) {
  const args = invoke(escrow, "fund_escrow", [new Address(tenant).toScVal(), terms(5n), terms(5n)]);
  return payload(hostFn(args), [entry(tenant, call(args, subs ?? [transfer(token, tenant, escrow, 5n)]))]);
}

async function codeOf(res: Response) {
  return ((await res.json()) as { code?: string }).code;
}

// Alta de una cuenta con passkey: el kit la despliega con el deployer compartido y un salt por passkey.
function deployArgs(wasmHex: string, from: string, salt = 7) {
  return new xdr.CreateContractArgsV2({
    contractIdPreimage: xdr.ContractIdPreimage.contractIdPreimageFromAddress(
      new xdr.ContractIdPreimageFromAddress({ address: new Address(from).toScAddress(), salt: Buffer.alloc(32, salt) }),
    ),
    executable: xdr.ContractExecutable.contractExecutableWasm(Buffer.from(wasmHex, "hex")),
    constructorArgs: [],
  });
}

function deployBody(args: xdr.CreateContractArgsV2, signer: string) {
  return payload(xdr.HostFunction.hostFunctionTypeCreateContractV2(args), [
    entry(
      signer,
      new xdr.SorobanAuthorizedInvocation({
        function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeCreateContractV2HostFn(args),
        subInvocations: [],
      }),
      "v1",
    ),
  ]);
}

beforeEach(() => {
  sim = { ok: true, minResourceFee: 1000n };
  relayer.mockClear();
});

describe("createRelayHandler", () => {
  it("valida y reenvía a Channels con la API key solo en la cabecera", async () => {
    const res = await handler()(request(fund()));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, data: { transactionId: "t1" } });
    const [url, init] = relayer.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://channels.example/testnet/");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer secret-api-key");
    expect(JSON.parse(init.body as string)).toEqual({ params: fund() });
  });

  it("rechaza funciones de staff, escrows no registrados y token.transfer directo", async () => {
    const resolve = invoke(escrow, "resolve", []);
    const fakeEscrow = invoke(randomContract(), "approve_release", [new Address(tenant).toScVal()]);
    const direct = invoke(token, "transfer", []);
    for (const args of [resolve, fakeEscrow, direct]) {
      const res = await handler()(request(payload(hostFn(args), [entry(tenant, call(args))])));
      expect(res.status).toBe(403);
    }
    expect(relayer).not.toHaveBeenCalled();
  });

  it("rechaza SOURCE_ACCOUNT, raíz distinta, firmantes ajenos y transferencias de terceros", async () => {
    const args = invoke(escrow, "approve_release", [new Address(tenant).toScVal()]);
    const other = invoke(escrow, "cancel", []);
    const stranger = randomContract();
    const cases = [
      payload(hostFn(args), [entry(tenant, call(args), "source")]),
      payload(hostFn(args), [entry(tenant, call(other))]),
      payload(hostFn(args), [entry(stranger, call(args))]),
      fund([transfer(token, stranger, escrow, 5n)]),
      fund([transfer(randomContract(), tenant, escrow, 5n)]),
    ];
    for (const body of cases) expect((await handler()(request(body))).status).toBe(403);
    expect(relayer).not.toHaveBeenCalled();
  });

  it("acepta el despliegue de una cuenta con el wasm y el deployer permitidos, y nada más", async () => {
    expect((await handler()(request(deployBody(deployArgs(ACCOUNT_WASM, deployer), deployer)))).status).toBe(200);
    expect((await handler()(request(deployBody(deployArgs(ESCROW_WASM, deployer), deployer)))).status).toBe(403);
    const other = randomAccount();
    expect((await handler()(request(deployBody(deployArgs(ACCOUNT_WASM, other), other)))).status).toBe(403);
  });

  it("rechaza origen ajeno, tipo de contenido, cuerpos enormes y esquemas con campos extra", async () => {
    const h = handler();
    expect((await h(request(fund(), { origin: "https://evil.example" }))).status).toBe(403);
    const noOrigin = request(fund());
    noOrigin.headers.delete("origin");
    expect((await h(noOrigin)).status).toBe(403);
    expect((await h(request(fund(), { "content-type": "text/plain" }))).status).toBe(415);
    expect((await h(request("x".repeat(65 * 1024)))).status).toBe(413);
    expect((await h(request({ ...fund(), relayerUrl: "https://evil" }))).status).toBe(400);
    expect((await h(request({ func: "AAAA", auth: [] }))).status).toBe(400);
  });

  it("filtra por simulación y fee, y no filtra detalles del Relayer", async () => {
    sim = { ok: false, minResourceFee: 0n };
    let res = await handler()(request(fund()));
    expect([res.status, await codeOf(res)]).toEqual([400, "SIMULATION_FAILED"]);
    sim = { ok: true, minResourceFee: 2_000_000n };
    res = await handler()(request(fund()));
    expect([res.status, await codeOf(res)]).toEqual([413, "FEE_TOO_HIGH"]);
    sim = { ok: true, minResourceFee: 1000n };
    relayer.mockImplementationOnce(async () => Response.json({ success: false, error: "secret-api-key leaked?" }));
    res = await handler()(request(fund()));
    const text = await res.text();
    expect(res.status).toBe(502);
    expect(text).not.toContain("secret-api-key");
  });

  it("aplica el cupo por credencial antes de consultar la red", async () => {
    const h = handler();
    for (let i = 0; i < 10; i++) expect((await h(request(fund()))).status).toBe(200);
    const simulate = vi.spyOn(chain, "simulate");
    const wasmHashOf = vi.spyOn(chain, "wasmHashOf");
    const res = await h(request(fund()));
    expect([res.status, await codeOf(res)]).toEqual([429, "RATE_LIMITED"]);
    expect(simulate).not.toHaveBeenCalled();
    expect(wasmHashOf).not.toHaveBeenCalled();
    simulate.mockRestore();
    wasmHashOf.mockRestore();
  });

  it("las altas de passkeys distintas no comparten cupo", async () => {
    const h = handler();
    for (let salt = 0; salt < 12; salt++) {
      expect((await h(request(deployBody(deployArgs(ACCOUNT_WASM, deployer, salt), deployer)))).status).toBe(200);
    }
  });

  it("solo fund_escrow lleva una transferencia, y siempre al escrow invocado", async () => {
    const approve = invoke(escrow, "approve_release", [new Address(tenant).toScVal()]);
    const cases = [
      payload(hostFn(approve), [entry(tenant, call(approve, [transfer(token, tenant, escrow, 5n)]))]),
      fund([transfer(token, tenant, randomContract(), 5n)]),
      fund([transfer(token, tenant, escrow, 5n), transfer(token, tenant, escrow, 5n)]),
    ];
    for (const body of cases) expect((await handler()(request(body))).status).toBe(403);
    expect(relayer).not.toHaveBeenCalled();
  });

  it("aplica el tope de create_fianza por credencial", async () => {
    const h = handler();
    const landlord = randomContract();
    wasm.set(landlord, ACCOUNT_WASM);
    const args = invoke(factory, "create_fianza", [new Address(landlord).toScVal()]);
    const body = payload(hostFn(args), [entry(landlord, call(args))]);
    for (let i = 0; i < 5; i++) expect((await h(request(body))).status).toBe(200);
    const res = await h(request(body));
    expect([res.status, await codeOf(res)]).toEqual([429, "RATE_LIMITED"]);
  });

  it("patrocina escrows de TW por su wasm, solo con sus funciones de usuario", async () => {
    const TW_WASM = "33".repeat(32);
    const twEscrow = randomContract();
    wasm.set(twEscrow, TW_WASM);
    const h = createRelayHandler({
      policy: {
        ...policy,
        externalEscrows: {
          wasmHashes: [TW_WASM],
          functions: ["fund_escrow", "approve_milestone", "release_funds", "dispute_escrow"],
        },
      },
      relayerUrl: "https://channels.example/testnet",
      apiKey: "k",
      rpcUrl: "http://unused",
      networkPassphrase: "Test SDF Network ; September 2015",
      chain,
      fetch: relayer as unknown as typeof fetch,
    });
    const approve = invoke(twEscrow, "approve_milestone", []);
    expect((await h(request(payload(hostFn(approve), [entry(tenant, call(approve))])))).status).toBe(200);
    const resolve = invoke(twEscrow, "resolve_dispute", []);
    expect((await h(request(payload(hostFn(resolve), [entry(tenant, call(resolve))])))).status).toBe(403);
    // Sin externalEscrows, el mismo escrow no pasa.
    expect((await handler()(request(payload(hostFn(approve), [entry(tenant, call(approve))])))).status).toBe(403);
  });

  it("los claims pasan sin auth; el resto necesita firma", async () => {
    const claim = invoke(escrow, "claim_after_timeout", []);
    expect((await handler()(request(payload(hostFn(claim), [])))).status).toBe(200);
    const cancel = invoke(escrow, "cancel", []);
    expect((await handler()(request(payload(hostFn(cancel), [])))).status).toBe(403);
  });
});
