import { describe, expect, it, vi } from "vitest";
import { StrKey } from "@stellar/stellar-sdk";
import { createApp } from "./app";
import { MAX_AUTH_FAILURES_PER_MINUTE, sha256Hex, verifyApiKey } from "./auth";
import { TtlCache } from "./chain";
import type { Chain } from "./chain";
import { deployments, loadConfigFromEnv, type ApiKey } from "./config";
import { LIMITS } from "./limits";
import { Problem } from "./problem";

const OTHER = StrKey.encodeContract(Buffer.alloc(32, 9));

// Cadena falsa: cuenta las lecturas para comprobar que un 429 nunca llega a la RPC.
function fakeChain() {
  const reads = { count: 0 };
  const chain: Chain = {
    async read(contractId, fn) {
      reads.count += 1;
      if (fn === "id_of") throw new Problem(502, "STELLAR_SIMULATION_FAILED", "La simulación falló", "Error(Contract, #1)", { contractError: 1 });
      throw new Error(`lectura inesperada ${contractId}.${fn}`);
    },
    async readRaw() {
      throw new Error("inesperado");
    },
    async build() {
      throw new Error("inesperado");
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
  };
  return { chain, reads };
}

const SECRET = "s3cr3t-de-prueba-con-mas-de-32-bytes-de-entropia";
const KEY: ApiKey = { id: "acme", secretSha256: sha256Hex(SECRET), label: "ACME", landlords: [], scopes: ["read", "build", "submit"], rpm: 300 };

function setup(keys: ApiKey[] = [KEY]) {
  const { chain, reads } = fakeChain();
  const cfg = loadConfigFromEnv({ API_KEYS_JSON: JSON.stringify(keys) }, deployments);
  const app = createApp(cfg, { chain, now: () => 0 });
  const get = (path: string, headers: Record<string, string> = {}) => app.request(`/api${path}`, { headers: { "x-real-ip": "1.2.3.4", ...headers } });
  const build = (headers: Record<string, string> = {}) =>
    app.request("/api/escrow/single-release/v2/fund", {
      method: "POST",
      headers: { "content-type": "application/json", "x-real-ip": "1.2.3.4", ...headers },
      body: JSON.stringify({ contractId: OTHER, signer: deployments.admin, amount: 1 }),
    });
  return { app, reads, get, build };
}

const code = async (r: Response) => ((await r.json()) as { code?: string }).code;

describe("límites por IP", () => {
  it("la petición 31 de build en un minuto devuelve 429 y no llega a la RPC", async () => {
    const { reads, build } = setup();
    for (let i = 0; i < LIMITS.buildsPerMinutePerIp; i++) expect((await build()).status).toBe(404); // contrato ajeno: tras consultar id_of
    const before = reads.count;
    const res = await build();
    expect([res.status, await code(res)]).toEqual([429, "TOO_MANY_REQUESTS"]);
    expect(res.headers.get("content-type")).toBe("application/problem+json");
    expect(reads.count).toBe(before);
    // Otra IP sigue teniendo su cupo.
    expect((await build({ "x-real-ip": "5.6.7.8" })).status).toBe(404);
  });

  it("las lecturas tienen su propio cupo, más alto", async () => {
    const { get } = setup();
    for (let i = 0; i < LIMITS.readsPerMinutePerIp; i++) expect((await get("/health")).status).toBe(200);
    expect((await get("/health")).status).toBe(429);
  });

  it("relay y ramp no cuentan: tienen sus propios límites", async () => {
    const { app } = setup();
    for (let i = 0; i < LIMITS.buildsPerMinutePerIp + 5; i++) {
      // Sin RELAYER_API_KEY responde 503 siempre, nunca 429 por nuestro cupo.
      expect((await app.request("/api/fianzas/v1/relay", { method: "POST", body: "{}", headers: { "x-real-ip": "1.2.3.4" } })).status).toBe(503);
    }
  });
});

describe("API keys (AUTH-9)", () => {
  it("verifica <id>.<secret> en tiempo constante y rechaza formatos raros", () => {
    expect(verifyApiKey([KEY], `acme.${SECRET}`)).toBe(KEY);
    expect(verifyApiKey([KEY], `acme.${SECRET}x`)).toBeNull();
    expect(verifyApiKey([KEY], `otra.${SECRET}`)).toBeNull();
    expect(verifyApiKey([KEY], "acme")).toBeNull();
    expect(verifyApiKey([KEY], ".secreto")).toBeNull();
    expect(verifyApiKey([KEY], "acme.")).toBeNull();
    // Un hash guardado mal formado nunca coincide.
    expect(verifyApiKey([{ ...KEY, secretSha256: "zz" }], `acme.${SECRET}`)).toBeNull();
  });

  it("una key válida usa su cupo (rpm) y no el de la IP", async () => {
    const { get, build } = setup([{ ...KEY, rpm: 3 }]);
    const h = { "x-api-key": `acme.${SECRET}` };
    expect((await get("/health", h)).status).toBe(200);
    expect((await build(h)).status).toBe(404);
    expect((await get("/health", h)).status).toBe(200);
    expect([(await get("/health", h)).status, await code(await get("/health", h))]).toEqual([429, "TOO_MANY_REQUESTS"]);
    // La misma IP sin key sigue teniendo su cupo anónimo.
    expect((await get("/health")).status).toBe(200);
  });

  it("rechaza la key en la URL y las sesiones Bearer", async () => {
    const { get } = setup();
    const inQuery = await get(`/health?api_key=acme.${SECRET}`);
    expect([inQuery.status, await code(inQuery)]).toEqual([401, "AUTH_INVALID_API_KEY"]);
    const bearer = await get("/health", { authorization: "Bearer abc" });
    expect([bearer.status, await code(bearer)]).toEqual([401, "AUTH_SESSION_NOT_CONFIGURED"]);
  });

  it("una key incorrecta da 401 y, tras 10 fallos por IP y minuto, 429", async () => {
    const { get } = setup();
    for (let i = 0; i < MAX_AUTH_FAILURES_PER_MINUTE; i++) {
      const res = await get("/health", { "x-api-key": "acme.mal" });
      expect([res.status, await code(res)]).toEqual([401, "AUTH_INVALID_API_KEY"]);
    }
    const blocked = await get("/health", { "x-api-key": "acme.mal" });
    expect([blocked.status, await code(blocked)]).toEqual([429, "TOO_MANY_REQUESTS"]);
    // Tampoco pasa la key buena desde esa IP mientras dure el bloqueo.
    expect((await get("/health", { "x-api-key": `acme.${SECRET}` })).status).toBe(429);
    // Otra IP no está afectada.
    expect((await get("/health", { "x-api-key": `acme.${SECRET}`, "x-real-ip": "9.9.9.9" })).status).toBe(200);
  });

  it("los scopes limitan lo que puede hacer la key", async () => {
    const { get, build, app } = setup([{ ...KEY, scopes: ["read"] }]);
    const h = { "x-api-key": `acme.${SECRET}` };
    expect((await get("/health", h)).status).toBe(200);
    const res = await build(h);
    expect([res.status, await code(res)]).toEqual([403, "AUTH_INSUFFICIENT_SCOPE"]);
    const submit = await app.request("/api/stellar/send-transaction", { method: "POST", headers: { "content-type": "application/json", ...h }, body: "{}" });
    expect(submit.status).toBe(403);
  });

  it("no filtra el secreto en los logs", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { get } = setup();
    await get("/health", { "x-api-key": `acme.${SECRET}` });
    await get("/health", { "x-api-key": "acme.secreto-equivocado" });
    expect(warn.mock.calls.flat().join(" ")).not.toContain("secreto-equivocado");
    warn.mockRestore();
  });
});

describe("TtlCache", () => {
  it("no pasa de 1000 entradas: borra las caducadas y después la más antigua", async () => {
    let t = 0;
    const cache = new TtlCache(() => t);
    for (let i = 0; i < 1001; i++) await cache.get(`k${i}`, 60_000, async () => i);
    expect(cache.size).toBeLessThanOrEqual(1000);
    // La más antigua (k0) se ha ido; la última sigue.
    const loads = { k0: 0, k1000: 0 };
    await cache.get("k0", 60_000, async () => (loads.k0 += 1));
    await cache.get("k1000", 60_000, async () => (loads.k1000 += 1));
    expect(loads).toEqual({ k0: 1, k1000: 0 });
    // Con todo caducado, insertar limpia la caché entera en vez de tirar solo una.
    t = 120_000;
    await cache.get("nueva", 60_000, async () => 1);
    expect(cache.size).toBe(1);
  });
});
