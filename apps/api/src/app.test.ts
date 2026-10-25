import { describe, expect, it } from "vitest";
import { createApp } from "./app";
import { deployments, loadConfigFromEnv } from "./config";
import type { Chain } from "./chain";
import { createApiClient, ApiError } from "./client";

// Cadena falsa: ninguna prueba toca la RPC.
const fakeChain: Chain = {
  async read(contractId, fn) {
    if (fn === "get_fees") return [100, 2000] as never;
    if (fn === "get_asset_amounts_per_shares") return [10_000_240n] as never;
    throw new Error(`lectura inesperada ${contractId}.${fn}`);
  },
  async send() {
    return { txHash: "ab".repeat(32), ledger: 123, status: "SUCCESS" };
  },
  async latestLedger() {
    return 1000;
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
    const ok = await app.request("/api/stellar/send-transaction", {
      method: "POST",
      body: JSON.stringify({ signedXdr: "AAAA" }),
      headers: { "content-type": "application/json" },
    });
    expect(ok.status).toBe(200);
    expect((await json(ok)).code).toBe("STELLAR_TX_SUBMITTED");
  });

  it("config sale de deployments mientras no hay factory", async () => {
    const b = await json(await app.request("/api/fianzas/v1/config"));
    expect(b.source).toBe("deployments");
    expect(b.platformFeeBps).toBe(2000);
    expect(b.tenantYieldBps).toBe(0);
    expect(b.factory).toBeNull();
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
