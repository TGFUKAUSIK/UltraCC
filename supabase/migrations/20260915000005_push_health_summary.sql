-- ---------------------------------------------------------------------------
-- Push delivery health, with evidence (2026-09-15).
--
-- The first version of push_dispatch_health() reported only the LATEST run's
-- counters — which read as "claimed 0, sent 0" during any quiet minute, even
-- if it had just delivered six reminders a minute earlier. That is exactly the
-- kind of number that makes a working system look broken.
--
-- This version reports the run heartbeat plus what actually happened over the
-- last day, so Settings can say "checked 1 min ago · 4 delivered in 24h" and
-- mean it. Still masked: timings and counts only, never endpoints or secrets.
-- ---------------------------------------------------------------------------

create or replace function public.push_dispatch_health()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run        public.push_dispatch_runs%rowtype;
  v_totals     record;
  v_last_claim timestamptz;
begin
  select * into v_run
    from public.push_dispatch_runs
   where authorized
   order by ran_at desc
   limit 1;

  if v_run.id is null then
    -- No authorized run has ever been recorded: the scheduler is not wired up.
    return jsonb_build_object('deliveryActive', false, 'lastRunAt', null);
  end if;

  select count(*)                     as runs,
         coalesce(sum(claimed), 0)    as claimed,
         coalesce(sum(sent), 0)       as sent,
         coalesce(sum(failed), 0)     as failed
    into v_totals
    from public.push_dispatch_runs
   where authorized
     and ran_at > now() - interval '24 hours';

  -- The most recent run that had something to deliver (proof of the full path).
  select max(ran_at) into v_last_claim
    from public.push_dispatch_runs
   where authorized
     and claimed > 0
     and ran_at > now() - interval '7 days';

  return jsonb_build_object(
    'deliveryActive', v_run.ran_at > now() - interval '10 minutes',
    'lastRunAt', v_run.ran_at,
    'runs24h', v_totals.runs,
    'claimed24h', v_totals.claimed,
    'sent24h', v_totals.sent,
    'failed24h', v_totals.failed,
    'lastDeliveryAt', v_last_claim
  );
end;
$$;

grant execute on function public.push_dispatch_health() to anon, authenticated;

notify pgrst, 'reload schema';
