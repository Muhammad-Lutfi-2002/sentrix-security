import { useActionMutation, useActionQuery } from "@agent-native/core/client/hooks";
import { IconArrowLeft, IconBug, IconPlayerStop } from "@tabler/icons-react";
import { Link, useParams } from "react-router";

import { ModeBadge, SeverityBadge, StatusBadge } from "@/components/sentrix/indicators";
import { ErrorNotice, PageHeader } from "@/components/sentrix/page-primitives";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { sonnerToast } from "@/components/ui/sonner";
import { ASSESSMENT_MODULES, assessmentModuleList } from "@/lib/sentrix";
import { formatDateTime, labelize } from "@/lib/format";

export function meta() {
  return [{ title: "Assessment · SENTRIX" }];
}

const LIVE_STATUSES = ["queued", "running"];

export default function AssessmentMonitorRoute() {
  const { id = "" } = useParams();
  const query = useActionQuery(
    "get-assessment",
    { id },
    {
      refetchInterval: (q) =>
        LIVE_STATUSES.includes(q.state.data?.assessment.status ?? "") ? 5000 : false,
    },
  );
  const cancel = useActionMutation("cancel-assessment");

  if (query.isLoading) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-10 w-1/2" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (query.isError || !query.data) {
    return (
      <div className="flex flex-col gap-4">
        <Link to="/assessments" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
          <IconArrowLeft className="size-4" aria-hidden="true" /> Back to assessments
        </Link>
        <ErrorNotice message="This assessment could not be loaded. It may have been removed, or the server is unavailable." />
      </div>
    );
  }

  const { assessment, project, findings, history } = query.data;
  const moduleIds = assessmentModuleList(assessment.modules);
  const modules = ASSESSMENT_MODULES.filter((m) => moduleIds.includes(m.id));
  const isLive = LIVE_STATUSES.includes(assessment.status);

  function confirmCancel() {
    cancel.mutate(
      { id },
      {
        onSuccess: () => sonnerToast.success("Assessment cancelled"),
        onError: (err) =>
          sonnerToast.error(err instanceof Error ? err.message : "Could not cancel the assessment"),
      },
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Link to="/assessments" className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <IconArrowLeft className="size-4" aria-hidden="true" /> Assessments
      </Link>
      <PageHeader
        title={assessment.title}
        description={project ? `Project: ${project.name} · ${labelize(project.environment)}` : undefined}
        actions={
          isLive ? (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm" className="gap-1.5">
                  <IconPlayerStop className="size-4" aria-hidden="true" />
                  Cancel assessment
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Cancel this assessment?</AlertDialogTitle>
                  <AlertDialogDescription>
                    The assessment will be marked cancelled. Its recorded scope and history are kept.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep running</AlertDialogCancel>
                  <AlertDialogAction onClick={confirmCancel}>Cancel assessment</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : null
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={assessment.status} />
        <ModeBadge mode={assessment.mode} />
        {isLive ? <span className="text-xs text-muted-foreground" aria-live="polite">Refreshing every 5 seconds</span> : null}
      </div>

      {assessment.status === "queued" ? (
        <div role="status" className="rounded-md border border-violet-300/40 bg-violet-500/10 px-4 py-3 text-sm text-violet-100">
          This assessment is queued and waiting for a scanner worker to pick it up. Status changes only when the worker actually starts it; if it stays queued, check that the worker is running (see the README).
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="gap-4 border-border/80 bg-card/80 p-5 lg:col-span-2">
          <h2 className="text-base font-semibold">Target and approved scope</h2>
          <dl className="grid gap-4 text-sm sm:grid-cols-2">
            <div><dt className="text-muted-foreground">Target</dt><dd className="break-all font-medium">{assessment.targetUrl}</dd></div>
            <div><dt className="text-muted-foreground">Authorization</dt><dd className="font-medium">{assessment.targetVerified ? "Target ownership verified" : "Target not currently verified"}</dd></div>
            <div className="sm:col-span-2"><dt className="text-muted-foreground">Approved scope</dt><dd className="whitespace-pre-line font-medium">{assessment.approvedScope}</dd></div>
          </dl>
        </Card>

        <Card className="gap-4 border-border/80 bg-card/80 p-5">
          <h2 className="text-base font-semibold">Execution</h2>
          <dl className="grid gap-3 text-sm">
            <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Completed work units</dt><dd className="font-medium">Not reported</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Findings linked</dt><dd className="font-medium tabular-nums">{findings.length}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Warnings</dt><dd className="font-medium">Not reported</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Errors</dt><dd className="font-medium">Not reported</dd></div>
          </dl>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="gap-4 border-border/80 bg-card/80 p-5">
          <h2 className="text-base font-semibold">Requested modules</h2>
          <p className="text-xs text-muted-foreground">Modules requested for this assessment. Execution status is not reported because no scan engine is connected.</p>
          <ul className="flex flex-col divide-y divide-border">
            {modules.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <span>{m.label}</span>
                <span className="text-muted-foreground">{m.kind === "active" ? "Active" : "Passive"} · not reported</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="gap-4 border-border/80 bg-card/80 p-5">
          <h2 className="text-base font-semibold">Findings discovered</h2>
          {findings.length ? (
            <ul className="flex flex-col divide-y divide-border">
              {findings.map((f) => (
                <li key={f.id} className="flex flex-col gap-1.5 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                  <Link to={`/findings/${f.id}`} className="inline-flex min-w-0 items-center gap-2 text-sm font-medium hover:underline">
                    <IconBug className="size-4 shrink-0" aria-hidden="true" />
                    <span className="truncate">{f.title}</span>
                  </Link>
                  <div className="flex shrink-0 gap-2"><SeverityBadge severity={f.severity} /><StatusBadge status={f.status} /></div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No findings are linked to this assessment.</p>
          )}
        </Card>
      </div>

      <Card className="gap-4 border-border/80 bg-card/80 p-5">
        <h2 className="text-base font-semibold">Execution history</h2>
        {history.length ? (
          <ol className="flex flex-col gap-3">
            {history.map((event) => (
              <li key={event.id} className="flex flex-col gap-0.5 border-l-2 border-border pl-4 text-sm">
                <span>{event.message}</span>
                <span className="text-xs text-muted-foreground">{labelize(event.kind)} · {formatDateTime(event.createdAt)}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-muted-foreground">No history recorded.</p>
        )}
        <p className="text-xs text-muted-foreground">
          Created {formatDateTime(assessment.createdAt)}
          {assessment.cancelledAt ? ` · Cancelled ${formatDateTime(assessment.cancelledAt)}` : ""}
        </p>
      </Card>
    </div>
  );
}
