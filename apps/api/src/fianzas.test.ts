import { describe, expect, it } from "vitest";
import { Keypair, StrKey, nativeToScVal, scValToNative, xdr } from "@stellar/stellar-sdk";
import { createApp } from "./app";
import { deployments, loadConfigFromEnv } from "./config";
import { Problem } from "./problem";
import type { Built, Chain } from "./chain";
import { parseAmount } from "./views";

const LANDLORD = Keypair.random().publicKey();
const TENANT = Keypair.random().publicKey();
const ESCROW = StrKey.encodeContract(Buffer.alloc(32, 7));
const OTHER = StrKey.encodeContract(Buffer.alloc(32, 9));
const PREDICTED = StrKey.encodeContract(Buffer.alloc(32, 1));
const FACTORY = deployments.factory!;

const termsRaw = nativeToScVal({ amount: 500_000_000n, id: 1n }, { type: { amount: ["symbol", "i128"], id: ["symbol", "u64"] } });

function summary(id: number) {
  return {
    id: BigInt(id),
    escrow: StrKey.encodeContract(Buffer.alloc(32, id)),
    status: ["Active"],
    data: {
      terms: {
        factory: FACTORY, id: BigInt(id), landlord: LANDLORD, amount: 500_000_000n, end_ts: 2_000_000_000n,
        tenant_yield_bps: 0, platform_fee_bps: 2000, tw_fee_bps: 0, tw_fee_receiver: undefined,
        defindex_vault_fee_bps: 100, defindex_protocol_fee_bps: 2000, treasury: deployments.treasury,
        dispute_resolvers: deployments.staff, timeout_secs: 120n, review_timeout_secs: 300n, stop_bond: 100_000_000n,
        strategy: { id: "usdc_fixed", kind: ["DeFindexVault"], vault: OTHER, asset: deployments.token, asset_name: "USDC:G", risk: ["Standard"], simulated: false, enabled: true, max_vault_fee_bps: 200 },
      },
      tenant: TENANT, invite_hash: undefined, status: ["Active"],
      approvals: { target: 2, approval_count: 0, approved_by: [] }, shares: 499_000_000n,
      created_ts: 1n, funded_ts: 2n,
      dispute: { reason_hash: undefined, stopped_ts: 0n, expert_ref: undefined, report_hash: undefined, bond_held: 0n, stop_justified: undefined },
      settlement: { total: 0n, yield_total: 0n, deduction: 0n, to_tenant: 0n, to_landlord: 0n, to_treasury: 0n, to_tw: 0n },
      path: ["Approved"],
    },
  };
}

interface Opts {
  buildResult?: unknown;
  buildError?: Problem;
}

function setup(opts: Opts = {}) {
  const builds: Array<{ contractId: string; fn: string; args: xdr.ScVal[]; signer: string }> = [];
  const chain: Chain = {
    async read(contractId, fn, args = []) {
      if (fn === "config_version") return 7 as never;
      if (fn === "predict_address") return PREDICTED as never;
      if (fn === "id_of") {
        const who = scValToNative(args[0]);
        if (who === ESCROW) return 1n as never;
        throw new Problem(502, "STELLAR_SIMULATION_FAILED", "La simulación falló", "Error(Contract, #1)", { contractError: 1 });
      }
      if (fn === "escrow_of") {
        if (scValToNative(args[0]) === 1n) return ESCROW as never;
        throw new Problem(502, "STELLAR_SIMULATION_FAILED", "La simulación falló", "Error(Contract, #1)", { contractError: 1 });
      }
      if (fn === "count_by_landlord") return 3 as never;
      if (fn === "list_by_landlord") {
        const start = Number(scValToNative(args[1]));
        const limit = Number(scValToNative(args[2]));
        return [1n, 2n, 3n].slice(start, start + limit) as never;
      }
      if (fn === "get_fianzas") return (scValToNative(args[0]) as bigint[]).map((id) => summary(Number(id))) as never;
      throw new Error(`lectura inesperada ${contractId}.${fn}`);
    },
    async readRaw(_contractId, fn) {
      if (fn === "get_terms") return termsRaw;
      throw new Error(`lectura raw inesperada ${fn}`);
    },
    async build(contractId, fn, args, signer): Promise<Built> {
      builds.push({ contractId, fn, args, signer });
      if (opts.buildError) throw opts.buildError;
      return { unsignedXdr: "AAAA", txHash: "ff".repeat(32), result: opts.buildResult };
    },
    async send() {
      return { txHash: "ab".repeat(32), ledger: 1, status: "SUCCESS" };
    },
    async latestLedger() {
      return 1000;
    },
    async wasmHashOf() {
      return null;
    },
    async getTransaction() {
      return null;
    },
  };
  const app = createApp(loadConfigFromEnv({}, deployments), { chain });
  const post = (path: string, body: unknown) =>
    app.request(`/api${path}`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
  return { app, builds, post };
}

const json = (r: Response) => r.json() as Promise<Record<string, any>>;

describe("POST /fianzas/v1/fianzas", () => {
  const body = { signer: LANDLORD, tenant: TENANT, amount: 50, endTs: 2_000_000_000, strategyId: "custody" };

  it("construye create_fianza con la configVersion actual y devuelve el contractId predicho", async () => {
    const { builds, post } = setup();
    const res = await post("/fianzas/v1/fianzas", body);
    expect(res.status).toBe(200);
    const b = await json(res);
    expect(b.contractId).toBe(PREDICTED);
    expect(b.configVersion).toBe(7);
    expect(b.nonce).toMatch(/^[0-9a-f]{64}$/);
    expect(b.unsignedXdr).toBe("AAAA");
    expect(b.result).toBeUndefined(); // el retorno simulado no se expone
    expect(builds).toHaveLength(1);
    expect(builds[0]).toMatchObject({ contractId: FACTORY, fn: "create_fianza", signer: LANDLORD });
    const p = scValToNative(builds[0].args[1]) as Record<string, unknown>;
    expect(p.amount).toBe(500_000_000n);
    expect(p.expected_config_version).toBe(7);
    expect(p.strategy_id).toBe("custody");
    expect(p.invite_hash).toBeNull();
  });

  it("exige tenant o inviteHash, no los dos", async () => {
    const { post } = setup();
    const res = await post("/fianzas/v1/fianzas", { ...body, inviteHash: "ab".repeat(32) });
    expect(res.status).toBe(400);
    expect((await json(res)).code).toBe("VALIDATION_ERROR");
  });

  it("traduce ConfigChanged de la factory a 409 FZ_CONFIG_CHANGED", async () => {
    const { post } = setup({
      buildError: new Problem(502, "STELLAR_SIMULATION_FAILED", "La simulación falló", "Error(Contract, #21)", { contractError: 21 }),
    });
    const res = await post("/fianzas/v1/fianzas", { ...body, expectedConfigVersion: 6 });
    expect(res.status).toBe(409);
    const b = await json(res);
    expect(b.code).toBe("FZ_CONFIG_CHANGED");
    expect(b.extensions.contractError).toBe(21);
  });
});

describe("rutas compatibles con TW", () => {
  it("fund rechaza un importe distinto del de la fianza", async () => {
    const { builds, post } = setup();
    const res = await post("/escrow/single-release/v2/fund", { contractId: ESCROW, signer: TENANT, amount: "49.9" });
    expect(res.status).toBe(422);
    expect((await json(res)).code).toBe("ESCROW_PROPERTIES_MISMATCH");
    expect(builds).toHaveLength(0);
  });

  it("fund reenvía los Terms de la cadena tal cual como expected_terms", async () => {
    const { builds, post } = setup();
    const res = await post("/escrow/single-release/v2/fund", { contractId: ESCROW, signer: TENANT, amount: 50 });
    expect(res.status).toBe(200);
    expect(builds[0]).toMatchObject({ contractId: ESCROW, fn: "fund_escrow", signer: TENANT });
    expect(builds[0].args[1].switch().name).toBe("scvVoid"); // sin inviteCode
    expect(builds[0].args[2]).toBe(termsRaw);
  });

  it("no construye nada contra contratos que no son fianzas de la factory", async () => {
    const { builds, post } = setup();
    const res = await post("/escrow/single-release/v2/fund", { contractId: OTHER, signer: TENANT, amount: 50 });
    expect(res.status).toBe(404);
    expect((await json(res)).code).toBe("ESCROW_NOT_FOUND");
    expect(builds).toHaveLength(0);
  });

  it("approve-milestones solo admite el milestone 0", async () => {
    const { post } = setup();
    const res = await post("/escrow/single-release/v2/approve-milestones", { contractId: ESCROW, approver: TENANT, milestoneIndexes: [1] });
    expect(res.status).toBe(422);
    expect((await json(res)).code).toBe("ESCROW_INVALID_MILESTONE_INDEX");
  });

  it("approve-and-release falla con ESCROW_NOT_COMPLETED si la aprobación no liquida", async () => {
    const pending = setup({ buildResult: undefined });
    const res = await pending.post("/escrow/single-release/v2/approve-and-release-milestones", { contractId: ESCROW, signer: TENANT, milestoneIndexes: [0] });
    expect(res.status).toBe(422);
    expect((await json(res)).code).toBe("ESCROW_NOT_COMPLETED");

    const settles = setup({ buildResult: { total: 1n } });
    const ok = await settles.post("/escrow/single-release/v2/approve-and-release-milestones", { contractId: ESCROW, signer: TENANT, milestoneIndexes: [0] });
    expect(ok.status).toBe(200);
    expect(settles.builds[0].fn).toBe("approve_release");
  });
});

describe("lecturas", () => {
  it("by-id traduce NotFound de la factory a 404", async () => {
    const { app } = setup();
    expect((await json(await app.request("/api/fianzas/v1/fianzas/by-id/1"))).contractId).toBe(ESCROW);
    const res = await app.request("/api/fianzas/v1/fianzas/by-id/99");
    expect(res.status).toBe(404);
    expect((await json(res)).code).toBe("ESCROW_NOT_FOUND");
  });

  it("la lista del casero pagina con cursor y mapea el resumen", async () => {
    const { app } = setup();
    const p1 = await json(await app.request(`/api/fianzas/v1/landlords/${LANDLORD}/fianzas?limit=2`));
    expect(p1.data.map((f: any) => f.id)).toEqual([1, 2]);
    expect(p1.hasMore).toBe(true);
    expect(p1.total).toBe(3);
    const f = p1.data[0];
    expect(f.status).toBe("Active");
    expect(f.terms.amount).toBe("50.0000000");
    expect(f.terms.strategy.kind).toBe("defindex");
    expect(f.terms.defindexVaultFeeBps).toBe(100);
    expect(f.settlement).toBeNull(); // no liquidada
    const p2 = await json(await app.request(`/api/fianzas/v1/landlords/${LANDLORD}/fianzas?limit=2&cursor=${p1.nextCursor}`));
    expect(p2.data.map((x: any) => x.id)).toEqual([3]);
    expect(p2.hasMore).toBe(false);
    expect(p2.nextCursor).toBeNull();
  });
});

describe("parseAmount", () => {
  it("acepta number o string con hasta 7 decimales", () => {
    expect(parseAmount(10)).toBe(100_000_000n);
    expect(parseAmount("10.5")).toBe(105_000_000n);
    expect(parseAmount("0.0000001")).toBe(1n);
    expect(() => parseAmount("1.12345678")).toThrow(expect.objectContaining({ code: "AMOUNT_PRECISION_UNSUPPORTED" }));
    expect(() => parseAmount("-1")).toThrow(expect.objectContaining({ code: "VALIDATION_ERROR" }));
  });
});
