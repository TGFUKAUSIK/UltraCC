/**
 * pyq-sync — Supabase Edge Function (Deno)
 *
 * Server-side importer for the Q-Bank previous-year-question archive. It reads
 * the PUBLIC CodeChef-VIT Papers API (https://www.papers.codechefvit.com,
 * MIT © 2025 CodeChef-VIT) and writes normalised *metadata* into
 * public.pyq_papers + public.pyq_sync_runs (migration
 * 20260920000002_pyq_codechef.sql). The student-facing app then queries
 * Postgres and never talks to CodeChef-VIT.
 *
 * HOW ONE RUN COVERS 3,154 PAPERS IN TWO REQUESTS: upstream's `subject`
 * parameter is a literal substring match and every subject string it holds
 * contains a space, so '?subject=%20' returns the whole archive at once. Only
 * if that stops working does the importer fall back to walking the 648-entry
 * catalogue one subject per request — see sweepPapers() in sync.ts.
 *
 * WHAT THIS FUNCTION DOES NOT DO:
 *   - It never downloads, stores, proxies or streams a PDF. Only metadata.
 *   - It never touches VTOP: no credentials, no session, no student data is
 *     read or written here, and none can be — nothing in these tables is
 *     per-student.
 *   - It never truncates or deletes. Writes are keyed upserts, so an upstream
 *     outage leaves the previously imported archive exactly as it was.
 *   - It never disables TLS verification, and it refuses non-HTTPS targets for
 *     both upstream and Supabase.
 *
 * INVOCATION CONTRACT
 *   POST /functions/v1/pyq-sync            (GET is accepted for manual runs)
 *   Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>   — or —
 *   x-pyq-secret: <PYQ_SYNC_SECRET>        — or —  ?secret=<PYQ_SYNC_SECRET>
 *   Optional query: ?budget=<seconds, 5..300>
 *   Body: {} (ignored). Content-Type: application/json.
 *
 *   200 { status:'complete'|'partial', runId, startedAt, finishedAt,
 *         subjectsEnumerated, subjectsFetched, papersDiscovered,
 *         papersInserted, papersUpdated, papersSkippedUnchanged,
 *         papersFailed, errorSummary }
 *   401 { error:'unauthorized', detail }        — bad or missing secret
 *   405 { error:'method_not_allowed' }
 *   409 { error:'busy', detail }                — another run holds the claim
 *   500 { error:'missing_platform_env' }        — Supabase env not configured
 *   503 { error:'sync_not_configured', detail } — no usable secret is configured
 *   502 { error:'sync_threw', detail }          — unexpected internal failure
 *
 * A 'complete' or 'partial' body always carries the real counts; the caller (and
 * public.pyq_status()) reads the same numbers back from pyq_sync_runs.
 *
 * SECRETS (supabase secrets set …):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY — provided by the platform
 *   PYQ_SYNC_SECRET                        — operator-set, >= 32 chars. Optional
 *       only because the secret may instead live in public.pyq_sync_config,
 *       which is how the pg_cron schedule in migration 20260920000002 presents
 *       it. With neither configured this function refuses every caller.
 *
 * WALL CLOCK: the default run budget is 210 s, under the function timeout. If
 * the invocation is killed anyway, its pyq_sync_runs row stays 'running' and
 * pyq_sync_begin() treats a row older than 45 minutes as abandoned, so the next
 * scheduled run claims cleanly.
 *
 * PRIVACY: logs counts, subject names and status codes only. No Supabase or
 * upstream response body, no header value and no secret is ever logged.
 */

import {
  assertHttpsBaseUrl,
  decideSyncAuth,
  MIN_SECRET_LENGTH,
  runSync,
  SYNC_DEFAULTS,
  type RestImpl,
  type SyncRunSummary,
} from './sync.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-pyq-secret',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function envOrNull(name: string): string | null {
  const value = Deno.env.get(name);
  return value && value.trim() ? value.trim() : null;
}

/** True when the platform's Supabase URL is a valid HTTPS origin. */
function isHttpsSupabaseUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST' && request.method !== 'GET') {
    return json({ error: 'method_not_allowed', detail: 'Use POST (or GET for a manual run).' }, 405);
  }

  // --- Platform configuration ---------------------------------------------
  const rawUrl = envOrNull('SUPABASE_URL');
  const serviceKey = envOrNull('SUPABASE_SERVICE_ROLE_KEY');
  if (!rawUrl || !serviceKey) return json({ error: 'missing_platform_env' }, 500);

  let supabaseUrl: string;
  try {
    // HTTPS-only, and never a caller-supplied target: this value comes from the
    // platform environment only.
    supabaseUrl = assertHttpsBaseUrl(rawUrl);
  } catch {
    return json({ error: 'missing_platform_env', detail: 'SUPABASE_URL must be an https origin.' }, 500);
  }

  // --- Shared-secret guard -------------------------------------------------
  const configuredSecret = envOrNull('PYQ_SYNC_SECRET');
  if (configuredSecret && configuredSecret.length < MIN_SECRET_LENGTH) {
    // Refuse rather than honour a weak secret.
    return json({
      error: 'sync_not_configured',
      detail: `PYQ_SYNC_SECRET is shorter than ${MIN_SECRET_LENGTH} characters.`,
    }, 503);
  }

  const url = new URL(request.url);
  // pg_net can set headers, so the header is the primary path; the query
  // parameter exists for schedulers and operators that cannot.
  const provided = request.headers.get('x-pyq-secret') || url.searchParams.get('secret') || null;
  const bearer = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '') || null;

  const decision = decideSyncAuth({
    envSecret: configuredSecret,
    provided,
    bearer,
    serviceKey,
  });

  let authorized = decision.kind === 'authorized';
  let via = decision.kind === 'authorized' ? decision.via : null;

  if (decision.kind === 'ask-database') {
    // The database is the authority: compare inside a SECURITY DEFINER function
    // that returns a bare boolean, so the secret is never read into this
    // function and a wrong guess cannot be distinguished from a missing row.
    try {
      const check = await fetch(`${supabaseUrl}/rest/v1/rpc/authorize_pyq_sync`, {
        method: 'POST',
        headers: serviceHeaders(serviceKey),
        body: JSON.stringify({ p_secret: decision.secret }),
        signal: AbortSignal.timeout(10_000),
      });
      const ok = check.ok && (await check.json()) === true;
      if (ok) {
        authorized = true;
        via = 'db-secret';
      }
    } catch (error) {
      console.error('[pyq-sync] authorize probe failed', error instanceof Error ? error.name : 'unknown');
      authorized = false;
    }
  }

  if (!authorized) {
    return json({
      error: 'unauthorized',
      detail: decision.kind === 'denied' ? decision.reason : 'Secret does not match.',
    }, 401);
  }

  // --- Run -----------------------------------------------------------------
  const budgetSeconds = Number(url.searchParams.get('budget') ?? '') || null;
  const budgetMs = budgetSeconds
    ? Math.min(Math.max(budgetSeconds, 5), 300) * 1000
    : SYNC_DEFAULTS.budgetMs;

  const rest = buildRest(supabaseUrl, serviceKey);
  // Deno's fetch verifies certificates against the platform trust store; no
  // option below weakens that, and any https-only enforcement lives in sync.ts.
  const fetchUpstream = (target: string, init: RequestInit) => fetch(target, init);

  let summary: SyncRunSummary;
  try {
    summary = await runSync({
      fetchUpstream,
      rest,
      budgetMs,
      log: (message) => console.error(`[pyq-sync] ${message.slice(0, 200)}`),
    });
  } catch (error) {
    console.error('[pyq-sync] fatal', error instanceof Error ? error.name : 'unknown');
    return json({ error: 'sync_threw', detail: 'The import aborted unexpectedly; existing metadata is unchanged.' }, 502);
  }

  if (summary.busy) {
    return json({ error: 'busy', detail: 'A sync run is already in progress.' }, 409);
  }
  return json(summary, summary.status === 'failed' ? 502 : 200);
});

function serviceHeaders(serviceKey: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
  };
}

/**
 * PostgREST client for the service role. anon can only SELECT these tables, so
 * the write path exists solely here, server-side.
 */
function buildRest(supabaseUrl: string, serviceKey: string): RestImpl {
  return async (path, init) => {
    const headers = serviceHeaders(serviceKey);
    // merge-duplicates turns POST into an upsert on the UNIQUE external_paper_id;
    // return=minimal keeps the response tiny (we already know the counts).
    if (init.method === 'POST' && path.startsWith('/rest/v1/pyq_papers')) {
      headers.Prefer = 'resolution=merge-duplicates,return=minimal';
    }
    return await fetch(`${supabaseUrl}${path}`, {
      method: init.method,
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(30_000),
    });
  };
}
