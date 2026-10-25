import { StrKey } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { FakeWallet } from "./fake";

describe("FakeWallet", () => {
  it("crea una C-address válida, firma y simula errores", async () => {
    const w = new FakeWallet(0);
    await expect(w.signAndSend({})).rejects.toMatchObject({ code: "NOT_CONNECTED" });
    const { address } = await w.createAccount("Ana");
    expect(StrKey.isValidContract(address)).toBe(true);
    expect(await w.connect()).toEqual({ address });
    const phases: string[] = [];
    const { hash } = await w.signAndSend({}, { onPhase: (p) => phases.push(p) });
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(phases).toEqual(["verifying", "signing", "submitting"]);
    w.failNext("USER_CANCELLED");
    await expect(w.signAndSend({})).rejects.toMatchObject({ code: "USER_CANCELLED" });
    await w.disconnect();
    expect(await w.connect()).toBeNull();
  });
});
