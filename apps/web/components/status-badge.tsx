import { CircleCheckIcon, CircleDotIcon, ClockIcon, HourglassIcon, OctagonPauseIcon, SearchIcon, XCircleIcon } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { STATUS_LABEL } from "@/lib/format";
import type { Status } from "@/lib/types";
import { cn } from "@/lib/utils";

const TONE: Record<Status, { icon: LucideIcon; className: string }> = {
  Proposed: { icon: HourglassIcon, className: "bg-secondary text-secondary-foreground" },
  Active: { icon: CircleDotIcon, className: "bg-success/10 text-success" },
  Ending: { icon: ClockIcon, className: "bg-warning/10 text-warning" },
  Stopped: { icon: OctagonPauseIcon, className: "bg-destructive/10 text-destructive" },
  UnderReview: { icon: SearchIcon, className: "bg-warning/10 text-warning" },
  Settled: { icon: CircleCheckIcon, className: "bg-secondary text-secondary-foreground" },
  Cancelled: { icon: XCircleIcon, className: "bg-muted text-muted-foreground" },
};

export function StatusBadge({ status }: { status: Status }) {
  const { icon: Icon, className } = TONE[status];
  return (
    <Badge className={cn("gap-1", className)}>
      <Icon aria-hidden />
      {STATUS_LABEL[status]}
    </Badge>
  );
}
