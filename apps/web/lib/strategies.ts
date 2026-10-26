import type { Strategy } from "./types";

// Fixture copy of factory.strategies() (docs/INTERFACES.md §6). The real list comes from the chain.
const base = { asset: "FIXTURE_USDC", asset_name: "USDC:FIXTURE_ISSUER", enabled: true };

export const STRATEGIES: Strategy[] = [
  { ...base, id: "usdc_fixed", kind: "DeFindexVault", vault: "FIXTURE_VAULT", defindex_strategy: "FIXTURE_BLEND_STRATEGY", apy_pool: "FIXTURE_POOL", risk: "Standard", simulated: false },
  { ...base, id: "usdc_mock", kind: "DeFindexVault", vault: "FIXTURE_MOCK_VAULT", defindex_strategy: null, apy_pool: null, risk: "Standard", simulated: true },
  { ...base, id: "custody", kind: "NoYield", vault: null, defindex_strategy: null, apy_pool: null, risk: "NoYield", simulated: false },
  // Roadmap only: there is no High strategy on testnet. The UI shows it disabled (architecture §7).
  { ...base, id: "usdc_etherfuse", kind: "DeFindexVault", vault: null, defindex_strategy: null, apy_pool: null, risk: "High", simulated: false, enabled: false },
];

export const DEFAULT_STRATEGY_ID = "usdc_fixed";

// Display names, APY text and risks live in the dictionaries: t.strategies[id] and t.risk[tier].

export function strategyById(id: string): Strategy {
  return STRATEGIES.find((s) => s.id === id) ?? STRATEGIES[0];
}
