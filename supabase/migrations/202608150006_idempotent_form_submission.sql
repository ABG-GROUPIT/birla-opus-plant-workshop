-- Make browser form retries idempotent without changing the legacy submit RPC.
-- Apply after 202607160005_excel_batch_import.sql.

alter table public.workshop_submissions
  add column if not exists client_submission_id uuid,
  add column if not exists client_payload_sha256 text;

create unique index if not exists workshop_submissions_client_submission_id_uidx
  on public.workshop_submissions (client_submission_id)
  where client_submission_id is not null;

do $migration$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.workshop_submissions'::regclass
      and conname = 'workshop_submissions_client_payload_sha256_check'
  ) then
    alter table public.workshop_submissions
      add constraint workshop_submissions_client_payload_sha256_check
      check (
        client_payload_sha256 is null
        or client_payload_sha256 ~ '^[0-9a-f]{64}$'
      ) not valid;
  end if;
end;
$migration$;

alter table public.workshop_submissions
  validate constraint workshop_submissions_client_payload_sha256_check;

create or replace function public.workshop_submit_single_use_case_idempotent(
  p_client_submission_id uuid,
  p_plant text,
  p_submitter_name text,
  p_submitter_email text,
  p_designation text,
  p_use_case_title text,
  p_use_case_theme text,
  p_value_stream text,
  p_expected_benefits text,
  p_media_session_id uuid,
  p_media_upload_token text,
  p_references jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  canonical_references jsonb := coalesce(p_references, '[]'::jsonb);
  legacy_result jsonb;
  new_submission_id uuid;
  payload_sha256 text;
  submission public.workshop_submissions%rowtype;
begin
  if p_client_submission_id is null then
    raise exception using
      errcode = '22023',
      message = 'A client submission id is required.';
  end if;

  -- Serialize concurrent requests for the same unguessable client key. The lock
  -- is transaction-scoped and prevents a race from creating two rows.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_client_submission_id::text, 0)
  );

  payload_sha256 := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        pg_catalog.jsonb_build_object(
          'plant', btrim(coalesce(p_plant, '')),
          'submitterName', btrim(coalesce(p_submitter_name, '')),
          'submitterEmail', lower(btrim(coalesce(p_submitter_email, ''))),
          'designation', btrim(coalesce(p_designation, '')),
          'useCaseTitle', btrim(coalesce(p_use_case_title, '')),
          'useCaseTheme', btrim(coalesce(p_use_case_theme, '')),
          'valueStream', btrim(coalesce(p_value_stream, '')),
          'expectedBenefits', btrim(coalesce(p_expected_benefits, '')),
          'references', canonical_references
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  select response.*
  into submission
  from public.workshop_submissions as response
  where response.client_submission_id = p_client_submission_id;

  if found then
    if submission.client_payload_sha256 is distinct from payload_sha256 then
      raise exception using
        errcode = '23505',
        message = 'This submission retry key was already used for different content.';
    end if;

    return pg_catalog.jsonb_build_object(
      'submission', workshop_private.submission_json(submission)
    );
  end if;

  perform workshop_private.validate_single_use_case_input(
    p_plant,
    p_submitter_name,
    p_submitter_email,
    p_designation,
    p_use_case_title,
    p_use_case_theme,
    p_value_stream,
    p_expected_benefits,
    true
  );

  legacy_result := public.workshop_submit_with_references(
    p_plant,
    p_submitter_name,
    p_submitter_email,
    p_designation,
    array[btrim(p_use_case_theme), '', '', '']::text[],
    p_value_stream,
    p_expected_benefits,
    p_media_session_id,
    p_media_upload_token,
    canonical_references
  );
  new_submission_id := (legacy_result -> 'submission' ->> 'id')::uuid;

  update public.workshop_submissions as response
  set
    use_case_title = btrim(p_use_case_title),
    use_case_theme = btrim(p_use_case_theme),
    client_submission_id = p_client_submission_id,
    client_payload_sha256 = payload_sha256
  where response.id = new_submission_id
  returning response.* into submission;

  return pg_catalog.jsonb_build_object(
    'submission', workshop_private.submission_json(submission)
  );
end;
$function$;

revoke all on function public.workshop_submit_single_use_case_idempotent(
  uuid, text, text, text, text, text, text, text, text, uuid, text, jsonb
) from public, anon, authenticated, service_role;

grant execute on function public.workshop_submit_single_use_case_idempotent(
  uuid, text, text, text, text, text, text, text, text, uuid, text, jsonb
) to anon;

comment on function public.workshop_submit_single_use_case_idempotent(
  uuid, text, text, text, text, text, text, text, text, uuid, text, jsonb
) is
  'Submits one response exactly once for an unguessable client retry key; an exact replay returns the original row.';

notify pgrst, 'reload schema';
