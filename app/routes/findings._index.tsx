import { useActionQuery } from "@agent-native/core/client/hooks";
import { IconArrowDown, IconArrowUp, IconBug, IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import { Link, useSearchParams } from "react-router";

import { ConfidenceBadge, SeverityBadge, StatusBadge } from "@/components/sentrix/indicators";
import { EmptyState, ErrorNotice, PageHeader } from "@/components/sentrix/page-primitives";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, labelize } from "@/lib/format";
import { FINDING_STATUSES, SEVERITIES } from "@/lib/sentrix";

export function meta() {
  return [{ title: "Vulnerabilities · SENTRIX" }];
}

const PAGE_SIZE = 20;
type SortKey = "discoveredAt" | "severity" | "title" | "status" | "owner";
const SORT_KEYS: SortKey[] = ["discoveredAt", "severity", "title", "status", "owner"];
const SORT_LABELS: Record<SortKey, string> = {
  discoveredAt: "Discovered",
  severity: "Severity",
  title: "Finding",
  status: "Status",
  owner: "Owner",
};

function SortHeader({
  sortKey,
  label,
  active,
  direction,
  onSort,
}: {
  sortKey: SortKey;
  label: string;
  active: boolean;
  direction: "asc" | "desc";
  onSort: (key: SortKey) => void;
}) {
  const ariaSort = active ? (direction === "asc" ? "ascending" : "descending") : "none";
  return (
    <TableHead aria-sort={ariaSort}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className="inline-flex items-center gap-1 rounded-sm font-medium hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {label}
        {active ? (
          direction === "asc" ? (
            <IconArrowUp className="size-3.5" aria-hidden="true" />
          ) : (
            <IconArrowDown className="size-3.5" aria-hidden="true" />
          )
        ) : null}
      </button>
    </TableHead>
  );
}

export default function FindingsRoute() {
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const severity = params.get("severity") ?? "all";
  const status = params.get("status") ?? "all";
  const sortParam = params.get("sort") as SortKey | null;
  const sort: SortKey = sortParam && SORT_KEYS.includes(sortParam) ? sortParam : "discoveredAt";
  const direction = params.get("dir") === "asc" ? "asc" : "desc";
  const page = Math.max(1, Number(params.get("page") ?? "1") || 1);

  function update(patch: Record<string, string | null>, resetPage = true) {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === "" || value === "all") next.delete(key);
      else next.set(key, value);
    }
    if (resetPage) next.delete("page");
    setParams(next, { replace: true });
  }

  const findings = useActionQuery("list-findings", {
    q: q || undefined,
    severity: severity !== "all" ? [severity as (typeof SEVERITIES)[number]] : undefined,
    status: status !== "all" ? [status as (typeof FINDING_STATUSES)[number]] : undefined,
    sort,
    direction,
    page,
    pageSize: PAGE_SIZE,
  });

  function toggleSort(key: SortKey) {
    if (key === sort) update({ dir: direction === "asc" ? "desc" : "asc" }, false);
    else update({ sort: key, dir: "desc" }, false);
  }

  const total = findings.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filtersActive = Boolean(q || severity !== "all" || status !== "all");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Vulnerabilities"
        description="Findings across all projects. Filters, sorting, and paging run on the server."
      />

      <Card className="grid gap-3 border-border/80 bg-card/80 p-4 md:grid-cols-[1fr_11rem_11rem]">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="finding-search">Search</Label>
          <Input
            id="finding-search"
            type="search"
            value={q}
            onChange={(e) => update({ q: e.target.value })}
            placeholder="Title or affected asset"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Severity</Label>
          <Select value={severity} onValueChange={(v) => update({ severity: v })}>
            <SelectTrigger aria-label="Filter by severity"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All severities</SelectItem>
              {SEVERITIES.map((s) => (
                <SelectItem key={s} value={s}>{labelize(s)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Status</Label>
          <Select value={status} onValueChange={(v) => update({ status: v })}>
            <SelectTrigger aria-label="Filter by status"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {FINDING_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>{labelize(s)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </Card>

      <Card className="border-border/80 bg-card/80 p-0">
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 text-sm text-muted-foreground">
          <span aria-live="polite">
            {findings.isLoading ? "Loading findings…" : `${total} ${total === 1 ? "finding" : "findings"}`}
          </span>
          {filtersActive ? (
            <Button variant="ghost" size="sm" onClick={() => setParams(new URLSearchParams(), { replace: true })}>
              Clear filters
            </Button>
          ) : null}
        </div>

        {findings.isError ? (
          <div className="p-4"><ErrorNotice message="Could not load findings. Adjust the filters or try again." /></div>
        ) : findings.isLoading ? (
          <div className="flex flex-col gap-3 p-4">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : findings.data?.rows.length ? (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <SortHeader sortKey="severity" label="Severity" active={sort === "severity"} direction={direction} onSort={toggleSort} />
                  <SortHeader sortKey="title" label="Finding" active={sort === "title"} direction={direction} onSort={toggleSort} />
                  <TableHead>Confidence</TableHead>
                  <TableHead>Affected asset</TableHead>
                  <SortHeader sortKey="discoveredAt" label="Discovered" active={sort === "discoveredAt"} direction={direction} onSort={toggleSort} />
                  <SortHeader sortKey="status" label="Status" active={sort === "status"} direction={direction} onSort={toggleSort} />
                  <SortHeader sortKey="owner" label="Owner" active={sort === "owner"} direction={direction} onSort={toggleSort} />
                </TableRow>
              </TableHeader>
              <TableBody>
                {findings.data.rows.map((f) => (
                  <TableRow key={f.id}>
                    <TableCell><SeverityBadge severity={f.severity} /></TableCell>
                    <TableCell className="max-w-xs">
                      <Link to={`/findings/${f.id}`} className="font-medium hover:underline">{f.title}</Link>
                    </TableCell>
                    <TableCell><ConfidenceBadge confidence={f.confidence} /></TableCell>
                    <TableCell className="max-w-[14rem] truncate font-mono text-xs">{f.affectedAsset}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(f.discoveredAt)}</TableCell>
                    <TableCell><StatusBadge status={f.status} /></TableCell>
                    <TableCell>{f.owner || "Unassigned"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <div className="p-4">
            <EmptyState
              icon={<IconBug className="size-10" aria-hidden="true" />}
              title={filtersActive ? "No findings match these filters" : "No findings yet"}
              description={filtersActive ? "Try a broader search or clear the filters." : "Findings appear here once an assessment records them."}
              action={filtersActive ? <Button variant="secondary" size="sm" onClick={() => setParams(new URLSearchParams(), { replace: true })}>Clear filters</Button> : undefined}
            />
          </div>
        )}

        <nav aria-label="Pagination" className="flex items-center justify-between gap-3 border-t border-border px-4 py-3 text-sm">
          <span className="text-muted-foreground tabular-nums">Page {Math.min(page, pageCount)} of {pageCount}</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="gap-1" disabled={page <= 1} onClick={() => update({ page: String(page - 1) }, false)}>
              <IconChevronLeft className="size-4" aria-hidden="true" /> Previous
            </Button>
            <Button variant="outline" size="sm" className="gap-1" disabled={page >= pageCount} onClick={() => update({ page: String(page + 1) }, false)}>
              Next <IconChevronRight className="size-4" aria-hidden="true" />
            </Button>
          </div>
        </nav>
      </Card>
    </div>
  );
}
