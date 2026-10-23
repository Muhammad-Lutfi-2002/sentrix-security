import {
  IconAlertCircle,
  IconAlertOctagon,
  IconAlertTriangle,
  IconCircleDot,
  IconInfoCircle,
} from "@tabler/icons-react";

import { Badge } from "@/components/ui/badge";
import { labelize } from "@/lib/format";
import { cn } from "@/lib/utils";

const severityConfig = {
  critical: {
    icon: IconAlertOctagon,
    className: "border-red-400/40 bg-red-500/15 text-red-200",
  },
  high: {
    icon: IconAlertTriangle,
    className: "border-orange-400/40 bg-orange-500/15 text-orange-200",
  },
  medium: {
    icon: IconAlertCircle,
    className: "border-amber-300/40 bg-amber-400/15 text-amber-100",
  },
  low: {
    icon: IconInfoCircle,
    className: "border-sky-300/40 bg-sky-400/15 text-sky-100",
  },
  info: {
    icon: IconCircleDot,
    className: "border-slate-300/30 bg-slate-400/15 text-slate-200",
  },
} as const;

export function SeverityBadge({ severity }: { severity: string }) {
  const config =
    severityConfig[severity as keyof typeof severityConfig] ?? severityConfig.info;
  const Icon = config.icon;
  return (
    <Badge
      variant="outline"
      className={cn("gap-1 font-medium capitalize", config.className)}
    >
      <Icon className="size-3.5" aria-hidden="true" />
      <span>{severity}</span>
    </Badge>
  );
}

const statusClass: Record<string, string> = {
  open: "border-red-400/30 text-red-200",
  in_progress: "border-cyan-300/40 text-cyan-200",
  fixed: "border-emerald-400/40 text-emerald-200",
  accepted_risk: "border-slate-300/30 text-slate-200",
  needs_review: "border-amber-300/40 text-amber-100",
  retest_required: "border-violet-300/40 text-violet-200",
  closed: "border-emerald-400/40 text-emerald-200",
  draft: "border-slate-300/30 text-slate-300",
  completed_with_warnings: "border-amber-300/40 text-amber-100",
  false_positive: "border-slate-300/30 text-slate-300",
  queued: "border-violet-300/40 text-violet-200",
  running: "border-cyan-300/40 text-cyan-200",
  completed: "border-emerald-400/40 text-emerald-200",
  cancelled: "border-slate-300/30 text-slate-300",
  failed: "border-red-400/40 text-red-200",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant="outline" className={cn("font-medium", statusClass[status])}>
      {labelize(status)}
    </Badge>
  );
}

export function ConfidenceBadge({ confidence }: { confidence: string }) {
  return (
    <Badge variant="outline" className="border-border text-muted-foreground">
      Confidence: {labelize(confidence)}
    </Badge>
  );
}

export function ModeBadge({ mode }: { mode: string }) {
  const active = mode === "active";
  return (
    <Badge
      variant="outline"
      className={cn(
        "font-medium",
        active
          ? "border-violet-300/50 bg-violet-500/15 text-violet-100"
          : "border-cyan-300/30 bg-cyan-400/10 text-cyan-100",
      )}
    >
      {active ? "Active: sends requests" : "Passive: no requests"}
    </Badge>
  );
}
