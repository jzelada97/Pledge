import { describe, expect, it, vi } from "vitest";

import { createTrustlessClient, TrustlessApiError, TW_YIELD_URL } from "./client";
import { escrowFixture, ESCROW_ID, LANDLORD } from "./test-utils";

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

const unsigned = { unsignedTransaction: "AAAA" };

describe("createTrustlessClient", () => {
  it("envía la API key y el cuerpo a la API con rendimiento", async () => {
    const fetch = mockFetch(201, unsigned);
    const tw = createTrustlessClient({ apiKey: "id.secret", fetch });

    const res = await tw.fund({ contractId: ESCROW_ID, signer: LANDLORD, amount: 500 });

    expect(res).toEqual(unsigned);
    const { url, init } = firstCall(fetch);
    expect(url).toBe(`${TW_YIELD_URL}/escrow/single-release/fund-escrow`);
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ "x-api-key": "id.secret" });
    expect(JSON.parse(init.body as string)).toEqual({ contractId: ESCROW_ID, signer: LANDLORD, amount: 500 });
  });

  it.each([
    ["deploy", "/deployer/single-release"],
    ["approveMilestone", "/escrow/single-release/approve-milestone"],
    ["releaseFunds", "/escrow/single-release/release-funds"],
    ["dispute", "/escrow/single-release/dispute-escrow"],
    ["resolveDispute", "/escrow/single-release/resolve-dispute"],
    ["withdrawRemainingFunds", "/escrow/single-release/withdraw-remaining-funds"],
  ] as const)("%s usa %s", async (method, path) => {
    const fetch = mockFetch(201, unsigned);
    const tw = createTrustlessClient({ apiKey: "k", baseUrl: "https://tw.test/", fetch });

    await (tw[method] as (b: unknown) => Promise<unknown>)({});

    expect(firstCall(fetch).url).toBe(`https://tw.test${path}`);
  });

  it("las lecturas mandan los arrays como clave[]=valor, también con un solo valor", async () => {
    const escrow = escrowFixture();
    let fetch = mockFetch(200, [escrow]);
    expect(await createTrustlessClient({ apiKey: "k", fetch }).getEscrows([ESCROW_ID])).toEqual([escrow]);
    expect(firstCall(fetch).url).toBe(
      `${TW_YIELD_URL}/helper/get-escrow-by-contract-ids?contractIds[]=${ESCROW_ID}&validateOnChain=true`,
    );

    fetch = mockFetch(200, [{ address: ESCROW_ID, balance: 1 }]);
    await createTrustlessClient({ apiKey: "k", fetch }).getBalances([ESCROW_ID]);
    expect(firstCall(fetch).url).toBe(`${TW_YIELD_URL}/helper/get-multiple-escrow-balance?addresses[]=${ESCROW_ID}`);

    fetch = mockFetch(200, { vault: "C", shares: 1, underlying: 1 });
    await createTrustlessClient({ apiKey: "k", fetch }).vaultPosition(ESCROW_ID);
    expect(firstCall(fetch).url).toBe(`${TW_YIELD_URL}/escrow/single-release/vault-position?contractId=${ESCROW_ID}`);
  });

  it("lista fianzas por rol y por firmante: por defecto single-release y validadas en cadena", async () => {
    const escrow = escrowFixture();
    let fetch = mockFetch(200, [escrow]);
    let tw = createTrustlessClient({ apiKey: "k", fetch });
    expect(await tw.getEscrowsByRole("approver", LANDLORD)).toEqual([escrow]);
    expect(firstCall(fetch).url).toBe(
      `${TW_YIELD_URL}/helper/get-escrows-by-role?role=approver&roleAddress=${LANDLORD}&type=single-release&validateOnChain=true`,
    );
    expect(firstCall(fetch).init.headers).toMatchObject({ "x-api-key": "k" });

    // Los filtros sustituyen a los de por defecto y se añaden los que falten.
    fetch = mockFetch(200, []);
    tw = createTrustlessClient({ apiKey: "k", fetch });
    await tw.getEscrowsBySigner(LANDLORD, { validateOnChain: false, orderBy: "createdAt", orderDirection: "desc", page: 2, pageSize: 20 });
    expect(firstCall(fetch).url).toBe(
      `${TW_YIELD_URL}/helper/get-escrows-by-signer?signer=${LANDLORD}&type=single-release&validateOnChain=false` +
        "&orderBy=createdAt&orderDirection=desc&page=2&pageSize=20",
    );
  });

  it("las listas sin resultados (cuerpo vacío) dan [] y los errores, TrustlessApiError", async () => {
    expect(await createTrustlessClient({ apiKey: "k", fetch: mockFetch(200, undefined) }).getEscrowsByRole("receiver", LANDLORD)).toEqual([]);
    const err = await createTrustlessClient({ apiKey: "k", fetch: mockFetch(400, { statusCode: 400, message: "role inválido" }) })
      .getEscrowsByRole("receiver", LANDLORD)
      .catch((e) => e);
    expect(err).toBeInstanceOf(TrustlessApiError);
    expect(err).toMatchObject({ status: 400, message: "role inválido" });
  });

  it("avisa al indexador de TW de una transacción enviada por otra vía", async () => {
    const hash = "ab".repeat(32);
    const fetch = mockFetch(200, { ok: true });
    const tw = createTrustlessClient({ apiKey: "k", fetch });
    await tw.indexTransaction(hash);
    const { url, init } = firstCall(fetch);
    expect(url).toBe(`${TW_YIELD_URL}/indexer/update-from-txhash`);
    expect(init.method).toBe("PUT");
    expect(JSON.parse(String(init.body))).toEqual({ txHash: hash });
    // Un hash mal formado no llega a la API.
    await expect(tw.indexTransaction("no-es-un-hash")).rejects.toThrow(RangeError);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("con listas vacías no llama a la API", async () => {
    const fetch = mockFetch(200, []);
    const tw = createTrustlessClient({ apiKey: "k", fetch });
    expect(await tw.getEscrows([])).toEqual([]);
    expect(await tw.getBalances([])).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("envía transacciones firmadas a /helper/send-transaction", async () => {
    const fetch = mockFetch(201, { message: "ok", contractId: ESCROW_ID });
    const tw = createTrustlessClient({ apiKey: "k", fetch });
    expect(await tw.sendTransaction("SIGNED")).toEqual({ message: "ok", contractId: ESCROW_ID });
    const { url, init } = firstCall(fetch);
    expect(url).toBe(`${TW_YIELD_URL}/helper/send-transaction`);
    expect(JSON.parse(init.body as string)).toEqual({ signedXdr: "SIGNED" });
  });

  it("convierte los errores de la API en TrustlessApiError", async () => {
    const body = { statusCode: 400, message: "The escrow must be completed to release earnings", path: "/x" };
    const tw = createTrustlessClient({ apiKey: "k", fetch: mockFetch(400, body) });

    const err = await tw.releaseFunds({ contractId: ESCROW_ID, releaseSigner: LANDLORD }).catch((e) => e);

    expect(err).toBeInstanceOf(TrustlessApiError);
    expect(err).toMatchObject({ status: 400, body });
    expect(err.message).toBe("The escrow must be completed to release earnings");
  });

  it("une los mensajes de validación y tolera errores sin JSON", async () => {
    const tw = createTrustlessClient({ apiKey: "k", fetch: mockFetch(400, { statusCode: 400, message: ["a", "b"] }) });
    expect((await tw.dispute({ contractId: ESCROW_ID, signer: LANDLORD }).catch((e) => e)).message).toBe("a; b");

    const tw2 = createTrustlessClient({ apiKey: "k", fetch: vi.fn(async () => new Response("Bad Gateway", { status: 502 })) });
    expect(await tw2.getEscrows([ESCROW_ID]).catch((e) => e)).toMatchObject({ status: 502, body: undefined });
  });

  it("exige API key", () => {
    expect(() => createTrustlessClient({ apiKey: "" })).toThrow();
  });
});
