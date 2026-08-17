-- Return deterministic HTTP 409 responses for browser-reachable optimistic
-- concurrency conflicts. PostgreSQL class 40 errors represent transaction
-- rollback and can be retried below the application layer; PostgREST's PT409
-- custom SQLSTATE preserves the no-mutation contract without that ambiguity.
-- Apply after 202608170008_live_role_and_delete_hardening.sql.

do $migration$
declare
  admin_update regprocedure := pg_catalog.to_regprocedure(
    'public.workshop_admin_update(text,uuid,timestamp with time zone,text,text,text,text,text[],text,text,text)'
  );
  excel_worker regprocedure := pg_catalog.to_regprocedure(
    'workshop_private.excel_batch_import(text,text,jsonb,boolean)'
  );
  definition text;
  legacy_code constant text := '''40001''';
  http_conflict_code constant text := '''PT409''';
  occurrence_count integer;
begin
  if admin_update is null then
    raise exception using
      errcode = '0A000',
      message = 'workshop_admin_update is missing; apply migration 005 first.';
  end if;

  definition := pg_catalog.pg_get_functiondef(admin_update);
  occurrence_count := (
    pg_catalog.char_length(definition) -
    pg_catalog.char_length(pg_catalog.replace(definition, legacy_code, ''))
  ) / pg_catalog.char_length(legacy_code);

  if occurrence_count <> 1 then
    raise exception using
      errcode = '0A000',
      message = 'workshop_admin_update concurrency guard did not match the expected source.';
  end if;

  execute pg_catalog.replace(definition, legacy_code, http_conflict_code);

  if excel_worker is null then
    raise exception using
      errcode = '0A000',
      message = 'excel_batch_import is missing; apply migration 005 first.';
  end if;

  definition := pg_catalog.pg_get_functiondef(excel_worker);
  occurrence_count := (
    pg_catalog.char_length(definition) -
    pg_catalog.char_length(pg_catalog.replace(definition, legacy_code, ''))
  ) / pg_catalog.char_length(legacy_code);

  if occurrence_count <> 1 then
    raise exception using
      errcode = '0A000',
      message = 'excel_batch_import concurrency guard did not match the expected source.';
  end if;

  execute pg_catalog.replace(definition, legacy_code, http_conflict_code);

  if pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(admin_update), legacy_code
  ) > 0 or pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(admin_update), http_conflict_code
  ) = 0 then
    raise exception using
      errcode = '0A000',
      message = 'workshop_admin_update conflict hardening did not take effect.';
  end if;

  if pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(excel_worker), legacy_code
  ) > 0 or pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(excel_worker), http_conflict_code
  ) = 0 then
    raise exception using
      errcode = '0A000',
      message = 'excel_batch_import conflict hardening did not take effect.';
  end if;
end;
$migration$;

-- CREATE OR REPLACE preserves grants, but restate the browser boundary so the
-- forward migration remains auditable without relying on implicit behavior.
revoke all on function public.workshop_admin_update(
  text,
  uuid,
  timestamptz,
  text,
  text,
  text,
  text,
  text[],
  text,
  text,
  text
) from public, anon, authenticated, service_role;

grant execute on function public.workshop_admin_update(
  text,
  uuid,
  timestamptz,
  text,
  text,
  text,
  text,
  text[],
  text,
  text,
  text
) to anon;

revoke all on function workshop_private.excel_batch_import(
  text,
  text,
  jsonb,
  boolean
) from public, anon, authenticated, service_role;

comment on function public.workshop_admin_update(
  text,
  uuid,
  timestamptz,
  text,
  text,
  text,
  text,
  text[],
  text,
  text,
  text
) is
  'Capability-protected admin update. A stale updated_at version returns PostgREST HTTP 409 (PT409) without mutation.';

comment on function workshop_private.excel_batch_import(
  text,
  text,
  jsonb,
  boolean
) is
  'Trusted atomic Excel worker. It is revoked from API roles; a concurrent insertion conflict returns PostgREST HTTP 409 (PT409) without mutation.';

notify pgrst, 'reload schema';
