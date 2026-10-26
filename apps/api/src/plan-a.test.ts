import { describe, expect, it } from "vitest";
import { Account, Asset, BASE_FEE, Contract, Keypair, Operation, StrKey, TransactionBuilder } from "@stellar/stellar-sdk";
import { TW_YIELD_URL, type Escrow } from "@fianzas/trustless";
import { createApp } from "./app";
import type { Chain } from "./chain";
import { deployments, loadConfigFromEnv } from "./config";

const NET = deployments.networkPassphrase;
const LANDLORD = Keypair.random().publicKey();
const TENANT = StrKey.encodeContract(Buffer.alloc(32, 2)); // passkey
const ESCROW = StrKey.encodeContract(Buffer.alloc(32, 7));
const NEW_ESCROW = StrKey.encodeContract(Buffer.alloc(32, 8));
const TW_DEPLOYER = StrKey.encodeContract(Buffer.alloc(32, 9));
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

// Transacción de despliegue como la que devuelve TW: una llamada al deployer, con la tesorería como origen.
function deployXdr(fn = "tw_new_single_release_escrow", source = deployments.treasury): string {
  return new TransactionBuilder(new Account(source, "1"), { fee: BASE_FEE, networkPassphrase: NET })
    .addOperation(new Contract(TW_DEPLOYER).call(fn))
    .setTimeout(300)
    .build()
    .toXDR();
}

const chain: Chain = {
  async read() {
    throw new Error("el plan A no toca la factory");
  },
  async readRaw() {
    throw new Error("inesperado");
  },
  async build() {
    throw new Error("inesperado");
  },
  async send() {
    throw new Error("inesperado");
  },
  async latestLedger() {
    return 1000;
  },
  async wasmHashOf() {
    return null;
  },
};

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
    return Response.json({ statusCode: 404, message: `sin ruta ${url.pathname}` }, { status: 404 });
  };
  return { twFetch, calls };
}

function setup(env: Record<string, string> = {}, escrows?: Escrow[]) {
  const { twFetch, calls } = fakeTw(escrows);
  const cfg = loadConfigFromEnv({ TW_API_KEY: "tw-key", ...env }, deployments);
  const app = createApp(cfg, { chain, now: () => 0, twFetch });
  const get = (p: string) => app.request(`/api${p}`);
  const post = (p: string, body: unknown) => app.request(`/api${p}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { app, calls, get, post };
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

  it("los errores de TW no filtran su cuerpo al cliente", async () => {
    const { get } = setup({ TW_API_KEY: "otra-key" }); // la API simulada responde 401
    const res = await get(`/fianzas/v1/fianzas/${ESCROW}/view`);
    expect(res.status).toBe(502);
    const b = await json(res);
    expect(b.code).toBe("FZ_TW_AUTH");
    expect(JSON.stringify(b)).not.toContain("Unauthorized");
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
