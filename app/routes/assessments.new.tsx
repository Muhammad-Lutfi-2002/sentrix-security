import { useActionMutation, useActionQuery } from "@agent-native/core/client/hooks";
import { IconAlertTriangle, IconCheck } from "@tabler/icons-react";
import { useState } from "react";
import { useNavigate } from "react-router";

import { ErrorNotice, PageHeader } from "@/components/sentrix/page-primitives";
import { ModeBadge } from "@/components/sentrix/indicators";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { sonnerToast } from "@/components/ui/sonner";
import { ASSESSMENT_MODULES, assessmentKind } from "@/lib/sentrix";
import { cn } from "@/lib/utils";

export function meta() {
  return [{ title: "New assessment · SENTRIX" }];
}

const STEPS = [
  { key: "project", label: "Project" },
  { key: "target", label: "Target" },
  { key: "scope", label: "Scope" },
  { key: "modules", label: "Modules" },
  { key: "safety", label: "Safety" },
  { key: "review", label: "Review" },
] as const;

type StepKey = (typeof STEPS)[number]["key"];

interface WizardState {
  projectId: string;
  title: string;
  targetId: string;
  targetUrl: string;
  approvedScope: string;
  modules: string[];
  activeAcknowledged: boolean;
  confirmed: boolean;
}

const initialState: WizardState = {
  projectId: "",
  title: "",
  targetId: "",
  targetUrl: "",
  approvedScope: "",
  modules: ["tls-config", "security-headers"],
  activeAcknowledged: false,
  confirmed: false,
};

function stepErrors(step: StepKey, state: WizardState): string[] {
  switch (step) {
    case "project":
      return state.projectId ? [] : ["Select a project to continue."];
    case "target": {
      const errors: string[] = [];
      if (!state.title.trim()) errors.push("Enter an assessment title.");
      if (!state.targetId) errors.push("Select a verified target, or register one and prove ownership.");
      return errors;
    }
    case "scope":
      return state.approvedScope.trim()
        ? []
        : ["Describe the approved scope, such as hostnames and paths."];
    case "modules":
      return state.modules.length ? [] : ["Select at least one available assessment module."];
    case "safety":
      return assessmentKind(state.modules) === "active" && !state.activeAcknowledged
        ? ["Acknowledge that active modules send requests to the target."]
        : [];
    case "review":
      return state.confirmed ? [] : ["Confirm the assessment before starting."];
  }
}

function ProgressSteps({ current, maxReached, onSelect }: { current: number; maxReached: number; onSelect: (i: number) => void }) {
  return (
    <nav aria-label="Assessment wizard progress">
      <ol className="grid grid-cols-2 gap-2 sm:grid-cols-6">
        {STEPS.map((step, index) => {
          const done = index < current;
          const reachable = index <= maxReached;
          return (
            <li key={step.key}>
              <button
                type="button"
                disabled={!reachable}
                aria-current={index === current ? "step" : undefined}
                onClick={() => onSelect(index)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
                  index === current
                    ? "border-violet-300/60 bg-violet-500/15 text-foreground"
                    : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                <span
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded-full border text-xs",
                    done ? "border-emerald-400 bg-emerald-500/20 text-emerald-100" : "border-border",
                  )}
                  aria-hidden="true"
                >
                  {done ? <IconCheck className="size-3" /> : index + 1}
                </span>
                <span className="truncate">
                  <span className="sr-only">{done ? "Completed: " : ""}</span>
                  {step.label}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function FieldError({ id, messages }: { id: string; messages: string[] }) {
  if (!messages.length) return null;
  return (
    <ul id={id} className="flex flex-col gap-1 text-sm text-red-200" role="alert">
      {messages.map((message) => (
        <li key={message} className="flex items-center gap-1.5">
          <IconAlertTriangle className="size-4 shrink-0" aria-hidden="true" />
          {message}
        </li>
      ))}
    </ul>
  );
}

function TargetPicker({ projectId, selectedId, onSelect }: { projectId: string; selectedId: string; onSelect: (id: string, url: string) => void }) {
  const targets = useActionQuery("list-targets", { projectId }, { enabled: Boolean(projectId) });
  const register = useActionMutation("register-target");
  const verify = useActionMutation("verify-target");
  const [url, setUrl] = useState("");
  const [excluded, setExcluded] = useState("");
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const rows = targets.data ?? [];

  function add() {
    setMsg(null);
    register.mutate(
      { projectId, url: url.trim(), excludedPaths: excluded.split("\n").map((p) => p.trim()).filter(Boolean) },
      {
        onSuccess: () => { setUrl(""); setExcluded(""); targets.refetch(); setMsg({ tone: "ok", text: "Target registered. Prove ownership below to use it." }); },
        onError: (e) => setMsg({ tone: "err", text: e instanceof Error ? e.message : "Could not register the target." }),
      },
    );
  }
  function check(targetId: string, canonicalUrl: string, method: "dns_txt" | "http_file") {
    setMsg(null);
    verify.mutate({ targetId, method }, {
      onSuccess: (r) => {
        setMsg({ tone: r.verified ? "ok" : "err", text: r.message });
        targets.refetch();
        if (r.verified) onSelect(targetId, canonicalUrl);
      },
      onError: (e) => setMsg({ tone: "err", text: e instanceof Error ? e.message : "Verification failed." }),
    });
  }

  if (!projectId) return <p className="text-sm text-muted-foreground">Select a project first.</p>;
  return (
    <div className="flex flex-col gap-4">
      {targets.isLoading ? <p className="text-sm text-muted-foreground">Loading targets…</p> : null}
      {rows.length === 0 && !targets.isLoading ? <p className="text-sm text-muted-foreground">No targets yet. Register one below.</p> : null}
      <ul className="flex flex-col gap-3">
        {rows.map((t) => {
          const verified = t.verificationStatus === "verified";
          const selected = selectedId === t.id;
          return (
            <li key={t.id} className={cn("flex flex-col gap-3 rounded-md border p-4", selected ? "border-violet-300/50 bg-violet-500/5" : "border-border")}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="break-all text-sm font-medium">{t.canonicalUrl}</span>
                <span className={cn("rounded-full border px-2 py-0.5 text-xs", verified ? "border-emerald-400/40 text-emerald-200" : "border-amber-300/40 text-amber-100")}>
                  {verified ? "Ownership verified" : t.verificationStatus === "expired" ? "Verification expired" : "Not verified"}
                </span>
              </div>
              {verified ? (
                <div><Button type="button" size="sm" variant={selected ? "secondary" : "outline"} onClick={() => onSelect(t.id, t.canonicalUrl)} aria-pressed={selected}>{selected ? "Selected" : "Use this target"}</Button></div>
              ) : t.verification ? (
                <div className="flex flex-col gap-3 text-xs text-muted-foreground">
                  <p>Prove you control this target with <strong>one</strong> of these:</p>
                  <div><p className="font-medium text-foreground">Option A: DNS TXT record</p><p className="break-all">Host: <code>{t.verification.dns.host}</code></p><p className="break-all">Value: <code>{t.verification.dns.value}</code></p></div>
                  <div><p className="font-medium text-foreground">Option B: file on the site</p><p className="break-all">URL: <code>{t.verification.file.url}</code></p><p className="break-all">Content: <code>{t.verification.file.content}</code></p></div>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" size="sm" variant="secondary" disabled={verify.isPending} onClick={() => check(t.id, t.canonicalUrl, "dns_txt")}>Check DNS record</Button>
                    <Button type="button" size="sm" variant="secondary" disabled={verify.isPending} onClick={() => check(t.id, t.canonicalUrl, "http_file")}>Check file</Button>
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      <div className="flex flex-col gap-3 rounded-md border border-dashed border-border p-4">
        <p className="text-sm font-medium">Register a new target</p>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="target-url">Target URL</Label>
          <Input id="target-url" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://app.example.com" inputMode="url" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="excluded-paths">Excluded paths (optional, one per line)</Label>
          <Textarea id="excluded-paths" rows={2} value={excluded} onChange={(e) => setExcluded(e.target.value)} placeholder="/admin" />
        </div>
        <div><Button type="button" variant="secondary" size="sm" onClick={add} disabled={register.isPending || !url.trim()}>{register.isPending ? "Registering…" : "Register target"}</Button></div>
      </div>
      {msg ? <p role="status" className={cn("text-sm", msg.tone === "ok" ? "text-emerald-200" : "text-red-200")}>{msg.text}</p> : null}
    </div>
  );
}

function NewProjectForm({ onCreated }: { onCreated: (id: string) => void }) {
  const [name, setName] = useState("");
  const [environment, setEnvironment] = useState("production");
  const [error, setError] = useState<string | null>(null);
  const create = useActionMutation("create-project");

  function submit() {
    if (!name.trim()) {
      setError("Enter a project name.");
      return;
    }
    setError(null);
    create.mutate(
      { name: name.trim(), environment: environment as "production" | "staging" | "development" },
      {
        onSuccess: (row) => {
          sonnerToast.success(`Project "${row.name}" created`);
          setName("");
          onCreated(row.id);
        },
        onError: (err) => setError(err instanceof Error ? err.message : "Could not create the project."),
      },
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-dashed border-border p-4">
      <p className="text-sm font-medium">Create a new project</p>
      <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-project-name">Project name</Label>
          <Input id="new-project-name" value={name} onChange={(e) => setName(e.target.value)} aria-invalid={Boolean(error)} aria-describedby={error ? "new-project-error" : undefined} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Environment</Label>
          <Select value={environment} onValueChange={setEnvironment}>
            <SelectTrigger aria-label="Environment"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="production">Production</SelectItem>
              <SelectItem value="staging">Staging</SelectItem>
              <SelectItem value="development">Development</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      {error ? <p id="new-project-error" role="alert" className="text-sm text-red-200">{error}</p> : null}
      <div>
        <Button type="button" variant="secondary" size="sm" onClick={submit} disabled={create.isPending}>
          {create.isPending ? "Creating…" : "Create project"}
        </Button>
      </div>
    </div>
  );
}

export default function NewAssessmentRoute() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [maxReached, setMaxReached] = useState(0);
  const [state, setState] = useState<WizardState>(initialState);
  const [attempted, setAttempted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // One key per wizard session: a retried submit returns the same assessment instead of creating a duplicate.
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const projectsQuery = useActionQuery("list-projects", {});
  const projects = projectsQuery.data ?? [];
  const create = useActionMutation("create-assessment");

  const currentKey = STEPS[step].key;
  const errors = stepErrors(currentKey, state);
  const allStepsValid = STEPS.every((s) => stepErrors(s.key, state).length === 0);
  const kind = assessmentKind(state.modules);

  function update(patch: Partial<WizardState>) {
    setState((prev) => ({ ...prev, ...patch }));
  }

  function goTo(index: number) {
    setAttempted(false);
    setSubmitError(null);
    setStep(index);
    setMaxReached((m) => Math.max(m, index));
  }

  function next() {
    if (errors.length) {
      setAttempted(true);
      return;
    }
    goTo(Math.min(step + 1, STEPS.length - 1));
  }

  function toggleModule(id: string, checked: boolean) {
    update({
      modules: checked
        ? [...state.modules, id]
        : state.modules.filter((m) => m !== id),
    });
  }

  function start() {
    if (!allStepsValid || create.isPending) return;
    setSubmitError(null);
    create.mutate(
      {
        projectId: state.projectId,
        targetId: state.targetId,
        title: state.title.trim(),
        approvedScope: state.approvedScope.trim(),
        modules: state.modules,
        idempotencyKey,
        explicitConfirmation: true,
      },
      {
        onSuccess: (row) => {
          sonnerToast.success("Assessment queued");
          navigate(`/assessments/${row.id}`);
        },
        onError: (err) =>
          setSubmitError(err instanceof Error ? err.message : "The assessment could not be created. Your inputs are preserved; try again."),
      },
    );
  }

  const selectedProject = projects.find((p) => p.id === state.projectId);
  const errorId = attempted && errors.length ? "step-errors" : undefined;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="New assessment"
        description="Define what will be tested, confirm authorization, and review before anything is queued."
      />
      <ProgressSteps current={step} maxReached={maxReached} onSelect={goTo} />

      <Card className="gap-6 border-border/80 bg-card/80 p-5 sm:p-6">
        {currentKey === "project" ? (
          <section aria-labelledby="step-title" className="flex flex-col gap-4">
            <h2 id="step-title" className="text-lg font-semibold">Select a project</h2>
            {projectsQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading projects…</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                <Label>Project</Label>
                <Select value={state.projectId} onValueChange={(v) => update({ projectId: v, targetId: "", targetUrl: "" })}>
                  <SelectTrigger aria-label="Project" aria-describedby={errorId} className="max-w-md">
                    <SelectValue placeholder={projects.length ? "Choose a project" : "No projects yet"} />
                  </SelectTrigger>
                  <SelectContent>
                    {projects.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {projects.length === 0 && !projectsQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">Create your first project to continue.</p>
            ) : null}
            <NewProjectForm onCreated={(id) => update({ projectId: id, targetId: "", targetUrl: "" })} />
          </section>
        ) : null}

        {currentKey === "target" ? (
          <section aria-labelledby="step-title" className="flex flex-col gap-5">
            <h2 id="step-title" className="text-lg font-semibold">Verified target</h2>
            <div className="flex flex-col gap-1.5 md:max-w-md">
              <Label htmlFor="assessment-title">Assessment title</Label>
              <Input id="assessment-title" value={state.title} onChange={(e) => update({ title: e.target.value })} placeholder="Q4 payments API review" />
            </div>
            <TargetPicker projectId={state.projectId} selectedId={state.targetId} onSelect={(id, url) => update({ targetId: id, targetUrl: url })} />
            <p className="text-xs text-muted-foreground">
              Assessments only run against targets whose ownership was proven with a DNS record or a well-known file, and the proof expires after 90 days. A checkbox alone is never accepted.
            </p>
            <FieldError id="step-errors" messages={attempted ? errors : []} />
          </section>
        ) : null}

        {currentKey === "scope" ? (
          <section aria-labelledby="step-title" className="flex flex-col gap-4">
            <h2 id="step-title" className="text-lg font-semibold">Scope confirmation</h2>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="scope">Approved scope</Label>
              <Textarea id="scope" rows={5} value={state.approvedScope} onChange={(e) => update({ approvedScope: e.target.value })} placeholder={"api.example.com\n/v1/* endpoints only\nNo testing of third-party services"} />
              <p className="text-xs text-muted-foreground">List hostnames, paths, and exclusions. This text is stored with the assessment as the approved scope.</p>
            </div>
          </section>
        ) : null}

        {currentKey === "modules" ? (
          <section aria-labelledby="step-title" className="flex flex-col gap-4">
            <div>
              <h2 id="step-title" className="text-lg font-semibold">Assessment modules</h2>
              <p className="text-sm text-muted-foreground">Passive modules only read responses. Active modules send requests that can change test data or trigger rate limits.</p>
            </div>
            <fieldset className="grid gap-3 md:grid-cols-2">
              <legend className="sr-only">Modules</legend>
              {ASSESSMENT_MODULES.map((module) => {
                const checked = state.modules.includes(module.id);
                const inputId = `module-${module.id}`;
                return (
                  <div key={module.id} className={cn("flex items-start gap-3 rounded-md border p-4", checked ? "border-violet-300/50 bg-violet-500/5" : "border-border", !module.available && "opacity-60")}>
                    <Checkbox id={inputId} checked={checked} disabled={!module.available} onCheckedChange={(v) => toggleModule(module.id, v === true)} className="mt-0.5" />
                    <div className="flex min-w-0 flex-col gap-1">
                      <Label htmlFor={inputId} className="font-medium">{module.label}</Label>
                      <span className="text-xs text-muted-foreground">{module.description}</span>
                      <span className="mt-1 text-xs">
                        {!module.available ? (
                          <span className="font-medium text-amber-100">Not available yet</span>
                        ) : (module.kind as string) === "active" ? (
                          <span className="font-medium text-violet-200">Active: sends requests to the target</span>
                        ) : (
                          <span className="font-medium text-cyan-200">Passive: reads responses only</span>
                        )}
                      </span>
                    </div>
                  </div>
                );
              })}
            </fieldset>
            <FieldError id="step-errors" messages={attempted ? errors : []} />
          </section>
        ) : null}

        {currentKey === "safety" ? (
          <section aria-labelledby="step-title" className="flex flex-col gap-4">
            <h2 id="step-title" className="text-lg font-semibold">Safety configuration</h2>
            <div className="flex flex-col gap-2 text-sm text-muted-foreground">
              <p>Selected run type: <ModeBadge mode={kind} /></p>
              <p>
                Passive checks only observe what the target already returns. Active checks send additional requests, which can create log entries, trigger alerts, or change test data.
              </p>
            </div>
            {kind === "active" ? (
              <div className="flex items-start gap-3 rounded-md border border-violet-300/40 bg-violet-500/5 p-4">
                <Checkbox id="active-ack" checked={state.activeAcknowledged} onCheckedChange={(v) => update({ activeAcknowledged: v === true })} className="mt-0.5" />
                <Label htmlFor="active-ack" className="font-normal leading-relaxed">
                  I understand the selected active modules will send requests to the target, and I have approval to do so in the stated scope.
                </Label>
              </div>
            ) : (
              <p className="rounded-md border border-border p-4 text-sm text-muted-foreground">
                All selected modules are passive. No active requests will be sent, so no extra acknowledgement is needed.
              </p>
            )}
            <FieldError id="step-errors" messages={attempted ? errors : []} />
          </section>
        ) : null}

        {currentKey === "review" ? (
          <section aria-labelledby="step-title" className="flex flex-col gap-5">
            <h2 id="step-title" className="text-lg font-semibold">Final review</h2>
            <dl className="grid gap-4 text-sm sm:grid-cols-2">
              <div><dt className="text-muted-foreground">Project</dt><dd className="font-medium">{selectedProject?.name ?? "—"}</dd></div>
              <div><dt className="text-muted-foreground">Title</dt><dd className="font-medium">{state.title || "—"}</dd></div>
              <div><dt className="text-muted-foreground">Target</dt><dd className="break-all font-medium">{state.targetUrl || "—"}</dd></div>
              <div><dt className="text-muted-foreground">Run type</dt><dd><ModeBadge mode={kind} /></dd></div>
              <div className="sm:col-span-2"><dt className="text-muted-foreground">Approved scope</dt><dd className="whitespace-pre-line font-medium">{state.approvedScope || "—"}</dd></div>
              <div className="sm:col-span-2">
                <dt className="text-muted-foreground">Modules</dt>
                <dd className="font-medium">
                  {ASSESSMENT_MODULES.filter((m) => state.modules.includes(m.id)).map((m) => m.label).join(", ") || "—"}
                </dd>
              </div>
            </dl>
            <div className="flex items-start gap-3 rounded-md border border-border p-4">
              <Checkbox id="confirm" checked={state.confirmed} onCheckedChange={(v) => update({ confirmed: v === true })} className="mt-0.5" />
              <Label htmlFor="confirm" className="font-normal leading-relaxed">
                I confirm this assessment is authorized and matches the approved scope above. Starting it records the assessment as queued.
              </Label>
            </div>
            {submitError ? <ErrorNotice message={submitError} /> : null}
            <FieldError id="step-errors" messages={attempted ? errors : []} />
          </section>
        ) : null}
      </Card>

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
        <Button type="button" variant="ghost" onClick={() => goTo(Math.max(step - 1, 0))} disabled={step === 0}>
          Back
        </Button>
        {currentKey === "review" ? (
          <div className="flex flex-col items-stretch gap-2 sm:items-end">
            {!allStepsValid ? (
              <p className="text-xs text-muted-foreground">Complete every step and the confirmation to enable the start button.</p>
            ) : null}
            <Button type="button" onClick={start} disabled={!allStepsValid || create.isPending}>
              {create.isPending ? "Starting…" : "Start assessment"}
            </Button>
          </div>
        ) : (
          <Button type="button" onClick={next}>Next</Button>
        )}
      </div>
    </div>
  );
}
