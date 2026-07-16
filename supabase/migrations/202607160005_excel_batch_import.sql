-- Idempotent Excel batch imports for the static GitHub Pages workshop site.
--
-- The browser-facing wrapper remains protected by the existing admin URL
-- capability. The private worker is deliberately separate so a trusted SQL
-- editor session can import a time-critical batch without handling the raw
-- capability. Direct table access remains closed.

create or replace function workshop_private.canonical_workshop_value_stream(
  p_value text
)
returns text
language sql
immutable
set search_path = ''
as $function$
  select case pg_catalog.lower(pg_catalog.btrim(coalesce(p_value, '')))
    when '' then ''
    when '1' then 'Productivity'
    when 'productivity' then 'Productivity'
    when '2' then 'Quality'
    when 'quality' then 'Quality'
    when '3' then 'Process Optimization'
    when 'process optimization' then 'Process Optimization'
    when '4' then 'Reliability'
    when 'reliability' then 'Reliability'
    when '5' then 'Energy Efficiency'
    when 'energy efficiency' then 'Energy Efficiency'
    when '6' then 'Safety'
    when 'safety' then 'Safety'
    when '7' then 'Sustainability'
    when 'sustainability' then 'Sustainability'
    when '8' then 'Supply Chain'
    when 'supply chain' then 'Supply Chain'
    else null
  end;
$function$;

create or replace function workshop_private.normalise_excel_fingerprint_text(
  p_value text
)
returns text
language sql
immutable
set search_path = ''
as $function$
  select pg_catalog.lower(
    pg_catalog.regexp_replace(
      pg_catalog.btrim(
        pg_catalog.replace(
          pg_catalog.replace(coalesce(p_value, ''), chr(13) || chr(10), chr(10)),
          chr(13),
          chr(10)
        )
      ),
      '[[:space:]]+',
      ' ',
      'g'
    )
  );
$function$;

create or replace function workshop_private.excel_submission_fingerprint(
  p_plant text,
  p_submitter_name text,
  p_use_case_title text,
  p_use_case_description text,
  p_value_stream text,
  p_expected_benefits text
)
returns bytea
language sql
immutable
set search_path = ''
as $function$
  select extensions.digest(
    pg_catalog.convert_to(
      pg_catalog.jsonb_build_array(
        workshop_private.normalise_excel_fingerprint_text(p_plant),
        workshop_private.normalise_excel_fingerprint_text(p_submitter_name),
        workshop_private.normalise_excel_fingerprint_text(p_use_case_title),
        workshop_private.normalise_excel_fingerprint_text(p_use_case_description),
        workshop_private.normalise_excel_fingerprint_text(
          workshop_private.canonical_workshop_value_stream(p_value_stream)
        ),
        workshop_private.normalise_excel_fingerprint_text(p_expected_benefits)
      )::text,
      'UTF8'
    ),
    'sha256'
  );
$function$;

create table if not exists workshop_private.excel_import_batches (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  workbook_sha256 text not null,
  payload_sha256 text not null,
  file_name text not null,
  publish_requested boolean not null,
  entry_count integer not null,
  inserted_count integer not null,
  unchanged_count integer not null,
  moved_duplicate_count integer not null,
  conflict_count integer not null,
  incomplete_count integer not null,
  imported_at timestamptz not null default pg_catalog.clock_timestamp(),
  result jsonb not null,
  constraint excel_import_batches_workbook_hash_check check (
    workbook_sha256 ~ '^[0-9a-f]{64}$'
  ),
  constraint excel_import_batches_payload_hash_check check (
    payload_sha256 ~ '^[0-9a-f]{64}$'
  ),
  constraint excel_import_batches_file_name_check check (
    char_length(pg_catalog.btrim(file_name)) between 1 and 260
  ),
  constraint excel_import_batches_counts_check check (
    entry_count >= 0
    and inserted_count >= 0
    and unchanged_count >= 0
    and moved_duplicate_count >= 0
    and conflict_count >= 0
    and incomplete_count >= 0
  ),
  constraint excel_import_batches_retry_key_unique unique (
    workbook_sha256,
    payload_sha256,
    publish_requested
  )
);

alter table workshop_private.excel_import_batches enable row level security;
revoke all on table workshop_private.excel_import_batches
  from public, anon, authenticated, service_role;

alter table public.workshop_submissions
  add column if not exists use_case_description text not null default '',
  add column if not exists value_stream_name text not null default '',
  add column if not exists source_kind text not null default 'web',
  add column if not exists source_key text,
  add column if not exists source_fingerprint bytea,
  add column if not exists source_sheet text,
  add column if not exists source_row integer,
  add column if not exists source_payload jsonb,
  add column if not exists import_batch_id uuid,
  add column if not exists imported_at timestamptz;

update public.workshop_submissions as response
set use_case_description = response.use_case_theme
where pg_catalog.btrim(response.use_case_description) = ''
  and pg_catalog.btrim(response.use_case_theme) <> '';

update public.workshop_submissions as response
set value_stream_name = workshop_private.canonical_workshop_value_stream(
  case
    when response.value_stream_1_selected then '1'
    when response.value_stream_2_selected then '2'
    when response.value_stream_3_selected then '3'
    when response.value_stream_4_selected then '4'
    else response.value_stream_name
  end
)
where pg_catalog.btrim(response.value_stream_name) = '';

alter table public.workshop_submissions
  drop constraint if exists workshop_submissions_input_lengths_check;

alter table public.workshop_submissions
  add constraint workshop_submissions_input_lengths_check check (
    char_length(pg_catalog.btrim(submitter_name)) <= 120
    and char_length(pg_catalog.btrim(submitter_email)) <= 254
    and char_length(pg_catalog.btrim(designation)) <= 160
    and char_length(pg_catalog.btrim(use_case_1)) <= 12000
    and char_length(pg_catalog.btrim(use_case_2)) <= 12000
    and char_length(pg_catalog.btrim(use_case_3)) <= 12000
    and char_length(pg_catalog.btrim(use_case_4)) <= 12000
    and char_length(pg_catalog.btrim(expected_benefits)) <= 12000
  ) not valid;

alter table public.workshop_submissions
  drop constraint if exists workshop_submissions_single_use_case_lengths_check;

alter table public.workshop_submissions
  add constraint workshop_submissions_single_use_case_lengths_check check (
    char_length(pg_catalog.btrim(use_case_title)) <= 200
    and char_length(pg_catalog.btrim(use_case_theme)) <= 12000
    and char_length(pg_catalog.btrim(use_case_description)) <= 12000
  ) not valid;

alter table public.workshop_submissions
  drop constraint if exists workshop_submissions_complete_response_check;

alter table public.workshop_submissions
  add constraint workshop_submissions_complete_response_check check (
    status not in ('submitted', 'approved')
    or (
      pg_catalog.btrim(use_case_title) <> ''
      and pg_catalog.btrim(
        coalesce(
          nullif(use_case_description, ''),
          use_case_theme
        )
      ) <> ''
      and pg_catalog.btrim(value_stream_name) <> ''
      and pg_catalog.btrim(expected_benefits) <> ''
      and (
        source_kind = 'excel'
        or (
          pg_catalog.btrim(submitter_name) <> ''
          and pg_catalog.btrim(submitter_email) <> ''
          and pg_catalog.btrim(designation) <> ''
        )
      )
    )
  );

do $constraints$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.workshop_submissions'::pg_catalog.regclass
      and conname = 'workshop_submissions_value_stream_name_check'
  ) then
    alter table public.workshop_submissions
      add constraint workshop_submissions_value_stream_name_check check (
        value_stream_name = ''
        or value_stream_name in (
          'Productivity',
          'Quality',
          'Process Optimization',
          'Reliability',
          'Energy Efficiency',
          'Safety',
          'Sustainability',
          'Supply Chain'
        )
      ) not valid;
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.workshop_submissions'::pg_catalog.regclass
      and conname = 'workshop_submissions_source_metadata_check'
  ) then
    alter table public.workshop_submissions
      add constraint workshop_submissions_source_metadata_check check (
        source_kind in ('web', 'excel')
        and (
          source_kind = 'web'
          or (
            source_key is not null
            and char_length(pg_catalog.btrim(source_key)) between 1 and 240
            and source_fingerprint is not null
            and octet_length(source_fingerprint) = 32
            and source_sheet is not null
            and char_length(pg_catalog.btrim(source_sheet)) between 1 and 120
            and source_row between 1 and 1000000
            and source_payload is not null
            and pg_catalog.jsonb_typeof(source_payload) = 'object'
            and import_batch_id is not null
            and imported_at is not null
          )
        )
      ) not valid;
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.workshop_submissions'::pg_catalog.regclass
      and conname = 'workshop_submissions_import_batch_fk'
  ) then
    alter table public.workshop_submissions
      add constraint workshop_submissions_import_batch_fk
      foreign key (import_batch_id)
      references workshop_private.excel_import_batches(id)
      on delete restrict
      not valid;
  end if;
end;
$constraints$;

create unique index if not exists workshop_submissions_excel_source_key_uidx
  on public.workshop_submissions (source_key)
  where source_kind = 'excel';

create unique index if not exists workshop_submissions_excel_fingerprint_uidx
  on public.workshop_submissions (source_fingerprint)
  where source_kind = 'excel';

create or replace function workshop_private.sync_workshop_value_stream_name()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  legacy_name text := '';
  canonical_name text;
  name_changed boolean := false;
  legacy_changed boolean := false;
begin
  legacy_name := case
    when new.value_stream_1_selected then 'Productivity'
    when new.value_stream_2_selected then 'Quality'
    when new.value_stream_3_selected then 'Process Optimization'
    when new.value_stream_4_selected then 'Reliability'
    else ''
  end;

  if tg_op = 'UPDATE' then
    name_changed := new.value_stream_name is distinct from old.value_stream_name;
    legacy_changed := row(
      new.value_stream_1_selected,
      new.value_stream_2_selected,
      new.value_stream_3_selected,
      new.value_stream_4_selected
    ) is distinct from row(
      old.value_stream_1_selected,
      old.value_stream_2_selected,
      old.value_stream_3_selected,
      old.value_stream_4_selected
    );
  end if;

  if tg_op = 'INSERT' then
    canonical_name := workshop_private.canonical_workshop_value_stream(
      case
        when pg_catalog.btrim(coalesce(new.value_stream_name, '')) <> ''
          then new.value_stream_name
        else legacy_name
      end
    );
  elsif name_changed then
    canonical_name := workshop_private.canonical_workshop_value_stream(
      new.value_stream_name
    );
  elsif legacy_changed then
    canonical_name := legacy_name;
  else
    canonical_name := workshop_private.canonical_workshop_value_stream(
      new.value_stream_name
    );
  end if;

  new.value_stream_name := coalesce(canonical_name, new.value_stream_name);
  new.value_stream_1_selected := new.value_stream_name = 'Productivity';
  new.value_stream_2_selected := new.value_stream_name = 'Quality';
  new.value_stream_3_selected := new.value_stream_name = 'Process Optimization';
  new.value_stream_4_selected := new.value_stream_name = 'Reliability';
  return new;
end;
$function$;

drop trigger if exists workshop_value_stream_name_sync_trigger
  on public.workshop_submissions;

create trigger workshop_value_stream_name_sync_trigger
before insert or update on public.workshop_submissions
for each row execute function workshop_private.sync_workshop_value_stream_name();

create or replace function workshop_private.sync_workshop_use_case_description()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  description_changed boolean := false;
  theme_changed boolean := false;
begin
  if tg_op = 'UPDATE' then
    description_changed := new.use_case_description is distinct from old.use_case_description;
    theme_changed := new.use_case_theme is distinct from old.use_case_theme;
  end if;

  if tg_op = 'INSERT' then
    if pg_catalog.btrim(coalesce(new.use_case_description, '')) = '' then
      new.use_case_description := pg_catalog.btrim(
        coalesce(new.use_case_theme, '')
      );
    else
      new.use_case_description := pg_catalog.btrim(new.use_case_description);
      new.use_case_theme := new.use_case_description;
    end if;
  elsif description_changed then
    new.use_case_description := pg_catalog.btrim(
      coalesce(new.use_case_description, '')
    );
    new.use_case_theme := new.use_case_description;
  elsif theme_changed then
    new.use_case_theme := pg_catalog.btrim(
      coalesce(new.use_case_theme, '')
    );
    new.use_case_description := new.use_case_theme;
  end if;

  return new;
end;
$function$;

drop trigger if exists workshop_use_case_description_sync_trigger
  on public.workshop_submissions;

-- Trigger names are ordered by PostgreSQL. "use_case_description" runs after
-- the existing "single_use_case" compatibility trigger, so cached legacy
-- inserts are projected into the new description column in the same write.
create trigger workshop_use_case_description_sync_trigger
before insert or update on public.workshop_submissions
for each row execute function workshop_private.sync_workshop_use_case_description();

create or replace function workshop_private.validate_workshop_response_input(
  p_plant text,
  p_submitter_name text,
  p_submitter_email text,
  p_designation text,
  p_use_case_title text,
  p_use_case_description text,
  p_value_stream text,
  p_expected_benefits text,
  p_source_kind text,
  p_require_complete boolean
)
returns void
language plpgsql
immutable
set search_path = ''
as $function$
declare
  submitter_name text := pg_catalog.btrim(coalesce(p_submitter_name, ''));
  submitter_email text := pg_catalog.btrim(coalesce(p_submitter_email, ''));
  designation text := pg_catalog.btrim(coalesce(p_designation, ''));
  use_case_title text := pg_catalog.btrim(coalesce(p_use_case_title, ''));
  use_case_description text := pg_catalog.btrim(
    coalesce(p_use_case_description, '')
  );
  value_stream text := workshop_private.canonical_workshop_value_stream(
    p_value_stream
  );
  expected_benefits text := pg_catalog.btrim(
    coalesce(p_expected_benefits, '')
  );
begin
  if p_source_kind is null or p_source_kind not in ('web', 'excel') then
    raise exception using errcode = '22023',
      message = 'Response source is not recognised.';
  end if;

  if p_plant is null or p_plant not in (
    'Panipat',
    'Ludhiana',
    'Cheyyar',
    'Chamarajanagar',
    'Mahad',
    'Kharagpur',
    'Head Office (Mumbai)'
  ) then
    raise exception using errcode = '22023',
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
  if char_length(use_case_description) > 12000 then
    raise exception using errcode = '22023',
      message = 'Use-case description must be 12000 characters or fewer.';
  end if;
  if char_length(expected_benefits) > 12000 then
    raise exception using errcode = '22023',
      message = 'Expected benefits must be 12000 characters or fewer.';
  end if;

  if submitter_email <> '' and submitter_email
    !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
    raise exception using errcode = '22023',
      message = 'Work email must be a valid email address.';
  end if;

  if pg_catalog.btrim(coalesce(p_value_stream, '')) <> ''
    and value_stream is null then
    raise exception using errcode = '22023',
      message = 'Value stream must be a code from 1 to 8 or a recognised workbook value.';
  end if;

  if p_require_complete then
    if p_source_kind <> 'excel' and submitter_name = '' then
      raise exception using errcode = '22023', message = 'Leader name is required.';
    end if;
    if p_source_kind <> 'excel' and submitter_email = '' then
      raise exception using errcode = '22023', message = 'Work email is required.';
    end if;
    if p_source_kind <> 'excel' and designation = '' then
      raise exception using errcode = '22023',
        message = 'Designation is required.';
    end if;
    if use_case_title = '' then
      raise exception using errcode = '22023',
        message = 'Use-case title is required.';
    end if;
    if use_case_description = '' then
      raise exception using errcode = '22023',
        message = 'Use-case description is required.';
    end if;
    if value_stream is null or value_stream = '' then
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

-- Preserve the existing validator signature for cached one-use-case clients.
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
begin
  perform workshop_private.validate_workshop_response_input(
    p_plant,
    p_submitter_name,
    p_submitter_email,
    p_designation,
    p_use_case_title,
    p_use_case_theme,
    p_value_stream,
    p_expected_benefits,
    'web',
    p_require_complete
  );
end;
$function$;

-- Cached four-slot clients remain accepted, with their one populated slot
-- translated into the modern title/description shape.
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
  translated_description text := '';
begin
  if p_use_cases is null or cardinality(p_use_cases) <> 4 then
    raise exception using errcode = '22023',
      message = 'Use cases must contain exactly four fixed slots.';
  end if;

  use_case_1 := pg_catalog.btrim(coalesce(p_use_cases[1], ''));
  use_case_2 := pg_catalog.btrim(coalesce(p_use_cases[2], ''));
  use_case_3 := pg_catalog.btrim(coalesce(p_use_cases[3], ''));
  use_case_4 := pg_catalog.btrim(coalesce(p_use_cases[4], ''));

  if char_length(use_case_1) > 12000
    or char_length(use_case_2) > 12000
    or char_length(use_case_3) > 12000
    or char_length(use_case_4) > 12000 then
    raise exception using errcode = '22023',
      message = 'Each use-case description must be 12000 characters or fewer.';
  end if;

  described_count :=
    (case when use_case_1 <> '' then 1 else 0 end)
    + (case when use_case_2 <> '' then 1 else 0 end)
    + (case when use_case_3 <> '' then 1 else 0 end)
    + (case when use_case_4 <> '' then 1 else 0 end);

  if described_count > 1 then
    raise exception using errcode = '22023',
      message = 'Only one use case may be provided per response.';
  end if;

  if described_count > 0 then
    translated_title := case
      when use_case_1 <> '' then 'Use Case 1'
      when use_case_2 <> '' then 'Use Case 2'
      when use_case_3 <> '' then 'Use Case 3'
      else 'Use Case 4'
    end;
    translated_description := coalesce(
      nullif(use_case_1, ''),
      nullif(use_case_2, ''),
      nullif(use_case_3, ''),
      nullif(use_case_4, ''),
      ''
    );
  end if;

  perform workshop_private.validate_workshop_response_input(
    p_plant,
    p_submitter_name,
    p_submitter_email,
    p_designation,
    translated_title,
    translated_description,
    p_value_stream,
    p_expected_benefits,
    'web',
    p_require_complete
  );
end;
$function$;

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
    'useCaseTheme', coalesce(
      nullif((p_submission).use_case_description, ''),
      (p_submission).use_case_theme
    ),
    'useCaseDescription', coalesce(
      nullif((p_submission).use_case_description, ''),
      (p_submission).use_case_theme
    ),
    'useCases', pg_catalog.jsonb_build_array(
      (p_submission).use_case_1,
      (p_submission).use_case_2,
      (p_submission).use_case_3,
      (p_submission).use_case_4
    ),
    'valueStreams', case
      when pg_catalog.btrim((p_submission).value_stream_name) = ''
        then '[]'::jsonb
      else pg_catalog.jsonb_build_array((p_submission).value_stream_name)
    end,
    'expectedBenefits', (p_submission).expected_benefits,
    'status', (p_submission).status,
    'isVisible', (p_submission).is_visible,
    'createdAt', (p_submission).created_at,
    'updatedAt', (p_submission).updated_at,
    'submittedAt', (p_submission).submitted_at,
    'reviewedAt', (p_submission).reviewed_at,
    'sourceKind', (p_submission).source_kind,
    'sourceSheet', (p_submission).source_sheet,
    'sourceRow', (p_submission).source_row,
    'importedAt', (p_submission).imported_at,
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
  canonical_stream text;
  description text;
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

  canonical_stream := workshop_private.canonical_workshop_value_stream(
    p_value_stream
  );
  description := coalesce(
    nullif(pg_catalog.btrim(p_use_cases[1]), ''),
    nullif(pg_catalog.btrim(p_use_cases[2]), ''),
    nullif(pg_catalog.btrim(p_use_cases[3]), ''),
    nullif(pg_catalog.btrim(p_use_cases[4]), ''),
    ''
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
    use_case_description,
    value_stream_1_selected,
    value_stream_2_selected,
    value_stream_3_selected,
    value_stream_4_selected,
    value_stream_name,
    expected_benefits,
    status,
    is_visible,
    created_at,
    updated_at,
    submitted_at,
    reviewed_at,
    source_kind
  ) values (
    pg_catalog.gen_random_uuid(),
    p_plant,
    pg_catalog.btrim(p_submitter_name),
    pg_catalog.btrim(p_submitter_email),
    pg_catalog.btrim(p_designation),
    pg_catalog.btrim(coalesce(p_use_cases[1], '')),
    pg_catalog.btrim(coalesce(p_use_cases[2], '')),
    pg_catalog.btrim(coalesce(p_use_cases[3], '')),
    pg_catalog.btrim(coalesce(p_use_cases[4], '')),
    description,
    canonical_stream = 'Productivity',
    canonical_stream = 'Quality',
    canonical_stream = 'Process Optimization',
    canonical_stream = 'Reliability',
    canonical_stream,
    pg_catalog.btrim(p_expected_benefits),
    'submitted',
    false,
    saved_at,
    saved_at,
    saved_at,
    null,
    'web'
  )
  returning * into submission;

  return pg_catalog.jsonb_build_object(
    'submission', workshop_private.submission_json(submission)
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
  existing public.workshop_submissions%rowtype;
  submission public.workshop_submissions%rowtype;
  saved_at timestamptz := pg_catalog.clock_timestamp();
  canonical_stream text;
  translated_title text := '';
  translated_description text := '';
begin
  perform workshop_private.require_admin_capability(p_capability);

  if p_id is null then
    raise exception using errcode = '22023', message = 'Response ID is required.';
  end if;
  if p_expected_updated_at is null then
    raise exception using errcode = '22023',
      message = 'The response version is required.';
  end if;
  if p_status is null
    or p_status not in ('draft', 'submitted', 'approved', 'rejected') then
    raise exception using errcode = '22023',
      message = 'Status must be draft, submitted, approved, or rejected.';
  end if;

  select response.*
  into existing
  from public.workshop_submissions as response
  where response.id = p_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Response not found.';
  end if;
  if existing.updated_at is distinct from p_expected_updated_at then
    raise exception using errcode = '40001',
      message = 'This response changed while it was being updated. Refresh and try again.';
  end if;

  -- This validates the fixed-slot shape and all non-completeness limits while
  -- allowing the Excel-specific contact exception to be applied below.
  perform workshop_private.validate_submission_input(
    p_plant,
    p_submitter_name,
    p_submitter_email,
    p_designation,
    p_use_cases,
    p_value_stream,
    p_expected_benefits,
    false
  );

  translated_title := case
    when pg_catalog.btrim(coalesce(p_use_cases[1], '')) <> '' then 'Use Case 1'
    when pg_catalog.btrim(coalesce(p_use_cases[2], '')) <> '' then 'Use Case 2'
    when pg_catalog.btrim(coalesce(p_use_cases[3], '')) <> '' then 'Use Case 3'
    when pg_catalog.btrim(coalesce(p_use_cases[4], '')) <> '' then 'Use Case 4'
    else ''
  end;
  translated_description := coalesce(
    nullif(pg_catalog.btrim(p_use_cases[1]), ''),
    nullif(pg_catalog.btrim(p_use_cases[2]), ''),
    nullif(pg_catalog.btrim(p_use_cases[3]), ''),
    nullif(pg_catalog.btrim(p_use_cases[4]), ''),
    ''
  );

  perform workshop_private.validate_workshop_response_input(
    p_plant,
    p_submitter_name,
    p_submitter_email,
    p_designation,
    translated_title,
    translated_description,
    p_value_stream,
    p_expected_benefits,
    existing.source_kind,
    p_status in ('submitted', 'approved')
  );

  canonical_stream := workshop_private.canonical_workshop_value_stream(
    p_value_stream
  );

  update public.workshop_submissions as response
  set
    plant = p_plant,
    submitter_name = pg_catalog.btrim(coalesce(p_submitter_name, '')),
    submitter_email = pg_catalog.btrim(coalesce(p_submitter_email, '')),
    designation = pg_catalog.btrim(coalesce(p_designation, '')),
    use_case_1 = pg_catalog.btrim(coalesce(p_use_cases[1], '')),
    use_case_2 = pg_catalog.btrim(coalesce(p_use_cases[2], '')),
    use_case_3 = pg_catalog.btrim(coalesce(p_use_cases[3], '')),
    use_case_4 = pg_catalog.btrim(coalesce(p_use_cases[4], '')),
    use_case_description = translated_description,
    value_stream_name = canonical_stream,
    value_stream_1_selected = canonical_stream = 'Productivity',
    value_stream_2_selected = canonical_stream = 'Quality',
    value_stream_3_selected = canonical_stream = 'Process Optimization',
    value_stream_4_selected = canonical_stream = 'Reliability',
    expected_benefits = pg_catalog.btrim(coalesce(p_expected_benefits, '')),
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
  existing public.workshop_submissions%rowtype;
  legacy_result jsonb;
  submission public.workshop_submissions%rowtype;
begin
  perform workshop_private.require_admin_capability(p_capability);

  if p_status is null
    or p_status not in ('draft', 'submitted', 'approved', 'rejected') then
    raise exception using errcode = '22023',
      message = 'Status must be draft, submitted, approved, or rejected.';
  end if;

  select response.*
  into existing
  from public.workshop_submissions as response
  where response.id = p_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'Response not found.';
  end if;

  perform workshop_private.validate_workshop_response_input(
    p_plant,
    p_submitter_name,
    p_submitter_email,
    p_designation,
    p_use_case_title,
    p_use_case_theme,
    p_value_stream,
    p_expected_benefits,
    existing.source_kind,
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
    array[pg_catalog.btrim(coalesce(p_use_case_theme, '')), '', '', '']::text[],
    p_value_stream,
    p_expected_benefits,
    p_status
  );

  update public.workshop_submissions as response
  set
    use_case_title = pg_catalog.btrim(coalesce(p_use_case_title, '')),
    use_case_theme = pg_catalog.btrim(coalesce(p_use_case_theme, '')),
    use_case_description = pg_catalog.btrim(coalesce(p_use_case_theme, ''))
  where response.id = p_id
  returning response.* into submission;

  return pg_catalog.jsonb_build_object(
    'submission', workshop_private.submission_json(submission)
  );
end;
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
        'createdAt', listed.created_at,
        'useCaseTitle', listed.use_case_title,
        'useCaseTheme', coalesce(
          nullif(listed.use_case_description, ''),
          listed.use_case_theme
        ),
        'useCaseDescription', coalesce(
          nullif(listed.use_case_description, ''),
          listed.use_case_theme
        ),
        'useCases', pg_catalog.jsonb_build_array(
          listed.use_case_1,
          listed.use_case_2,
          listed.use_case_3,
          listed.use_case_4
        ),
        'valueStreams', case
          when pg_catalog.btrim(listed.value_stream_name) = '' then '[]'::jsonb
          else pg_catalog.jsonb_build_array(listed.value_stream_name)
        end,
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
        pg_catalog.lower(pg_catalog.btrim(listed.use_case_title)),
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
      pg_catalog.lower(pg_catalog.btrim(response.use_case_title)),
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

create or replace function workshop_private.excel_batch_import(
  p_workbook_sha256 text,
  p_file_name text,
  p_entries jsonb,
  p_publish boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  workbook_sha256 text := pg_catalog.lower(
    pg_catalog.btrim(coalesce(p_workbook_sha256, ''))
  );
  payload_sha256 text;
  file_name text := pg_catalog.btrim(coalesce(p_file_name, ''));
  batch_id uuid;
  existing_batch workshop_private.excel_import_batches%rowtype;
  entry jsonb;
  entry_position integer;
  entry_count integer;
  duplicate_source_key text;
  source_key text;
  supplied_source_key text;
  source_sheet text;
  source_row integer;
  source_row_text text;
  source_serial text;
  source_serial_slug text;
  plant_slug text;
  plant text;
  submitter_name text;
  submitter_email text;
  designation text;
  use_case_title text;
  use_case_description text;
  raw_value_stream text;
  canonical_stream text;
  expected_benefits text;
  source_payload jsonb;
  fingerprint bytea;
  existing public.workshop_submissions%rowtype;
  inserted_id uuid;
  saved_at timestamptz := pg_catalog.clock_timestamp();
  missing_fields text[];
  inserted jsonb := '[]'::jsonb;
  unchanged jsonb := '[]'::jsonb;
  moved_duplicates jsonb := '[]'::jsonb;
  conflicts jsonb := '[]'::jsonb;
  incomplete jsonb := '[]'::jsonb;
  import_result jsonb;
begin
  -- Serialize the small, infrequent workshop imports so concurrent snapshots
  -- cannot split ownership of a source key or semantic fingerprint.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('birla-opus-excel-import-v1', 0)
  );

  if workbook_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023',
      message = 'Workbook SHA-256 must contain exactly 64 lowercase hexadecimal characters.';
  end if;
  if char_length(file_name) not between 1 and 260 then
    raise exception using errcode = '22023',
      message = 'Workbook file name must be between 1 and 260 characters.';
  end if;
  if p_publish is null then
    raise exception using errcode = '22023',
      message = 'Publish intent is required.';
  end if;
  if p_entries is null or pg_catalog.jsonb_typeof(p_entries) <> 'array' then
    raise exception using errcode = '22023',
      message = 'Workbook entries must be supplied as a JSON array.';
  end if;
  if octet_length(pg_catalog.convert_to(p_entries::text, 'UTF8')) > 5242880 then
    raise exception using errcode = '22023',
      message = 'Workbook import payload must be 5 MiB or smaller.';
  end if;

  entry_count := pg_catalog.jsonb_array_length(p_entries);
  if entry_count > 500 then
    raise exception using errcode = '22023',
      message = 'A workbook import may contain at most 500 entries.';
  end if;

  payload_sha256 := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(p_entries::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );

  select receipt.*
  into existing_batch
  from workshop_private.excel_import_batches as receipt
  where receipt.workbook_sha256 = workbook_sha256
    and receipt.payload_sha256 = payload_sha256
    and receipt.publish_requested = p_publish;

  if found then
    return existing_batch.result || pg_catalog.jsonb_build_object('replayed', true);
  end if;

  if exists (
    select 1
    from workshop_private.excel_import_batches as receipt
    where receipt.workbook_sha256 = workbook_sha256
      and receipt.payload_sha256 <> payload_sha256
  ) then
    raise exception using errcode = '22023',
      message = 'This workbook hash was previously imported with a different normalized payload.';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_entries) as listed(value)
    where pg_catalog.jsonb_typeof(listed.value) <> 'object'
  ) then
    raise exception using errcode = '22023',
      message = 'Every workbook entry must be a JSON object.';
  end if;

  select repeated.source_key
  into duplicate_source_key
  from (
    select
      pg_catalog.lower(
        pg_catalog.btrim(coalesce(listed.value ->> 'sourceKey', ''))
      ) as source_key,
      count(*) as occurrences
    from pg_catalog.jsonb_array_elements(p_entries) as listed(value)
    group by 1
  ) as repeated
  where repeated.source_key <> ''
    and repeated.occurrences > 1
  limit 1;

  if duplicate_source_key is not null then
    raise exception using errcode = '22023',
      message = 'Workbook payload contains a duplicate source key: ' || duplicate_source_key;
  end if;

  insert into workshop_private.excel_import_batches (
    workbook_sha256,
    payload_sha256,
    file_name,
    publish_requested,
    entry_count,
    inserted_count,
    unchanged_count,
    moved_duplicate_count,
    conflict_count,
    incomplete_count,
    imported_at,
    result
  ) values (
    workbook_sha256,
    payload_sha256,
    file_name,
    p_publish,
    entry_count,
    0,
    0,
    0,
    0,
    0,
    saved_at,
    pg_catalog.jsonb_build_object('state', 'processing')
  )
  returning id into batch_id;

  for entry, entry_position in
    select listed.value, listed.ordinality::integer
    from pg_catalog.jsonb_array_elements(p_entries)
      with ordinality as listed(value, ordinality)
  loop
    supplied_source_key := pg_catalog.lower(
      pg_catalog.btrim(coalesce(entry ->> 'sourceKey', ''))
    );
    source_sheet := pg_catalog.btrim(coalesce(entry ->> 'sourceSheet', ''));
    source_row_text := pg_catalog.btrim(coalesce(entry ->> 'sourceRow', ''));
    source_serial := pg_catalog.btrim(coalesce(entry ->> 'sourceSerial', ''));
    plant := pg_catalog.btrim(coalesce(entry ->> 'plant', ''));
    submitter_name := pg_catalog.btrim(coalesce(entry ->> 'submitterName', ''));
    submitter_email := pg_catalog.btrim(coalesce(entry ->> 'submitterEmail', ''));
    designation := pg_catalog.btrim(coalesce(entry ->> 'designation', ''));
    use_case_title := pg_catalog.btrim(coalesce(entry ->> 'useCaseTitle', ''));
    use_case_description := pg_catalog.btrim(coalesce(
      entry ->> 'useCaseDescription',
      entry ->> 'useCaseTheme',
      ''
    ));
    raw_value_stream := pg_catalog.btrim(coalesce(entry ->> 'valueStream', ''));
    canonical_stream := workshop_private.canonical_workshop_value_stream(
      raw_value_stream
    );
    expected_benefits := pg_catalog.btrim(coalesce(
      entry ->> 'expectedBenefits',
      ''
    ));

    if entry ? 'sourcePayload'
      and entry -> 'sourcePayload' <> 'null'::jsonb
      and pg_catalog.jsonb_typeof(entry -> 'sourcePayload') <> 'object' then
      raise exception using errcode = '22023',
        message = 'sourcePayload must be a JSON object at import position ' || entry_position::text || '.';
    end if;
    source_payload := coalesce(entry -> 'sourcePayload', entry);
    if source_payload = 'null'::jsonb then
      source_payload := entry;
    end if;
    if octet_length(pg_catalog.convert_to(source_payload::text, 'UTF8')) > 65536 then
      raise exception using errcode = '22023',
        message = 'One source row exceeds 64 KiB at import position ' || entry_position::text || '.';
    end if;

    if plant not in (
      'Panipat',
      'Ludhiana',
      'Cheyyar',
      'Chamarajanagar',
      'Mahad',
      'Kharagpur',
      'Head Office (Mumbai)'
    ) then
      raise exception using errcode = '22023',
        message = 'Unrecognised plant at import position ' || entry_position::text || '.';
    end if;
    if char_length(source_sheet) > 120
      or char_length(source_serial) > 80
      or char_length(submitter_name) > 120
      or char_length(submitter_email) > 254
      or char_length(designation) > 160
      or char_length(use_case_title) > 200
      or char_length(use_case_description) > 12000
      or char_length(expected_benefits) > 12000 then
      raise exception using errcode = '22023',
        message = 'A workbook field exceeds its length limit at import position ' || entry_position::text || '.';
    end if;
    if submitter_email <> '' and submitter_email
      !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
      raise exception using errcode = '22023',
        message = 'Invalid optional work email at import position ' || entry_position::text || '.';
    end if;
    if raw_value_stream <> '' and canonical_stream is null then
      raise exception using errcode = '22023',
        message = 'Unrecognised value stream at import position ' || entry_position::text || '.';
    end if;
    if source_row_text <> '' and source_row_text !~ '^[1-9][0-9]{0,6}$' then
      raise exception using errcode = '22023',
        message = 'sourceRow must be a positive integer at import position ' || entry_position::text || '.';
    end if;
    source_row := case
      when source_row_text = '' then null
      else source_row_text::integer
    end;

    plant_slug := case plant
      when 'Panipat' then 'panipat'
      when 'Ludhiana' then 'ludhiana'
      when 'Cheyyar' then 'cheyyar'
      when 'Chamarajanagar' then 'chamarajanagar'
      when 'Mahad' then 'mahad'
      when 'Kharagpur' then 'kharagpur'
      else 'head-office-mumbai'
    end;
    source_serial_slug := pg_catalog.btrim(
      pg_catalog.lower(
        pg_catalog.regexp_replace(source_serial, '[^a-zA-Z0-9]+', '-', 'g')
      ),
      '-'
    );
    source_key := case
      when source_serial_slug = '' then ''
      else 'excel-v1|' || plant_slug || '|' || source_serial_slug
    end;

    if supplied_source_key <> '' and supplied_source_key <> source_key then
      raise exception using errcode = '22023',
        message = 'sourceKey does not match plant and sourceSerial at import position ' || entry_position::text || '.';
    end if;

    missing_fields := '{}'::text[];
    if source_key = '' then
      missing_fields := pg_catalog.array_append(missing_fields, 'sourceKey');
    end if;
    if source_sheet = '' then
      missing_fields := pg_catalog.array_append(missing_fields, 'sourceSheet');
    end if;
    if source_row is null then
      missing_fields := pg_catalog.array_append(missing_fields, 'sourceRow');
    end if;
    if use_case_title = '' then
      missing_fields := pg_catalog.array_append(missing_fields, 'useCaseTitle');
    end if;
    if use_case_description = '' then
      missing_fields := pg_catalog.array_append(missing_fields, 'useCaseDescription');
    end if;
    if canonical_stream is null or canonical_stream = '' then
      missing_fields := pg_catalog.array_append(missing_fields, 'valueStream');
    end if;
    if expected_benefits = '' then
      missing_fields := pg_catalog.array_append(missing_fields, 'expectedBenefits');
    end if;

    if cardinality(missing_fields) > 0 then
      incomplete := incomplete || pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'position', entry_position,
          'sourceKey', nullif(source_key, ''),
          'sourceSheet', nullif(source_sheet, ''),
          'sourceRow', source_row,
          'missingFields', pg_catalog.to_jsonb(missing_fields)
        )
      );
      continue;
    end if;

    perform workshop_private.validate_workshop_response_input(
      plant,
      submitter_name,
      submitter_email,
      designation,
      use_case_title,
      use_case_description,
      canonical_stream,
      expected_benefits,
      'excel',
      true
    );

    fingerprint := workshop_private.excel_submission_fingerprint(
      plant,
      submitter_name,
      use_case_title,
      use_case_description,
      canonical_stream,
      expected_benefits
    );

    select response.*
    into existing
    from public.workshop_submissions as response
    where response.source_kind = 'excel'
      and response.source_key = source_key;

    if found then
      if existing.source_fingerprint = fingerprint then
        unchanged := unchanged || pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object(
            'sourceKey', source_key,
            'submissionId', existing.id
          )
        );
      else
        conflicts := conflicts || pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object(
            'sourceKey', source_key,
            'submissionId', existing.id,
            'reason', 'source_key_changed'
          )
        );
      end if;
      continue;
    end if;

    select response.*
    into existing
    from public.workshop_submissions as response
    where response.source_kind = 'excel'
      and response.source_fingerprint = fingerprint;

    if found then
      moved_duplicates := moved_duplicates || pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'sourceKey', source_key,
          'existingSourceKey', existing.source_key,
          'submissionId', existing.id
        )
      );
      continue;
    end if;

    inserted_id := null;
    insert into public.workshop_submissions (
      id,
      plant,
      submitter_name,
      submitter_email,
      designation,
      use_case_title,
      use_case_theme,
      use_case_description,
      use_case_1,
      use_case_2,
      use_case_3,
      use_case_4,
      value_stream_1_selected,
      value_stream_2_selected,
      value_stream_3_selected,
      value_stream_4_selected,
      value_stream_name,
      expected_benefits,
      status,
      is_visible,
      created_at,
      updated_at,
      submitted_at,
      reviewed_at,
      source_kind,
      source_key,
      source_fingerprint,
      source_sheet,
      source_row,
      source_payload,
      import_batch_id,
      imported_at
    ) values (
      pg_catalog.gen_random_uuid(),
      plant,
      submitter_name,
      submitter_email,
      designation,
      use_case_title,
      use_case_description,
      use_case_description,
      use_case_description,
      '',
      '',
      '',
      canonical_stream = 'Productivity',
      canonical_stream = 'Quality',
      canonical_stream = 'Process Optimization',
      canonical_stream = 'Reliability',
      canonical_stream,
      expected_benefits,
      case when p_publish then 'approved' else 'submitted' end,
      p_publish,
      saved_at + ((entry_position - 1) * interval '1 microsecond'),
      saved_at,
      saved_at,
      case when p_publish then saved_at else null end,
      'excel',
      source_key,
      fingerprint,
      source_sheet,
      source_row,
      source_payload,
      batch_id,
      saved_at
    )
    on conflict do nothing
    returning id into inserted_id;

    if inserted_id is null then
      raise exception using errcode = '40001',
        message = 'The workbook import changed concurrently. Retry the batch.';
    end if;

    inserted := inserted || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'sourceKey', source_key,
        'submissionId', inserted_id,
        'published', p_publish
      )
    );
  end loop;

  import_result := pg_catalog.jsonb_build_object(
    'batchId', batch_id,
    'workbookSha256', workbook_sha256,
    'payloadSha256', payload_sha256,
    'fileName', file_name,
    'publishRequested', p_publish,
    'replayed', false,
    'counts', pg_catalog.jsonb_build_object(
      'entries', entry_count,
      'inserted', pg_catalog.jsonb_array_length(inserted),
      'unchanged', pg_catalog.jsonb_array_length(unchanged),
      'movedDuplicates', pg_catalog.jsonb_array_length(moved_duplicates),
      'conflicts', pg_catalog.jsonb_array_length(conflicts),
      'incomplete', pg_catalog.jsonb_array_length(incomplete)
    ),
    'inserted', inserted,
    'unchanged', unchanged,
    'movedDuplicates', moved_duplicates,
    'conflicts', conflicts,
    'incomplete', incomplete
  );

  update workshop_private.excel_import_batches as receipt
  set
    inserted_count = pg_catalog.jsonb_array_length(inserted),
    unchanged_count = pg_catalog.jsonb_array_length(unchanged),
    moved_duplicate_count = pg_catalog.jsonb_array_length(moved_duplicates),
    conflict_count = pg_catalog.jsonb_array_length(conflicts),
    incomplete_count = pg_catalog.jsonb_array_length(incomplete),
    result = import_result
  where receipt.id = batch_id;

  return import_result;
end;
$function$;

create or replace function public.workshop_admin_excel_batch_import(
  p_capability text,
  p_workbook_sha256 text,
  p_file_name text,
  p_entries jsonb,
  p_publish boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
begin
  -- Authenticate before the private worker parses or expands the JSON payload.
  perform workshop_private.require_admin_capability(p_capability);
  return workshop_private.excel_batch_import(
    p_workbook_sha256,
    p_file_name,
    p_entries,
    p_publish
  );
end;
$function$;

alter table public.workshop_submissions enable row level security;
revoke all on table public.workshop_submissions
  from public, anon, authenticated;

revoke all on function workshop_private.canonical_workshop_value_stream(text)
  from public, anon, authenticated, service_role;
revoke all on function workshop_private.normalise_excel_fingerprint_text(text)
  from public, anon, authenticated, service_role;
revoke all on function workshop_private.excel_submission_fingerprint(
  text, text, text, text, text, text
) from public, anon, authenticated, service_role;
revoke all on function workshop_private.sync_workshop_value_stream_name()
  from public, anon, authenticated, service_role;
revoke all on function workshop_private.sync_workshop_use_case_description()
  from public, anon, authenticated, service_role;
revoke all on function workshop_private.validate_workshop_response_input(
  text, text, text, text, text, text, text, text, text, boolean
) from public, anon, authenticated, service_role;
revoke all on function workshop_private.validate_single_use_case_input(
  text, text, text, text, text, text, text, text, boolean
) from public, anon, authenticated, service_role;
revoke all on function workshop_private.validate_submission_input(
  text, text, text, text, text[], text, text, boolean
) from public, anon, authenticated, service_role;
revoke all on function workshop_private.submission_json(
  public.workshop_submissions
) from public, anon, authenticated, service_role;
revoke all on function workshop_private.excel_batch_import(
  text, text, jsonb, boolean
) from public, anon, authenticated, service_role;

revoke all on function public.workshop_admin_excel_batch_import(
  text, text, text, jsonb, boolean
) from public, anon, authenticated, service_role;

grant execute on function public.workshop_admin_excel_batch_import(
  text, text, text, jsonb, boolean
) to anon;

comment on function workshop_private.excel_batch_import(
  text, text, jsonb, boolean
) is
  'Trusted atomic Excel worker. It is revoked from API roles and may be called directly only from a trusted SQL editor session.';

comment on function public.workshop_admin_excel_batch_import(
  text, text, text, jsonb, boolean
) is
  'Capability-protected atomic Excel import. It inserts only new complete rows and reports unchanged, moved, conflicting, and incomplete rows without overwriting.';

notify pgrst, 'reload schema';
