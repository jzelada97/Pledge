"use client";

import { useState } from "react";
import { RISK_LABEL, STRATEGIES, STRATEGY_COPY } from "@/lib/strategies";
import { Tag } from "./wire";

export function StrategyPicker(props: { value: string; onChange: (id: string) => void }) {
  const [highRiskAck, setHighRiskAck] = useState(false);
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {STRATEGIES.map((s) => {
        const copy = STRATEGY_COPY[s.id];
        const selectable = s.enabled && (s.risk !== "High" || highRiskAck);
        return (
          <label
            key={s.id}
            className={`flex flex-col gap-1 rounded border-2 p-3 text-sm ${
              props.value === s.id ? "border-neutral-800" : "border-neutral-300"
            } ${s.enabled ? "" : "opacity-60"}`}
          >
            <span className="flex items-center gap-2">
              <input
                type="radio"
                name="strategy"
                disabled={!selectable}
                checked={props.value === s.id}
                onChange={() => props.onChange(s.id)}
              />
              <span className="font-medium">{copy.name}</span>
            </span>
            <span className="flex flex-wrap gap-1">
              <Tag>{RISK_LABEL[s.risk]}</Tag>
              {s.simulated && <Tag>Simulated yield</Tag>}
              {s.id === "usdc_fixed" && <Tag>Default</Tag>}
              {!s.enabled && <Tag>Not available on testnet</Tag>}
            </span>
            <span>{copy.apy}</span>
            <span className="text-neutral-600">{copy.risks}</span>
            {s.risk === "High" && (
              <span className="flex items-start gap-1 text-xs">
                <input type="checkbox" checked={highRiskAck} onChange={(e) => setHighRiskAck(e.target.checked)} />
                I understand this option has more risk and almost no yield today.
              </span>
            )}
          </label>
        );
      })}
    </div>
  );
}
