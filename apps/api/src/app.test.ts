import { describe, expect, it } from "vitest";
import { createApp } from "./app";
import { deployments, loadConfigFromEnv } from "./config";
import type { Chain } from "./chain";
import { createApiClient, ApiError } from "./client";

// Cadena falsa: ninguna prueba toca la RPC. `config` imita lo que devuelve scValToNative.
const fakeChain: Chain = {
  async read(contractId, fn) {
    if (fn === "get_fees") return [100, 2000] as never;
    if (fn === "get_asset_amounts_per_shares") return [10_000_240n] as never;
    if (fn === "config") {
      return {
        token: deployments.token,
        treasury: deployments.treasury,
        staff: deployments.staff,
        platform_fee_bps: 2000,
        tw_fee_bps: 0,
        tw_fee_receiver: undefined,
        timeout_secs: 120n,
        review_timeout_secs: 300n,
        stop_bond_min: 100_000_000n,
        stop_bond_bps: 500,
        tenant_yield_bps: 0,
        vault_manager: undefined,
      } as never;
    }
    if (fn === "paused") return false as never;
    if (fn === "escrow_wasm_hash") return new Uint8Array(32).fill(0xab) as never;
    if (fn === "config_version") return 7 as never;
    throw new Error(`lectura inesperada ${contractId}.${fn}`);
  },
  async readRaw(contractId, fn) {
    throw new Error(`lectura inesperada ${contractId}.${fn}`);
  },
  async build(contractId, fn) {
    throw new Error(`build inesperado ${contractId}.${fn}`);
  },
  async send() {
    return { txHash: "ab".repeat(32), ledger: 123, status: "SUCCESS" };
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

const cfg = loadConfigFromEnv({}, deployments); // sin RELAYER_API_KEY ni RAMP_FAUCET_SECRET
const app = createApp(cfg, { chain: fakeChain, now: () => 0 });
const json = (r: Response) => r.json() as Promise<Record<string, any>>;

describe("esqueleto de la API", () => {
  it("responde en /api/health", async () => {
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    const b = await json(res);
    expect(b.ok).toBe(true);
    expect(b.network).toBe("testnet");
    expect(b.relayer).toBe(false);
  });

  it("devuelve Problem Details en rutas desconocidas", async () => {
    const res = await app.request("/api/no-existe");
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toBe("application/problem+json");
    const b = await json(res);
    expect(b.code).toBe("NOT_FOUND");
    expect(b.instance).toBe("/api/no-existe");
    expect(b.traceId).toBeTruthy();
  });

  it("las rutas de TW que cambian de semántica responden 501 con replacement", async () => {
    const res = await app.request("/api/escrow/single-release/v2/dispute", { method: "POST", body: "{}" });
    expect(res.status).toBe(501);
    const b = await json(res);
    expect(b.code).toBe("FZ_ENDPOINT_NOT_SUPPORTED");
    expect(b.extensions.replacement).toContain("/fianzas/v1/fianzas/{contractId}/stop");
  });

  it("deploy de TW remite a la creación vía factory", async () => {
    const b = await json(await app.request("/api/escrow/single-release/v2/deploy", { method: "POST", body: "{}" }));
    expect(b.status).toBe(501);
    expect(b.extensions.replacement).toBe("POST /api/fianzas/v1/fianzas");
  });

  it("send-transaction valida el cuerpo", async () => {
    const sin = await app.request("/api/stellar/send-transaction", { method: "POST", body: "{}", headers: { "content-type": "application/json" } });
    expect(sin.status).toBe(400);
    expect((await json(sin)).code).toBe("VALIDATION_ERROR");
    // Un XDR que no se puede leer no llega a la RPC (los casos válidos están en send-policy.test.ts).
    const malo = await app.request("/api/stellar/send-transaction", {
      method: "POST",
      body: JSON.stringify({ signedXdr: "AAAA" }),
      headers: { "content-type": "application/json" },
    });
    expect(malo.status).toBe(400);
    expect((await json(malo)).code).toBe("STELLAR_TX_UNPARSEABLE");
  });

  it("config sale de deployments mientras no hay factory", async () => {
    const noFactory = createApp(loadConfigFromEnv({}, { ...deployments, factory: null }), { chain: fakeChain, now: () => 0 });
    const b = await json(await noFactory.request("/api/fianzas/v1/config"));
    expect(b.source).toBe("deployments");
    expect(b.platformFeeBps).toBe(2000);
    expect(b.tenantYieldBps).toBe(0);
    expect(b.factory).toBeNull();
    expect(b.configVersion).toBeNull();
  });

  it("config de la factory se serializa sin BigInt y con la misma forma", async () => {
    const res = await app.request("/api/fianzas/v1/config");
    expect(res.status).toBe(200);
    const b = await json(res);
    expect(b.source).toBe("chain");
    expect(b.factory).toBe(deployments.factory);
    expect(b.paused).toBe(false);
    expect(b.escrowWasmHash).toBe("ab".repeat(32));
    expect(b.platformFeeBps).toBe(2000);
    expect(b.twFeeReceiver).toBeNull();
    expect(b.timeoutSecs).toBe(120);
    expect(b.stopBondMin).toBe("100000000");
    expect(b.configVersion).toBe(7);
  });

  it("strategies lee comisiones y precio por share del vault", async () => {
    const list = await json(await app.request("/api/fianzas/v1/strategies"));
    const fixed = list.find((s: any) => s.id === "usdc_fixed");
    expect(fixed.vaultFeeBps).toBe(100);
    expect(fixed.protocolFeeBps).toBe(2000);
    expect(fixed.pricePerShare).toBe("1.0000240");
    expect(fixed.isDefault).toBe(true);
    const custody = list.find((s: any) => s.id === "custody");
    expect(custody.pricePerShare).toBeNull();
    expect(custody.apyLabel).toBe("sin rendimiento");
  });

  it("relay y ramp responden 503 si no están configurados", async () => {
    expect((await app.request("/api/fianzas/v1/relay", { method: "POST", body: "{}" })).status).toBe(503);
    expect((await app.request("/api/fianzas/v1/ramp")).status).toBe(503);
  });

  it("el cliente tipado traduce los errores a ApiError", async () => {
    const client = createApiClient("/api", async (input, init) => app.request(input as string, init));
    const health = await client.health();
    expect(health.network).toBe("testnet");
    await expect(client.getStrategyPrice("nope")).rejects.toBeInstanceOf(ApiError);
    const price = await client.getStrategyPrice("usdc_fixed");
    expect(price.pricePerShare).toBe("1.0000240");
  });
});
