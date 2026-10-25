import { Networks, StrKey } from "@stellar/stellar-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RampChain } from "./chain";
import { createSimRampHandler, type SimRampConfig } from "./sim-ramp";

const ACCOUNT_WASM = "11".repeat(32);
const ORIGIN = "https://fianzas.example";
const contract = () => StrKey.encodeContract(Buffer.from(crypto.getRandomValues(new Uint8Array(32))));
const ours = contract();

const transfer = vi.fn(async (_to: string, _s: bigint) => "ab".repeat(32));
const chain: RampChain = {
  wasmHashOf: async (c) => (c === ours ? ACCOUNT_WASM : null),
  transfer,
};

function config(over: Partial<SimRampConfig> = {}): SimRampConfig {
  return {
    networkPassphrase: Networks.TESTNET,
    rpcUrl: "http://unused",
    faucetSecret: "unused",
    token: contract(),
    accountWasmHashes: [ACCOUNT_WASM],
    enabled: true,
    allowedOrigins: [ORIGIN],
    maxAmount: "100",
    perAddressCap: "150",
    perIpPerHour: 5,
    globalHourlyCap: 50,
    chain,
    ...over,
  };
}

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("https://fianzas.example/api/ramp", {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN, "x-real-ip": "1.2.3.4", ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => transfer.mockClear());

describe("createSimRampHandler", () => {
  it("no se puede construir con la passphrase de mainnet", () => {
    expect(() => createSimRampHandler(config({ networkPassphrase: Networks.PUBLIC }))).toThrow();
  });

  it("envía a una cuenta nuestra con el importe exacto en stroops y expone solo sus ids", async () => {
    const { POST, GET } = createSimRampHandler(config());
    const res = await POST(post({ to: ours, amount: "12.5" }));
    expect(res.status).toBe(200);
    const { id } = (await res.json()) as { id: string };
    expect(transfer).toHaveBeenCalledWith(ours, 125_000_000n);
    expect(await (await GET(new Request(`https://x/api/ramp?id=${id}`))).json()).toEqual({ status: "completed" });
    expect((await GET(new Request("https://x/api/ramp?id=otro"))).status).toBe(404);
  });

  it("rechaza destinos G, contratos ajenos, importes no válidos y campos extra", async () => {
    const { POST } = createSimRampHandler(config());
    const cases: [unknown, number][] = [
      [{ to: "GAAH4OT36RRCCAGKARGPN2HLHT2NOBVFHO4GUHA6CF7UKQ4MMV24WQ4N", amount: "1" }, 400],
      [{ to: contract(), amount: "1" }, 403],
      [{ to: ours, amount: "1e3" }, 400],
      [{ to: ours, amount: "-1" }, 400],
      [{ to: ours, amount: "0.00000001" }, 400],
      [{ to: ours, amount: "101" }, 400],
      [{ to: ours, amount: "1", from: "faucet" }, 400],
    ];
    for (const [body, status] of cases) expect((await POST(post(body))).status, JSON.stringify(body)).toBe(status);
    expect(transfer).not.toHaveBeenCalled();
  });

  it("aplica el interruptor, el origen, el tope por dirección y el de IP", async () => {
    expect((await createSimRampHandler(config({ enabled: false })).POST(post({ to: ours, amount: "1" }))).status).toBe(403);
    const { POST } = createSimRampHandler(config());
    expect((await POST(post({ to: ours, amount: "1" }, { origin: "https://evil.example" }))).status).toBe(403);
    expect((await POST(post({ to: ours, amount: "100" }))).status).toBe(200);
    expect((await POST(post({ to: ours, amount: "60" }))).status).toBe(429); // 160 > 150
    expect((await POST(post({ to: ours, amount: "50" }))).status).toBe(200);
    for (let i = 0; i < 2; i++) await POST(post({ to: ours, amount: "0.0000001" }));
    expect((await POST(post({ to: ours, amount: "0.0000001" }))).status).toBe(429); // 6.ª petición de la IP
  });

  it("si la transferencia falla, devuelve RAMP_DOWN y no consume el tope", async () => {
    const { POST } = createSimRampHandler(config());
    transfer.mockRejectedValueOnce(new Error("boom"));
    const res = await POST(post({ to: ours, amount: "100" }));
    expect([res.status, await res.json()]).toEqual([502, { code: "RAMP_DOWN" }]);
    expect((await POST(post({ to: ours, amount: "100" }))).status).toBe(200);
  });
});
