import { describe, expect, it, vi } from "vitest";

import { createTrustlessClient, TrustlessApiError, TW_BETA_URL } from "./client";
import { escrowFixture, ESCROW_ID, TENANT } from "./test-utils";

function mockFetch(status: number, body: unknown) {
  return vi.fn<typeof fetch>(
    async () => new Response(body === undefined ? "" : JSON.stringify(body), { status }),
  );
}

/** URL y opciones de la primera llamada a `fetch`. */
function firstCall(fetch: ReturnType<typeof mockFetch>) {
  const [url, init] = fetch.mock.calls[0];
  return { url: String(url), init: init ?? {} };
}

const unsigned = { unsignedXdr: "AAAA", txHash: "ab12" };

describe("createTrustlessClient", () => {
  it("envía la API key y el cuerpo a la ruta v2", async () => {
    const fetch = mockFetch(200, unsigned);
    const tw = createTrustlessClient({ apiKey: "id.secret", fetch });

    const res = await tw.fund({ contractId: ESCROW_ID, signer: TENANT, amount: 500 });

    expect(res).toEqual(unsigned);
    const { url, init } = firstCall(fetch);
    expect(url).toBe(`${TW_BETA_URL}/escrow/single-release/v2/fund`);
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ "x-api-key": "id.secret" });
    expect(JSON.parse(init.body as string)).toEqual({
      contractId: ESCROW_ID,
      signer: TENANT,
      amount: 500,
    });
  });

  it.each([
    ["deploy", "/escrow/single-release/v2/deploy"],
    ["approveMilestones", "/escrow/single-release/v2/approve-milestones"],
    ["approveAndReleaseMilestones", "/escrow/single-release/v2/approve-and-release-milestones"],
    ["releaseFunds", "/escrow/single-release/v2/release-funds"],
    ["dispute", "/escrow/single-release/v2/dispute"],
    ["resolveDispute", "/escrow/single-release/v2/resolve-dispute"],
  ] as const)("%s usa %s", async (method, path) => {
    const fetch = mockFetch(200, unsigned);
    const tw = createTrustlessClient({ apiKey: "k", baseUrl: "https://tw.test/", fetch });

    await (tw[method] as (b: unknown) => Promise<unknown>)({});

    expect(firstCall(fetch).url).toBe(`https://tw.test${path}`);
  });

  it("lee un escrow y envía transacciones firmadas", async () => {
    const escrow = escrowFixture();
    const tw = createTrustlessClient({ apiKey: "k", fetch: mockFetch(200, escrow) });
    expect(await tw.getEscrow(ESCROW_ID)).toEqual(escrow);

    const fetch = mockFetch(200, { txHash: "ff", ledger: 42 });
    const tw2 = createTrustlessClient({ apiKey: "k", fetch });
    expect(await tw2.sendTransaction("SIGNED")).toEqual({ txHash: "ff", ledger: 42 });
    const { url, init } = firstCall(fetch);
    expect(url).toBe(`${TW_BETA_URL}/stellar/send-transaction`);
    expect(JSON.parse(init.body as string)).toEqual({ signedXdr: "SIGNED" });
  });

  it("convierte los Problem Details en TrustlessApiError", async () => {
    const problem = { status: 422, code: "ESCROW_NOT_COMPLETED", detail: "Faltan aprobaciones", traceId: "t1" };
    const tw = createTrustlessClient({ apiKey: "k", fetch: mockFetch(422, problem) });

    const err = await tw.releaseFunds({ contractId: ESCROW_ID, releaseSigner: TENANT }).catch((e) => e);

    expect(err).toBeInstanceOf(TrustlessApiError);
    expect(err).toMatchObject({ status: 422, code: "ESCROW_NOT_COMPLETED", traceId: "t1" });
    expect(err.message).toBe("Faltan aprobaciones");
  });

  it("tolera errores sin cuerpo JSON", async () => {
    const fetch = vi.fn(async () => new Response("Bad Gateway", { status: 502 }));
    const tw = createTrustlessClient({ apiKey: "k", fetch });

    const err = await tw.getEscrow(ESCROW_ID).catch((e) => e);
    expect(err).toMatchObject({ status: 502, code: undefined });
  });

  it("exige API key", () => {
    expect(() => createTrustlessClient({ apiKey: "" })).toThrow();
  });
});
