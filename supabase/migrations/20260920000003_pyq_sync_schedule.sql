-- ---------------------------------------------------------------------------
-- CodeChef-VIT PYQ archive: register the daily sync schedule.
--
-- WHY THIS IS ITS OWN FILE
--   20260920000002_pyq_codechef.sql ends with a scheduling block that refuses
--   to fire unless public.pyq_sync_config holds a >=32-character secret, and
--   that row is operator-supplied on purpose — the value must never exist in
--   the repository. On this project the migration was pushed before the secret
--   was created, so the block correctly skipped and the file is now recorded as
--   applied. Rather than editing an applied migration or hand-poking the
--   database outside the migration history, this file re-runs the same guarded
--   decision through `supabase db push`, and stops the moment anything is
--   missing instead of scheduling a job that would fail quietly.
--
-- WHAT IT TOUCHES
--   Nothing but the pg_cron job registry. No table, column, index, grant,
--   policy or row in public.pyq_papers / pyq_sync_runs / pyq_sync_config is
--   created, altered or removed here. Unscheduling first keeps it safe to run
--   twice.
--
-- CADENCE, STATED ACCURATELY
--   '40 3 * * *' is pg_cron UTC, i.e. 03:40 UTC = 09:10 IST. (The comment in
--   the first migration annotated it as 22:10 UTC, which is wrong; that file is
--   already applied so its comment is left as it shipped.) A run costs two
--   upstream requests and ~3,150 keyed upserts — measured at 4.7 s cold and
--   1.9 s when everything is unchanged — so once a day is comfortably inside a
--   free project's budget, and the papers themselves are never fetched.
--
-- HOW THE SECRET REACHES THE FUNCTION
--   The cron command reads the secret out of public.pyq_sync_config at fire
--   time, so it is never baked into the job definition, never appears in
--   cron.job, and rotating the value in that table plus the function secret is
--   all it takes.
-- ---------------------------------------------------------------------------

-- Drop any previous copy of this job so re-running replaces rather than stacks.
do $$
begin
  if to_regnamespace('cron') is null then
    raise notice 'pyq-sync: pg_cron is not installed on this project, so nothing was scheduled — enable it in Database → Extensions and run this file again';
    return;
  end if;
  perform cron.unschedule(jobid)
    from cron.job
   where jobname = 'pyq-sync';
exception when others then
  -- The registry exists but this role cannot read or unschedule from it. The
  -- block below decides whether that matters; it is not a reason to abort.
  raise notice 'pyq-sync: could not inspect cron.job (%) — continuing', sqlerrm;
end;
$$;

do $$
declare
  -- Your project's own URL. Public information, not a secret. Replace <project-ref>.
  v_project_url text := 'https://<project-ref>.supabase.co';
  v_secret      text;
  v_http_schema text;
  v_command     text;
begin
  -- No operator-configured secret -> no schedule. Never a default, never a
  -- placeholder, never a guess.
  select secret into v_secret from public.pyq_sync_config limit 1;
  if v_secret is null or length(v_secret) < 32 then
    raise notice 'pyq-sync: public.pyq_sync_config holds no usable secret, so nothing was scheduled — set one there and as the PYQ_SYNC_SECRET function secret, then run this file again';
    return;
  end if;

  -- pg_net puts http_post in `net`, in `extensions`, or wherever an operator
  -- placed it; the schedule has to name the real one.
  select n.nspname into v_http_schema
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where p.proname = 'http_post'
   order by (n.nspname = 'net') desc, (n.nspname = 'extensions') desc
   limit 1;

  if v_http_schema is null then
    raise notice 'pyq-sync: pg_net http_post is not available, so nothing was scheduled — enable pg_net in Database → Extensions and run this file again';
    return;
  end if;

  -- The timeout covers the importer's own 210 s budget plus headroom for its
  -- per-subject fallback path, so a slow day delays the run instead of killing
  -- it at 30 s and leaving a 'running' row behind.
  v_command := format(
    $cmd$select %I.http_post(
      url := %L,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-pyq-secret', (select secret from public.pyq_sync_config limit 1)
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 240000
    );$cmd$,
    v_http_schema,
    v_project_url || '/functions/v1/pyq-sync'
  );

  perform cron.schedule('pyq-sync', '40 3 * * *', v_command);
  raise notice 'pyq-sync: scheduled daily at 03:40 UTC through the % schema', v_http_schema;
exception when others then
  raise notice 'pyq-sync: scheduling failed (%) — create the job in Supabase → Integrations → Cron instead', sqlerrm;
end;
$$;
