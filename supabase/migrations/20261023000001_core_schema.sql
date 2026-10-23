-- SENTRIX V2 core schema. Every workspace-owned row carries workspace_id.
-- Cross-table integrity is enforced with composite FKs (id, workspace_id) so a row
-- can never reference a parent that belongs to another workspace.

create schema if not exists private;

create type public.workspace_role as enum ('owner','admin','analyst','developer','auditor');
create type public.assessment_status as enum ('draft','queued','running','completed','completed_with_warnings','failed','cancelled');
create type public.finding_status as enum ('open','in_progress','needs_review','false_positive','accepted_risk','fixed','retest_required','closed');
create type public.severity as enum ('critical','high','medium','low','info');

create or replace function private.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;

-- ---------- identity ----------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.workspace_role not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index on public.workspace_members (user_id);

create table public.role_permissions (
  role public.workspace_role not null,
  permission text not null,
  primary key (role, permission)
);

-- ---------- projects & targets ----------
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  description text not null default '' check (char_length(description) <= 500),
  environment text not null default 'production' check (environment in ('production','staging','development')),
  archived_at timestamptz,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id)
);
create index on public.projects (workspace_id, created_at desc);

create table public.authorized_targets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  project_id uuid not null,
  canonical_url text not null check (char_length(canonical_url) <= 2048),
  environment text not null default 'production' check (environment in ('production','staging','development')),
  verification_status text not null default 'unverified' check (verification_status in ('unverified','pending','verified','failed','expired')),
  approved_scope text not null default '',
  excluded_paths text[] not null default '{}',
  authorization_metadata jsonb not null default '{}'::jsonb,
  verified_at timestamptz,
  review_by timestamptz,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  unique (project_id, canonical_url),
  foreign key (project_id, workspace_id) references public.projects(id, workspace_id) on delete cascade,
  check (verification_status <> 'verified' or verified_at is not null)
);

create table public.target_verifications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  target_id uuid not null,
  method text not null check (method in ('dns_txt','http_file','manual_review')),
  challenge_hash text not null,           -- hash only; raw token is shown once to the user
  status text not null default 'pending' check (status in ('pending','verified','failed','expired')),
  evidence jsonb not null default '{}'::jsonb,
  checked_at timestamptz,
  expires_at timestamptz not null default (now() + interval '7 days'),
  created_at timestamptz not null default now(),
  foreign key (target_id, workspace_id) references public.authorized_targets(id, workspace_id) on delete cascade
);
create index on public.target_verifications (target_id);

-- ---------- assessments ----------
create table public.assessments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  project_id uuid not null,
  target_id uuid,
  title text not null check (char_length(title) between 1 and 160),
  mode text not null default 'passive' check (mode in ('passive','active')),
  status public.assessment_status not null default 'draft',
  approved_scope text not null default '',
  idempotency_key text,
  confirmed_by uuid references auth.users(id) on delete restrict,
  confirmed_at timestamptz,
  created_by uuid not null references auth.users(id) on delete restrict,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  unique (workspace_id, idempotency_key),
  foreign key (project_id, workspace_id) references public.projects(id, workspace_id) on delete restrict,
  foreign key (target_id, workspace_id) references public.authorized_targets(id, workspace_id) on delete restrict,
  check (status = 'draft' or (confirmed_by is not null and confirmed_at is not null))
);
create index on public.assessments (workspace_id, status);
create index on public.assessments (project_id, created_at desc);

create table public.assessment_modules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  assessment_id uuid not null,
  module_id text not null,
  kind text not null check (kind in ('passive','active')),
  status text not null default 'pending' check (status in ('pending','running','completed','skipped','failed')),
  skip_reason text,
  started_at timestamptz,
  finished_at timestamptz,
  unique (assessment_id, module_id),
  foreign key (assessment_id, workspace_id) references public.assessments(id, workspace_id) on delete cascade
);

create table public.assessment_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  assessment_id uuid not null,
  status text not null default 'queued' check (status in ('queued','claimed','running','succeeded','failed','cancelled')),
  attempts int not null default 0 check (attempts >= 0),
  max_attempts int not null default 3 check (max_attempts between 1 and 10),
  locked_by text,
  locked_until timestamptz,
  run_after timestamptz not null default now(),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (assessment_id),
  foreign key (assessment_id, workspace_id) references public.assessments(id, workspace_id) on delete cascade
);
create index on public.assessment_jobs (status, run_after);

create table public.assets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  project_id uuid not null,
  kind text not null check (kind in ('host','url','repository','dependency_manifest')),
  identifier text not null,
  created_at timestamptz not null default now(),
  unique (project_id, kind, identifier),
  foreign key (project_id, workspace_id) references public.projects(id, workspace_id) on delete cascade
);

-- ---------- findings ----------
create table public.findings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  project_id uuid not null,
  assessment_id uuid,
  asset_id uuid references public.assets(id) on delete set null,
  fingerprint text not null,              -- dedupe key: module + rule + asset + location
  module_id text not null,
  rule_id text not null,
  title text not null check (char_length(title) between 1 and 300),
  severity public.severity not null,
  confidence text not null default 'medium' check (confidence in ('high','medium','low')),
  verification text not null default 'unverified_observation' check (verification in ('confirmed','unverified_observation')),
  status public.finding_status not null default 'open',
  affected_asset text not null,
  owner_user_id uuid references auth.users(id) on delete set null,
  description text not null default '',
  impact text not null default '',
  remediation text not null default '',
  reference_links text[] not null default '{}',
  cvss_vector text,
  cvss_score numeric(3,1) check (cvss_score between 0 and 10),
  is_demo boolean not null default false,  -- seed data is always flagged
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  unique (project_id, fingerprint),
  foreign key (project_id, workspace_id) references public.projects(id, workspace_id) on delete cascade,
  foreign key (assessment_id, workspace_id) references public.assessments(id, workspace_id) on delete set null (assessment_id)
);
create index on public.findings (workspace_id, severity, status);
create index on public.findings (project_id, status);
create index on public.findings (assessment_id);

create table public.finding_evidence (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  finding_id uuid not null,
  kind text not null check (kind in ('http_exchange','header','certificate','code_snippet','file')),
  content jsonb not null default '{}'::jsonb,   -- bounded + redacted by the worker
  storage_path text,
  created_at timestamptz not null default now(),
  foreign key (finding_id, workspace_id) references public.findings(id, workspace_id) on delete cascade
);
create index on public.finding_evidence (finding_id);

create table public.remediation_tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  finding_id uuid not null,
  assignee_id uuid references auth.users(id) on delete set null,
  priority text not null default 'medium' check (priority in ('low','medium','high','urgent')),
  status text not null default 'open' check (status in ('open','in_progress','fix_submitted','approved','rejected')),
  due_date date,
  notes text not null default '',
  fix_evidence text not null default '',
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  foreign key (finding_id, workspace_id) references public.findings(id, workspace_id) on delete cascade
);
create index on public.remediation_tasks (finding_id);

create table public.retests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  finding_id uuid not null,
  task_id uuid,
  requested_by uuid not null references auth.users(id) on delete restrict,
  outcome text check (outcome in ('fixed','partially_fixed','still_vulnerable','unable_to_verify')),
  notes text not null default '',
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (finding_id, workspace_id) references public.findings(id, workspace_id) on delete cascade,
  foreign key (task_id, workspace_id) references public.remediation_tasks(id, workspace_id) on delete set null (task_id),
  check (outcome is null or completed_at is not null)
);

-- ---------- reports, logs, misc ----------
create table public.reports (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  assessment_id uuid not null,
  format text not null check (format in ('pdf','json','csv')),
  storage_path text not null,
  sha256 text,
  generated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (assessment_id, workspace_id) references public.assessments(id, workspace_id) on delete cascade
);

create table public.activity_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  kind text not null,
  message text not null,
  assessment_id uuid,
  finding_id uuid,
  created_at timestamptz not null default now()
);
create index on public.activity_events (workspace_id, created_at desc);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  workspace_id uuid references public.workspaces(id) on delete set null,
  actor_id uuid,
  action text not null,
  entity text not null,
  entity_id text,
  details jsonb not null default '{}'::jsonb,  -- ids and changed column names only; never secrets
  created_at timestamptz not null default now()
);
create index on public.audit_logs (workspace_id, created_at desc);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  body text not null default '',
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.notifications (user_id, created_at desc);

create table public.scheduled_assessments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  project_id uuid not null,
  target_id uuid not null,
  cron text not null check (char_length(cron) <= 100),
  modules text[] not null,
  enabled boolean not null default false,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key (project_id, workspace_id) references public.projects(id, workspace_id) on delete cascade,
  foreign key (target_id, workspace_id) references public.authorized_targets(id, workspace_id) on delete cascade
);

create table public.integrations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  provider text not null,
  config jsonb not null default '{}'::jsonb,   -- non-secret config only
  secret_ref text,                             -- reference to Supabase Vault; never the secret itself
  enabled boolean not null default false,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, provider)
);

-- updated_at triggers
do $$ declare t text; begin
  foreach t in array array['profiles','workspaces','projects','authorized_targets','assessments','assessment_jobs','findings','remediation_tasks','integrations'] loop
    execute format('create trigger touch_%1$s before update on public.%1$s for each row execute function private.touch_updated_at()', t);
  end loop; end $$;
