-- ---------------------------------------------------------------------------
-- Schedule the push dispatcher (2026-09-15).
--
-- WHAT THIS DOES
--   Every minute, pg_cron asks pg_net to POST the dispatcher, passing the
--   secret generated in public.push_cron_config — read from the table at each
--   run, so it is never written into this file, into the repository, or into
--   the function's environment.
--
-- SAFETY
--   Everything here is optional and non-fatal: if pg_cron or pg_net is not
--   enabled on the project, this migration raises a notice and the app keeps
--   working with in-app notifications until an operator enables the extension
--   (Dashboard → Database → Extensions) and re-runs it. Nothing half-scheduled
--   is left behind — an existing job is removed before the new one is created.
-- ---------------------------------------------------------------------------

do $$
begin
  create extension if not exists pg_cron with schema pg_catalog;
exception when others then
  raise notice 'push-dispatch: pg_cron could not be enabled (%) — enable it in Database → Extensions, then run this file again', sqlerrm;
end;
$$;

do $$
begin
  create extension if not exists pg_net with schema extensions;
exception when others then
  raise notice 'push-dispatch: pg_net could not be enabled (%) — enable it in Database → Extensions, then run this file again', sqlerrm;
end;
$$;

-- Replace any previous job so this file stays safe to run twice.
do $$
declare
  v_job record;
begin
  for v_job in select jobid from cron.job where jobname = 'push-dispatch' loop
    perform cron.unschedule(v_job.jobid);
  end loop;
exception when others then
  raise notice 'push-dispatch: could not inspect cron.job (%)', sqlerrm;
end;
$$;

do $$
declare
  -- Your project's own URL (public, not a secret). Replace <project-ref>.
  v_project_url text := 'https://<project-ref>.supabase.co';
  v_http_schema text;
  v_command     text;
begin
  -- pg_net may live in `net`, in `extensions`, or wherever an operator put it.
  select n.nspname into v_http_schema
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where p.proname = 'http_post'
   order by (n.nspname = 'net') desc, (n.nspname = 'extensions') desc
   limit 1;

  if v_http_schema is null then
    raise notice 'push-dispatch: pg_net is not available, so no cron job was created — enable it in Database → Extensions and re-run this file';
    return;
  end if;

  v_command := format(
    $cmd$select %I.http_post(
      url := %L,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (select secret from public.push_cron_config limit 1)
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 20000
    );$cmd$,
    v_http_schema,
    v_project_url || '/functions/v1/push-dispatch'
  );

  perform cron.schedule('push-dispatch', '* * * * *', v_command);
  raise notice 'push-dispatch: scheduled every minute through %', v_http_schema;
exception when others then
  raise notice 'push-dispatch: scheduling failed (%) — set the cron job up in Supabase → Integrations → Cron instead', sqlerrm;
end;
$$;

notify pgrst, 'reload schema';
