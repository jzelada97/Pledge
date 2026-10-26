import type { Formatters } from "./format";
import type { Messages } from "./i18n/messages";

// Who gets the net yield is a jurisdiction setting (GlobalConfig.tenant_yield_bps, issue #16), never a
// per-deposit choice. The UI only reads it from Terms and says where the yield goes; it never states the law.
export function yieldGoesTo(t: Messages, f: Formatters, tenantYieldBps: number, viewer: "landlord" | "tenant"): string {
  const y = t.yieldPolicy;
  if (tenantYieldBps === 0) return viewer === "landlord" ? y.you : y.yourLandlord;
  if (tenantYieldBps === 10000) return viewer === "tenant" ? y.you : y.yourTenant;
  return y.shared(f.percent(tenantYieldBps), f.percent(10000 - tenantYieldBps));
}
