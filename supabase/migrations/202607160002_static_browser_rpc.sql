-- Browser-safe Data API boundary for the static GitHub Pages deployment.
--
-- The anon role can execute only the four public RPCs below. Direct table
-- access stays revoked and RLS-protected. The admin URL carries a 256-bit
-- capability; only its SHA-256 digest is stored in the database.

create extension if not exists pgcrypto with schema extensions;

create schema if not exists workshop_private;
revoke all on schema workshop_private from public, anon, authenticated;

create table if not exists workshop_private.admin_capabilities (
  token_hash bytea primary key,
  label text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  constraint admin_capabilities_token_hash_length_check
    check (octet_length(token_hash) = 32)
);

alter table workshop_private.admin_capabilities enable row level security;
revoke all on table workshop_private.admin_capabilities
  from public, anon, authenticated, service_role;

-- The raw capability is deliberately not present in this migration.
insert into workshop_private.admin_capabilities (token_hash, label)
values (
  pg_catalog.decode(
    'c9f1d166af09bc31bc6987084b55ca2833d09c21b839e05d89bb97fbacacc11c',
    'hex'
  ),
  'Primary workshop admin URL'
)
on conflict (token_hash) do nothing;

-- Preserve existing records while enforcing the application limits on every
-- new or changed record. NOT VALID deliberately avoids rejecting the migration
-- if an older server/API version previously stored an overlong value.
do $constraints$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.workshop_submissions'::pg_catalog.regclass
      and conname = 'workshop_submissions_input_lengths_check'
  ) then
    alter table public.workshop_submissions
      add constraint workshop_submissions_input_lengths_check check (
        char_length(btrim(submitter_name)) <= 120
        and char_length(btrim(submitter_email)) <= 254
        and char_length(btrim(designation)) <= 160
        and char_length(btrim(use_case_1)) <= 2000
        and char_length(btrim(use_case_2)) <= 2000
        and char_length(btrim(use_case_3)) <= 2000
        and char_length(btrim(use_case_4)) <= 2000
        and char_length(btrim(expected_benefits)) <= 4000
      ) not valid;
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.workshop_submissions'::pg_catalog.regclass
      and conname = 'workshop_submissions_email_format_check'
  ) then
    alter table public.workshop_submissions
      add constraint workshop_submissions_email_format_check check (
        btrim(submitter_email) = ''
        or btrim(submitter_email)
          ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
      ) not valid;
  end if;
end;
$constraints$;

-- Reassert the direct-table boundary in case database defaults change later.
alter table public.workshop_submissions enable row level security;
alter table public.workshop_submission_audit enable row level security;
revoke all on table public.workshop_submissions
  from public, anon, authenticated;
revoke all on table public.workshop_submission_audit
  from public, anon, authenticated;

create or replace function workshop_private.require_admin_capability(
  p_capability text
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  capability_is_valid boolean := false;
begin
  if p_capability is not null and char_length(p_capability) = 64 then
    select exists (
      select 1
      from workshop_private.admin_capabilities as capability
      where capability.token_hash = extensions.digest(
        pg_catalog.convert_to(p_capability, 'UTF8'),
        'sha256'
      )
        and capability.revoked_at is null
        and (
          capability.expires_at is null
          or capability.expires_at > pg_catalog.statement_timestamp()
        )
    ) into capability_is_valid;
  end if;

  if not capability_is_valid then
    raise exception using
      errcode = '28000',
      message = 'This admin link is invalid or has expired.';
  end if;
end;
$function$;

create or replace function workshop_private.validate_submission_input(
  p_plant text,
  p_submitter_name text,
  p_submitter_email text,
  p_designation text,
  p_use_cases text[],
  p_value_stream text,
  p_expected_benefits text,
  p_require_complete boolean
)
returns void
language plpgsql
immutable
set search_path = ''
as $function$
declare
  submitter_name text := btrim(coalesce(p_submitter_name, ''));
  submitter_email text := btrim(coalesce(p_submitter_email, ''));
  designation text := btrim(coalesce(p_designation, ''));
  expected_benefits text := btrim(coalesce(p_expected_benefits, ''));
  value_stream text := btrim(coalesce(p_value_stream, ''));
  use_case_1 text;
  use_case_2 text;
  use_case_3 text;
  use_case_4 text;
  described_use_case_count integer;
begin
  if p_plant is null or p_plant not in (
    'Panipat',
    'Ludhiana',
    'Cheyyar',
    'Chamarajanagar',
    'Mahad',
    'Kharagpur'
  ) then
    raise exception using
      errcode = '22023',
      message = 'Plant must be one of the six workshop plants.';
  end if;

  if p_use_cases is null or cardinality(p_use_cases) <> 4 then
    raise exception using
      errcode = '22023',
      message = 'Use cases must contain exactly four fixed slots.';
  end if;

  use_case_1 := btrim(coalesce(p_use_cases[1], ''));
  use_case_2 := btrim(coalesce(p_use_cases[2], ''));
  use_case_3 := btrim(coalesce(p_use_cases[3], ''));
  use_case_4 := btrim(coalesce(p_use_cases[4], ''));

  if char_length(submitter_name) > 120 then
    raise exception using errcode = '22023',
      message = 'Leader name must be 120 characters or fewer.';
  end if;
  if char_length(submitter_email) > 254 then
    raise exception using errcode = '22023',
      message = 'Work email must be 254 characters or fewer.';
  end if;
  if char_length(designation) > 160 then
    raise exception using errcode = '22023',
      message = 'Designation must be 160 characters or fewer.';
  end if;
  if char_length(use_case_1) > 2000
    or char_length(use_case_2) > 2000
    or char_length(use_case_3) > 2000
    or char_length(use_case_4) > 2000 then
    raise exception using errcode = '22023',
      message = 'Each use-case description must be 2000 characters or fewer.';
  end if;
  if char_length(expected_benefits) > 4000 then
    raise exception using errcode = '22023',
      message = 'Expected benefits must be 4000 characters or fewer.';
  end if;

  if submitter_email <> '' and submitter_email
    !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
    raise exception using errcode = '22023',
      message = 'Work email must be a valid email address.';
  end if;

  if value_stream <> '' and value_stream not in ('1', '2', '3', '4') then
    raise exception using errcode = '22023',
      message = 'Value stream must be one of 1, 2, 3, or 4.';
  end if;

  described_use_case_count :=
    (case when use_case_1 <> '' then 1 else 0 end)
    + (case when use_case_2 <> '' then 1 else 0 end)
    + (case when use_case_3 <> '' then 1 else 0 end)
    + (case when use_case_4 <> '' then 1 else 0 end);

  if p_require_complete then
    if submitter_name = '' then
      raise exception using errcode = '22023',
        message = 'Leader name is required.';
    end if;
    if submitter_email = '' then
      raise exception using errcode = '22023',
        message = 'Work email is required.';
    end if;
    if designation = '' then
      raise exception using errcode = '22023',
        message = 'Designation is required.';
    end if;
    if described_use_case_count <> 1 then
      raise exception using errcode = '22023',
        message = 'Choose exactly one use case and provide its description.';
    end if;
    if value_stream = '' then
      raise exception using errcode = '22023',
        message = 'Choose exactly one value stream.';
    end if;
    if expected_benefits = '' then
      raise exception using errcode = '22023',
        message = 'Expected benefits are required.';
    end if;
  end if;
end;
$function$;

create or replace function workshop_private.submission_json(
  p_submission public.workshop_submissions
)
returns jsonb
language sql
immutable
set search_path = ''
as $function$
  select pg_catalog.jsonb_build_object(
    'id', (p_submission).id,
    'plant', (p_submission).plant,
    'submitterName', (p_submission).submitter_name,
    'submitterEmail', (p_submission).submitter_email,
    'designation', (p_submission).designation,
    'useCases', pg_catalog.jsonb_build_array(
      (p_submission).use_case_1,
      (p_submission).use_case_2,
      (p_submission).use_case_3,
      (p_submission).use_case_4
    ),
    'valueStreams', pg_catalog.to_jsonb(
      pg_catalog.array_remove(
        array[
          case when (p_submission).value_stream_1_selected then '1' end,
          case when (p_submission).value_stream_2_selected then '2' end,
          case when (p_submission).value_stream_3_selected then '3' end,
          case when (p_submission).value_stream_4_selected then '4' end
        ]::text[],
        null::text
      )
    ),
    'expectedBenefits', (p_submission).expected_benefits,
    'status', (p_submission).status,
    'isVisible', (p_submission).is_visible,
    'createdAt', (p_submission).created_at,
    'updatedAt', (p_submission).updated_at,
    'submittedAt', (p_submission).submitted_at,
    'reviewedAt', (p_submission).reviewed_at
  );
$function$;

create or replace function public.workshop_public_list()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  submissions jsonb;
begin
  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'id', listed.id,
        'plant', listed.plant,
        'submitterName', listed.submitter_name,
        'useCases', pg_catalog.jsonb_build_array(
          listed.use_case_1,
          listed.use_case_2,
          listed.use_case_3,
          listed.use_case_4
        ),
        'valueStreams', pg_catalog.to_jsonb(
          pg_catalog.array_remove(
            array[
              case when listed.value_stream_1_selected then '1' end,
              case when listed.value_stream_2_selected then '2' end,
              case when listed.value_stream_3_selected then '3' end,
              case when listed.value_stream_4_selected then '4' end
            ]::text[],
            null::text
          )
        ),
        'expectedBenefits', listed.expected_benefits,
        'status', listed.status,
        'isVisible', listed.is_visible
      )
      order by listed.created_at desc, listed.id desc
    ),
    '[]'::jsonb
  )
  into submissions
  from (
    select response.*
    from public.workshop_submissions as response
    where response.status = 'approved'
      and response.is_visible = true
    order by response.created_at desc, response.id desc
    limit 1000
  ) as listed;

  return pg_catalog.jsonb_build_object(
    'submissions', submissions,
    'count', pg_catalog.jsonb_array_length(submissions)
  );
end;
$function$;

create or replace function public.workshop_submit(
  p_plant text,
  p_submitter_name text,
  p_submitter_email text,
  p_designation text,
  p_use_cases text[],
  p_value_stream text,
  p_expected_benefits text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  submission public.workshop_submissions%rowtype;
  saved_at timestamptz := pg_catalog.clock_timestamp();
begin
  perform workshop_private.validate_submission_input(
    p_plant,
    p_submitter_name,
    p_submitter_email,
    p_designation,
    p_use_cases,
    p_value_stream,
    p_expected_benefits,
    true
  );

  insert into public.workshop_submissions (
    id,
    plant,
    submitter_name,
    submitter_email,
    designation,
    use_case_1,
    use_case_2,
    use_case_3,
    use_case_4,
    value_stream_1_selected,
    value_stream_2_selected,
    value_stream_3_selected,
    value_stream_4_selected,
    expected_benefits,
    status,
    is_visible,
    created_at,
    updated_at,
    submitted_at,
    reviewed_at
  ) values (
    pg_catalog.gen_random_uuid(),
    p_plant,
    btrim(p_submitter_name),
    btrim(p_submitter_email),
    btrim(p_designation),
    btrim(coalesce(p_use_cases[1], '')),
    btrim(coalesce(p_use_cases[2], '')),
    btrim(coalesce(p_use_cases[3], '')),
    btrim(coalesce(p_use_cases[4], '')),
    btrim(p_value_stream) = '1',
    btrim(p_value_stream) = '2',
    btrim(p_value_stream) = '3',
    btrim(p_value_stream) = '4',
    btrim(p_expected_benefits),
    'submitted',
    false,
    saved_at,
    saved_at,
    saved_at,
    null
  )
  returning * into submission;

  return pg_catalog.jsonb_build_object(
    'submission', workshop_private.submission_json(submission)
  );
end;
$function$;

create or replace function public.workshop_admin_list(
  p_capability text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  submissions jsonb;
begin
  perform workshop_private.require_admin_capability(p_capability);

  select coalesce(
    pg_catalog.jsonb_agg(
      workshop_private.submission_json(listed)
      order by listed.created_at desc, listed.id desc
    ),
    '[]'::jsonb
  )
  into submissions
  from (
    select response.*
    from public.workshop_submissions as response
    order by response.created_at desc, response.id desc
    limit 1000
  ) as listed;

  return pg_catalog.jsonb_build_object(
    'submissions', submissions,
    'count', pg_catalog.jsonb_array_length(submissions)
  );
end;
$function$;

create or replace function public.workshop_admin_update(
  p_capability text,
  p_id uuid,
  p_expected_updated_at timestamptz,
  p_plant text,
  p_submitter_name text,
  p_submitter_email text,
  p_designation text,
  p_use_cases text[],
  p_value_stream text,
  p_expected_benefits text,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  submission public.workshop_submissions%rowtype;
  saved_at timestamptz := pg_catalog.clock_timestamp();
begin
  perform workshop_private.require_admin_capability(p_capability);

  if p_id is null then
    raise exception using errcode = '22023', message = 'Response ID is required.';
  end if;
  if p_expected_updated_at is null then
    raise exception using
      errcode = '22023',
      message = 'The response version is required.';
  end if;
  if p_status is null
    or p_status not in ('draft', 'submitted', 'approved', 'rejected') then
    raise exception using
      errcode = '22023',
      message = 'Status must be draft, submitted, approved, or rejected.';
  end if;

  perform workshop_private.validate_submission_input(
    p_plant,
    p_submitter_name,
    p_submitter_email,
    p_designation,
    p_use_cases,
    p_value_stream,
    p_expected_benefits,
    p_status in ('submitted', 'approved')
  );

  update public.workshop_submissions as response
  set
    plant = p_plant,
    submitter_name = btrim(coalesce(p_submitter_name, '')),
    submitter_email = btrim(coalesce(p_submitter_email, '')),
    designation = btrim(coalesce(p_designation, '')),
    use_case_1 = btrim(coalesce(p_use_cases[1], '')),
    use_case_2 = btrim(coalesce(p_use_cases[2], '')),
    use_case_3 = btrim(coalesce(p_use_cases[3], '')),
    use_case_4 = btrim(coalesce(p_use_cases[4], '')),
    value_stream_1_selected = btrim(coalesce(p_value_stream, '')) = '1',
    value_stream_2_selected = btrim(coalesce(p_value_stream, '')) = '2',
    value_stream_3_selected = btrim(coalesce(p_value_stream, '')) = '3',
    value_stream_4_selected = btrim(coalesce(p_value_stream, '')) = '4',
    expected_benefits = btrim(coalesce(p_expected_benefits, '')),
    status = p_status,
    is_visible = p_status = 'approved',
    updated_at = saved_at,
    submitted_at = case
      when p_status in ('submitted', 'approved', 'rejected')
        then coalesce(response.submitted_at, saved_at)
      else response.submitted_at
    end,
    reviewed_at = case
      when p_status = 'submitted' then null
      when p_status in ('approved', 'rejected')
        and response.status is distinct from p_status then saved_at
      else response.reviewed_at
    end
  where response.id = p_id
    and response.updated_at = p_expected_updated_at
  returning response.* into submission;

  if not found then
    if exists (
      select 1
      from public.workshop_submissions as existing
      where existing.id = p_id
    ) then
      raise exception using
        errcode = '40001',
        message = 'This response changed while it was being updated. Refresh and try again.';
    end if;

    raise exception using
      errcode = 'P0002',
      message = 'Response not found.';
  end if;

  return pg_catalog.jsonb_build_object(
    'submission', workshop_private.submission_json(submission)
  );
end;
$function$;

revoke all on function workshop_private.require_admin_capability(text)
  from public, anon, authenticated, service_role;
revoke all on function workshop_private.validate_submission_input(
  text, text, text, text, text[], text, text, boolean
) from public, anon, authenticated, service_role;
revoke all on function workshop_private.submission_json(
  public.workshop_submissions
) from public, anon, authenticated, service_role;

revoke all on function public.workshop_public_list()
  from public, anon, authenticated, service_role;
revoke all on function public.workshop_submit(
  text, text, text, text, text[], text, text
) from public, anon, authenticated, service_role;
revoke all on function public.workshop_admin_list(text)
  from public, anon, authenticated, service_role;
revoke all on function public.workshop_admin_update(
  text, uuid, timestamptz, text, text, text, text, text[], text, text, text
) from public, anon, authenticated, service_role;

grant execute on function public.workshop_public_list() to anon;
grant execute on function public.workshop_submit(
  text, text, text, text, text[], text, text
) to anon;
grant execute on function public.workshop_admin_list(text) to anon;
grant execute on function public.workshop_admin_update(
  text, uuid, timestamptz, text, text, text, text, text[], text, text, text
) to anon;

comment on function public.workshop_public_list() is
  'Returns only approved, visible, presentation-safe workshop responses.';
comment on function public.workshop_submit(
  text, text, text, text, text[], text, text
) is 'Creates one complete leader response, hidden pending admin approval.';
comment on function public.workshop_admin_list(text) is
  'Returns complete responses when supplied the private admin URL capability.';
comment on function public.workshop_admin_update(
  text, uuid, timestamptz, text, text, text, text, text[], text, text, text
) is 'Edits and reviews a response using capability authorization and optimistic locking.';

notify pgrst, 'reload schema';
