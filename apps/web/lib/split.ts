import type { Settlement } from "./types";

// Same formula as the contract's split() (docs/INTERFACES.md §4). Used for previews only:
// the real numbers always come from the chain (preview_settlement / Settlement).
export function split(amount: bigint, total: bigint, deduction: bigint, platformBps: number, tenantBps: number): Settlement {
  const principalBack = total < amount ? total : amount;
  const cut = deduction < principalBack ? deduction : principalBack;
  const yieldTotal = total > amount ? total - amount : 0n;
  const fee = (yieldTotal * BigInt(platformBps)) / 10000n;
  const net = yieldTotal - fee;
  const landlordYield = (net * BigInt(10000 - tenantBps)) / 10000n;
  const tenantYield = net - landlordYield;
  return {
    total,
    yield_total: yieldTotal,
    deduction: cut,
    to_tenant: principalBack - cut + tenantYield,
    to_landlord: cut + landlordYield,
    to_treasury: fee,
  };
}

// Splits a Settlement back into deposit and yield parts, so the UI can always show them apart.
export function breakdown(s: Settlement, amount: bigint) {
  const principalBack = s.total < amount ? s.total : amount;
  return {
    depositToTenant: principalBack - s.deduction,
    deduction: s.deduction,
    tenantYield: s.to_tenant - (principalBack - s.deduction),
    landlordYield: s.to_landlord - s.deduction,
    platformFee: s.to_treasury,
  };
}

// Mirrors factory/src/bond.rs: min(max(min, floor(amount × bps / 10000)), amount).
export function computeStopBond(amount: bigint, min: bigint, bps: number): bigint {
  const byBps = (amount * BigInt(bps)) / 10000n;
  const bond = byBps > min ? byBps : min;
  return bond < amount ? bond : amount;
}
