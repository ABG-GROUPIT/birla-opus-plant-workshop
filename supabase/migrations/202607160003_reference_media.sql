-- Optional leader reference material for the static workshop site.
--
-- Files are served from a public bucket because the presentation itself is
-- public. Uploads remain tightly scoped: an anonymous browser must first
-- create a one-hour session and may then write only one of that session's
-- three fixed, unguessable object paths. Direct reference/session table access
-- remains RLS-protected and revoked.

-- Keep URL and file-shape validation in one place so the RPC and table
-- constraints cannot drift apart.
create or replace function workshop_private.is_workshop_https_url(
  p_url text
)
returns boolean
language sql
immutable
set search_path = ''
as $function$
  select p_url is not null
    and char_length(btrim(p_url)) between 1 and 2048
    and btrim(p_url) ~*
      '^https://[a-z0-9][a-z0-9.-]*(:[0-9]{1,5})?([/?#][^[:space:]]*)?$';
$function$;

create or replace function workshop_private.is_workshop_reference_file(
  p_kind text,
  p_file_name text,
  p_mime_type text
)
returns boolean
language sql
immutable
set search_path = ''
as $function$
  select case btrim(coalesce(p_kind, ''))
    when 'pdf' then
      lower(btrim(coalesce(p_mime_type, ''))) = 'application/pdf'
      and lower(btrim(coalesce(p_file_name, ''))) ~ '[.]pdf$'
    when 'powerpoint' then
      lower(btrim(coalesce(p_mime_type, ''))) =
        'application/vnd.openxmlformats-officedocument.presentationml.presentation'
      and lower(btrim(coalesce(p_file_name, ''))) ~ '[.]pptx$'
    when 'word' then
      lower(btrim(coalesce(p_mime_type, ''))) =
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      and lower(btrim(coalesce(p_file_name, ''))) ~ '[.]docx$'
    when 'spreadsheet' then
      lower(btrim(coalesce(p_mime_type, ''))) =
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      and lower(btrim(coalesce(p_file_name, ''))) ~ '[.]xlsx$'
    when 'image' then
      (
        lower(btrim(coalesce(p_mime_type, ''))) = 'image/jpeg'
        and lower(btrim(coalesce(p_file_name, ''))) ~ '[.]jpe?g$'
      ) or (
        lower(btrim(coalesce(p_mime_type, ''))) = 'image/png'
        and lower(btrim(coalesce(p_file_name, ''))) ~ '[.]png$'
      ) or (
        lower(btrim(coalesce(p_mime_type, ''))) = 'image/webp'
        and lower(btrim(coalesce(p_file_name, ''))) ~ '[.]webp$'
      )
    else false
  end;
$function$;

-- The raw upload token is returned once and is never stored in this table.
-- Storage object paths use <session UUID>/<raw token>/<slot 1..3>; by the time
-- those paths are published the session has already been consumed.
create table if not exists workshop_private.reference_upload_sessions (
  id uuid primary key,
  token_hash bytea not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  submission_id uuid unique references public.workshop_submissions (id)
    on delete set null,
  constraint reference_upload_sessions_token_hash_length_check
    check (octet_length(token_hash) = 32),
  constraint reference_upload_sessions_expiry_check
    check (expires_at > created_at),
  constraint reference_upload_sessions_consumption_check
    check (
      (consumed_at is null and submission_id is null)
      or (consumed_at is not null and submission_id is not null)
    )
);

create index if not exists reference_upload_sessions_active_idx
  on workshop_private.reference_upload_sessions (expires_at)
  where consumed_at is null;

alter table workshop_private.reference_upload_sessions enable row level security;
revoke all on table workshop_private.reference_upload_sessions
  from public, anon, authenticated, service_role;

create table if not exists public.workshop_submission_references (
  id uuid primary key,
  submission_id uuid not null references public.workshop_submissions (id)
    on delete cascade,
  title text not null,
  kind text not null,
  external_url text,
  object_path text,
  file_name text,
  mime_type text,
  size_bytes bigint,
  is_visible boolean not null default true,
  sort_order smallint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workshop_submission_references_title_check check (
    char_length(btrim(title)) between 1 and 120
  ),
  constraint workshop_submission_references_kind_check check (
    kind in ('link', 'pdf', 'powerpoint', 'word', 'spreadsheet', 'image')
  ),
  constraint workshop_submission_references_sort_order_check check (
    sort_order between 0 and 3
  ),
  constraint workshop_submission_references_shape_check check (
    (
      kind = 'link'
      and workshop_private.is_workshop_https_url(external_url)
      and object_path is null
      and file_name is null
      and mime_type is null
      and size_bytes is null
    )
    or (
      kind <> 'link'
      and external_url is null
      and object_path is not null
      and file_name is not null
      and mime_type is not null
      and size_bytes is not null
      and char_length(btrim(object_path)) between 1 and 220
      and object_path ~
        '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{64}/[123]$'
      and char_length(btrim(file_name)) between 1 and 255
      and position('/' in file_name) = 0
      and position(chr(92) in file_name) = 0
      and char_length(btrim(mime_type)) between 1 and 160
      and size_bytes between 1 and 10485760
      and workshop_private.is_workshop_reference_file(
        kind,
        file_name,
        mime_type
      )
    )
  ),
  constraint workshop_submission_references_submission_order_key
    unique (submission_id, sort_order),
  constraint workshop_submission_references_object_path_key
    unique (object_path)
);

create index if not exists workshop_submission_references_submission_idx
  on public.workshop_submission_references (
    submission_id,
    is_visible,
    sort_order
  );

alter table public.workshop_submission_references enable row level security;
revoke all on table public.workshop_submission_references
  from public, anon, authenticated;
grant select, insert, update, delete
  on table public.workshop_submission_references to service_role;

-- Public file delivery is intentional for this one-day public presentation.
-- Upload restrictions are enforced again by the Storage service before RLS.
insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'workshop-references',
  'workshop-references',
  true,
  10485760,
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'image/jpeg',
    'image/png',
    'image/webp'
  ]::text[]
)
on conflict (id) do update
set
  name = excluded.name,
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- RLS calls this function for one exact object name. FOR SHARE makes upload
-- attempts wait while submission finalization consumes the session, closing a
-- race in which an extra slot could otherwise arrive during finalization.
create or replace function workshop_private.workshop_reference_upload_allowed(
  p_object_path text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  path_parts text[];
  parsed_session_id uuid;
  raw_token text;
  slot text;
  matched_session_id uuid;
  existing_object_count integer;
begin
  path_parts := pg_catalog.string_to_array(coalesce(p_object_path, ''), '/');
  if pg_catalog.cardinality(path_parts) <> 3 then
    return false;
  end if;

  raw_token := path_parts[2];
  slot := path_parts[3];
  if raw_token !~ '^[0-9a-f]{64}$' or slot not in ('1', '2', '3') then
    return false;
  end if;

  begin
    parsed_session_id := path_parts[1]::uuid;
  exception
    when invalid_text_representation then
      return false;
  end;

  if path_parts[1] <> parsed_session_id::text then
    return false;
  end if;

  select upload_session.id
  into matched_session_id
  from workshop_private.reference_upload_sessions as upload_session
  where upload_session.id = parsed_session_id
    and upload_session.token_hash = extensions.digest(
      pg_catalog.convert_to(raw_token, 'UTF8'),
      'sha256'
    )
    and upload_session.consumed_at is null
    and upload_session.expires_at > pg_catalog.statement_timestamp()
  for share;

  if not found then
    return false;
  end if;

  select count(*)::integer
  into existing_object_count
  from storage.objects as stored_object
  where stored_object.bucket_id = 'workshop-references'
    and pg_catalog.split_part(stored_object.name, '/', 1) =
      parsed_session_id::text
    and pg_catalog.split_part(stored_object.name, '/', 2) = raw_token
    and pg_catalog.split_part(stored_object.name, '/', 3) in ('1', '2', '3')
    and pg_catalog.split_part(stored_object.name, '/', 4) = '';

  return existing_object_count < 3;
end;
$function$;

-- Grant only what the bucket policy needs. workshop_private is not an exposed
-- Data API schema, and all other private functions retain their own revokes.
grant usage on schema workshop_private to anon;
revoke all on function workshop_private.workshop_reference_upload_allowed(
  text
) from public, authenticated, service_role;
grant execute on function workshop_private.workshop_reference_upload_allowed(
  text
) to anon;

drop policy if exists "Workshop reference uploads use active sessions"
  on storage.objects;
create policy "Workshop reference uploads use active sessions"
on storage.objects
for insert
to anon
with check (
  bucket_id = 'workshop-references'
  and workshop_private.workshop_reference_upload_allowed(name)
);

-- Do not add a SELECT policy for this bucket. Public object retrieval uses the
-- public asset endpoint, while authenticated object listing remains denied.
drop policy if exists "Workshop reference uploads may return metadata"
  on storage.objects;

create or replace function workshop_private.workshop_reference_json(
  p_reference public.workshop_submission_references
)
returns jsonb
language sql
immutable
set search_path = ''
as $function$
  select pg_catalog.jsonb_build_object(
    'id', (p_reference).id,
    'title', (p_reference).title,
    'kind', (p_reference).kind,
    'externalUrl', (p_reference).external_url,
    'objectPath', (p_reference).object_path,
    'fileName', (p_reference).file_name,
    'mimeType', (p_reference).mime_type,
    'sizeBytes', (p_reference).size_bytes,
    'isVisible', (p_reference).is_visible,
    'sortOrder', (p_reference).sort_order
  );
$function$;

-- Preserve the existing response shape and add complete admin reference data.
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

create or replace function public.workshop_media_session_create()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  session_id uuid := pg_catalog.gen_random_uuid();
  raw_token text := pg_catalog.encode(extensions.gen_random_bytes(32), 'hex');
  expires_at timestamptz := pg_catalog.clock_timestamp() + interval '1 hour';
begin
  insert into workshop_private.reference_upload_sessions (
    id,
    token_hash,
    created_at,
    expires_at
  ) values (
    session_id,
    extensions.digest(pg_catalog.convert_to(raw_token, 'UTF8'), 'sha256'),
    pg_catalog.clock_timestamp(),
    expires_at
  );

  return pg_catalog.jsonb_build_object(
    'sessionId', session_id,
    'uploadToken', raw_token,
    'expiresAt', expires_at
  );
end;
$function$;

create or replace function public.workshop_submit_with_references(
  p_plant text,
  p_submitter_name text,
  p_submitter_email text,
  p_designation text,
  p_use_cases text[],
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
  upload_session workshop_private.reference_upload_sessions%rowtype;
  reference_item jsonb;
  normalized_references jsonb := '[]'::jsonb;
  reference_position integer;
  reference_count integer;
  link_count integer := 0;
  file_count integer := 0;
  total_file_bytes bigint := 0;
  used_sort_orders integer[] := '{}'::integer[];
  reference_title text;
  reference_kind text;
  external_url text;
  object_path text;
  file_name text;
  mime_type text;
  size_bytes bigint;
  size_text text;
  sort_order integer;
  sort_order_text text;
  expected_object_path text;
  stored_metadata jsonb;
  stored_mime_type text;
  stored_size_text text;
  stored_size_bytes bigint;
  session_object_count integer;
  submission_result jsonb;
  new_submission_id uuid;
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

  if p_references is null then
    p_references := '[]'::jsonb;
  end if;
  if pg_catalog.jsonb_typeof(p_references) <> 'array' then
    raise exception using
      errcode = '22023',
      message = 'Reference material must be supplied as an array.';
  end if;

  reference_count := pg_catalog.jsonb_array_length(p_references);
  if reference_count > 4 then
    raise exception using
      errcode = '22023',
      message = 'A response may contain at most four references.';
  end if;

  if (p_media_session_id is null) <> (p_media_upload_token is null) then
    raise exception using
      errcode = '22023',
      message = 'Both the media session ID and upload token are required.';
  end if;

  if p_media_session_id is not null then
    if char_length(p_media_upload_token) <> 64
      or p_media_upload_token !~ '^[0-9a-f]{64}$' then
      raise exception using
        errcode = '28000',
        message = 'The reference upload session is invalid or has expired.';
    end if;

    select candidate.*
    into upload_session
    from workshop_private.reference_upload_sessions as candidate
    where candidate.id = p_media_session_id
      and candidate.token_hash = extensions.digest(
        pg_catalog.convert_to(p_media_upload_token, 'UTF8'),
        'sha256'
      )
      and candidate.consumed_at is null
      and candidate.expires_at > pg_catalog.statement_timestamp()
    for update;

    if not found then
      raise exception using
        errcode = '28000',
        message = 'The reference upload session is invalid or has expired.';
    end if;
  end if;

  for reference_item, reference_position in
    select listed.value, listed.ordinality::integer
    from pg_catalog.jsonb_array_elements(p_references)
      with ordinality as listed(value, ordinality)
  loop
    if pg_catalog.jsonb_typeof(reference_item) <> 'object' then
      raise exception using
        errcode = '22023',
        message = 'Every reference must be an object.';
    end if;

    reference_title := btrim(coalesce(reference_item ->> 'title', ''));
    reference_kind := btrim(coalesce(reference_item ->> 'kind', ''));
    if char_length(reference_title) not between 1 and 120 then
      raise exception using
        errcode = '22023',
        message = 'Each reference title must be between 1 and 120 characters.';
    end if;
    if reference_kind not in (
      'link',
      'pdf',
      'powerpoint',
      'word',
      'spreadsheet',
      'image'
    ) then
      raise exception using
        errcode = '22023',
        message = 'A reference has an unsupported type.';
    end if;

    sort_order_text := reference_item ->> 'sortOrder';
    if sort_order_text is null then
      sort_order := reference_position - 1;
    elsif sort_order_text !~ '^[0-9]+$' then
      raise exception using
        errcode = '22023',
        message = 'Reference ordering must use whole numbers.';
    else
      sort_order := sort_order_text::integer;
    end if;

    if sort_order < 0 or sort_order >= reference_count
      or sort_order = any(used_sort_orders) then
      raise exception using
        errcode = '22023',
        message = 'Reference ordering must be unique and consecutive.';
    end if;
    used_sort_orders := pg_catalog.array_append(used_sort_orders, sort_order);

    external_url := nullif(
      btrim(coalesce(reference_item ->> 'externalUrl', '')),
      ''
    );
    object_path := nullif(
      btrim(coalesce(reference_item ->> 'objectPath', '')),
      ''
    );
    file_name := nullif(
      btrim(coalesce(reference_item ->> 'fileName', '')),
      ''
    );
    mime_type := nullif(
      lower(btrim(coalesce(reference_item ->> 'mimeType', ''))),
      ''
    );

    if reference_kind = 'link' then
      link_count := link_count + 1;
      if link_count > 2 then
        raise exception using
          errcode = '22023',
          message = 'A response may contain at most two HTTPS links.';
      end if;
      if not workshop_private.is_workshop_https_url(external_url) then
        raise exception using
          errcode = '22023',
          message = 'Reference links must use a valid HTTPS URL.';
      end if;

      normalized_references := normalized_references ||
        pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object(
            'title', reference_title,
            'kind', reference_kind,
            'externalUrl', external_url,
            'objectPath', null,
            'fileName', null,
            'mimeType', null,
            'sizeBytes', null,
            'sortOrder', sort_order
          )
        );
      continue;
    end if;

    file_count := file_count + 1;
    if file_count > 3 then
      raise exception using
        errcode = '22023',
        message = 'A response may contain at most three uploaded files.';
    end if;
    if p_media_session_id is null then
      raise exception using
        errcode = '22023',
        message = 'Uploaded references require an active media session.';
    end if;

    if reference_item -> 'sizeBytes' is null
      or pg_catalog.jsonb_typeof(reference_item -> 'sizeBytes') <> 'number' then
      raise exception using
        errcode = '22023',
        message = 'Every uploaded reference must include its size.';
    end if;
    size_text := reference_item ->> 'sizeBytes';
    if size_text !~ '^[0-9]+$' then
      raise exception using
        errcode = '22023',
        message = 'Uploaded reference size must be a whole number of bytes.';
    end if;
    size_bytes := size_text::bigint;

    if size_bytes not between 1 and 10485760 then
      raise exception using
        errcode = '22023',
        message = 'Each uploaded reference must be 10 MiB or smaller.';
    end if;
    total_file_bytes := total_file_bytes + size_bytes;
    if total_file_bytes > 26214400 then
      raise exception using
        errcode = '22023',
        message = 'Uploaded references may total at most 25 MiB.';
    end if;

    if not workshop_private.is_workshop_reference_file(
      reference_kind,
      file_name,
      mime_type
    ) then
      raise exception using
        errcode = '22023',
        message = 'A reference file name or media type is not allowed.';
    end if;

    expected_object_path := p_media_session_id::text || '/' ||
      p_media_upload_token || '/' || file_count::text;
    if object_path is distinct from expected_object_path then
      raise exception using
        errcode = '22023',
        message = 'A reference file does not match its assigned upload slot.';
    end if;

    select stored_object.metadata
    into stored_metadata
    from storage.objects as stored_object
    where stored_object.bucket_id = 'workshop-references'
      and stored_object.name = object_path;

    if not found then
      raise exception using
        errcode = '22023',
        message = 'A reference file has not finished uploading.';
    end if;

    stored_mime_type := lower(coalesce(
      stored_metadata ->> 'mimetype',
      stored_metadata ->> 'contentType',
      ''
    ));
    stored_size_text := coalesce(
      stored_metadata ->> 'size',
      stored_metadata ->> 'contentLength'
    );
    if stored_size_text is null or stored_size_text !~ '^[0-9]+$' then
      raise exception using
        errcode = '22023',
        message = 'A reference file has invalid stored metadata.';
    end if;
    stored_size_bytes := stored_size_text::bigint;

    if stored_mime_type <> mime_type or stored_size_bytes <> size_bytes then
      raise exception using
        errcode = '22023',
        message = 'A reference file does not match its upload manifest.';
    end if;

    normalized_references := normalized_references ||
      pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'title', reference_title,
          'kind', reference_kind,
          'externalUrl', null,
          'objectPath', object_path,
          'fileName', file_name,
          'mimeType', mime_type,
          'sizeBytes', size_bytes,
          'sortOrder', sort_order
        )
      );
  end loop;

  if file_count > 0 and p_media_session_id is null then
    raise exception using
      errcode = '22023',
      message = 'Uploaded references require an active media session.';
  end if;

  if p_media_session_id is not null then
    select count(*)::integer
    into session_object_count
    from storage.objects as stored_object
    where stored_object.bucket_id = 'workshop-references'
      and pg_catalog.split_part(stored_object.name, '/', 1) =
        p_media_session_id::text
      and pg_catalog.split_part(stored_object.name, '/', 2) =
        p_media_upload_token
      and pg_catalog.split_part(stored_object.name, '/', 3) in ('1', '2', '3')
      and pg_catalog.split_part(stored_object.name, '/', 4) = '';

    if session_object_count <> file_count then
      raise exception using
        errcode = '22023',
        message = 'The uploaded files do not match the submitted references.';
    end if;
  end if;

  submission_result := public.workshop_submit(
    p_plant,
    p_submitter_name,
    p_submitter_email,
    p_designation,
    p_use_cases,
    p_value_stream,
    p_expected_benefits
  );
  new_submission_id := (submission_result -> 'submission' ->> 'id')::uuid;

  insert into public.workshop_submission_references (
    id,
    submission_id,
    title,
    kind,
    external_url,
    object_path,
    file_name,
    mime_type,
    size_bytes,
    is_visible,
    sort_order,
    created_at,
    updated_at
  )
  select
    pg_catalog.gen_random_uuid(),
    new_submission_id,
    normalized.value ->> 'title',
    normalized.value ->> 'kind',
    nullif(normalized.value ->> 'externalUrl', ''),
    nullif(normalized.value ->> 'objectPath', ''),
    nullif(normalized.value ->> 'fileName', ''),
    nullif(normalized.value ->> 'mimeType', ''),
    case
      when normalized.value -> 'sizeBytes' = 'null'::jsonb then null
      else (normalized.value ->> 'sizeBytes')::bigint
    end,
    true,
    (normalized.value ->> 'sortOrder')::smallint,
    saved_at,
    saved_at
  from pg_catalog.jsonb_array_elements(normalized_references)
    as normalized(value);

  if p_media_session_id is not null then
    update workshop_private.reference_upload_sessions as consumed_session
    set
      consumed_at = saved_at,
      submission_id = new_submission_id
    where consumed_session.id = p_media_session_id;
  end if;

  select response.*
  into submission
  from public.workshop_submissions as response
  where response.id = new_submission_id;

  return pg_catalog.jsonb_build_object(
    'submission', workshop_private.submission_json(submission)
  );
end;
$function$;

create or replace function public.workshop_admin_reference_update(
  p_capability text,
  p_reference_id uuid,
  p_title text,
  p_external_url text,
  p_is_visible boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  reference public.workshop_submission_references%rowtype;
  normalized_title text := btrim(coalesce(p_title, ''));
  normalized_url text := nullif(btrim(coalesce(p_external_url, '')), '');
begin
  perform workshop_private.require_admin_capability(p_capability);

  if p_reference_id is null then
    raise exception using
      errcode = '22023',
      message = 'Reference ID is required.';
  end if;
  if char_length(normalized_title) not between 1 and 120 then
    raise exception using
      errcode = '22023',
      message = 'Reference title must be between 1 and 120 characters.';
  end if;
  if p_is_visible is null then
    raise exception using
      errcode = '22023',
      message = 'Reference visibility is required.';
  end if;

  select existing.*
  into reference
  from public.workshop_submission_references as existing
  where existing.id = p_reference_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'Reference not found.';
  end if;

  if reference.kind = 'link' then
    if not workshop_private.is_workshop_https_url(normalized_url) then
      raise exception using
        errcode = '22023',
        message = 'Reference links must use a valid HTTPS URL.';
    end if;
  elsif normalized_url is not null then
    raise exception using
      errcode = '22023',
      message = 'Only link references may have an external URL.';
  end if;

  update public.workshop_submission_references as changed
  set
    title = normalized_title,
    external_url = case
      when reference.kind = 'link' then normalized_url
      else null
    end,
    is_visible = p_is_visible,
    updated_at = pg_catalog.clock_timestamp()
  where changed.id = p_reference_id
  returning changed.* into reference;

  return pg_catalog.jsonb_build_object(
    'reference', workshop_private.workshop_reference_json(reference)
  );
end;
$function$;

-- Presentation-safe list: approved responses and only references the admin has
-- left visible. Leader email/designation remain excluded as before.
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

-- submission_json now supplies all reference rows, including hidden ones.
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

revoke all on function workshop_private.is_workshop_https_url(text)
  from public, anon, authenticated, service_role;
revoke all on function workshop_private.is_workshop_reference_file(
  text,
  text,
  text
) from public, anon, authenticated, service_role;
revoke all on function workshop_private.workshop_reference_json(
  public.workshop_submission_references
) from public, anon, authenticated, service_role;
revoke all on function workshop_private.submission_json(
  public.workshop_submissions
) from public, anon, authenticated, service_role;

revoke all on function public.workshop_media_session_create()
  from public, anon, authenticated, service_role;
revoke all on function public.workshop_submit_with_references(
  text,
  text,
  text,
  text,
  text[],
  text,
  text,
  uuid,
  text,
  jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.workshop_admin_reference_update(
  text,
  uuid,
  text,
  text,
  boolean
) from public, anon, authenticated, service_role;

grant execute on function public.workshop_media_session_create() to anon;
grant execute on function public.workshop_submit_with_references(
  text,
  text,
  text,
  text,
  text[],
  text,
  text,
  uuid,
  text,
  jsonb
) to anon;
grant execute on function public.workshop_admin_reference_update(
  text,
  uuid,
  text,
  text,
  boolean
) to anon;

comment on function public.workshop_media_session_create() is
  'Creates a one-hour, three-slot anonymous reference upload capability.';
comment on function public.workshop_submit_with_references(
  text,
  text,
  text,
  text,
  text[],
  text,
  text,
  uuid,
  text,
  jsonb
) is
  'Atomically validates a leader response, uploaded objects, and optional reference metadata.';
comment on function public.workshop_admin_reference_update(
  text,
  uuid,
  text,
  text,
  boolean
) is
  'Edits a reference title/link or hides it using the workshop admin capability.';

notify pgrst, 'reload schema';
