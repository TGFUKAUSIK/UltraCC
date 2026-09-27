-- campus_data_cache — server-side ingest cache for public campus datasets
-- (clubs directory, transport routes, KOHA library search/detail pages).
--
-- Flow: upstream (server-side only, inside the campus-data edge function)
--       -> validated + normalized -> this table -> campus-data edge function
--       -> UltraCC frontend.
--
-- The anon role may never touch this table: reads happen only through the
-- campus-data edge function, which uses the service role. All writes happen
-- server-side during ingest.

create table if not exists public.campus_data_cache (
  dataset      text        not null,
  cache_key    text        not null default '',
  payload      jsonb       not null,
  synced_at    timestamptz not null default now(),
  primary key (dataset, cache_key)
);

create index if not exists campus_data_cache_dataset_idx
  on public.campus_data_cache (dataset);

comment on table public.campus_data_cache is
  'Server-side ingest cache for public campus datasets (clubs, transport, library search). Written only by the campus-data edge function with the service role; never writable or readable by anon.';

-- Lock the table down: no direct client access, in either direction.
alter table public.campus_data_cache enable row level security;

-- No RLS policies are created on purpose: with RLS enabled and no permissive
-- policy for anon/authenticated, every client-side read/write is denied.
-- The service role bypasses RLS, which is exactly the single server-side
-- access path the edge function uses.
