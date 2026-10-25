import { percent } from "./format";

// Who gets the net yield is a jurisdiction setting (GlobalConfig.tenant_yield_bps, issue #16), never a
// per-deposit choice. The UI only reads it from Terms and says where the yield goes; it never states the law.
export const YIELD_POLICY_NOTE =
  "Who gets the yield depends on local rules. For now Fianzas runs in Portugal, and the yield goes to the landlord.";

export function yieldGoesTo(tenantYieldBps: number, viewer: "landlord" | "tenant"): string {
  if (tenantYieldBps === 0) return viewer === "landlord" ? "You" : "Your landlord";
  if (tenantYieldBps === 10000) return viewer === "tenant" ? "You" : "Your tenant";
  return `Tenant ${percent(tenantYieldBps)} · landlord ${percent(10000 - tenantYieldBps)}`;
}
