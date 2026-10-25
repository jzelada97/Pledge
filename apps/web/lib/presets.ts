// Yield policy presets (docs/INTERFACES.md §10). They do not claim what the law says in any country.
export const PRESETS = [
  { id: "tenant", label: "All to the tenant", bps: 10000 },
  { id: "half", label: "50 / 50", bps: 5000 },
  { id: "landlord", label: "All to the landlord", bps: 0 },
  { id: "custom", label: "Custom", bps: null },
] as const;

export const PRESET_DISCLAIMER =
  "Presets are a starting point. They don't say what the law requires in your country: check your local rules.";
