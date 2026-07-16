-- One freehand use case per response, plus the Head Office workshop entity.
--
-- The legacy four-slot columns and RPCs remain in place so an older cached
-- GitHub Pages bundle can continue submitting while clients move to the
-- useCaseTitle/useCaseTheme contract. A trigger keeps both representations in
-- sync; all new browser writes use the single-use-case RPCs below.

alter table public.workshop_submissions
  add column if not exists use_case_title text not null default '',
  add column if not exists use_case_theme text not null default '';

-- Preserve the former grouping label as the title and its freehand
-- description as the theme.
update public.workshop_submissions as response
set
  use_case_title = case
    when btrim(response.use_case_title) <> '' then response.use_case_title
    when btrim(response.use_case_1) <> '' then 'Use Case 1'
    when btrim(response.use_case_2) <> '' then 'Use Case 2'
    when btrim(response.use_case_3) <> '' then 'Use Case 3'
    when btrim(response.use_case_4) <> '' then 'Use Case 4'
    else ''
  end,
  use_case_theme = case
    when btrim(response.use_case_theme) <> '' then response.use_case_theme
    else coalesce(
      nullif(btrim(response.use_case_1), ''),
      nullif(btrim(response.use_case_2), ''),
      nullif(btrim(response.use_case_3), ''),
      nullif(btrim(response.use_case_4), ''),
      ''
    )
  end
where btrim(response.use_case_title) = ''
  and btrim(response.use_case_theme) = '';

-- Translate between the new one-use-case shape and the legacy four-slot
-- projection. New fields win when a modern client changes them; legacy fields
-- win when only an old client changes its four-slot array.
create or replace function workshop_private.sync_workshop_single_use_case()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  legacy_count integer;
  legacy_changed boolean := false;
  modern_changed boolean := false;
  legacy_title text := '';
  legacy_theme text := '';
  projected_slot integer := 1;
begin
  legacy_count :=
    (case when btrim(coalesce(new.use_case_1, '')) <> '' then 1 else 0 end)
    + (case when btrim(coalesce(new.use_case_2, '')) <> '' then 1 else 0 end)
    + (case when btrim(coalesce(new.use_case_3, '')) <> '' then 1 else 0 end)
    + (case when btrim(coalesce(new.use_case_4, '')) <> '' then 1 else 0 end);

  if legacy_count > 0 then
    projected_slot := case
      when btrim(coalesce(new.use_case_1, '')) <> '' then 1
      when btrim(coalesce(new.use_case_2, '')) <> '' then 2
      when btrim(coalesce(new.use_case_3, '')) <> '' then 3
      else 4
    end;
    legacy_title := case
      when btrim(coalesce(new.use_case_1, '')) <> '' then 'Use Case 1'
      when btrim(coalesce(new.use_case_2, '')) <> '' then 'Use Case 2'
      when btrim(coalesce(new.use_case_3, '')) <> '' then 'Use Case 3'
      else 'Use Case 4'
    end;
    legacy_theme := coalesce(
      nullif(btrim(new.use_case_1), ''),
      nullif(btrim(new.use_case_2), ''),
      nullif(btrim(new.use_case_3), ''),
      nullif(btrim(new.use_case_4), ''),
      ''
    );
  end if;

  if tg_op = 'UPDATE' then
    legacy_changed :=
      row(new.use_case_1, new.use_case_2, new.use_case_3, new.use_case_4)
      is distinct from
      row(old.use_case_1, old.use_case_2, old.use_case_3, old.use_case_4);
    modern_changed :=
      row(new.use_case_title, new.use_case_theme)
      is distinct from
      row(old.use_case_title, old.use_case_theme);
  end if;

  if (
    tg_op = 'INSERT'
    and btrim(coalesce(new.use_case_title, '')) = ''
    and btrim(coalesce(new.use_case_theme, '')) = ''
  ) or (tg_op = 'UPDATE' and legacy_changed and not modern_changed) then
    new.use_case_title := legacy_title;
    new.use_case_theme := legacy_theme;
    new.use_case_1 := case when projected_slot = 1 then legacy_theme else '' end;
    new.use_case_2 := case when projected_slot = 2 then legacy_theme else '' end;
    new.use_case_3 := case when projected_slot = 3 then legacy_theme else '' end;
    new.use_case_4 := case when projected_slot = 4 then legacy_theme else '' end;
    return new;
  end if;

  if tg_op = 'INSERT'
    or modern_changed then
    new.use_case_title := btrim(coalesce(new.use_case_title, ''));
    new.use_case_theme := btrim(coalesce(new.use_case_theme, ''));

    projected_slot := case new.use_case_title
      when 'Use Case 2' then 2
      when 'Use Case 3' then 3
      when 'Use Case 4' then 4
      else 1
    end;

    new.use_case_1 := case
      when projected_slot = 1 then new.use_case_theme
      else ''
    end;
    new.use_case_2 := case
      when projected_slot = 2 then new.use_case_theme
      else ''
    end;
    new.use_case_3 := case
      when projected_slot = 3 then new.use_case_theme
      else ''
    end;
    new.use_case_4 := case
      when projected_slot = 4 then new.use_case_theme
      else ''
    end;
  end if;

  return new;
end;
$function$;

drop trigger if exists workshop_single_use_case_sync_trigger
  on public.workshop_submissions;

create trigger workshop_single_use_case_sync_trigger
before insert or update on public.workshop_submissions
for each row execute function workshop_private.sync_workshop_single_use_case();

-- Replace the original six-plant constraint and completeness rule. The
-- trigger above lets the unchanged legacy RPCs satisfy the new rule.
alter table public.workshop_submissions
  drop constraint if exists workshop_submissions_plant_check;

alter table public.workshop_submissions
  add constraint workshop_submissions_plant_check check (
    plant in (
      'Panipat',
      'Ludhiana',
      'Cheyyar',
      'Chamarajanagar',
      'Mahad',
      'Kharagpur',
      'Head Office (Mumbai)'
    )
  );

alter table public.workshop_submissions
  drop constraint if exists workshop_submissions_complete_response_check;

alter table public.workshop_submissions
  add constraint workshop_submissions_complete_response_check check (
    status not in ('submitted', 'approved')
    or (
      btrim(submitter_name) <> ''
      and btrim(submitter_email) <> ''
      and btrim(designation) <> ''
      and btrim(use_case_title) <> ''
      and btrim(use_case_theme) <> ''
      and btrim(expected_benefits) <> ''
      and (
        (case when value_stream_1_selected then 1 else 0 end)
        + (case when value_stream_2_selected then 1 else 0 end)
        + (case when value_stream_3_selected then 1 else 0 end)
        + (case when value_stream_4_selected then 1 else 0 end)
      ) = 1
    )
  );

do $constraints$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.workshop_submissions'::pg_catalog.regclass
      and conname = 'workshop_submissions_single_use_case_lengths_check'
  ) then
    alter table public.workshop_submissions
      add constraint workshop_submissions_single_use_case_lengths_check check (
        char_length(btrim(use_case_title)) <= 200
        and char_length(btrim(use_case_theme)) <= 2000
      ) not valid;
  end if;
end;
$constraints$;

create index if not exists workshop_submissions_use_case_group_idx
  on public.workshop_submissions (
    plant,
    lower(btrim(use_case_title)),
    created_at,
    id
  );

create or replace function workshop_private.validate_single_use_case_input(
  p_plant text,
  p_submitter_name text,
  p_submitter_email text,
  p_designation text,
  p_use_case_title text,
  p_use_case_theme text,
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
  use_case_title text := btrim(coalesce(p_use_case_title, ''));
  use_case_theme text := btrim(coalesce(p_use_case_theme, ''));
  value_stream text := btrim(coalesce(p_value_stream, ''));
  expected_benefits text := btrim(coalesce(p_expected_benefits, ''));
begin
  if p_plant is null or p_plant not in (
    'Panipat',
    'Ludhiana',
    'Cheyyar',
    'Chamarajanagar',
    'Mahad',
    'Kharagpur',
    'Head Office (Mumbai)'
  ) then
    raise exception using
      errcode = '22023',
      message = 'Plant or workshop entity is not recognised.';
  end if;

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
  if char_length(use_case_title) > 200 then
    raise exception using errcode = '22023',
      message = 'Use-case title must be 200 characters or fewer.';
  end if;
  if char_length(use_case_theme) > 2000 then
    raise exception using errcode = '22023',
      message = 'Use-case theme must be 2000 characters or fewer.';
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
    if use_case_title = '' then
      raise exception using errcode = '22023',
        message = 'Use-case title is required.';
    end if;
    if use_case_theme = '' then
      raise exception using errcode = '22023',
        message = 'Use-case theme is required.';
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

-- Keep the old validator signature and behaviour available to cached clients,
-- but accept Head Office and translate its four-slot input into the new shape.
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
  use_case_1 text;
  use_case_2 text;
  use_case_3 text;
  use_case_4 text;
  described_count integer;
  translated_title text := '';
  translated_theme text := '';
begin
  if p_use_cases is null or cardinality(p_use_cases) <> 4 then
    raise exception using
      errcode = '22023',
      message = 'Use cases must contain exactly four fixed slots.';
  end if;

  use_case_1 := btrim(coalesce(p_use_cases[1], ''));
  use_case_2 := btrim(coalesce(p_use_cases[2], ''));
  use_case_3 := btrim(coalesce(p_use_cases[3], ''));
  use_case_4 := btrim(coalesce(p_use_cases[4], ''));

  if char_length(use_case_1) > 2000
    or char_length(use_case_2) > 2000
    or char_length(use_case_3) > 2000
    or char_length(use_case_4) > 2000 then
    raise exception using errcode = '22023',
      message = 'Each use-case description must be 2000 characters or fewer.';
  end if;

  described_count :=
    (case when use_case_1 <> '' then 1 else 0 end)
    + (case when use_case_2 <> '' then 1 else 0 end)
    + (case when use_case_3 <> '' then 1 else 0 end)
    + (case when use_case_4 <> '' then 1 else 0 end);

  if described_count > 0 then
    translated_title := case
      when use_case_1 <> '' then 'Use Case 1'
      when use_case_2 <> '' then 'Use Case 2'
      when use_case_3 <> '' then 'Use Case 3'
      else 'Use Case 4'
    end;
    translated_theme := coalesce(
      nullif(use_case_1, ''),
      nullif(use_case_2, ''),
      nullif(use_case_3, ''),
      nullif(use_case_4, ''),
      ''
    );
  end if;

  if described_count > 1 then
    raise exception using errcode = '22023',
      message = 'Only one use case may be provided per response.';
  end if;

  if p_require_complete and described_count = 0 then
    raise exception using errcode = '22023',
      message = 'Choose exactly one use case and provide its description.';
  end if;

  perform workshop_private.validate_single_use_case_input(
    p_plant,
    p_submitter_name,
    p_submitter_email,
    p_designation,
    translated_title,
    translated_theme,
    p_value_stream,
    p_expected_benefits,
    p_require_complete
  );
end;
$function$;

-- Complete admin JSON now includes both the modern contract and the legacy
-- array for compatibility.
create or replace function workshop_private.submission_json(
  p_submission public.workshop_submissions
)
returns jsonb
language sql
stable
set search_path = ''
as $function$
  select pg_catalog.jsonb_build_object(
    'id', (p_submission).id,
    'plant', (p_submission).plant,
    'submitterName', (p_submission).submitter_name,
    'submitterEmail', (p_submission).submitter_email,
    'designation', (p_submission).designation,
    'useCaseTitle', (p_submission).use_case_title,
    'useCaseTheme', (p_submission).use_case_theme,
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
    'reviewedAt', (p_submission).reviewed_at,
    'references', coalesce(
      (
        select pg_catalog.jsonb_agg(
          workshop_private.workshop_reference_json(reference)
          order by reference.sort_order, reference.id
        )
        from public.workshop_submission_references as reference
        where reference.submission_id = (p_submission).id
      ),
      '[]'::jsonb
    )
  );
$function$;

create or replace function public.workshop_submit_single_use_case_with_references(
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
  legacy_result jsonb;
  new_submission_id uuid;
  submission public.workshop_submissions%rowtype;
begin
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
    p_references
  );
  new_submission_id := (legacy_result -> 'submission' ->> 'id')::uuid;

  update public.workshop_submissions as response
  set
    use_case_title = btrim(p_use_case_title),
    use_case_theme = btrim(p_use_case_theme)
  where response.id = new_submission_id
  returning response.* into submission;

  return pg_catalog.jsonb_build_object(
    'submission', workshop_private.submission_json(submission)
  );
end;
$function$;

create or replace function public.workshop_admin_single_use_case_update(
  p_capability text,
  p_id uuid,
  p_expected_updated_at timestamptz,
  p_plant text,
  p_submitter_name text,
  p_submitter_email text,
  p_designation text,
  p_use_case_title text,
  p_use_case_theme text,
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
  legacy_result jsonb;
  submission public.workshop_submissions%rowtype;
begin
  if p_status is null
    or p_status not in ('draft', 'submitted', 'approved', 'rejected') then
    raise exception using
      errcode = '22023',
      message = 'Status must be draft, submitted, approved, or rejected.';
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
    p_status in ('submitted', 'approved')
  );

  legacy_result := public.workshop_admin_update(
    p_capability,
    p_id,
    p_expected_updated_at,
    p_plant,
    p_submitter_name,
    p_submitter_email,
    p_designation,
    array[btrim(coalesce(p_use_case_theme, '')), '', '', '']::text[],
    p_value_stream,
    p_expected_benefits,
    p_status
  );

  update public.workshop_submissions as response
  set
    use_case_title = btrim(coalesce(p_use_case_title, '')),
    use_case_theme = btrim(coalesce(p_use_case_theme, ''))
  where response.id = p_id
  returning response.* into submission;

  return pg_catalog.jsonb_build_object(
    'submission', workshop_private.submission_json(submission)
  );
end;
$function$;

-- Presentation-safe output contains no leader email/designation. Ordering
-- keeps equal use-case titles adjacent inside each workshop entity.
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
        'createdAt', listed.created_at,
        'useCaseTitle', listed.use_case_title,
        'useCaseTheme', listed.use_case_theme,
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
        'isVisible', listed.is_visible,
        'references', coalesce(
          (
            select pg_catalog.jsonb_agg(
              workshop_private.workshop_reference_json(reference)
              order by reference.sort_order, reference.id
            )
            from public.workshop_submission_references as reference
            where reference.submission_id = listed.id
              and reference.is_visible = true
          ),
          '[]'::jsonb
        )
      )
      order by
        listed.plant,
        lower(btrim(listed.use_case_title)),
        listed.created_at,
        listed.id
    ),
    '[]'::jsonb
  )
  into submissions
  from (
    select response.*
    from public.workshop_submissions as response
    where response.status = 'approved'
      and response.is_visible = true
    order by
      response.plant,
      lower(btrim(response.use_case_title)),
      response.created_at,
      response.id
    limit 1000
  ) as listed;

  return pg_catalog.jsonb_build_object(
    'submissions', submissions,
    'count', pg_catalog.jsonb_array_length(submissions)
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

alter table public.workshop_submissions enable row level security;
revoke all on table public.workshop_submissions
  from public, anon, authenticated;

revoke all on function workshop_private.sync_workshop_single_use_case()
  from public, anon, authenticated, service_role;
revoke all on function workshop_private.validate_single_use_case_input(
  text, text, text, text, text, text, text, text, boolean
) from public, anon, authenticated, service_role;
revoke all on function workshop_private.validate_submission_input(
  text, text, text, text, text[], text, text, boolean
) from public, anon, authenticated, service_role;
revoke all on function workshop_private.submission_json(
  public.workshop_submissions
) from public, anon, authenticated, service_role;

revoke all on function public.workshop_submit_single_use_case_with_references(
  text, text, text, text, text, text, text, text, uuid, text, jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.workshop_admin_single_use_case_update(
  text, uuid, timestamptz, text, text, text, text, text, text, text, text, text
) from public, anon, authenticated, service_role;

grant execute on function public.workshop_submit_single_use_case_with_references(
  text, text, text, text, text, text, text, text, uuid, text, jsonb
) to anon;
grant execute on function public.workshop_admin_single_use_case_update(
  text, uuid, timestamptz, text, text, text, text, text, text, text, text, text
) to anon;

comment on function public.workshop_submit_single_use_case_with_references(
  text, text, text, text, text, text, text, text, uuid, text, jsonb
) is
  'Atomically submits one titled use case, its theme, one value stream, benefits, and optional references.';
comment on function public.workshop_admin_single_use_case_update(
  text, uuid, timestamptz, text, text, text, text, text, text, text, text, text
) is
  'Edits and reviews the one-use-case response contract with optimistic locking.';

notify pgrst, 'reload schema';
