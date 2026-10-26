"use client";

import { CircleCheckIcon, CircleDotIcon, ClockIcon, HourglassIcon, OctagonPauseIcon, SearchIcon, XCircleIcon } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/lib/i18n/client";
import type { Status } from "@/lib/types";
import { cn } from "@/lib/utils";

const TONE: Record<Status, { icon: LucideIcon; className: string; text: string }> = {
  Proposed: { icon: HourglassIcon, className: "bg-secondary text-secondary-foreground", text: "text-muted-foreground" },
  Active: { icon: CircleDotIcon, className: "bg-success/10 text-success", text: "text-success" },
  Ending: { icon: ClockIcon, className: "bg-warning/10 text-warning", text: "text-warning" },
  Stopped: { icon: OctagonPauseIcon, className: "bg-destructive/10 text-destructive", text: "text-destructive" },
  UnderReview: { icon: SearchIcon, className: "bg-warning/10 text-warning", text: "text-warning" },
  Settled: { icon: CircleCheckIcon, className: "bg-secondary text-secondary-foreground", text: "text-muted-foreground" },
  Cancelled: { icon: XCircleIcon, className: "bg-muted text-muted-foreground", text: "text-muted-foreground" },
};

// Icon + label without a pill, for list rows. `inverted` is for rows drawn on the primary selection colour.
export function StatusLine({ status, inverted }: { status: Status; inverted?: boolean }) {
  const { t } = useI18n();
  const { icon: Icon, text } = TONE[status];
  return (
    <span className={cn("inline-flex items-center gap-1 text-sm font-medium", inverted ? "text-primary-foreground" : text)}>
      <Icon className="size-3.5" aria-hidden />
      {t.status[status]}
    </span>
  );
}

export function StatusBadge({ status }: { status: Status }) {
  const { t } = useI18n();
  const { icon: Icon, className } = TONE[status];
  return (
    <Badge className={cn("gap-1", className)}>
      <Icon aria-hidden />
      {t.status[status]}
    </Badge>
  );
}
