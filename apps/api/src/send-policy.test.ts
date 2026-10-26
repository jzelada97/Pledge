import { describe, expect, it, vi } from "vitest";
import { Account, Address, Asset, BASE_FEE, Contract, Keypair, Operation, StrKey, TransactionBuilder, type Transaction } from "@stellar/stellar-sdk";
import { TW_ESCROW_WASM_TESTNET } from "@fianzas/trustless";
import { createApp } from "./app";
import { simulationProblem, type Chain } from "./chain";
import { deployments, loadConfigFromEnv } from "./config";
import { Problem } from "./problem";

const NET = deployments.networkPassphrase;
const FACTORY = deployments.factory!;
const ESCROW = StrKey.encodeContract(Buffer.alloc(32, 7)); // registrado en la factory
const TW_ESCROW = StrKey.encodeContract(Buffer.alloc(32, 8)); // escrow de TW nuestro (platform = tesorería)
const TW_FOREIGN = StrKey.encodeContract(Buffer.alloc(32, 6)); // escrow de TW de otra plataforma
const OTHER = StrKey.encodeContract(Buffer.alloc(32, 9));
const signer = Keypair.random();

function signed(build: (b: TransactionBuilder) => TransactionBuilder): Transaction {
  const tx = build(new TransactionBuilder(new Account(signer.publicKey(), "7"), { fee: BASE_FEE, networkPassphrase: NET })).setTimeout(30).build();
  tx.sign(signer);
  return tx;
}
const invoke = (contractId: string) => signed((b) => b.addOperation(new Contract(contractId).call("approve_release", new Address(signer.publicKey()).toScVal())));
const payment = () => signed((b) => b.addOperation(Operation.payment({ destination: Keypair.random().publicKey(), asset: Asset.native(), amount: "1" })));
const twoOps = () =>
  signed((b) =>
    b
      .addOperation(new Contract(ESCROW).call("approve_release", new Address(signer.publicKey()).toScVal()))
      .addOperation(new Contract(ESCROW).call("extend_contract_ttl")),
  );
function feeBump(): string {
  const bump = TransactionBuilder.buildFeeBumpTransaction(signer, "1000", invoke(ESCROW), NET);
  bump.sign(signer);
  return bump.toXDR();
}

interface Faults {
  wasmFailures?: number; // cuántas veces falla wasmHashOf antes de responder
  idOfNetworkError?: boolean; // id_of falla por red, no porque no esté registrado
  platformOf?: Record<string, string>; // roles.platform de cada escrow de TW
}

function setup(dep = deployments, faults: Faults = {}) {
  const sent: string[] = [];
  let wasmFailures = faults.wasmFailures ?? 0;
  const chain: Chain = {
    async read(contractId, fn, args = []) {
      if (fn === "id_of") {
        if (faults.idOfNetworkError) throw new Error("ECONNRESET");
        const { scValToNative } = await import("@stellar/stellar-sdk");
        if (scValToNative(args[0]) === ESCROW) return 1n as never;
        throw new Problem(502, "STELLAR_SIMULATION_FAILED", "La simulación falló", "Error(Contract, #1)", { contractError: 1 });
      }
      if (fn === "get_escrow") return { roles: { platform: faults.platformOf?.[contractId] ?? deployments.treasury } } as never;
      throw new Error(`lectura inesperada ${fn}`);
    },
    async readRaw() {
      throw new Error("inesperado");
    },
    async build() {
      throw new Error("inesperado");
    },
    async send(xdr) {
      sent.push(xdr);
      return { txHash: "ab".repeat(32), ledger: 1, status: "SUCCESS" };
    },
    async latestLedger() {
      return 1000;
    },
    async wasmHashOf(contractId) {
      if (wasmFailures > 0) {
        wasmFailures -= 1;
        throw new Error("RPC caído");
      }
      return contractId === TW_ESCROW || contractId === TW_FOREIGN ? TW_ESCROW_WASM_TESTNET : null;
    },
  };
  const app = createApp(loadConfigFromEnv({}, dep), { chain, now: () => 0 });
  const send = (signedXdr: string) =>
    app.request("/api/stellar/send-transaction", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ signedXdr }) });
  return { app, send, sent };
}
const json = (r: Response) => r.json() as Promise<Record<string, any>>;

describe("POST /stellar/send-transaction solo reenvía transacciones de la plataforma (API-11)", () => {
  it("acepta una llamada a una fianza registrada en la factory, a la factory y a un escrow de TW", async () => {
    const { send, sent } = setup();
    for (const target of [ESCROW, FACTORY, TW_ESCROW]) {
      const res = await send(invoke(target).toXDR());
      expect(res.status).toBe(200);
      const b = await json(res);
      expect(b.code).toBe("STELLAR_TX_SUBMITTED");
      expect(b.contractId).toBe(target);
    }
    expect(sent).toHaveLength(3);
  });

  it("rechaza pagos clásicos, contratos ajenos, fee bumps y varias operaciones con 403 FZ_TX_NOT_ALLOWED", async () => {
    const { send, sent } = setup();
    for (const xdr of [payment().toXDR(), invoke(OTHER).toXDR(), feeBump(), twoOps().toXDR()]) {
      const res = await send(xdr);
      expect([res.status, (await json(res)).code]).toEqual([403, "FZ_TX_NOT_ALLOWED"]);
    }
    expect(sent).toHaveLength(0);
  });

  it("un fallo del RPC responde 503 y no se cachea como 'no permitido' (#91)", async () => {
    const { send, sent } = setup(deployments, { wasmFailures: 1 });
    const first = await send(invoke(TW_ESCROW).toXDR());
    const body = await json(first);
    expect([first.status, body.code]).toEqual([503, "FZ_RPC_UNAVAILABLE"]);
    expect(JSON.stringify(body)).not.toContain("RPC caído"); // el detalle interno va al log
    const second = await send(invoke(TW_ESCROW).toXDR());
    expect(second.status).toBe(200);
    expect(sent).toHaveLength(1);
  });

  it("un error de red al consultar la factory es 503, no 403 (#91)", async () => {
    const { send } = setup(deployments, { idOfNetworkError: true });
    const res = await send(invoke(ESCROW).toXDR());
    expect([res.status, (await json(res)).code]).toEqual([503, "FZ_RPC_UNAVAILABLE"]);
  });

  it("solo pasan los escrows de TW de esta plataforma: platform = tesorería (#91)", async () => {
    const { send, sent } = setup(deployments, { platformOf: { [TW_FOREIGN]: Keypair.random().publicKey() } });
    const foreign = await send(invoke(TW_FOREIGN).toXDR());
    expect([foreign.status, (await json(foreign)).code]).toEqual([403, "FZ_TX_NOT_ALLOWED"]);
    expect((await send(invoke(TW_ESCROW).toXDR())).status).toBe(200);
    expect(sent).toHaveLength(1);
    // Un 403 tampoco se recuerda: si el escrow pasa a ser nuestro (otra lectura), entra.
    const { send: send2 } = setup(deployments, { platformOf: { [TW_FOREIGN]: deployments.treasury } });
    expect((await send2(invoke(TW_FOREIGN).toXDR())).status).toBe(200);
  });

  it("sin factory desplegada (plan A), solo pasan los escrows de TW", async () => {
    const { send, sent } = setup({ ...deployments, factory: null });
    expect((await send(invoke(TW_ESCROW).toXDR())).status).toBe(200);
    expect((await send(invoke(ESCROW).toXDR())).status).toBe(403);
    expect(sent).toHaveLength(1);
  });

  it("la decisión por contrato se cachea: la segunda vez no vuelve a la RPC", async () => {
    const { app, send } = setup();
    void app;
    expect((await send(invoke(TW_ESCROW).toXDR())).status).toBe(200);
    expect((await send(invoke(TW_ESCROW).toXDR())).status).toBe(200);
  });
});

describe("x-trace-id y errores sin detalles internos (API-12)", () => {
  it("solo acepta un trace-id inofensivo; si no, genera uno", async () => {
    const { app } = setup();
    const ok = await app.request("/api/health", { headers: { "x-trace-id": "abc-123_XYZ" } });
    expect(ok.headers.get("x-trace-id")).toBe("abc-123_XYZ");
    const bad = await app.request("/api/health", { headers: { "x-trace-id": "<script>alert(1)</script>" } });
    expect(bad.headers.get("x-trace-id")).toMatch(/^[0-9a-f-]{36}$/);
    const long = await app.request("/api/health", { headers: { "x-trace-id": "a".repeat(65) } });
    expect(long.headers.get("x-trace-id")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("los errores de simulación no devuelven la respuesta cruda de la RPC, pero sí el número del contrato", () => {
    const raw = 'HostError: Error(Contract, #21)\n\nEvent log (newest first):\n   0: [Diagnostic Event] contract:CC3Q…, topics:[error, Error(Contract, #21)], data:["escalating error to VM trap"]\n   1: ... http://rpc-interno:8000';
    const p = simulationProblem(raw, FACTORY, "create_fianza");
    expect(p.status).toBe(502);
    expect(p.extensions).toEqual({ contractId: FACTORY, fn: "create_fianza", contractError: 21 });
    expect(p.detail).not.toContain("Diagnostic");
    expect(p.detail).not.toContain("http://");
    expect(p.detail).toContain("#21");
    expect(p.internal).toBe(raw);
    const generic = simulationProblem("some host failure", FACTORY, "config");
    expect(generic.extensions).toEqual({ contractId: FACTORY, fn: "config" });
    expect(generic.detail).toBe("La simulación de config falló");
  });

  it("el detalle interno va al log con el traceId y no al cliente", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const app = createApp(loadConfigFromEnv({}, deployments), { chain: fakeThrowing(), now: () => 0 });
    const res = await app.request("/api/fianzas/v1/fianzas/by-id/1", { headers: { "x-trace-id": "traza-1" } });
    expect(res.status).toBe(502);
    expect(JSON.stringify(await json(res))).not.toContain("rpc-interno");
    const logged = error.mock.calls.flat().join(" ");
    expect(logged).toContain("traza-1");
    expect(logged).toContain("rpc-interno");
    error.mockRestore();
  });
});

function fakeThrowing(): Chain {
  return {
    async read(_c, fn) {
      throw simulationProblem("HostError: boom at http://rpc-interno:8000", FACTORY, fn);
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
}
