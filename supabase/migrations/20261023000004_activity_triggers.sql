-- Activity timeline is written by trusted triggers (users have no INSERT policy on activity_events).
create or replace function private.log_activity() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'findings' then
    if tg_op = 'INSERT' then
      insert into public.activity_events (workspace_id, actor_id, kind, message, assessment_id, finding_id)
      values (new.workspace_id, (select auth.uid()), 'finding', 'New finding: ' || new.title, new.assessment_id, new.id);
    elsif new.status is distinct from old.status then
      insert into public.activity_events (workspace_id, actor_id, kind, message, assessment_id, finding_id)
      values (new.workspace_id, (select auth.uid()), 'finding',
              'Status changed from ' || old.status::text || ' to ' || new.status::text || ': ' || new.title, new.assessment_id, new.id);
    end if;
  elsif tg_table_name = 'assessments' then
    if tg_op = 'INSERT' then
      insert into public.activity_events (workspace_id, actor_id, kind, message, assessment_id)
      values (new.workspace_id, (select auth.uid()), 'assessment', 'Assessment "' || new.title || '" created', new.id);
    elsif new.status is distinct from old.status then
      insert into public.activity_events (workspace_id, actor_id, kind, message, assessment_id)
      values (new.workspace_id, (select auth.uid()), 'assessment', 'Assessment "' || new.title || '" ' || replace(new.status::text, '_', ' '), new.id);
    end if;
  end if;
  return null;
end $$;
revoke all on function private.log_activity() from public;

create trigger log_activity_findings after insert or update on public.findings for each row execute function private.log_activity();
create trigger log_activity_assessments after insert or update on public.assessments for each row execute function private.log_activity();
