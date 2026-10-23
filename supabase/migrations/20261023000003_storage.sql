-- Private buckets; object path convention: <workspace_id>/<random uuid>.<ext>.
-- NOT yet exercised by automated tests (needs a real Supabase storage schema).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
 ('reports','reports',false, 26214400, array['application/pdf','application/json','text/csv']),
 ('evidence','evidence',false, 10485760, array['application/json','text/plain','image/png']),
 ('artifacts','artifacts',false, 52428800, array['application/zip','application/json'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy reports_obj_read on storage.objects for select to authenticated using (
  bucket_id = 'reports' and private.has_permission(((storage.foldername(name))[1])::uuid, 'reports.export'));
create policy evidence_obj_read on storage.objects for select to authenticated using (
  bucket_id = 'evidence' and private.has_permission(((storage.foldername(name))[1])::uuid, 'evidence.view'));
create policy artifacts_obj_read on storage.objects for select to authenticated using (
  bucket_id = 'artifacts' and private.has_permission(((storage.foldername(name))[1])::uuid, 'assessments.start'));
-- Uploads/writes: service role only (server generates the unpredictable object name after validating type and size).
