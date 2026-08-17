-- Close the two database-contract gaps found during final live acceptance.
-- Apply after 202608150007_private_reference_delivery.sql.

-- A consumed upload session has both consumed_at and submission_id populated.
-- ON DELETE SET NULL therefore conflicts with the table's paired-nullability
-- check when its submission is deleted. The session belongs to that submission,
-- so cascading the session is the consistent retention model. References
-- already cascade independently and the append-only audit row remains intact.
do $migration$
declare
  current_delete_action "char";
begin
  select constraint_record.confdeltype
  into current_delete_action
  from pg_catalog.pg_constraint as constraint_record
  where constraint_record.conrelid =
      'workshop_private.reference_upload_sessions'::pg_catalog.regclass
    and constraint_record.conname =
      'reference_upload_sessions_submission_id_fkey'
    and constraint_record.contype = 'f';

  if current_delete_action is null then
    raise exception using
      errcode = 'P0002',
      message = 'The reference upload session submission foreign key is missing.';
  end if;

  if current_delete_action <> 'c' then
    alter table workshop_private.reference_upload_sessions
      drop constraint reference_upload_sessions_submission_id_fkey;

    alter table workshop_private.reference_upload_sessions
      add constraint reference_upload_sessions_submission_id_fkey
      foreign key (submission_id)
      references public.workshop_submissions (id)
      on delete cascade
      not valid;

    alter table workshop_private.reference_upload_sessions
      validate constraint reference_upload_sessions_submission_id_fkey;
  end if;
end;
$migration$;

-- Trigger functions do not need Data API roles to execute them directly.
-- Revoking function EXECUTE does not remove or disable existing row/event
-- trigger bindings; their owners retain the privileges needed by PostgreSQL.
revoke all on function public.record_workshop_submission_audit()
  from public, anon, authenticated, service_role;

-- Some long-lived owner-controlled projects contain this live-only helper even
-- though a clean installation of the checked-in migrations does not. Harden it
-- when present without making it a dependency for new installations.
do $migration$
begin
  if pg_catalog.to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke all on function public.rls_auto_enable() '
      || 'from public, anon, authenticated, service_role';
  end if;
end;
$migration$;
