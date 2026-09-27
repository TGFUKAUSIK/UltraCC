-- ---------------------------------------------------------------------------
-- Cab-share RPC helpers (replaces header/GUC-based UPDATE/DELETE policies,
-- which PostgREST cannot populate reliably from client headers).
--
-- join_cabride  — atomically decrement seats_left (returns false when full).
-- delete_cabride — delete a ride only when the correct poster code is given.
--
-- Both are SECURITY DEFINER so anon can use them without row-level write
-- access; they validate inside the function instead.
-- ---------------------------------------------------------------------------

create or replace function public.join_cabride(p_ride_id bigint)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ok boolean;
begin
  update public.cabshare_rides
     set seats_left = seats_left - 1
   where id = p_ride_id
     and seats_left > 0
  returning true into v_ok;
  return coalesce(v_ok, false);
end;
$$;

grant execute on function public.join_cabride(bigint) to anon, authenticated;

create or replace function public.delete_cabride(p_ride_id bigint, p_code text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ok boolean;
begin
  delete from public.cabshare_rides
   where id = p_ride_id
     and poster_code = p_code
  returning true into v_ok;
  return coalesce(v_ok, false);
end;
$$;

grant execute on function public.delete_cabride(bigint, text) to anon, authenticated;

-- Qn-paper delete by poster code (same pattern).
create or replace function public.delete_qbank_paper(p_paper_id bigint, p_code text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ok boolean;
begin
  delete from public.qbank_papers
   where id = p_paper_id
     and poster_code = p_code
  returning true into v_ok;
  return coalesce(v_ok, false);
end;
$$;

grant execute on function public.delete_qbank_paper(bigint, text) to anon, authenticated;
