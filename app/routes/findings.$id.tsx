import { useActionMutation, useActionQuery } from "@agent-native/core/client/hooks";
import { IconArrowLeft, IconEye, IconEyeOff } from "@tabler/icons-react";
import { useState } from "react";
import { Link, useParams } from "react-router";

import { ConfidenceBadge, SeverityBadge, StatusBadge } from "@/components/sentrix/indicators";
import { ErrorNotice, PageHeader } from "@/components/sentrix/page-primitives";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { sonnerToast } from "@/components/ui/sonner";
import { formatDate, formatDateTime, labelize } from "@/lib/format";
import { FINDING_STATUSES } from "@/lib/sentrix";

export function meta() {
  return [{ title: "Finding · SENTRIX" }];
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="gap-3 border-border/80 bg-card/80 p-5">
      <h2 className="text-base font-semibold">{title}</h2>
      <div className="text-sm leading-relaxed text-muted-foreground">{children}</div>
    </Card>
  );
}

function MaskedEvidence({ evidence }: { evidence: string }) {
  const [revealed, setRevealed] = useState(false);
  if (!evidence) return <p>No evidence recorded.</p>;
  return (
    <div className="flex flex-col gap-3">
      <pre className="overflow-x-auto rounded-md border border-border bg-background p-3 font-mono text-xs text-foreground">
        {revealed ? evidence : "•".repeat(Math.min(evidence.length, 48))}
      </pre>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          aria-pressed={revealed}
          onClick={() => setRevealed((v) => !v)}
        >
          {revealed ? <IconEyeOff className="size-4" aria-hidden="true" /> : <IconEye className="size-4" aria-hidden="true" />}
          {revealed ? "Hide evidence" : "Reveal evidence"}
        </Button>
        <span className="text-xs">Evidence is masked by default to limit exposure of sensitive values.</span>
      </div>
    </div>
  );
}

export default function FindingDetailRoute() {
  const { id = "" } = useParams();
  const query = useActionQuery("get-finding", { id });
  const updateStatus = useActionMutation("update-finding-status");
  const [statusDraft, setStatusDraft] = useState<string | null>(null);

  if (query.isLoading) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-10 w-1/2" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  if (query.isError || !query.data) {
    return (
      <div className="flex flex-col gap-4">
        <Link to="/findings" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
          <IconArrowLeft className="size-4" aria-hidden="true" /> Vulnerabilities
        </Link>
        <ErrorNotice message="This finding could not be loaded. It may have been removed, or the server is unavailable." />
      </div>
    );
  }

  const { finding, timeline, assessment } = query.data;
  const currentStatus = statusDraft ?? finding.status;
  const references = finding.referenceLinks
    .split(/\s+/)
    .filter((link) => /^https?:\/\//.test(link));

  function saveStatus() {
    if (!statusDraft || statusDraft === finding.status) return;
    updateStatus.mutate(
      { id, status: statusDraft as (typeof FINDING_STATUSES)[number] },
      {
        onSuccess: () => {
          setStatusDraft(null);
          sonnerToast.success(`Status set to ${labelize(statusDraft)}`);
        },
        onError: (err) =>
          sonnerToast.error(err instanceof Error ? err.message : "Could not update the status"),
      },
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Link to="/findings" className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <IconArrowLeft className="size-4" aria-hidden="true" /> Vulnerabilities
      </Link>
      <PageHeader title={finding.title} description={`Affects ${finding.affectedAsset}`} />

      <div className="flex flex-wrap items-center gap-2">
        <SeverityBadge severity={finding.severity} />
        <ConfidenceBadge confidence={finding.confidence} />
        <StatusBadge status={finding.status} />
        <span className="text-xs text-muted-foreground">
          Owner: {finding.owner || "Unassigned"} · Discovered {formatDate(finding.discoveredAt)}
          {assessment ? (
            <>
              {" · "}
              <Link to={`/assessments/${assessment.id}`} className="text-primary hover:underline">
                {assessment.title}
              </Link>
            </>
          ) : null}
        </span>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <Section title="Technical description"><p>{finding.description || "No description recorded."}</p></Section>
          <Section title="Impact"><p>{finding.impact || "No impact recorded."}</p></Section>
          <Section title="Evidence"><MaskedEvidence evidence={finding.evidence} /></Section>
          <Section title="Remediation"><p>{finding.remediation || "No remediation recorded."}</p></Section>
          <Section title="References">
            {references.length ? (
              <ul className="flex list-disc flex-col gap-1 pl-5">
                {references.map((link) => (
                  <li key={link}>
                    <a href={link} target="_blank" rel="noopener noreferrer" className="break-all text-primary hover:underline">
                      {link}
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <p>No references recorded.</p>
            )}
          </Section>
        </div>

        <div className="flex flex-col gap-6">
          <Card className="gap-4 border-border/80 bg-card/80 p-5">
            <h2 className="text-base font-semibold">Status</h2>
            <div className="flex flex-col gap-1.5">
              <Label>Change status</Label>
              <Select value={currentStatus} onValueChange={setStatusDraft}>
                <SelectTrigger aria-label="Finding status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {FINDING_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>{labelize(s)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              size="sm"
              onClick={saveStatus}
              disabled={!statusDraft || statusDraft === finding.status || updateStatus.isPending}
            >
              {updateStatus.isPending ? "Saving…" : "Save status"}
            </Button>
          </Card>

          <Card className="gap-3 border-border/80 bg-card/80 p-5">
            <h2 className="text-base font-semibold">Retest history</h2>
            <p className="text-sm text-muted-foreground">No retests have been recorded for this finding yet.</p>
          </Card>

          <Card className="gap-3 border-border/80 bg-card/80 p-5">
            <h2 className="text-base font-semibold">Activity timeline</h2>
            {timeline.length ? (
              <ol className="flex flex-col gap-3">
                {timeline.map((event) => (
                  <li key={event.id} className="flex flex-col gap-0.5 border-l-2 border-border pl-4 text-sm">
                    <span>{event.message}</span>
                    <span className="text-xs text-muted-foreground">{formatDateTime(event.createdAt)}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-sm text-muted-foreground">No activity recorded for this finding.</p>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
