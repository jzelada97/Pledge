import { describe, expect, it, vi } from "vitest";
import { FakeAnchor } from "./fake";
import { createSimulatedAnchor } from "./simulated";

describe("createSimulatedAnchor", () => {
  it("llama a /api/ramp y traduce los errores", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => Response.json({ id: "h1", status: "completed" }));
    const anchor = createSimulatedAnchor({ rampUrl: "/api/ramp", fetch: fetchMock as unknown as typeof fetch });
    expect(anchor.isSimulated).toBe(true);
    expect(await anchor.startDeposit("CABC", "USDC", "10")).toEqual({ url: "", id: "h1" });
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string)).toEqual({ to: "CABC", amount: "10" });
    expect(await anchor.status("h1")).toBe("completed");
    await expect(anchor.startDeposit("CABC", "USDC", "1e3")).rejects.toMatchObject({ code: "INVALID_AMOUNT" });
    await expect(anchor.startWithdraw("CABC", "USDC", "1")).rejects.toMatchObject({ code: "NOT_SUPPORTED" });
    fetchMock.mockImplementationOnce(async () => Response.json({ code: "RATE_LIMITED" }, { status: 429 }));
    await expect(anchor.startDeposit("CABC", "USDC", "1")).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });
});

describe("FakeAnchor", () => {
  it("completa el depósito tras el retraso", async () => {
    const a = new FakeAnchor(0);
    const { id } = await a.startDeposit("CABC", "USDC", "5");
    expect(await a.status(id)).toBe("completed");
    expect(await a.status("nope")).toBe("error");
  });
});
