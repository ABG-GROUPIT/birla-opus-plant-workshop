-- Production Supabase/Postgres schema for the Birla Opus workshop.
-- Run this once through Supabase migrations or the Dashboard SQL editor.

create table if not exists public.workshop_submissions (
  id uuid primary key,
  plant text not null,
  submitter_name text not null default '',
  submitter_email text not null default '',
  designation text not null default '',
  use_case_1 text not null default '',
  use_case_2 text not null default '',
  use_case_3 text not null default '',
  use_case_4 text not null default '',
  value_stream_1_selected boolean not null default false,
  value_stream_2_selected boolean not null default false,
  value_stream_3_selected boolean not null default false,
  value_stream_4_selected boolean not null default false,
  expected_benefits text not null default '',
  status text not null default 'draft',
  is_visible boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  submitted_at timestamptz,
  reviewed_at timestamptz,
  constraint workshop_submissions_plant_check check (
    plant in (
      'Panipat',
      'Ludhiana',
      'Cheyyar',
      'Chamarajanagar',
      'Mahad',
      'Kharagpur'
    )
  ),
  constraint workshop_submissions_status_check check (
    status in ('draft', 'submitted', 'approved', 'rejected')
  ),
  constraint workshop_submissions_visibility_check check (
    not is_visible or status = 'approved'
  ),
  constraint workshop_submissions_complete_response_check check (
    status not in ('submitted', 'approved')
    or (
      btrim(submitter_name) <> ''
      and btrim(submitter_email) <> ''
      and btrim(designation) <> ''
      and btrim(expected_benefits) <> ''
      and (
        (case when btrim(use_case_1) <> '' then 1 else 0 end)
        + (case when btrim(use_case_2) <> '' then 1 else 0 end)
        + (case when btrim(use_case_3) <> '' then 1 else 0 end)
        + (case when btrim(use_case_4) <> '' then 1 else 0 end)
      ) = 1
      and (
        (case when value_stream_1_selected then 1 else 0 end)
        + (case when value_stream_2_selected then 1 else 0 end)
        + (case when value_stream_3_selected then 1 else 0 end)
        + (case when value_stream_4_selected then 1 else 0 end)
      ) = 1
    )
  )
);

create index if not exists workshop_submissions_plant_idx
  on public.workshop_submissions (plant);

create index if not exists workshop_submissions_status_visibility_idx
  on public.workshop_submissions (status, is_visible);

create index if not exists workshop_submissions_created_at_idx
  on public.workshop_submissions (created_at desc);

-- Keep the Data API table private. The website's server-side API is the only
-- public entry point and uses a Supabase secret key.
alter table public.workshop_submissions enable row level security;
revoke all on table public.workshop_submissions from anon, authenticated;
grant select, insert, update, delete on table public.workshop_submissions
  to service_role;

-- Lightweight audit metadata records which fields changed without duplicating
-- leader names, email addresses, or freehand response text.
create table if not exists public.workshop_submission_audit (
  id bigint generated always as identity primary key,
  submission_id uuid not null,
  action text not null check (action in ('insert', 'update', 'delete')),
  changed_fields text[] not null default '{}',
  previous_status text,
  new_status text,
  previous_is_visible boolean,
  new_is_visible boolean,
  changed_at timestamptz not null default now()
);

create index if not exists workshop_submission_audit_submission_idx
  on public.workshop_submission_audit (submission_id, changed_at desc);

alter table public.workshop_submission_audit enable row level security;
revoke all on table public.workshop_submission_audit from anon, authenticated;
grant select on table public.workshop_submission_audit to service_role;
grant usage, select on sequence public.workshop_submission_audit_id_seq
  to service_role;

create or replace function public.record_workshop_submission_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  fields text[];
begin
  if tg_op = 'INSERT' then
    fields := array['record_created'];
  elsif tg_op = 'DELETE' then
    fields := array['record_deleted'];
  else
    select coalesce(array_agg(key order by key), '{}'::text[])
      into fields
      from jsonb_each(to_jsonb(new)) as next_value(key, value)
      where to_jsonb(old) -> next_value.key is distinct from next_value.value;
  end if;

  insert into public.workshop_submission_audit (
    submission_id,
    action,
    changed_fields,
    previous_status,
    new_status,
    previous_is_visible,
    new_is_visible
  ) values (
    case when tg_op = 'DELETE' then old.id else new.id end,
    lower(tg_op),
    fields,
    case when tg_op = 'INSERT' then null else old.status end,
    case when tg_op = 'DELETE' then null else new.status end,
    case when tg_op = 'INSERT' then null else old.is_visible end,
    case when tg_op = 'DELETE' then null else new.is_visible end
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.record_workshop_submission_audit() from public;

drop trigger if exists workshop_submission_audit_trigger
  on public.workshop_submissions;

create trigger workshop_submission_audit_trigger
after insert or update or delete on public.workshop_submissions
for each row execute function public.record_workshop_submission_audit();
