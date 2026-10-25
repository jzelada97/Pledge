import type { RiskTier, Strategy } from "./types";

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

// Front-only display copy. APY is read live from apy_pool; these numbers are placeholders.
export const STRATEGY_COPY: Record<string, { name: string; apy: string; risks: string }> = {
  usdc_fixed: {
    name: "Blend Fixed Pool",
    apy: "~6.5 %, variable, not guaranteed",
    risks: "Risks: protocol, oracle, liquidity and smart contract.",
  },
  usdc_mock: {
    name: "Demo pool",
    apy: "~6.5 %, simulated",
    risks: "Simulated yield for the demo. Not a real return.",
  },
  custody: {
    name: "Custody only",
    apy: "No yield",
    risks: "Risks: smart contract, USDC issuer and operational.",
  },
  usdc_etherfuse: {
    name: "Real-world assets (RWA)",
    apy: "~0.05 % today, variable",
    risks: "Higher risk and almost no yield today: illiquid RWA collateral and a small pool.",
  },
};

export const RISK_LABEL: Record<RiskTier, string> = {
  NoYield: "No yield",
  Standard: "Standard risk",
  High: "High risk",
};

export function strategyById(id: string): Strategy {
  return STRATEGIES.find((s) => s.id === id) ?? STRATEGIES[0];
}
