import { useActionQuery } from "@agent-native/core/client/hooks";
import {
  IconArrowRight,
  IconClipboardList,
  IconShieldCheck,
} from "@tabler/icons-react";
import { Link } from "react-router";

import { EmptyState, ErrorNotice, MetricCard, PageHeader } from "@/components/sentrix/page-primitives";
import { ModeBadge, SeverityBadge, StatusBadge } from "@/components/sentrix/indicators";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatDateTime, labelize } from "@/lib/format";

export function meta() {
  return [{ title: "Security posture · SENTRIX" }];
}

export default function DashboardRoute() {
  const { data, isLoading, isError } = useActionQuery("dashboard-summary", {});

  if (isError) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Security posture" />
        <ErrorNotice message="Could not load dashboard data. Refresh the page or try again shortly." />
      </div>
    );
  }

  const summary = data;
  const remediationPercent =
    summary && summary.remediation.total > 0
      ? Math.round((summary.remediation.resolved / summary.remediation.total) * 100)
      : 0;
  const maxDiscovered = Math.max(1, ...(summary?.trend ?? []).map((w) => w.discovered));
  const hasAnyData = Boolean(
    summary &&
      (summary.totalProjects > 0 || summary.latestFindings.length > 0 || summary.recentAssessments.length > 0),
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Security posture"
        description="Live status from projects, assessments, and findings in this workspace."
        actions={
          <Button asChild size="sm">
            <Link to="/assessments/new">Start assessment</Link>
          </Button>
        }
      />

      <section aria-labelledby="metrics-heading" className="flex flex-col gap-3">
        <h2 id="metrics-heading" className="sr-only">Key metrics</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <MetricCard label="Total projects" value={summary?.totalProjects ?? 0} loading={isLoading} />
          <MetricCard label="Active assessments" value={summary?.activeAssessments ?? 0} loading={isLoading} hint="Queued or running" />
          <MetricCard label="Open critical" value={summary?.openCritical ?? 0} loading={isLoading} tone="critical" />
          <MetricCard label="Open high" value={summary?.openHigh ?? 0} loading={isLoading} tone="high" />
          <Card className="gap-2 border-border/80 bg-card/80 p-4 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Remediation</p>
            {isLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <p className="text-3xl font-semibold tabular-nums">{remediationPercent}%</p>
            )}
            {isLoading ? null : (
              <>
                <Progress value={remediationPercent} aria-label="Remediation progress" />
                <p className="text-xs text-muted-foreground">
                  {summary?.remediation.resolved ?? 0} of {summary?.remediation.total ?? 0} resolved or accepted
                </p>
              </>
            )}
          </Card>
        </div>
      </section>

      {!isLoading && !hasAnyData ? (
        <EmptyState
          icon={<IconShieldCheck className="size-10" aria-hidden="true" />}
          title="No assessment data yet"
          description="Create a project and start an assessment. Results, findings, and trends appear here once they are recorded."
          action={
            <Button asChild>
              <Link to="/assessments/new">Start an assessment</Link>
            </Button>
          }
        />
      ) : null}

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="gap-4 border-border/80 bg-card/80 p-5 xl:col-span-2">
          <div>
            <h2 className="text-base font-semibold">Risk trend</h2>
            <p className="text-sm text-muted-foreground">Findings discovered per week, last 8 weeks, with open critical and high counts.</p>
          </div>
          {isLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : (
            <ol className="flex flex-col gap-2" aria-label="Findings discovered per week">
              {summary?.trend.map((week) => (
                <li key={week.week} className="grid grid-cols-[6rem_1fr_auto] items-center gap-3 text-sm">
                  <span className="text-muted-foreground tabular-nums">{formatDate(week.week)}</span>
                  <div className="h-2.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                    <div
                      className="h-full rounded-full bg-primary transition-[width] duration-300 motion-reduce:transition-none"
                      style={{ width: `${(week.discovered / maxDiscovered) * 100}%` }}
                    />
                  </div>
                  <span className="whitespace-nowrap tabular-nums text-foreground">
                    {week.discovered} found · {week.openCritical} critical · {week.openHigh} high open
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Card>

        <Card className="gap-4 border-border/80 bg-card/80 p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">Activity history</h2>
          </div>
          {isLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : summary?.activity.length ? (
            <ul className="flex flex-col divide-y divide-border">
              {summary.activity.map((event) => (
                <li key={event.id} className="py-2.5">
                  <p className="text-sm">{event.message}</p>
                  <p className="text-xs text-muted-foreground">
                    {labelize(event.kind)} · {formatDateTime(event.createdAt)}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No activity recorded yet.</p>
          )}
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="gap-4 border-border/80 bg-card/80 p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">Recent assessments</h2>
            <Link to="/assessments" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
              View all <IconArrowRight className="size-3.5" aria-hidden="true" />
            </Link>
          </div>
          {isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : summary?.recentAssessments.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Assessment</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Mode</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary.recentAssessments.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell>
                      <Link to={`/assessments/${a.id}`} className="font-medium text-foreground hover:underline">
                        {a.title}
                      </Link>
                    </TableCell>
                    <TableCell><StatusBadge status={a.status} /></TableCell>
                    <TableCell><ModeBadge mode={a.mode} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <EmptyState
              icon={<IconClipboardList className="size-8" aria-hidden="true" />}
              title="No assessments yet"
              description="Assessments you start will be listed here with their status."
            />
          )}
        </Card>

        <Card className="gap-4 border-border/80 bg-card/80 p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">Latest findings</h2>
            <Link to="/findings" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
              View all <IconArrowRight className="size-3.5" aria-hidden="true" />
            </Link>
          </div>
          {isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : summary?.latestFindings.length ? (
            <ul className="flex flex-col divide-y divide-border">
              {summary.latestFindings.map((f) => (
                <li key={f.id} className="flex flex-col gap-1.5 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                  <Link to={`/findings/${f.id}`} className="min-w-0 truncate text-sm font-medium hover:underline">
                    {f.title}
                  </Link>
                  <div className="flex shrink-0 items-center gap-2">
                    <SeverityBadge severity={f.severity} />
                    <StatusBadge status={f.status} />
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No findings recorded yet.</p>
          )}
        </Card>
      </div>
    </div>
  );
}
