import { useActionQuery } from "@agent-native/core/client/hooks";
import { IconClipboardList } from "@tabler/icons-react";
import { Link } from "react-router";

import { ModeBadge, StatusBadge } from "@/components/sentrix/indicators";
import { EmptyState, ErrorNotice, PageHeader } from "@/components/sentrix/page-primitives";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/format";

export function meta() {
  return [{ title: "Assessments · SENTRIX" }];
}

export default function AssessmentsRoute() {
  const assessments = useActionQuery("list-assessments", { limit: 100 });
  const projects = useActionQuery("list-projects", {});
  const projectName = new Map((projects.data ?? []).map((p) => [p.id, p.name]));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Assessments"
        description="Every assessment, its run type, and its current status."
        actions={
          <Button asChild size="sm">
            <Link to="/assessments/new">New assessment</Link>
          </Button>
        }
      />
      <Card className="border-border/80 bg-card/80 p-0">
        {assessments.isError ? (
          <div className="p-5"><ErrorNotice message="Could not load assessments. Refresh the page to try again." /></div>
        ) : assessments.isLoading ? (
          <div className="flex flex-col gap-3 p-5">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : assessments.data?.length ? (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Assessment</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Run type</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {assessments.data.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell>
                      <Link to={`/assessments/${a.id}`} className="font-medium hover:underline">
                        {a.title}
                      </Link>
                      <p className="max-w-xs truncate text-xs text-muted-foreground">{a.targetUrl}</p>
                    </TableCell>
                    <TableCell>{projectName.get(a.projectId) ?? "—"}</TableCell>
                    <TableCell><StatusBadge status={a.status} /></TableCell>
                    <TableCell><ModeBadge mode={a.mode} /></TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(a.createdAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <div className="p-5">
            <EmptyState
              icon={<IconClipboardList className="size-10" aria-hidden="true" />}
              title="No assessments yet"
              description="Start an assessment to define scope, choose modules, and confirm authorization before anything is queued."
              action={
                <Button asChild>
                  <Link to="/assessments/new">Start an assessment</Link>
                </Button>
              }
            />
          </div>
        )}
      </Card>
    </div>
  );
}
