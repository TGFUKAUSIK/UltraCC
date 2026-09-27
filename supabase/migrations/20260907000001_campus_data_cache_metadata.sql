-- campus_data_cache metadata — distinguishes complete vs partial datasets.
--
-- record_count: number of records the ingest produced (clubs count, routes
--   count, etc.) so a shrunken/partial payload is detectable server-side.
-- sync_status:  'complete' | 'partial' — a partial ingest never overwrites a
--   complete row (enforced by the campus-data function, made auditable here).
--
-- Additive and backward compatible: existing rows keep NULL record_count and
-- default 'complete' status, and the (dataset, cache_key) primary key is
-- unchanged, so the edge function keeps working across the migration.
--
-- RLS stays enabled with no permissive policies: only the service role
-- (campus-data edge function) may read or write this table.

alter table public.campus_data_cache
  add column if not exists record_count integer;

alter table public.campus_data_cache
  add column if not exists sync_status text not null default 'complete'
    check (sync_status in ('complete', 'partial'));

comment on column public.campus_data_cache.record_count is
  'Record count of the last successful ingest (null for rows written before this column existed).';
comment on column public.campus_data_cache.sync_status is
  'complete when the full upstream dataset was ingested; partial rows must never replace a complete cached copy.';
