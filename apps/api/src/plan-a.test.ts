import { describe, expect, it } from "vitest";
import { Account, Address, Asset, BASE_FEE, Contract, Keypair, Operation, StrKey, TransactionBuilder, scValToNative, xdr } from "@stellar/stellar-sdk";
import { TW_DEPLOYER_TESTNET, TW_DEPLOY_FN, TW_ESCROW_WASM_TESTNET, TW_FEE_ADDRESS_TESTNET, TW_YIELD_URL, type Escrow } from "@fianzas/trustless";
import { createApp } from "./app";
import type { Chain } from "./chain";
import { deployments, loadConfigFromEnv } from "./config";

const NET = deployments.networkPassphrase;
const LANDLORD = Keypair.random().publicKey();
const TENANT = StrKey.encodeContract(Buffer.alloc(32, 2)); // passkey
const ESCROW = StrKey.encodeContract(Buffer.alloc(32, 7));
const NEW_ESCROW = StrKey.encodeContract(Buffer.alloc(32, 8));
const OTHER_CONTRACT = StrKey.encodeContract(Buffer.alloc(32, 9));
const treasuryKp = Keypair.random();

function escrow(over: Partial<Escrow> = {}): Escrow {
  return {
    contractId: ESCROW,
    type: "single-release",
    vault: "CCG3G4YUO3FOPCTZXDSXOB3VXLOWVW3G5FB6RJNB45TYQ34SBS7TS7ZJ",
    engagementId: "fianza-1",
    title: "Fianza 1",
    description: "Fianza de habitación",
    amount: 500,
    balance: 500.0000893,
    platformFee: 0,
    roles: { approver: LANDLORD, serviceProvider: LANDLORD, platformAddress: deployments.treasury, releaseSigner: TENANT, disputeResolver: deployments.staff[0]!, receiver: TENANT },
    flags: { disputed: false, released: false, resolved: false },
    trustline: { symbol: "USDC", address: deployments.tokenIssuer, contractId: deployments.token },
    milestones: [{ description: "Devolución de la fianza", status: "pending", evidence: "", approved: false }],
    ...over,
  };
}

// Transacción de despliegue como la que devuelve TW (packages/trustless/CLAUDE.md): una llamada al deployer con
// el firmante como origen, una sola auth de la cuenta origen y sin subinvocaciones.
function deployXdr(
  fn = TW_DEPLOY_FN,
  source = deployments.treasury,
  contract = TW_DEPLOYER_TESTNET,
  opts: { fee?: string; subs?: xdr.SorobanAuthorizedInvocation[]; auth?: boolean } = {},
): string {
  const args = new xdr.InvokeContractArgs({ contractAddress: new Address(contract).toScAddress(), functionName: fn, args: [] });
  const entry = new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
    rootInvocation: new xdr.SorobanAuthorizedInvocation({ function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(args), subInvocations: opts.subs ?? [] }),
  });
  return new TransactionBuilder(new Account(source, "1"), { fee: opts.fee ?? "170000", networkPassphrase: NET })
    .addOperation(Operation.invokeHostFunction({ func: xdr.HostFunction.hostFunctionTypeInvokeContract(args), auth: opts.auth === false ? [] : [entry] }))
    .setTimeout(300)
    .build()
    .toXDR();
}

const EXPECTED_ESCROW = xdr.ScVal.scvSymbol("escrow-actual");

/** Cadena simulada: registra los builds (lo que firma una passkey contra el contrato de TW). */
let onChain: { flags: Escrow["flags"]; milestones: Escrow["milestones"] } | null = null;
function fakeChain() {
  const builds: Array<{ contractId: string; fn: string; args: xdr.ScVal[]; signer: string }> = [];
  const chain: Chain = {
    async read(_contractId, fn) {
      if (fn === "get_escrow") {
        if (!onChain) throw new Error("sin estado en cadena");
        return onChain as never;
      }
      throw new Error("el plan A no toca la factory");
    },
    async readRaw(_contractId, fn) {
      if (fn === "get_escrow") return EXPECTED_ESCROW;
      throw new Error(`lectura raw inesperada ${fn}`);
    },
    async build(contractId, fn, args, signer) {
      builds.push({ contractId, fn, args, signer });
      return { unsignedXdr: "informativo", txHash: "cc".repeat(32), result: undefined, soroban: { func: "f", auth: ["a"], validUntilLedger: 1060 } };
    },
    async send() {
      return { txHash: "dd".repeat(32), ledger: 7, status: "SUCCESS" };
    },
    async latestLedger() {
      return 1000;
    },
    async wasmHashOf(contractId) {
      return contractId === ESCROW ? TW_ESCROW_WASM_TESTNET : null;
    },
  };
  return { chain, builds };
}

/** Saldos que devuelve get-multiple-escrow-balance en la API simulada (por contractId). */
const balances: Record<string, number> = {};

/** API de TW simulada: registra las llamadas y responde con fixtures. */
function fakeTw(escrows: Escrow[] = [escrow()]) {
  const calls: Array<{ method: string; path: string; body?: any; key: string | null }> = [];
  const twFetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const key = new Headers(init?.headers).get("x-api-key");
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path: url.pathname + url.search, body, key });
    if (key !== "tw-key") return Response.json({ statusCode: 401, message: "Unauthorized" }, { status: 401 });
    if (url.pathname === "/helper/get-escrow-by-contract-ids") {
      const ids = url.searchParams.getAll("contractIds[]");
      return Response.json(escrows.filter((e) => ids.includes(e.contractId)));
    }
    if (url.pathname === "/escrow/single-release/vault-position") {
      return Response.json({ vault: escrows[0]?.vault, shares: 499.99, underlying: 500.0009 });
    }
    if (url.pathname === "/helper/get-escrows-by-role") {
      const role = url.searchParams.get("role") as keyof Escrow["roles"];
      const addr = url.searchParams.get("roleAddress");
      return Response.json(escrows.filter((e) => e.roles[role] === addr));
    }
    if (url.pathname === "/deployer/single-release") return Response.json({ unsignedTransaction: deployXdr("tw_new_single_release_escrow", body.signer) });
    if (url.pathname === "/helper/send-transaction") return Response.json({ status: "SUCCESS", contractId: NEW_ESCROW });
    if (url.pathname === "/indexer/update-from-txhash") return Response.json({ ok: true });
    // Acciones de cuentas G: TW devuelve el XDR con el firmante del rol como origen.
    if (url.pathname === "/helper/get-multiple-escrow-balance") {
      return Response.json(url.searchParams.getAll("addresses[]").map((a) => ({ address: a, balance: balances[a] ?? 0 })));
    }
    const signerOf: Record<string, string | undefined> = {
      "/escrow/single-release/fund-escrow": body?.signer,
      "/escrow/single-release/approve-milestone": body?.approver,
      "/escrow/single-release/release-funds": body?.releaseSigner,
      "/escrow/single-release/dispute-escrow": body?.signer,
      "/escrow/single-release/resolve-dispute": body?.disputeResolver,
      "/escrow/single-release/withdraw-remaining-funds": body?.disputeResolver,
    };
    if (url.pathname in signerOf) {
      const source = signerOf[url.pathname];
      if (!source || !StrKey.isValidEd25519PublicKey(source)) return Response.json({ statusCode: 400, message: "invalid version byte" }, { status: 400 });
      return Response.json({ unsignedTransaction: deployXdr(url.pathname.split("/").pop()!.replace(/-/g, "_"), source) });
    }
    return Response.json({ statusCode: 404, message: `sin ruta ${url.pathname}` }, { status: 404 });
  };
  return { twFetch, calls };
}

function setup(env: Record<string, string> = {}, escrows?: Escrow[]) {
  const { twFetch, calls } = fakeTw(escrows);
  const { chain, builds } = fakeChain();
  const cfg = loadConfigFromEnv({ TW_API_KEY: "tw-key", ...env }, deployments);
  const app = createApp(cfg, { chain, now: () => 0, twFetch });
  const get = (p: string) => app.request(`/api${p}`);
  const post = (p: string, body: unknown) => app.request(`/api${p}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { app, calls, builds, get, post };
}
const json = (r: Response) => r.json() as Promise<Record<string, any>>;

describe("plan A: configuración y lecturas", () => {
  it("con TW_API_KEY el backend es trustless y config lo dice", async () => {
    const { get } = setup();
    expect((await json(await get("/health"))).backend).toBe("trustless");
    const cfg = await json(await get("/fianzas/v1/config"));
    expect(cfg.source).toBe("trustless");
    expect(cfg.twFeeBps).toBe(30);
    expect(cfg.twFeeOnPrincipal).toBe(true);
    expect(cfg.tenantYieldBps).toBe(0);
  });

  it("sin TW_API_KEY se queda el plan B (factory)", async () => {
    const cfg = loadConfigFromEnv({}, deployments);
    expect(cfg.backend).toBe("factory");
    expect(loadConfigFromEnv({ TW_API_KEY: "k", FIANZAS_BACKEND: "factory" }, deployments).backend).toBe("factory");
  });

  it("view traduce el escrow de TW y usa el vault para el rendimiento", async () => {
    const { get, calls } = setup();
    const res = await get(`/fianzas/v1/fianzas/${ESCROW}/view`);
    expect(res.status).toBe(200);
    const v = await json(res);
    expect(v).toMatchObject({ contractId: ESCROW, status: "Active", landlord: LANDLORD, tenant: TENANT, amount: "500.0000000" });
    expect(v.accruedYield).toBe("0.0009000"); // underlying 500.0009 − 500
    expect(v.expectedPayout).toBe("498.5000891"); // 500.0000893 − 0,3 % (truncado)
    expect(v.approvals).toEqual({ target: 2, count: 0, landlordApproved: false });
    expect(calls.every((c) => c.key === "tw-key")).toBe(true);
    expect(calls.some((c) => c.path.includes("validateOnChain=true"))).toBe(true);
  });

  it("terms lleva las comisiones del plan A y una fianza desconocida da 404", async () => {
    const { get } = setup();
    const t = await json(await get(`/fianzas/v1/fianzas/${ESCROW}/terms`));
    expect(t).toMatchObject({ twFeeBps: 30, twFeeOnPrincipal: true, platformFeeBps: 0, tenantYieldBps: 0, tokenIssuer: deployments.tokenIssuer });
    const missing = await get(`/fianzas/v1/fianzas/${NEW_ESCROW}/terms`);
    expect([missing.status, (await json(missing)).code]).toEqual([404, "ESCROW_NOT_FOUND"]);
  });

  it("las listas salen de get-escrows-by-role, con cursor", async () => {
    const list = [escrow(), escrow({ contractId: NEW_ESCROW, engagementId: "fianza-2", flags: { disputed: false, released: true, resolved: false } })];
    const { get, calls } = setup({}, list);
    const p1 = await json(await get(`/fianzas/v1/landlords/${LANDLORD}/fianzas?limit=1`));
    expect(p1.data.map((f: any) => f.contractId)).toEqual([ESCROW]);
    expect(p1).toMatchObject({ hasMore: true, total: 2 });
    const p2 = await json(await get(`/fianzas/v1/landlords/${LANDLORD}/fianzas?limit=1&cursor=${p1.nextCursor}`));
    expect(p2.data[0].status).toBe("Settled");
    expect(p2.hasMore).toBe(false);
    const tenant = await json(await get(`/fianzas/v1/tenants/${TENANT}/fianzas?status=Active`));
    expect(tenant.data).toHaveLength(1);
    expect(calls.find((c) => c.path.includes("get-escrows-by-role"))!.path).toContain(`role=approver&roleAddress=${LANDLORD}`);
  });

  it("by-id y cancel no existen en el plan A y lo dicen", async () => {
    const { get, post } = setup();
    expect((await get("/fianzas/v1/fianzas/by-id/1")).status).toBe(501);
    expect((await post(`/fianzas/v1/fianzas/${ESCROW}/cancel`, { signer: LANDLORD })).status).toBe(501);
  });
});

describe("plan A: crear la fianza", () => {
  const body = { landlord: LANDLORD, tenant: TENANT, amount: 500 };

  it("con TREASURY_SECRET firma en el servidor, envía por TW y devuelve el contractId", async () => {
    const { post, calls } = setup({ TREASURY_SECRET: treasuryKp.secret() });
    const res = await post("/fianzas/v1/fianzas", body);
    expect(res.status).toBe(200);
    const b = await json(res);
    expect(b).toMatchObject({ contractId: NEW_ESCROW, signedBy: "treasury", status: "SUCCESS" });
    expect(b.engagementId).toMatch(/^fianza-/);
    const deploy = calls.find((c) => c.path === "/deployer/single-release")!;
    expect(deploy.body.roles).toEqual({
      approver: LANDLORD, serviceProvider: LANDLORD, platformAddress: deployments.treasury,
      releaseSigner: TENANT, receiver: TENANT, disputeResolver: deployments.staff[0],
    });
    expect(deploy.body).toMatchObject({ signer: deployments.treasury, amount: 500, platformFee: 0, trustline: { symbol: "USDC", address: deployments.tokenIssuer } });
    const sent = calls.find((c) => c.path === "/helper/send-transaction")!;
    const tx = TransactionBuilder.fromXDR(sent.body.signedXdr, NET);
    expect(tx.signatures).toHaveLength(1); // firmada, y solo por la tesorería
  });

  it("sin TREASURY_SECRET devuelve el XDR sin firmar para firmarlo fuera y enviarlo por /submit", async () => {
    const { post, calls } = setup();
    const b = await json(await post("/fianzas/v1/fianzas", body));
    expect(b.contractId).toBeNull();
    expect(b.signer).toBe(deployments.treasury);
    expect(b.submitPath).toBe("/api/fianzas/v1/fianzas/submit");
    expect(calls.some((c) => c.path === "/helper/send-transaction")).toBe(false);
    // Se firma fuera (aquí con una clave cualquiera) y se envía.
    const tx = TransactionBuilder.fromXDR(b.unsignedXdr, NET);
    tx.sign(treasuryKp);
    const sent = await json(await post("/fianzas/v1/fianzas/submit", { signedXdr: tx.toXDR() }));
    expect(sent.contractId).toBe(NEW_ESCROW);
  });

  it("rechaza un firmante passkey, partes inválidas y envíos que no son el despliegue", async () => {
    const { post } = setup();
    const passkey = await post("/fianzas/v1/fianzas", { ...body, signer: TENANT });
    expect([passkey.status, (await json(passkey)).code]).toEqual([422, "FZ_SIGNER_MUST_BE_G"]);
    const same = await post("/fianzas/v1/fianzas", { ...body, tenant: LANDLORD });
    expect([same.status, (await json(same)).code]).toEqual([422, "FZ_INVALID_PARTIES"]);
    // Un pago firmado no es un despliegue: no se reenvía a TW.
    const pay = new TransactionBuilder(new Account(treasuryKp.publicKey(), "1"), { fee: BASE_FEE, networkPassphrase: NET })
      .addOperation(Operation.payment({ destination: LANDLORD, asset: Asset.native(), amount: "1" }))
      .setTimeout(30)
      .build();
    pay.sign(treasuryKp);
    const notDeploy = await post("/fianzas/v1/fianzas/submit", { signedXdr: pay.toXDR() });
    expect([notDeploy.status, (await json(notDeploy)).code]).toEqual([403, "FZ_TX_NOT_ALLOWED"]);
    // Otra función del deployer tampoco.
    const other = TransactionBuilder.fromXDR(deployXdr("update_escrow"), NET);
    other.sign(treasuryKp);
    expect((await post("/fianzas/v1/fianzas/submit", { signedXdr: other.toXDR() })).status).toBe(403);
  });

  it("no firma con la tesorería nada que no sea exactamente el despliegue de TW", async () => {
    // La API de TW simulada devuelve, según el título, un XDR manipulado.
    const cases: Array<[string, () => string]> = [
      ["otro contrato", () => deployXdr(TW_DEPLOY_FN, deployments.treasury, OTHER_CONTRACT)],
      ["otra función", () => deployXdr("update_escrow")],
      ["otro origen", () => deployXdr(TW_DEPLOY_FN, LANDLORD)],
      ["sin auth", () => deployXdr(TW_DEPLOY_FN, deployments.treasury, TW_DEPLOYER_TESTNET, { auth: false })],
      ["auth con subinvocaciones", () => deployXdr(TW_DEPLOY_FN, deployments.treasury, TW_DEPLOYER_TESTNET, { subs: [new xdr.SorobanAuthorizedInvocation({ function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(new xdr.InvokeContractArgs({ contractAddress: new Address(deployments.token).toScAddress(), functionName: "transfer", args: [] })), subInvocations: [] })] })],
      ["comisión desorbitada", () => deployXdr(TW_DEPLOY_FN, deployments.treasury, TW_DEPLOYER_TESTNET, { fee: "50000000" })],
    ];
    for (const [name, make] of cases) {
      const { twFetch: base } = fakeTw();
      const twFetch: typeof fetch = async (input, init) => (String(input).includes("/deployer/single-release") ? Response.json({ unsignedTransaction: make() }) : base(input, init));
      const app = createApp(loadConfigFromEnv({ TW_API_KEY: "tw-key", TREASURY_SECRET: treasuryKp.secret() }, deployments), { chain: fakeChain().chain, now: () => 0, twFetch });
      const res = await app.request("/api/fianzas/v1/fianzas", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      expect([name, res.status, (await json(res)).code]).toEqual([name, 502, "FZ_TW_UNEXPECTED_TX"]);
    }
    // Y /submit tampoco reenvía a TW una llamada a otro contrato, aunque se llame igual.
    const { post } = setup();
    const other = TransactionBuilder.fromXDR(deployXdr(TW_DEPLOY_FN, treasuryKp.publicKey(), OTHER_CONTRACT), NET);
    other.sign(treasuryKp);
    expect((await post("/fianzas/v1/fianzas/submit", { signedXdr: other.toXDR() })).status).toBe(403);
  });

  it("los errores de TW no filtran su cuerpo al cliente", async () => {
    const { get } = setup({ TW_API_KEY: "otra-key" }); // la API simulada responde 401
    const res = await get(`/fianzas/v1/fianzas/${ESCROW}/view`);
    expect(res.status).toBe(502);
    const b = await json(res);
    expect(b.code).toBe("FZ_TW_AUTH");
    expect(JSON.stringify(b)).not.toContain("Unauthorized");
  });
});

describe("plan A: fondear, aprobar, liberar y parar", () => {
  const SR = "/escrow/single-release/v2";
  const G_TENANT = Keypair.random().publicKey();
  const withGTenant = () => escrow({ roles: { ...escrow().roles, releaseSigner: G_TENANT, receiver: G_TENANT } });
  const approved = () => escrow({ milestones: [{ description: "Devolución de la fianza", status: "pending", evidence: "", approved: true }] });

  it("fund: con inquilino G lo construye la API de TW; con passkey, contra el contrato con el escrow actual", async () => {
    const g = setup({}, [withGTenant()]);
    const res = await g.post(`${SR}/fund`, { contractId: ESCROW, signer: G_TENANT, amount: 500 });
    expect(res.status).toBe(200);
    const b = await json(res);
    expect(b.soroban).toBeUndefined();
    expect(TransactionBuilder.fromXDR(b.unsignedXdr, NET)).toMatchObject({ source: G_TENANT });
    expect(g.calls.find((c) => c.path === "/escrow/single-release/fund-escrow")!.body).toEqual({ contractId: ESCROW, signer: G_TENANT, amount: 500 });
    expect(g.builds).toHaveLength(0);

    const p = setup();
    const pres = await p.post(`${SR}/fund`, { contractId: ESCROW, signer: TENANT, amount: "500" });
    expect(pres.status).toBe(200);
    expect((await json(pres)).soroban).toBeDefined();
    expect(p.builds).toHaveLength(1);
    expect(p.builds[0]).toMatchObject({ contractId: ESCROW, fn: "fund_escrow", signer: TENANT });
    expect(p.builds[0].args[1]).toBe(EXPECTED_ESCROW); // el Escrow actual, tal cual
    expect(scValToNative(p.builds[0].args[2])).toBe(5_000_000_000n);
    expect(p.calls.some((c) => c.path.includes("fund-escrow"))).toBe(false);
  });

  it("fund rechaza otro importe y a quien no es el inquilino", async () => {
    const { post } = setup();
    const wrong = await post(`${SR}/fund`, { contractId: ESCROW, signer: TENANT, amount: 499 });
    expect([wrong.status, (await json(wrong)).code]).toEqual([422, "ESCROW_PROPERTIES_MISMATCH"]);
    const other = await post(`${SR}/fund`, { contractId: ESCROW, signer: LANDLORD, amount: 500 });
    expect([other.status, (await json(other)).code]).toEqual([422, "FZ_NOT_PARTY"]);
  });

  it("approve: el casero (G) aprueba por TW; el inquilino passkey libera contra el contrato tras la aprobación", async () => {
    const first = setup();
    const a = await first.post(`${SR}/approve-milestones`, { contractId: ESCROW, approver: LANDLORD, milestoneIndexes: [0] });
    expect(a.status).toBe(200);
    expect(first.calls.find((c) => c.path.includes("approve-milestone"))!.body).toEqual({ contractId: ESCROW, milestoneIndex: "0", approver: LANDLORD });
    // El inquilino aún no puede liberar.
    const early = await first.post(`${SR}/approve-and-release-milestones`, { contractId: ESCROW, signer: TENANT, milestoneIndexes: [0] });
    expect([early.status, (await json(early)).code]).toEqual([422, "ESCROW_NOT_COMPLETED"]);

    const second = setup({}, [approved()]);
    const rel = await second.post(`${SR}/approve-and-release-milestones`, { contractId: ESCROW, signer: TENANT, milestoneIndexes: [0] });
    expect(rel.status).toBe(200);
    expect(second.builds[0]).toMatchObject({ contractId: ESCROW, fn: "release_funds", signer: TENANT });
    expect(scValToNative(second.builds[0].args[1])).toBe(TW_FEE_ADDRESS_TESTNET);
    // El casero no puede aprobar dos veces, y un tercero no es parte.
    const twice = await second.post(`${SR}/approve-milestones`, { contractId: ESCROW, approver: LANDLORD, milestoneIndexes: [0] });
    expect([twice.status, (await json(twice)).code]).toEqual([422, "FZ_ALREADY_APPROVED"]);
    const stranger = await second.post(`${SR}/approve-milestones`, { contractId: ESCROW, approver: Keypair.random().publicKey(), milestoneIndexes: [0] });
    expect((await json(stranger)).code).toBe("FZ_NOT_PARTY");
    expect((await second.post(`${SR}/approve-milestones`, { contractId: ESCROW, approver: LANDLORD, milestoneIndexes: [1] })).status).toBe(422);
  });

  it("stop: solo el casero, solo antes de aprobar; passkey contra el contrato", async () => {
    const { post, calls } = setup();
    const ok = await post(`/fianzas/v1/fianzas/${ESCROW}/stop`, { signer: LANDLORD, reasonHash: "ab".repeat(32) });
    expect(ok.status).toBe(200);
    expect((await json(ok)).stopBond).toBeNull();
    expect(calls.find((c) => c.path.includes("dispute-escrow"))!.body).toEqual({ contractId: ESCROW, signer: LANDLORD });
    const tenant = await post(`/fianzas/v1/fianzas/${ESCROW}/stop`, { signer: TENANT });
    expect([tenant.status, (await json(tenant)).code]).toEqual([422, "FZ_NOT_PARTY"]);
    const late = setup({}, [approved()]);
    expect((await json(await late.post(`/fianzas/v1/fianzas/${ESCROW}/stop`, { signer: LANDLORD }))).code).toBe("FZ_ALREADY_APPROVED");
    const pk = setup({}, [escrow({ roles: { ...escrow().roles, approver: TENANT, serviceProvider: TENANT, releaseSigner: LANDLORD, receiver: LANDLORD } })]);
    expect((await pk.post(`/fianzas/v1/fianzas/${ESCROW}/stop`, { signer: TENANT })).status).toBe(200);
    expect(pk.builds[0]).toMatchObject({ fn: "dispute_escrow", signer: TENANT });
  });
});

describe("plan A: resolver y repartir el rendimiento (staff)", () => {
  const STAFF = deployments.staff[0]!;
  const stopped = () => escrow({ flags: { disputed: true, released: false, resolved: false } });
  const resolved = () => escrow({ flags: { disputed: true, released: false, resolved: true } });

  it("resolve reparte el importe fondeado: deducción al casero, resto al inquilino, vía resolve-dispute de TW", async () => {
    const { post, calls } = setup({}, [stopped()]);
    const res = await post(`/fianzas/v1/fianzas/${ESCROW}/resolve`, { resolver: STAFF, deduction: 100, stopJustified: true });
    expect(res.status).toBe(200);
    const b = await json(res);
    expect(b.distributions).toEqual([
      { address: TENANT, amount: "400.0000000" },
      { address: LANDLORD, amount: "100.0000000" },
    ]);
    expect(TransactionBuilder.fromXDR(b.unsignedXdr, NET)).toMatchObject({ source: STAFF });
    expect(calls.find((c) => c.path.includes("resolve-dispute"))!.body).toEqual({
      contractId: ESCROW,
      disputeResolver: STAFF,
      distributions: [
        { address: TENANT, amount: 400 },
        { address: LANDLORD, amount: 100 },
      ],
    });
  });

  it("resolve rechaza deducción sin justificar, fianzas no paradas, resolvers ajenos y passkeys", async () => {
    const { post } = setup({}, [stopped()]);
    const incoherent = await post(`/fianzas/v1/fianzas/${ESCROW}/resolve`, { resolver: STAFF, deduction: 1, stopJustified: false });
    expect([incoherent.status, (await json(incoherent)).code]).toEqual([422, "FZ_INCOHERENT_RESOLUTION"]);
    const stranger = await post(`/fianzas/v1/fianzas/${ESCROW}/resolve`, { resolver: LANDLORD, deduction: 0, stopJustified: true });
    expect((await json(stranger)).code).toBe("FZ_NOT_RESOLVER");
    const passkey = await post(`/fianzas/v1/fianzas/${ESCROW}/resolve`, { resolver: TENANT, deduction: 0, stopJustified: true });
    expect((await json(passkey)).code).toBe("FZ_SIGNER_MUST_BE_G");
    const active = setup();
    const notStopped = await active.post(`/fianzas/v1/fianzas/${ESCROW}/resolve`, { resolver: STAFF, deduction: 0, stopJustified: true });
    expect((await json(notStopped)).code).toBe("FZ_NOT_DISPUTED");
  });

  it("distribute-yield reparte el sobrante exacto de getBalances con la comisión configurada", async () => {
    balances[ESCROW] = 0.0001; // 1000 stroops de rendimiento tras resolver
    try {
      const { post, calls } = setup({ TW_PLATFORM_FEE_BPS: "2000" }, [resolved()]);
      const res = await post(`/fianzas/v1/fianzas/${ESCROW}/distribute-yield`, { resolver: STAFF });
      expect(res.status).toBe(200);
      const b = await json(res);
      expect(b).toMatchObject({ remaining: "0.0001000", tenantYieldBps: 0, platformFeeBps: 2000 });
      expect(b.distributions).toEqual([
        { address: deployments.treasury, amount: "0.0000200" },
        { address: LANDLORD, amount: "0.0000800" },
      ]);
      expect(calls.find((c) => c.path.includes("withdraw-remaining-funds"))!.body.disputeResolver).toBe(STAFF);
      // Con la fianza aún activa no hay nada que repartir.
      const active = setup({ TW_PLATFORM_FEE_BPS: "2000" });
      expect((await json(await active.post(`/fianzas/v1/fianzas/${ESCROW}/distribute-yield`, { resolver: STAFF }))).code).toBe("FZ_NOT_SETTLED");
    } finally {
      delete balances[ESCROW];
    }
  });

  it("preview-settlement estima el reparto de una fianza parada con el saldo de hoy", async () => {
    const { get } = setup({}, [stopped()]); // balance 500.0000893
    const p = await json(await get(`/fianzas/v1/fianzas/${ESCROW}/preview-settlement?deduction=100`));
    expect(p).toMatchObject({
      estimated: true,
      total: "500.0000893",
      principalBack: "500.0000000",
      deduction: "100.0000000",
      yieldTotal: "0.0000893",
      toTenant: "400.0000000",
      toLandlord: "100.0000893", // Portugal: el rendimiento al casero
      toTreasury: "0.0000000",
    });
    expect((await get(`/fianzas/v1/fianzas/${ESCROW}/preview-settlement?deduction=501`)).status).toBe(422);
  });

  it("lo que TW no tiene responde 501 con el sustituto", async () => {
    const { post } = setup();
    for (const a of ["assign-expert", "record-report", "claim-timeout", "claim-review-timeout"]) {
      const res = await post(`/fianzas/v1/fianzas/${ESCROW}/${a}`, { signer: STAFF });
      expect([a, res.status, (await json(res)).code]).toEqual([a, 501, "FZ_ENDPOINT_NOT_SUPPORTED"]);
    }
  });
});

describe("plan A: la cadena manda y el indexador de TW se entera", () => {
  it("view superpone flags y milestones leídos del contrato a lo que dice la API de TW", async () => {
    onChain = { flags: { disputed: false, released: false, resolved: false }, milestones: [{ description: "Devolución de la fianza", status: "pending", evidence: "", approved: true }] };
    try {
      const { get, post } = setup(); // la API de TW aún dice approved: false
      const v = await json(await get(`/fianzas/v1/fianzas/${ESCROW}/view`));
      expect(v.approvals.landlordApproved).toBe(true);
      // Y con el estado en cadena el inquilino ya puede liberar.
      expect((await post(`/escrow/single-release/v2/approve-and-release-milestones`, { contractId: ESCROW, signer: TENANT, milestoneIndexes: [0] })).status).toBe(200);
    } finally {
      onChain = null;
    }
  });

  it("send-transaction avisa al indexador de TW tras enviar, y el front puede avisar tras el Relayer", async () => {
    const { app, calls, post } = setup();
    const tx = new TransactionBuilder(new Account(LANDLORD, "1"), { fee: BASE_FEE, networkPassphrase: NET })
      .addOperation(new Contract(ESCROW).call("approve_milestone"))
      .setTimeout(30)
      .build();
    tx.sign(treasuryKp);
    const res = await app.request("/api/stellar/send-transaction", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ signedXdr: tx.toXDR() }) });
    expect(res.status).toBe(200);
    expect(calls.find((c) => c.path === "/indexer/update-from-txhash")!.body).toEqual({ txHash: "dd".repeat(32) });
    const idx = await post("/fianzas/v1/indexer", { txHash: "ee".repeat(32) });
    expect((await json(idx)).ok).toBe(true);
    expect((await post("/fianzas/v1/indexer", { txHash: "no-es-un-hash" })).status).toBe(400);
  });
});

// La URL base por defecto es la de TrustYield.
describe("URL de TW", () => {
  it("usa TW_API_URL si se da y la de TrustYield si no", async () => {
    expect(TW_YIELD_URL).toContain("railway.app");
    const cfg = loadConfigFromEnv({ TW_API_KEY: "k", TW_API_URL: "https://tw.example" }, deployments);
    expect(cfg.trustless?.baseUrl).toBe("https://tw.example");
  });
});
