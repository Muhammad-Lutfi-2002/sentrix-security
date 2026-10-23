-- Permissions, RLS, trusted workflows (RPC), transition guards, audit triggers.

insert into public.role_permissions (role, permission) values
 ('owner','projects.read'),('owner','projects.write'),('owner','projects.delete'),('owner','targets.manage'),
 ('owner','assessments.read'),('owner','assessments.start'),('owner','assessments.cancel'),
 ('owner','evidence.view'),('owner','findings.read'),('owner','findings.update'),('owner','remediation.approve'),
 ('owner','reports.export'),('owner','members.manage'),('owner','integrations.manage'),('owner','audit.read'),
 ('admin','projects.read'),('admin','projects.write'),('admin','projects.delete'),('admin','targets.manage'),
 ('admin','assessments.read'),('admin','assessments.start'),('admin','assessments.cancel'),
 ('admin','evidence.view'),('admin','findings.read'),('admin','findings.update'),('admin','remediation.approve'),
 ('admin','reports.export'),('admin','members.manage'),('admin','integrations.manage'),('admin','audit.read'),
 ('analyst','projects.read'),('analyst','projects.write'),('analyst','targets.manage'),
 ('analyst','assessments.read'),('analyst','assessments.start'),('analyst','assessments.cancel'),
 ('analyst','evidence.view'),('analyst','findings.read'),('analyst','findings.update'),('analyst','remediation.approve'),
 ('analyst','reports.export'),
 ('developer','projects.read'),('developer','assessments.read'),('developer','findings.read'),
 ('developer','findings.update'),('developer','evidence.view'),
 ('auditor','projects.read'),('auditor','assessments.read'),('auditor','findings.read'),
 ('auditor','reports.export'),('auditor','audit.read');

-- ---------- helpers (security definer, fixed search_path) ----------
create or replace function private.is_member(ws uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.workspace_members m where m.workspace_id = ws and m.user_id = (select auth.uid()));
$$;

create or replace function private.has_permission(ws uuid, perm text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.workspace_members m
    join public.role_permissions p on p.role = m.role
    where m.workspace_id = ws and m.user_id = (select auth.uid()) and p.permission = perm);
$$;

create or replace function private.is_service() returns boolean
language sql stable set search_path = '' as $$
  select coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role'
      or current_user in ('postgres','service_role','supabase_admin');
$$;

create or replace function private.write_audit(ws uuid, act text, ent text, ent_id text, det jsonb default '{}')
returns void language sql security definer set search_path = '' as $$
  insert into public.audit_logs (workspace_id, actor_id, action, entity, entity_id, details)
  values (ws, (select auth.uid()), act, ent, ent_id, det);
$$;

revoke all on function private.write_audit(uuid,text,text,text,jsonb) from public;
revoke all on schema private from public;
grant usage on schema private to authenticated, anon, service_role;
grant execute on function private.is_member(uuid), private.has_permission(uuid,text), private.is_service() to authenticated, service_role;

-- ---------- trusted workflows ----------
create or replace function public.create_workspace(p_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); ws uuid;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  insert into public.workspaces (name, created_by) values (p_name, uid) returning id into ws;
  insert into public.workspace_members (workspace_id, user_id, role) values (ws, uid, 'owner');
  perform private.write_audit(ws, 'workspace.create', 'workspace', ws::text);
  return ws;
end $$;

create or replace function public.set_member_role(p_ws uuid, p_user uuid, p_role public.workspace_role)
returns void language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); caller public.workspace_role; target public.workspace_role;
begin
  if not private.has_permission(p_ws, 'members.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  select role into caller from public.workspace_members where workspace_id = p_ws and user_id = uid;
  select role into target from public.workspace_members where workspace_id = p_ws and user_id = p_user;
  if p_user = uid then raise exception 'cannot change your own role' using errcode = '42501'; end if;
  if target is null then raise exception 'not a member' using errcode = 'P0002'; end if;
  if (p_role = 'owner' or target = 'owner') and caller <> 'owner' then
    raise exception 'only an owner can grant or change owner' using errcode = '42501'; end if;
  update public.workspace_members set role = p_role where workspace_id = p_ws and user_id = p_user;
  perform private.write_audit(p_ws, 'member.role_change', 'workspace_member', p_user::text, jsonb_build_object('from', target, 'to', p_role));
end $$;

create or replace function public.add_workspace_member(p_ws uuid, p_user uuid, p_role public.workspace_role)
returns void language plpgsql security definer set search_path = '' as $$
declare caller public.workspace_role;
begin
  if not private.has_permission(p_ws, 'members.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  select role into caller from public.workspace_members where workspace_id = p_ws and user_id = (select auth.uid());
  if p_role = 'owner' and caller <> 'owner' then raise exception 'only an owner can add an owner' using errcode = '42501'; end if;
  insert into public.workspace_members (workspace_id, user_id, role) values (p_ws, p_user, p_role);
  perform private.write_audit(p_ws, 'member.add', 'workspace_member', p_user::text, jsonb_build_object('role', p_role));
end $$;

create or replace function public.remove_workspace_member(p_ws uuid, p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare target public.workspace_role; caller public.workspace_role;
begin
  if not private.has_permission(p_ws, 'members.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  select role into caller from public.workspace_members where workspace_id = p_ws and user_id = (select auth.uid());
  select role into target from public.workspace_members where workspace_id = p_ws and user_id = p_user;
  if target = 'owner' and (caller <> 'owner'
     or (select count(*) from public.workspace_members where workspace_id = p_ws and role = 'owner') < 2) then
    raise exception 'cannot remove the last owner or an owner as non-owner' using errcode = '42501'; end if;
  delete from public.workspace_members where workspace_id = p_ws and user_id = p_user;
  perform private.write_audit(p_ws, 'member.remove', 'workspace_member', p_user::text);
end $$;

revoke all on function public.create_workspace(text), public.set_member_role(uuid,uuid,public.workspace_role),
  public.add_workspace_member(uuid,uuid,public.workspace_role), public.remove_workspace_member(uuid,uuid) from public, anon;
grant execute on function public.create_workspace(text), public.set_member_role(uuid,uuid,public.workspace_role),
  public.add_workspace_member(uuid,uuid,public.workspace_role), public.remove_workspace_member(uuid,uuid) to authenticated;

-- ---------- guards ----------
-- workspace_id / created_by are immutable for ordinary callers.
create or replace function private.immutable_ownership() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.workspace_id is distinct from old.workspace_id then raise exception 'workspace_id is immutable' using errcode='42501'; end if;
  return new;
end $$;

create or replace function private.guard_assessment() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare svc boolean := private.is_service();
begin
  if tg_op = 'INSERT' then
    if not svc and new.status <> 'draft' then raise exception 'assessments must be created as draft' using errcode='42501'; end if;
    return new;
  end if;
  if new.status = old.status then
    if not svc and (new.approved_scope is distinct from old.approved_scope or new.mode is distinct from old.mode
       or new.target_id is distinct from old.target_id) and old.status <> 'draft' then
      raise exception 'scope is frozen after queueing' using errcode='42501'; end if;
    return new;
  end if;
  if not ((old.status, new.status) in (
      ('draft','queued'),('draft','cancelled'),('queued','running'),('queued','cancelled'),
      ('running','completed'),('running','completed_with_warnings'),('running','failed'),('running','cancelled'),
      ('failed','queued'))) then
    raise exception 'invalid assessment transition % -> %', old.status, new.status using errcode='23514'; end if;
  if not svc then
    if new.status = 'queued' and old.status = 'draft' then
      if not private.has_permission(new.workspace_id,'assessments.start') then raise exception 'forbidden' using errcode='42501'; end if;
      if new.target_id is null or not exists (select 1 from public.authorized_targets t where t.id = new.target_id
          and t.verification_status = 'verified' and (t.review_by is null or t.review_by > now())) then
        raise exception 'target is not verified' using errcode='23514'; end if;
      new.confirmed_by := (select auth.uid()); new.confirmed_at := now();
    elsif new.status = 'cancelled' then
      if not private.has_permission(new.workspace_id,'assessments.cancel') then raise exception 'forbidden' using errcode='42501'; end if;
    else
      raise exception 'only the worker may set status %', new.status using errcode='42501';
    end if;
  end if;
  if new.status in ('completed','completed_with_warnings','failed','cancelled') then new.finished_at := now(); end if;
  if new.status = 'running' then new.started_at := now(); end if;
  return new;
end $$;
create trigger guard_assessment before insert or update on public.assessments for each row execute function private.guard_assessment();

-- enqueue a job when an assessment is queued (idempotent via unique(assessment_id))
create or replace function private.enqueue_job() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'queued' and old.status in ('draft','failed') then
    insert into public.assessment_jobs (workspace_id, assessment_id) values (new.workspace_id, new.id)
    on conflict (assessment_id) do update set status='queued', attempts=0, run_after=now(), last_error=null;
  elsif new.status = 'cancelled' then
    update public.assessment_jobs set status='cancelled' where assessment_id = new.id and status in ('queued','claimed','running');
  end if;
  return new;
end $$;
create trigger enqueue_job after update of status on public.assessments for each row execute function private.enqueue_job();

create or replace function private.guard_finding() returns trigger
language plpgsql set search_path = '' as $$
begin
  if private.is_service() then return new; end if;
  if (new.severity, new.fingerprint, new.title, new.module_id, new.rule_id, new.project_id, new.assessment_id, new.verification, new.is_demo)
     is distinct from (old.severity, old.fingerprint, old.title, old.module_id, old.rule_id, old.project_id, old.assessment_id, old.verification, old.is_demo) then
    raise exception 'scanner-owned finding fields are read-only' using errcode='42501'; end if;
  if new.status is distinct from old.status then
    if new.status = 'closed' and old.status <> 'fixed' and old.status <> 'false_positive' and old.status <> 'accepted_risk' then
      raise exception 'finding must be fixed (with a passing retest) before closing' using errcode='23514'; end if;
    if new.status = 'closed' and old.status = 'fixed' and not exists (
        select 1 from public.retests r where r.finding_id = new.id and r.outcome = 'fixed') then
      raise exception 'closing a fixed finding requires a retest with outcome fixed' using errcode='23514'; end if;
    if new.status in ('accepted_risk','closed') and not private.has_permission(new.workspace_id,'remediation.approve') then
      raise exception 'approval permission required' using errcode='42501'; end if;
  end if;
  return new;
end $$;
create trigger guard_finding before update on public.findings for each row execute function private.guard_finding();

create trigger immutable_ws_projects before update on public.projects for each row execute function private.immutable_ownership();
create trigger immutable_ws_targets before update on public.authorized_targets for each row execute function private.immutable_ownership();
create trigger immutable_ws_assessments before update on public.assessments for each row execute function private.immutable_ownership();
create trigger immutable_ws_findings before update on public.findings for each row execute function private.immutable_ownership();

-- target verification state is worker-owned
create or replace function private.guard_target() returns trigger
language plpgsql set search_path = '' as $$
begin
  if private.is_service() then return new; end if;
  if tg_op = 'INSERT' then
    if new.verification_status <> 'unverified' or new.verified_at is not null then
      raise exception 'verification is set by the verification worker' using errcode='42501'; end if;
  elsif new.verification_status is distinct from old.verification_status or new.verified_at is distinct from old.verified_at
     or (new.canonical_url is distinct from old.canonical_url) then
    raise exception 'verification fields and URL are read-only; re-register the target' using errcode='42501'; end if;
  return new;
end $$;
create trigger guard_target before insert or update on public.authorized_targets for each row execute function private.guard_target();

-- audit triggers: record ids + changed column names only
create or replace function private.audit_row() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r jsonb := to_jsonb(coalesce(new, old)); old_j jsonb := case when tg_op='UPDATE' then to_jsonb(old) end;
        changed text[];
begin
  if tg_op = 'UPDATE' then
    select coalesce(array_agg(k), '{}') into changed from jsonb_object_keys(r) k where r->k is distinct from old_j->k and k <> 'updated_at';
  end if;
  insert into public.audit_logs (workspace_id, actor_id, action, entity, entity_id, details)
  values ((r->>'workspace_id')::uuid, (select auth.uid()), tg_table_name || '.' || lower(tg_op), tg_table_name, r->>'id',
          jsonb_build_object('changed', coalesce(changed, '{}')));
  return coalesce(new, old);
end $$;
do $$ declare t text; begin
  foreach t in array array['projects','authorized_targets','assessments','findings','integrations','remediation_tasks','retests','reports'] loop
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$s for each row execute function private.audit_row()', t);
  end loop; end $$;

-- ---------- RLS ----------
do $$ declare t text; begin
  foreach t in array array['profiles','workspaces','workspace_members','role_permissions','projects','authorized_targets',
    'target_verifications','assessments','assessment_modules','assessment_jobs','assets','findings','finding_evidence',
    'remediation_tasks','retests','reports','activity_events','audit_logs','notifications','scheduled_assessments','integrations'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
  end loop; end $$;

revoke all on all tables in schema public from anon, authenticated;
grant select on all tables in schema public to authenticated;
grant insert, update, delete on public.projects, public.authorized_targets, public.assessments, public.findings,
  public.remediation_tasks, public.retests, public.notifications, public.profiles, public.workspaces,
  public.scheduled_assessments, public.integrations, public.assessment_modules to authenticated;
grant usage on all sequences in schema public to authenticated;

create policy profiles_read on public.profiles for select to authenticated using (
  id = (select auth.uid()) or exists (select 1 from public.workspace_members a join public.workspace_members b
    on a.workspace_id = b.workspace_id where a.user_id = (select auth.uid()) and b.user_id = profiles.id));
create policy profiles_insert on public.profiles for insert to authenticated with check (id = (select auth.uid()));
create policy profiles_update on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy ws_read on public.workspaces for select to authenticated using (private.is_member(id));
create policy ws_update on public.workspaces for update to authenticated
  using (private.has_permission(id,'members.manage')) with check (private.has_permission(id,'members.manage'));
-- no INSERT/DELETE policy on workspaces; no write policy at all on workspace_members: use RPCs.

create policy members_read on public.workspace_members for select to authenticated using (private.is_member(workspace_id));
create policy perms_read on public.role_permissions for select to authenticated using (true);  -- static, non-sensitive reference data

create policy projects_read on public.projects for select to authenticated using (private.has_permission(workspace_id,'projects.read'));
create policy projects_ins on public.projects for insert to authenticated with check (private.has_permission(workspace_id,'projects.write') and created_by = (select auth.uid()));
create policy projects_upd on public.projects for update to authenticated using (private.has_permission(workspace_id,'projects.write')) with check (private.has_permission(workspace_id,'projects.write'));
create policy projects_del on public.projects for delete to authenticated using (private.has_permission(workspace_id,'projects.delete'));

create policy targets_read on public.authorized_targets for select to authenticated using (private.has_permission(workspace_id,'projects.read'));
create policy targets_ins on public.authorized_targets for insert to authenticated with check (private.has_permission(workspace_id,'targets.manage') and created_by = (select auth.uid()));
create policy targets_upd on public.authorized_targets for update to authenticated using (private.has_permission(workspace_id,'targets.manage')) with check (private.has_permission(workspace_id,'targets.manage'));
create policy targets_del on public.authorized_targets for delete to authenticated using (private.has_permission(workspace_id,'targets.manage'));
create policy tverif_read on public.target_verifications for select to authenticated using (private.has_permission(workspace_id,'targets.manage'));

create policy assess_read on public.assessments for select to authenticated using (private.has_permission(workspace_id,'assessments.read'));
create policy assess_ins on public.assessments for insert to authenticated with check (private.has_permission(workspace_id,'assessments.start') and created_by = (select auth.uid()));
create policy assess_upd on public.assessments for update to authenticated
  using (private.has_permission(workspace_id,'assessments.start') or private.has_permission(workspace_id,'assessments.cancel'))
  with check (private.has_permission(workspace_id,'assessments.start') or private.has_permission(workspace_id,'assessments.cancel'));
create policy amod_read on public.assessment_modules for select to authenticated using (private.has_permission(workspace_id,'assessments.read'));
create policy amod_ins on public.assessment_modules for insert to authenticated with check (private.has_permission(workspace_id,'assessments.start')
  and exists (select 1 from public.assessments a where a.id = assessment_id and a.status = 'draft'));
-- assessment_jobs: restricted metadata, only those who can start assessments may read; writes are service/trigger only
create policy jobs_read on public.assessment_jobs for select to authenticated using (private.has_permission(workspace_id,'assessments.start'));
create policy assets_read on public.assets for select to authenticated using (private.has_permission(workspace_id,'projects.read'));

create policy findings_read on public.findings for select to authenticated using (private.has_permission(workspace_id,'findings.read'));
create policy findings_upd on public.findings for update to authenticated using (private.has_permission(workspace_id,'findings.update')) with check (private.has_permission(workspace_id,'findings.update'));
create policy evidence_read on public.finding_evidence for select to authenticated using (private.has_permission(workspace_id,'evidence.view'));

create policy rem_read on public.remediation_tasks for select to authenticated using (private.has_permission(workspace_id,'findings.read'));
create policy rem_ins on public.remediation_tasks for insert to authenticated with check (private.has_permission(workspace_id,'findings.update'));
create policy rem_upd on public.remediation_tasks for update to authenticated using (private.has_permission(workspace_id,'findings.update')) with check (private.has_permission(workspace_id,'findings.update'));
create policy retests_read on public.retests for select to authenticated using (private.has_permission(workspace_id,'findings.read'));
create policy retests_ins on public.retests for insert to authenticated with check (private.has_permission(workspace_id,'findings.update') and requested_by = (select auth.uid()));

create policy reports_read on public.reports for select to authenticated using (private.has_permission(workspace_id,'reports.export'));
create policy activity_read on public.activity_events for select to authenticated using (private.is_member(workspace_id));
create policy audit_read on public.audit_logs for select to authenticated using (workspace_id is not null and private.has_permission(workspace_id,'audit.read'));
create policy notif_read on public.notifications for select to authenticated using (user_id = (select auth.uid()) and private.is_member(workspace_id));
create policy notif_upd on public.notifications for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy sched_read on public.scheduled_assessments for select to authenticated using (private.has_permission(workspace_id,'assessments.read'));
create policy sched_write on public.scheduled_assessments for all to authenticated using (private.has_permission(workspace_id,'assessments.start')) with check (private.has_permission(workspace_id,'assessments.start') and created_by = (select auth.uid()));
create policy integ_all on public.integrations for all to authenticated using (private.has_permission(workspace_id,'integrations.manage')) with check (private.has_permission(workspace_id,'integrations.manage') and created_by = (select auth.uid()));

-- tighten grants: tables that clients must never write directly
revoke insert, update, delete on public.workspaces from authenticated;
grant update (name) on public.workspaces to authenticated;
revoke insert, update, delete on public.findings from authenticated;
grant update (status, owner_user_id) on public.findings to authenticated;
revoke delete on public.assessments, public.retests from authenticated;
