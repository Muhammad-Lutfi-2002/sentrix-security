import type { ReactNode } from "react";

import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {title}
        </h1>
        {description ? (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 gap-2">{actions}</div> : null}
    </div>
  );
}

export function MetricCard({
  label,
  value,
  hint,
  loading,
  tone,
}: {
  label: string;
  value: number | string;
  hint?: string;
  loading?: boolean;
  tone?: "neutral" | "critical" | "high";
}) {
  return (
    <Card className="gap-1 border-border/80 bg-card/80 p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      {loading ? (
        <Skeleton className="h-8 w-16" />
      ) : (
        <p
          className={cn(
            "text-3xl font-semibold tabular-nums",
            tone === "critical" && "text-red-200",
            tone === "high" && "text-orange-200",
          )}
        >
          {value}
        </p>
      )}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </Card>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border px-6 py-12 text-center">
      <div className="text-muted-foreground">{icon}</div>
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      <p className="max-w-md text-sm text-muted-foreground">{description}</p>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function ErrorNotice({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="rounded-md border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm text-red-100"
    >
      {message}
    </div>
  );
}
