"use client";

import { useId, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useI18n } from "@/lib/i18n/client";
import { STRATEGIES } from "@/lib/strategies";
import { cn } from "@/lib/utils";

// Selectable cards: each is a real radio with its label, so keyboard and screen readers work as a group.
export function StrategyPicker(props: { value: string; onChange: (id: string) => void; "aria-describedby"?: string }) {
  const { t } = useI18n();
  const [highRiskAck, setHighRiskAck] = useState(false);
  const base = useId();

  return (
    <RadioGroup
      value={props.value}
      onValueChange={props.onChange}
      aria-describedby={props["aria-describedby"]}
      className="grid gap-4 sm:grid-cols-2"
    >
      {STRATEGIES.map((s) => {
        const copy = t.strategies[s.id];
        const id = `${base}-${s.id}`;
        const selectable = s.enabled && (s.risk !== "High" || highRiskAck);
        return (
          <div
            key={s.id}
            className={cn(
              "flex flex-col gap-3 rounded-xl border bg-card p-4 transition-colors has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:ring-3 has-[[data-state=checked]]:ring-primary/20",
              !s.enabled && "bg-muted",
            )}
          >
            <div className="flex items-start gap-3">
              <RadioGroupItem value={s.id} id={id} disabled={!selectable} aria-describedby={`${id}-desc`} className="mt-0.5" />
              <div className="grid gap-1">
                <Label htmlFor={id} className="text-base font-semibold">
                  {copy.name}
                </Label>
                <p className="text-sm font-medium">{copy.apy}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 pl-7">
              <Badge variant="outline">{t.risk[s.risk]}</Badge>
              {s.id === "usdc_fixed" && <Badge variant="secondary">{t.landlord.create.recommended}</Badge>}
              {s.simulated && <Badge className="bg-warning/10 text-warning">{t.common.simulatedYield}</Badge>}
              {!s.enabled && <Badge variant="outline">{t.landlord.create.notAvailable}</Badge>}
            </div>
            <p id={`${id}-desc`} className="pl-7 text-sm text-muted-foreground">
              {copy.risks}
            </p>
            {s.risk === "High" && (
              <div className="flex items-start gap-2 pl-7">
                <Checkbox id={`${id}-ack`} checked={highRiskAck} onCheckedChange={(v) => setHighRiskAck(v === true)} />
                <Label htmlFor={`${id}-ack`} className="text-sm leading-snug font-normal">
                  {t.landlord.create.highRiskAck}
                </Label>
              </div>
            )}
          </div>
        );
      })}
    </RadioGroup>
  );
}
