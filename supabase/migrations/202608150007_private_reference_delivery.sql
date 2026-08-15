-- Revoke permanent public Storage URLs for workshop reference files.
--
-- Anonymous uploads remain capability-scoped by migration 003. Reads now go
-- through the `workshop-reference-access` Edge Function, which calls the
-- service-role-only RPC below before streaming a private object. Public reads
-- are allowed only while both the response and reference are presentation
-- visible; administrators must supply the existing raw admin capability.

update storage.buckets
set public = false
where id = 'workshop-references';

-- Defense in depth: private delivery uses the Edge Function's service role and
-- must not acquire a direct browser SELECT policy later by accident.
drop policy if exists "Workshop reference files are publicly readable"
  on storage.objects;
drop policy if exists "Workshop reference files are anonymously readable"
  on storage.objects;

create or replace function public.workshop_reference_access(
  p_reference_id uuid,
  p_capability text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  reference_id uuid;
  object_path text;
  file_name text;
  mime_type text;
  size_bytes bigint;
  reference_is_visible boolean;
  response_status text;
  response_is_visible boolean;
  is_admin boolean := p_capability is not null;
begin
  if p_reference_id is null then
    raise exception using
      errcode = '22023',
      message = 'Reference ID is required.';
  end if;

  if is_admin then
    perform workshop_private.require_admin_capability(p_capability);
  end if;

  select
    stored_reference.id,
    stored_reference.object_path,
    stored_reference.file_name,
    stored_reference.mime_type,
    stored_reference.size_bytes,
    stored_reference.is_visible,
    submission.status,
    submission.is_visible
  into
    reference_id,
    object_path,
    file_name,
    mime_type,
    size_bytes,
    reference_is_visible,
    response_status,
    response_is_visible
  from public.workshop_submission_references as stored_reference
  join public.workshop_submissions as submission
    on submission.id = stored_reference.submission_id
  where stored_reference.id = p_reference_id
    and stored_reference.kind <> 'link'
    and stored_reference.object_path is not null;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'Reference file not found.';
  end if;

  if not is_admin and not (
    reference_is_visible = true
    and response_status = 'approved'
    and response_is_visible = true
  ) then
    raise exception using
      errcode = '42501',
      message = 'Reference file is not available.';
  end if;

  return pg_catalog.jsonb_build_object(
    'referenceId', reference_id,
    'objectPath', object_path,
    'fileName', file_name,
    'mimeType', mime_type,
    'sizeBytes', size_bytes
  );
end;
$function$;

revoke all on function public.workshop_reference_access(uuid, text)
  from public, anon, authenticated;
grant execute on function public.workshop_reference_access(uuid, text)
  to service_role;

comment on function public.workshop_reference_access(uuid, text) is
  'Authorizes private reference delivery for approved public media or a valid admin capability; callable only by the server-side Edge Function.';

notify pgrst, 'reload schema';
