"use client";

import { PRESETS, PRESET_DISCLAIMER } from "@/lib/presets";
import { percent } from "@/lib/format";
import { Note } from "./wire";

export function PolicyPicker(props: { bps: number; onChange: (bps: number) => void }) {
  const preset = PRESETS.find((p) => p.bps === props.bps)?.id ?? "custom";
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <label key={p.id} className="flex items-center gap-1 rounded border border-neutral-400 px-2 py-1 text-sm">
            <input
              type="radio"
              name="policy"
              checked={preset === p.id}
              onChange={() => props.onChange(p.bps ?? props.bps)}
            />
            {p.label}
          </label>
        ))}
      </div>
      {preset === "custom" && (
        <label className="flex items-center gap-2 text-sm">
          Tenant gets
          <input
            type="range"
            min={0}
            max={10000}
            step={500}
            value={props.bps}
            onChange={(e) => props.onChange(Number(e.target.value))}
          />
          {percent(props.bps)}
        </label>
      )}
      <p className="text-sm">
        Of the yield after the platform fee: tenant {percent(props.bps)} · landlord {percent(10000 - props.bps)}
      </p>
      <Note>{PRESET_DISCLAIMER}</Note>
    </div>
  );
}
